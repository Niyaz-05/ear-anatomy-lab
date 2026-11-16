/**
 * Optional pure-tone playback (Web Audio). Off until the learner presses Play, so it always starts
 * from a user gesture; the output is capped well below full scale whatever the level slider says
 * (the slider's dB SPL describe the simulated sound, not what your speakers play), and it ramps in
 * and out to avoid clicks.
 */
const MAX_GAIN = 0.12;

/** Output gain for a simulated level: louder with level, but never above MAX_GAIN. */
export function toneGain(levelDb: number): number {
  if (levelDb <= 0) return 0;
  return Math.min(MAX_GAIN, 0.004 * 10 ** ((levelDb - 40) / 40));
}

export class TonePlayer {
  private ctx: AudioContext | null = null;
  private osc: OscillatorNode | null = null;
  private gain: GainNode | null = null;

  get playing() { return this.osc !== null; }

  start(freqHz: number, levelDb: number): boolean {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return false;
    this.ctx ??= new AC();
    void this.ctx.resume();
    this.stop(true);
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freqHz;
    gain.gain.value = 0;
    osc.connect(gain).connect(this.ctx.destination);
    osc.start();
    gain.gain.setTargetAtTime(toneGain(levelDb), this.ctx.currentTime, 0.03);
    this.osc = osc; this.gain = gain;
    return true;
  }

  update(freqHz: number, levelDb: number) {
    if (!this.ctx || !this.osc || !this.gain) return;
    this.osc.frequency.setTargetAtTime(freqHz, this.ctx.currentTime, 0.02);
    this.gain.gain.setTargetAtTime(toneGain(levelDb), this.ctx.currentTime, 0.03);
  }

  stop(now = false) {
    const { ctx, osc, gain } = this;
    this.osc = null; this.gain = null;
    if (!ctx || !osc || !gain) return;
    gain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
    osc.stop(ctx.currentTime + (now ? 0.01 : 0.12));
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }
}
