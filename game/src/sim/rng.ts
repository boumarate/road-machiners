// The only source of randomness in the sim. State lives in the world, so replays are exact.

export type Rng = { rngState: number };

// mulberry32
export function nextRandom(r: Rng): number {
  r.rngState = (r.rngState + 0x6d2b79f5) | 0;
  let t = r.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randRange(r: Rng, lo: number, hi: number): number {
  return lo + (hi - lo) * nextRandom(r);
}

export function randInt(r: Rng, lo: number, hi: number): number {
  return Math.floor(randRange(r, lo, hi + 1));
}

export function chance(r: Rng, p: number): boolean {
  return nextRandom(r) < p;
}

// Standard normal draw, Box-Muller. 1 - u keeps the log argument in (0, 1].
export function gauss(r: Rng): number {
  const u = 1 - nextRandom(r);
  const v = nextRandom(r);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// A pure draw in [0, 1), keyed by a seed and any number of integer keys. Same inputs always give the
// same output, and it never reads or writes world.rngState, so it can be called any number of times
// within a turn (for example once per contact) without shifting the world's random stream.
export function hashRandom(seed: number, ...keys: number[]): number {
  let h = seed | 0;
  for (const k of keys) {
    h = Math.imul(h ^ (k | 0), 0x9e3779b1);
    h ^= h >>> 15;
  }
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
