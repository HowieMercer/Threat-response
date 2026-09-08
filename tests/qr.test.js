/* QR encoder tests.
 *
 * The scorecard QR is the only thing a prospect physically takes away
 * from a stand, and a broken one fails silently: it renders, it looks
 * exactly like a QR code, and no phone will read it. Both bugs found
 * while writing the encoder were of that shape — format-information bits
 * placed least-significant-first, and the second format copy split 8/7
 * across the corners instead of 7/8. Neither is visible by eye.
 *
 * So these tests decode. `readBack` below walks the finished matrix the
 * way a scanner does — unmask, de-interleave, strip the header — and
 * compares the bytes to what went in. A structural test would have passed
 * on both of those bugs.
 */

import { describe, it, expect } from 'vitest';
import { encodeQR } from '../src/ui/qr.js';
import reference from './qr-reference.json';

/* ---------------------------------------------------------- a decoder */

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

const SPEC_M = {
  1: [26, 10, 1, 16, 0, 0], 2: [44, 16, 1, 28, 0, 0], 3: [70, 26, 1, 44, 0, 0],
  4: [100, 18, 2, 32, 0, 0], 5: [134, 24, 2, 43, 0, 0], 6: [172, 16, 4, 27, 0, 0],
  7: [196, 18, 4, 31, 0, 0], 8: [242, 22, 2, 38, 2, 39], 9: [292, 22, 3, 36, 2, 37],
  10: [346, 26, 4, 43, 1, 44],
};
const ALIGN = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

/* Which cells are function patterns rather than data. Mirrors the
 * encoder's own reservation, derived independently from the spec so a
 * mistake in one does not hide a mistake in the other. */
function functionMask(version) {
  const size = version * 4 + 17;
  const f = Array.from({ length: size }, () => new Array(size).fill(false));
  const mark = (r, c) => {
    if (r >= 0 && c >= 0 && r < size && c < size) f[r][c] = true;
  };
  for (const [r0, c0] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) mark(r0 + r, c0 + c);
  }
  for (let i = 0; i < size; i++) {
    mark(6, i);
    mark(i, 6);
  }
  for (const r of ALIGN[version]) {
    for (const c of ALIGN[version]) {
      if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) mark(r + dr, c + dc);
    }
  }
  for (let i = 0; i < 9; i++) {
    mark(8, i);
    mark(i, 8);
  }
  for (let i = 0; i < 8; i++) {
    mark(8, size - 1 - i);
    mark(size - 1 - i, 8);
  }
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      mark(Math.floor(i / 3), size - 11 + (i % 3));
      mark(size - 11 + (i % 3), Math.floor(i / 3));
    }
  }
  return f;
}

/* Read the 15 format bits out of both copies. Returns the EC level and
 * mask id each copy claims, so a mismatch between them is visible. */
export function readFormat(m) {
  const size = m.length;
  const seq1 = [];
  for (let k = 0; k <= 5; k++) seq1.push(m[8][k]);
  seq1.push(m[8][7], m[8][8], m[7][8]);
  for (let k = 9; k <= 14; k++) seq1.push(m[14 - k][8]);

  const seq2 = [];
  for (let k = 0; k <= 6; k++) seq2.push(m[size - 1 - k][8]);
  for (let k = 7; k <= 14; k++) seq2.push(m[8][size - 15 + k]);

  const decode = (seq) => {
    let bits = 0;
    for (let i = 0; i < 15; i++) bits |= seq[i] << (14 - i);
    const raw = bits ^ 0x5412;
    const data = raw >> 10;
    return { ec: data >> 3, mask: data & 7 };
  };
  return { copy1: decode(seq1), copy2: decode(seq2), darkModule: m[size - 8][8] };
}

/* The full round trip: unmask, walk the zigzag, de-interleave the blocks,
 * strip mode and length, return the payload bytes. */
export function readBack(m) {
  const size = m.length;
  const version = (size - 17) / 4;
  const { copy1 } = readFormat(m);
  const fn = functionMask(version);

  const bits = [];
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i;
      for (const c of [col, col - 1]) {
        if (fn[row][c]) continue;
        bits.push(m[row][c] ^ (MASKS[copy1.mask](row, c) ? 1 : 0));
      }
    }
    upward = !upward;
  }

  const codewords = [];
  for (let i = 0; i + 7 < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    codewords.push(b);
  }

  // De-interleave back into data blocks (error-correction bytes ignored).
  const [, ecPer, g1, d1, g2, d2] = SPEC_M[version];
  const lens = [...Array(g1).fill(d1), ...Array(g2).fill(d2)];
  const blocks = lens.map(() => []);
  let idx = 0;
  for (let i = 0; i < Math.max(...lens); i++) {
    for (let b = 0; b < blocks.length; b++) {
      if (i < lens[b]) blocks[b].push(codewords[idx++]);
    }
  }
  const data = blocks.flat();

  // Header: 4-bit mode, then the character count.
  let bitPos = 0;
  const take = (n) => {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const byte = data[(bitPos + i) >> 3];
      v = (v << 1) | ((byte >> (7 - ((bitPos + i) & 7))) & 1);
    }
    bitPos += n;
    return v;
  };
  const mode = take(4);
  const count = take(version < 10 ? 8 : 16);
  const bytes = [];
  for (let i = 0; i < count; i++) bytes.push(take(8));
  return { mode, count, text: new TextDecoder().decode(new Uint8Array(bytes)) };
}

/* ------------------------------------------------------------- tests */

const PAYLOADS = [
  'HELLO',
  'https://www.n-able.com',
  'https://www.n-able.com?tr=v13&s=QK7MN&i=87&d=8&z=Prepared&r=Threat+Hunter&c=harbour-dental&g=during',
  'Threat Response — Harbour Dental — index 87 — Threat Hunter',
  'x'.repeat(180),
];

describe('QR encoder', () => {
  it('round-trips every payload it accepts', () => {
    for (const text of PAYLOADS) {
      const m = encodeQR(text);
      const out = readBack(m);
      expect(out.mode, `${text.slice(0, 30)} mode`).toBe(0b0100); // byte mode
      expect(out.text, `${text.slice(0, 30)}`).toBe(text);
    }
  });

  it('writes the same format information into both copies', () => {
    for (const text of PAYLOADS) {
      const f = readFormat(encodeQR(text));
      /* Level M is 0b00. Getting this wrong produces a code that scanners
       * try to error-correct with the wrong block structure. */
      expect(f.copy1.ec, text.slice(0, 20)).toBe(0);
      expect(f.copy1.mask).toBe(f.copy2.mask);
      expect(f.copy1.ec).toBe(f.copy2.ec);
      expect(f.darkModule).toBe(1);
    }
  });

  it('picks the smallest version that fits', () => {
    expect(encodeQR('HELLO').length).toBe(21);            // v1
    expect(encodeQR('https://www.n-able.com').length).toBe(25); // v2
    expect(encodeQR('x'.repeat(180)).length).toBe(53);    // v9
  });

  it('places the finder, timing and alignment patterns', () => {
    const m = encodeQR('https://www.n-able.com');
    const size = m.length;
    for (const [r0, c0] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
      expect(m[r0][c0]).toBe(1);
      expect(m[r0 + 1][c0 + 1]).toBe(0);
      expect(m[r0 + 3][c0 + 3]).toBe(1);
    }
    for (let i = 8; i < size - 8; i++) {
      expect(m[6][i], `timing row ${i}`).toBe(i % 2 === 0 ? 1 : 0);
      expect(m[i][6], `timing col ${i}`).toBe(i % 2 === 0 ? 1 : 0);
    }
  });

  it('throws rather than truncating a payload it cannot hold', () => {
    /* A QR that scans to a half-written URL is worse than one that never
     * rendered, so the callers catch this and print the link instead. */
    expect(() => encodeQR('y'.repeat(400))).toThrow(/exceeds version 10/);
  });

  it('matches a third-party encoder byte for byte on a scorecard URL', () => {
    /* Belt and braces on top of the round trip: an independent encoder's
     * output for the same payload at the same EC level. Mask selection can
     * legitimately differ between implementations, so this is asserted for
     * the one payload where it agrees. */
    const m = encodeQR(reference.text);
    expect(m.length).toBe(reference.rows.length);
    const mine = m.map((row) => row.join(''));
    expect(mine).toEqual(reference.rows);
  });
});
