/**
 * Values that change every frame, shared by the 3D scene and the panels without going through React
 * state: the balance simulation (head movement → cupulae → afferents → eye movements). The science is
 * in src/ear/balance.ts; this only integrates it in time. The scene reads it in its frame loop; the
 * panels subscribe and re-render a few times a second.
 */
import {
  canalReadout, createCanalState, nystagmusStep, spinStopSimulation, stepCanals,
  type CanalId, type CanalReading, type CanalState, type NystagmusState, type SpinSample, type Vec3,
} from '../ear/balance';
import type { HeadMotion } from './sim';

export type Axis = 'yaw' | 'pitch' | 'roll';
const AXIS: Record<Axis, keyof Vec3> = { yaw: 'y', pitch: 'x', roll: 'z' };

/** A quick head turn: `deg` degrees about an axis over `durS`, with a smooth (half-sine) velocity profile. */
interface Turn { axis: Axis; deg: number; t0: number; durS: number }

export const SPIN = { omegaDegS: 100, spinS: 40, afterS: 40, dtS: 0.05, speed: 4 } as const;
/** Seconds of eye-position trace kept. */
export const TRACE_S = 3;
const TRACE_N = 180;

export class BalanceLive {
  time = 0;
  canal: CanalState = createCanalState();
  /** Head angular velocity now, deg/s (balance.ts frame: y yaw-left, x nose-up, z right-ear-down). */
  omega: Vec3 = { x: 0, y: 0, z: 0 };
  /** Head orientation for the icon, degrees: yaw (+ left), pitch (+ nose up), roll (+ right ear down). */
  head = { yaw: 0, pitch: 0, roll: 0 };
  readings: Record<CanalId, CanalReading> = canalReadout({ x: 0, y: 0, z: 0 });
  /** Horizontal slow-phase eye velocity, deg/s (+ = leftwards), and the eye-position trace (+ = right). */
  spv = 0;
  nyst: NystagmusState = { positionDeg: 0, fast: false };
  trace = new Float32Array(TRACE_N);
  private traceAcc = 0;
  private turns: Turn[] = [];
  private drag: Vec3 = { x: 0, y: 0, z: 0 };
  private dragAt = -1;
  motion: HeadMotion = 'none';
  private motionT = 0;
  /** The spin-and-stop run being played back, if any. */
  spin: { samples: SpinSample[]; t: number; stopTimeS: number; tauCupulaS: number; tauStorageS: number; done: boolean } | null = null;
  private listeners = new Set<() => void>();
  version = 0;

  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private notify() { this.version++; this.listeners.forEach((f) => f()); }

  /** Start a quick head turn (adds to any movement already going on). */
  turn(axis: Axis, deg: number, durS = 0.5) {
    this.stopSpin();
    this.turns.push({ axis, deg, t0: this.time, durS });
    this.notify();
  }
  /** Turn the head back to straight ahead. */
  centre() {
    this.stopSpin();
    (['yaw', 'pitch', 'roll'] as Axis[]).forEach((a) => { const d = -this.head[a]; if (Math.abs(d) > 0.5) this.turns.push({ axis: a, deg: d, t0: this.time, durS: 0.6 }); });
    this.notify();
  }
  /** Head velocity from a drag on the head icon, deg/s; it fades when the drag stops. */
  setDrag(omega: Vec3) { this.drag = omega; this.dragAt = this.time; }
  setMotion(m: HeadMotion) { if (m !== this.motion) { this.motion = m; this.motionT = 0; if (m !== 'none') this.stopSpin(); } }

  startSpin() {
    const r = spinStopSimulation({ omegaDegS: SPIN.omegaDegS, spinS: SPIN.spinS, afterS: SPIN.afterS, dtS: SPIN.dtS });
    this.turns = []; this.motion = 'none'; this.drag = { x: 0, y: 0, z: 0 };
    this.canal = createCanalState();
    this.head = { yaw: 0, pitch: 0, roll: 0 };
    this.spin = { ...r, t: 0, done: false };
    this.notify();
  }
  stopSpin() { if (this.spin) { this.spin = null; this.canal = createCanalState(); } }
  /** The spin-and-stop sample now (when one is playing). */
  spinSample(): SpinSample | null {
    if (!this.spin) return null;
    const i = Math.min(this.spin.samples.length - 1, Math.max(0, Math.round(this.spin.t / SPIN.dtS)));
    return this.spin.samples[i] ?? null;
  }
  /** Whether anything is moving (the scene keeps rendering while it does). */
  get active() {
    return this.turns.length > 0 || this.motion !== 'none' || (this.spin !== null && !this.spin.done) || Math.hypot(this.canal.cupula.x, this.canal.cupula.y, this.canal.cupula.z) > 0.2 || this.time - this.dragAt < 0.3;
  }

  reset() {
    this.turns = []; this.motion = 'none'; this.spin = null; this.drag = { x: 0, y: 0, z: 0 };
    this.canal = createCanalState(); this.head = { yaw: 0, pitch: 0, roll: 0 };
    this.omega = { x: 0, y: 0, z: 0 }; this.readings = canalReadout(this.omega);
    this.nyst = { positionDeg: 0, fast: false }; this.trace.fill(0); this.spv = 0;
    this.notify();
  }

  /** Advance by `dt` seconds of real time. */
  step(dtIn: number) {
    const dt = Math.min(0.05, Math.max(0, dtIn));
    if (dt === 0) return;
    this.time += dt;
    const w: Vec3 = { x: 0, y: 0, z: 0 };
    if (this.spin) {
      this.spin.t = Math.min(this.spin.t + dt * SPIN.speed, SPIN.spinS + SPIN.afterS);
      this.spin.done = this.spin.t >= SPIN.spinS + SPIN.afterS;
      const s = this.spinSample()!;
      w.y = s.headVelocity;
      this.canal = { adapted: { x: 0, y: s.headVelocity - s.cupula, z: 0 }, cupula: { x: 0, y: s.cupula, z: 0 }, t: s.t };
      this.spv = s.slowPhaseVelocity;
      this.head.yaw = ((this.head.yaw + s.headVelocity * dt * SPIN.speed + 180) % 360 + 360) % 360 - 180;
    } else {
      // Quick turns: half-sine velocity, so each turn starts and ends at rest.
      this.turns = this.turns.filter((t) => {
        const u = (this.time - t.t0) / t.durS;
        if (u >= 1) return false;
        if (u > 0) w[AXIS[t.axis]] += (t.deg * Math.PI) / (2 * t.durS) * Math.sin(Math.PI * u);
        return true;
      });
      if (this.motion !== 'none') {
        this.motionT += dt;
        w[AXIS[this.motion]] += 90 * Math.sin(2 * Math.PI * 0.4 * this.motionT);
      }
      if (this.time - this.dragAt < 0.12) { w.x += this.drag.x; w.y += this.drag.y; w.z += this.drag.z; }
      this.canal = stepCanals(this.canal, w, dt);
      this.head.yaw = Math.max(-170, Math.min(170, this.head.yaw + w.y * dt));
      this.head.pitch = Math.max(-80, Math.min(80, this.head.pitch + w.x * dt));
      this.head.roll = Math.max(-80, Math.min(80, this.head.roll + w.z * dt));
      // Horizontal VOR: the eyes turn against the head velocity the canals signal.
      this.spv = -this.canal.cupula.y;
    }
    this.omega = w;
    this.readings = canalReadout(this.canal.cupula);
    this.nyst = nystagmusStep(this.nyst, this.spv, dt);
    // With no vestibular drive the eyes return to straight ahead.
    if (Math.abs(this.spv) < 1) this.nyst = { positionDeg: this.nyst.positionDeg * (1 - Math.min(1, dt * 3)), fast: false };
    // Trace in real time, + = rightwards (nystagmusStep counts + leftwards, like yaw).
    this.traceAcc += dt;
    const every = TRACE_S / TRACE_N;
    while (this.traceAcc >= every) {
      this.traceAcc -= every;
      this.trace.copyWithin(0, 1);
      this.trace[TRACE_N - 1] = -this.nyst.positionDeg;
    }
    this.notify();
  }
}

export const balanceLive = new BalanceLive();
