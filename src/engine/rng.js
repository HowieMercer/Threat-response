/* Seeded RNG.
 *
 * Deterministic on purpose. A run is fully described by its seed, which is
 * what makes "play the run I just played" possible from a URL fragment —
 * the single cheapest thing this game can do for booth competition and for
 * anyone sharing a score. It also means a reported bug is reproducible
 * instead of anecdotal.
 */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Seeds are shown to players and typed back in, so they need to survive
 * being read aloud across a trade show stand. Base36, uppercase, no
 * ambiguous characters. */
const ALPHABET = '23456789ACDEFGHJKLMNPQRTUVWXYZ';

export function encodeSeed(seed) {
  let n = seed >>> 0;
  let out = '';
  do {
    out = ALPHABET[n % ALPHABET.length] + out;
    n = Math.floor(n / ALPHABET.length);
  } while (n > 0);
  return out.padStart(5, ALPHABET[0]);
}

export function decodeSeed(code) {
  const s = String(code || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (!s) return null;
  let n = 0;
  for (const ch of s) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) return null;
    n = n * ALPHABET.length + i;
  }
  return n >>> 0;
}

export function randomSeed() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    return crypto.getRandomValues(new Uint32Array(1))[0] >>> 0;
  }
  return (Math.random() * 4294967296) >>> 0;
}

export function pick(rand, arr) {
  return arr[Math.floor(rand() * arr.length) % arr.length];
}
