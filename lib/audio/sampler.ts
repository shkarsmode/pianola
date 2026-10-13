/** A grand piano from Salamander samples (one every three semitones), pitched to fill the gaps. */

const SAMPLE_NAMES: [string, number][] = (() => {
  const out: [string, number][] = [["A0", 21]];
  for (let o = 1; o <= 7; o++) {
    const c = 12 * (o + 1);
    out.push([`C${o}`, c], [`Ds${o}`, c + 3], [`Fs${o}`, c + 6], [`A${o}`, c + 9]);
  }
  out.push(["C8", 108]);
  return out;
})();

export interface Voice {
  stop(at?: number): void;
}

function impulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let seed = ch ? 7 : 13;
    for (let i = 0; i < len; i++) {
      seed = (seed * 16807) % 2147483647;
      const noise = (seed / 2147483647) * 2 - 1;
      d[i] = noise * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

export class PianoSampler {
  readonly output: GainNode;
  private buffers = new Map<number, AudioBuffer>();
  private loading: Promise<void> | null = null;
  private voices = new Set<{ src: AudioBufferSourceNode; gain: GainNode }>();

  constructor(
    private ctx: AudioContext,
    destination: AudioNode,
    private base = "/samples/piano",
  ) {
    this.output = ctx.createGain();
    this.output.gain.value = 0.9;
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    const verb = ctx.createConvolver();
    verb.buffer = impulse(ctx, 2.2, 3.2);
    wet.gain.value = 0.16;
    dry.gain.value = 0.92;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    this.output.connect(dry).connect(comp);
    this.output.connect(verb).connect(wet).connect(comp);
    comp.connect(destination);
  }

  load(): Promise<void> {
    if (!this.loading) {
      this.loading = Promise.all(
        SAMPLE_NAMES.map(async ([name, midi]) => {
          const res = await fetch(`${this.base}/${name}.mp3`);
          const data = await res.arrayBuffer();
          this.buffers.set(midi, await this.ctx.decodeAudioData(data));
        }),
      ).then(() => undefined);
    }
    return this.loading;
  }

  get ready(): boolean {
    return this.buffers.size === SAMPLE_NAMES.length;
  }

  private nearest(pitch: number): [number, AudioBuffer] | null {
    let best: number | null = null;
    for (const m of this.buffers.keys()) if (best == null || Math.abs(m - pitch) < Math.abs(best - pitch)) best = m;
    return best == null ? null : [best, this.buffers.get(best)!];
  }

  /** Plays a note at `when` (AudioContext time) for `dur` seconds; the release follows. */
  play(pitch: number, vel: number, when: number, dur: number, gainScale = 1): Voice {
    const hit = this.nearest(pitch);
    if (!hit) return { stop() {} };
    const [root, buffer] = hit;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = Math.pow(2, (pitch - root) / 12);
    const gain = ctx.createGain();
    const v = Math.max(0.02, Math.min(1, vel / 127));
    const level = Math.pow(v, 1.6) * 0.95 * gainScale;
    const start = Math.max(when, ctx.currentTime);
    gain.gain.setValueAtTime(level, start);
    const release = pitch < 48 ? 0.5 : pitch < 72 ? 0.35 : 0.25;
    const off = start + Math.max(0.05, dur);
    gain.gain.setTargetAtTime(0, off, release / 3);
    src.connect(gain).connect(this.output);
    src.start(start);
    src.stop(off + release * 2.5);
    const voice = { src, gain };
    this.voices.add(voice);
    src.onended = () => {
      this.voices.delete(voice);
      gain.disconnect();
    };
    return {
      stop: (at?: number) => {
        const t = Math.max(at ?? ctx.currentTime, ctx.currentTime);
        gain.gain.cancelScheduledValues(t);
        gain.gain.setTargetAtTime(0, t, 0.03);
        try {
          src.stop(t + 0.15);
        } catch {
          /* already stopped */
        }
      },
    };
  }

  stopAll() {
    const t = this.ctx.currentTime;
    for (const { src, gain } of this.voices) {
      gain.gain.cancelScheduledValues(t);
      gain.gain.setTargetAtTime(0, t, 0.02);
      try {
        src.stop(t + 0.1);
      } catch {
        /* already stopped */
      }
    }
  }
}
