/**
 * A short two-note chime, synthesized so there's no audio file to ship.
 * Runs wherever an AudioContext exists: the offscreen document or the options page.
 */
export async function playChime(volume: number): Promise<void> {
  if (volume <= 0) return;
  const ctx = new AudioContext();
  if (ctx.state === "suspended") await ctx.resume();

  const master = ctx.createGain();
  master.gain.value = 0.35 * Math.min(1, volume);
  master.connect(ctx.destination);

  const start = ctx.currentTime + 0.02;
  // Two bell-like notes (E6 then A6) with a soft attack and a long-ish decay.
  const notes = [
    { freq: 1318.5, at: 0, length: 0.55 },
    { freq: 1760, at: 0.13, length: 0.75 },
  ];
  for (const { freq, at, length } of notes) {
    for (const [ratio, level] of [
      [1, 1],
      [2, 0.18], // a touch of overtone so it rings rather than beeps
    ] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq * ratio;
      const t = start + at;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(level, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
      osc.connect(gain).connect(master);
      osc.start(t);
      osc.stop(t + length + 0.05);
    }
  }

  const end = start + 1;
  await new Promise((resolve) => setTimeout(resolve, (end - ctx.currentTime) * 1000 + 100));
  await ctx.close();
}
