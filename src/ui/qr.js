/* QR encoder, byte mode, error correction level M, versions 1-10.
 *
 * In-file because the alternative is a CDN script or an image request,
 * and both break the one-file offline constraint that the whole
 * distribution model rests on. Level M rather than L because this gets
 * scanned off a tablet screen at a trade show stand, at an angle, under
 * exhibition lighting, by a phone that is not being held still.
 *
 * Versions 1-10 hold up to 213 bytes in byte mode at level M, which is
 * comfortably more than a landing URL with a run's result on the end.
 * Anything longer throws rather than silently truncating — a QR that
 * scans to a broken URL is worse than one that never rendered.
 */

/* ------------------------------------------------------------- GF(256) */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function buildTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecLen) {
  const gen = rsGenerator(ecLen);
  const res = new Uint8Array(ecLen);
  for (const byte of data) {
    const factor = byte ^ res[0];
    res.copyWithin(0, 1);
    res[ecLen - 1] = 0;
    if (factor !== 0) {
      for (let i = 0; i < ecLen; i++) res[i] ^= gfMul(gen[i + 1], factor);
    }
  }
  return res;
}

/* --------------------------------------------------------- version data
 *
 * Per version at level M: [total codewords, ec codewords per block,
 * group 1 block count, group 1 data codewords, group 2 block count,
 * group 2 data codewords]. From the tables in ISO/IEC 18004.
 */
const SPEC_M = {
  1:  [26, 10, 1, 16, 0, 0],
  2:  [44, 16, 1, 28, 0, 0],
  3:  [70, 26, 1, 44, 0, 0],
  4:  [100, 18, 2, 32, 0, 0],
  5:  [134, 24, 2, 43, 0, 0],
  6:  [172, 16, 4, 27, 0, 0],
  7:  [196, 18, 4, 31, 0, 0],
  8:  [242, 22, 2, 38, 2, 39],
  9:  [292, 22, 3, 36, 2, 37],
  10: [346, 26, 4, 43, 1, 44],
};

const ALIGN_CENTERS = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

/* Version information bit strings for versions 7+, BCH(18,6) encoded. */
const VERSION_BITS = { 7: 0x07c94, 8: 0x085bc, 9: 0x09a99, 10: 0x0a4d3 };

function dataCapacity(version) {
  const [total, ecPer, g1, d1, g2, d2] = SPEC_M[version];
  return g1 * d1 + g2 * d2;
}

/* -------------------------------------------------------------- encode */

function toBytes(str) {
  return new TextEncoder().encode(str);
}

function buildCodewords(bytes, version) {
  const capacity = dataCapacity(version);
  const bits = [];
  const push = (value, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };

  push(0b0100, 4);                              // byte mode
  push(bytes.length, version < 10 ? 8 : 16);    // character count
  for (const b of bytes) push(b, 8);

  const capBits = capacity * 8;
  if (bits.length > capBits) throw new Error('qr: payload too long for version ' + version);

  // Terminator, then pad to a byte boundary.
  for (let i = 0; i < 4 && bits.length < capBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const data = new Uint8Array(capacity);
  for (let i = 0; i < bits.length / 8; i++) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i * 8 + j];
    data[i] = byte;
  }
  // Pad codewords, alternating, per spec.
  for (let i = Math.ceil(bits.length / 8), t = 0; i < capacity; i++, t++) {
    data[i] = t % 2 === 0 ? 0xec : 0x11;
  }

  // Split into blocks, generate EC, then interleave.
  const [, ecPer, g1, d1, g2, d2] = SPEC_M[version];
  const blocks = [];
  let offset = 0;
  for (let i = 0; i < g1; i++) {
    blocks.push(data.slice(offset, offset + d1));
    offset += d1;
  }
  for (let i = 0; i < g2; i++) {
    blocks.push(data.slice(offset, offset + d2));
    offset += d2;
  }
  const ecBlocks = blocks.map((b) => rsEncode(b, ecPer));

  const out = [];
  const maxData = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++) {
    for (const b of blocks) if (i < b.length) out.push(b[i]);
  }
  for (let i = 0; i < ecPer; i++) {
    for (const b of ecBlocks) out.push(b[i]);
  }
  return out;
}

/* -------------------------------------------------------------- matrix */

function makeMatrix(version, codewords) {
  const size = version * 4 + 17;
  const m = Array.from({ length: size }, () => new Array(size).fill(null));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

  const set = (r, c, v) => {
    m[r][c] = v;
    reserved[r][c] = true;
  };

  const finder = (r0, c0) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = r0 + r, cc = c0 + c;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        const inRing = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const dark = inRing && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        set(rr, cc, dark ? 1 : 0);
      }
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    set(6, i, i % 2 === 0 ? 1 : 0);
    set(i, 6, i % 2 === 0 ? 1 : 0);
  }

  // Alignment patterns
  const centers = ALIGN_CENTERS[version];
  for (const r of centers) {
    for (const c of centers) {
      // Skip the three that collide with finders.
      if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          set(r + dr, c + dc, dark ? 1 : 0);
        }
      }
    }
  }

  // Dark module and format-info reservations
  set(size - 8, 8, 1);
  for (let i = 0; i < 9; i++) {
    if (m[8][i] === null) set(8, i, 0);
    if (m[i][8] === null) set(i, 8, 0);
  }
  for (let i = 0; i < 8; i++) {
    if (m[8][size - 1 - i] === null) set(8, size - 1 - i, 0);
    if (m[size - 1 - i][8] === null) set(size - 1 - i, 8, 0);
  }

  // Version info, versions 7+
  if (version >= 7) {
    const bits = VERSION_BITS[version];
    for (let i = 0; i < 18; i++) {
      const bit = (bits >> i) & 1;
      set(Math.floor(i / 3), size - 11 + (i % 3), bit);
      set(size - 11 + (i % 3), Math.floor(i / 3), bit);
    }
  }

  // Data placement, two-column zigzag from bottom right
  let bitIndex = 0;
  const nextBit = () => {
    const byte = codewords[bitIndex >> 3];
    const bit = byte === undefined ? 0 : (byte >> (7 - (bitIndex & 7))) & 1;
    bitIndex++;
    return bit;
  };
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--; // skip the vertical timing column
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i;
      for (const c of [col, col - 1]) {
        if (reserved[row][c]) continue;
        m[row][c] = nextBit();
      }
    }
    upward = !upward;
  }

  return { m, reserved, size };
}

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

/* Format information: 5 data bits (EC level + mask), BCH(15,5) with the
 * 0x5412 XOR mask applied. */
function formatBits(maskId) {
  const ecBits = 0b00; // level M
  let data = (ecBits << 3) | maskId;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/* Format-info placement.
 *
 * Two details here are easy to get wrong and both produce a code that
 * still renders and still looks like a QR, so they were caught by diffing
 * against a reference encoder rather than by reading the output:
 *
 *   1. The fifteen bits go into the cell sequence most-significant first.
 *      Placing them LSB-first gives a valid-looking code that no scanner
 *      will read.
 *   2. The second copy is 7 cells down the left edge and 8 along the top,
 *      not 8 and 7. The dark module at (size-8, 8) sits between them and
 *      is not a format cell. Getting the split wrong leaves one data
 *      module stuck at zero — a single wrong pixel, and the code fails to
 *      decode roughly half the time depending on the payload.
 */
function applyFormat(m, size, maskId) {
  const bits = formatBits(maskId);
  const bit = (k) => (bits >> (14 - k)) & 1;

  // Copy one, wrapped around the top-left finder.
  for (let k = 0; k <= 5; k++) m[8][k] = bit(k);
  m[8][7] = bit(6);
  m[8][8] = bit(7);
  m[7][8] = bit(8);
  for (let k = 9; k <= 14; k++) m[14 - k][8] = bit(k);

  // Copy two, split across the bottom-left and top-right.
  for (let k = 0; k <= 6; k++) m[size - 1 - k][8] = bit(k);
  for (let k = 7; k <= 14; k++) m[8][size - 15 + k] = bit(k);

  // The dark module. Always set, never carries information.
  m[size - 8][8] = 1;
}

function penalty(m, size) {
  let score = 0;

  // Rule 1: runs of five or more
  for (let i = 0; i < size; i++) {
    for (const line of [m[i], m.map((row) => row[i])]) {
      let run = 1;
      for (let j = 1; j < size; j++) {
        if (line[j] === line[j - 1]) run++;
        else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
  }

  // Rule 2: 2x2 blocks of one color
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
    }
  }

  // Rule 3: finder-like 1:1:3:1:1 patterns
  const pat = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const patRev = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (let i = 0; i < size; i++) {
    for (let j = 0; j <= size - 11; j++) {
      const row = m[i].slice(j, j + 11);
      const col = Array.from({ length: 11 }, (_, k) => m[j + k][i]);
      for (const line of [row, col]) {
        if (pat.every((v, k) => v === line[k]) || patRev.every((v, k) => v === line[k])) score += 40;
      }
    }
  }

  // Rule 4: dark-module proportion
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark += m[r][c];
  const pct = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(pct - 50) / 5) * 10;

  return score;
}

/* Returns a size x size array of 0/1. */
export function encodeQR(text) {
  const bytes = toBytes(text);
  const version = Object.keys(SPEC_M)
    .map(Number)
    .sort((a, b) => a - b)
    .find((v) => {
      const header = 4 + (v < 10 ? 8 : 16);
      return dataCapacity(v) * 8 >= header + bytes.length * 8;
    });
  if (!version) throw new Error(`qr: ${bytes.length} bytes exceeds version 10 at level M`);

  const codewords = buildCodewords(bytes, version);
  const { m, reserved, size } = makeMatrix(version, codewords);

  let best = null;
  for (let maskId = 0; maskId < 8; maskId++) {
    const candidate = m.map((row) => [...row]);
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!reserved[r][c] && MASKS[maskId](r, c)) candidate[r][c] ^= 1;
      }
    }
    applyFormat(candidate, size, maskId);
    const score = penalty(candidate, size);
    if (!best || score < best.score) best = { score, matrix: candidate };
  }
  return best.matrix;
}

/* An <svg> element rather than a canvas: it scales to any tablet without
 * resampling, and it prints. */
/* The module colours come from the token layer but they deliberately do NOT
 * follow the theme. A scanner wants the largest luminance gap it can get,
 * and this gets read off a tablet at an angle under exhibition lighting, so
 * both themes render ink on paper. --anchor-ink and --on-ink are the two
 * tokens that stay put across a theme switch, which is exactly the property
 * needed here. */
function tokenColor(name, fallback) {
  if (typeof getComputedStyle !== 'function') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v ? `rgb(${v})` : fallback;
}

export function qrSvg(text, { size = 180, quiet = 3, dark, light } = {}) {
  dark ??= tokenColor('--anchor-ink-rgb', 'rgb(20 6 40)');       /* token-fallback: --anchor-ink */
  light ??= tokenColor('--on-ink-rgb', 'rgb(244 246 254)');     /* token-fallback: --on-ink */
  const matrix = encodeQR(text);
  const n = matrix.length;
  const total = n + quiet * 2;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${total} ${total}`);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('role', 'img');
  svg.setAttribute('shape-rendering', 'crispEdges');

  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('width', total);
  bg.setAttribute('height', total);
  bg.setAttribute('fill', light);
  svg.appendChild(bg);

  /* One path for every dark module. Far fewer nodes than a rect each,
   * which matters on a mid-range Android at a stand. */
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (matrix[r][c]) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
  }
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', dark);
  svg.appendChild(path);
  return svg;
}
