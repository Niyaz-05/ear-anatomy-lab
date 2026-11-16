import { useEffect, useReducer, useRef } from 'react';
import { balanceLive } from './live';
import type { HeadMotion } from './sim';

/**
 * Runs the balance simulation in real time while a view that uses it is open (Balance, and the
 * crista and macula close-ups). Outside them the head is put back at rest.
 */
export function useBalanceDriver(active: boolean, playing: boolean, motion: HeadMotion, spin: number) {
  useEffect(() => { balanceLive.setMotion(active ? motion : 'none'); }, [active, motion]);
  const lastSpin = useRef(spin);
  useEffect(() => {
    if (active && spin > 0 && spin !== lastSpin.current) balanceLive.startSpin();
    lastSpin.current = spin;
  }, [active, spin]);
  useEffect(() => {
    if (!active) { balanceLive.reset(); return; }
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      if (playing) balanceLive.step(dt);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, playing]);
}

/** Re-render a panel when the balance simulation changes, at most `hz` times a second. */
export function useBalanceLive(hz = 12) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    let last = 0, timer = 0;
    const off = balanceLive.subscribe(() => {
      const now = performance.now();
      if (now - last >= 1000 / hz) { last = now; bump(); }
      else if (!timer) timer = window.setTimeout(() => { timer = 0; last = performance.now(); bump(); }, 1000 / hz);
    });
    return () => { off(); window.clearTimeout(timer); };
  }, [hz]);
  return balanceLive;
}
