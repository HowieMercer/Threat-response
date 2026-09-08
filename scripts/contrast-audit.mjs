/* Contrast audit + token-layer discipline check.
 *
 *   node scripts/contrast-audit.mjs [--verbose]
 *
 * Two jobs, both of which fail the build:
 *
 *   1. Every foreground/background pair the UI actually uses is measured
 *      against its WCAG threshold, in BOTH themes, and at every stage of
 *      the escalation drift — because the surface warms as the run gets
 *      worse and a ratio that passes at stage 1 can fail at stage 5.
 *
 *   2. No colour literal exists outside `tokens.css`. That is the rule
 *      that keeps a theme swap possible; v13 had 128 violations of it and
 *      that is why "re-theme it" was not a find-and-replace.
 *
 * Thresholds follow WCAG 2.2:
 *   4.5:1  body text and anything under 18.66px bold / 24px regular
 *   3.0:1  large text, and UI component boundaries (1.4.11 non-text)
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');
const TOKENS = join(SRC, 'styles', 'tokens.css');
const verbose = process.argv.includes('--verbose');

/* ─────────────────────────────────────────────── parse the token file ── */

/* Pull `--x-rgb: <triple or var()>` out of a given selector block. */
function blockFor(css, selector) {
  const i = css.indexOf(selector + ' {');
  if (i < 0) return null;
  const start = css.indexOf('{', i) + 1;
  let depth = 1, j = start;
  while (j < css.length && depth > 0) {
    if (css[j] === '{') depth++;
    else if (css[j] === '}') depth--;
    j++;
  }
  return css.slice(start, j - 1);
}

function declsIn(block) {
  const out = {};
  if (!block) return out;
  // Strip comments so a hex in prose is not read as a value.
  const clean = block.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of clean.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const css = readFileSync(TOKENS, 'utf8');

/* :root appears twice (anchors, then the light theme). Merge both. */
const rootBlocks = [];
{
  let from = 0;
  for (;;) {
    const i = css.indexOf('\n:root {', from);
    if (i < 0) break;
    rootBlocks.push(blockFor(css.slice(i), ':root'));
    from = i + 8;
  }
}
const base = Object.assign({}, ...rootBlocks.map(declsIn));
const darkDecls = declsIn(blockFor(css, ":root[data-theme='dark']"));

/* .on-ink is a third colour context, not a theme — see tokens.css. */
const inkDecls = declsIn(blockFor(css, '.on-ink'));

const stageDecls = {};
for (let s = 1; s <= 5; s++) {
  stageDecls[`light-${s}`] = declsIn(blockFor(css, `:root[data-stage='${s}']`));
  stageDecls[`dark-${s}`] = declsIn(blockFor(css, `:root[data-theme='dark'][data-stage='${s}']`));
}

/* Resolve a token name to [r,g,b], following var() indirection. */
function resolve(name, scope, seen = new Set()) {
  if (seen.has(name)) throw new Error(`token cycle at ${name}`);
  seen.add(name);
  const raw = scope[name];
  if (raw === undefined) throw new Error(`unknown token ${name}`);
  const v = raw.trim();
  const varMatch = v.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (varMatch) return resolve(varMatch[1], scope, seen);
  const nums = v.match(/^(\d+)\s+(\d+)\s+(\d+)$/);
  if (!nums) throw new Error(`token ${name} is not a triple: "${v}"`);
  return [+nums[1], +nums[2], +nums[3]];
}

function scopeFor(theme, stage) {
  const s = { ...base };
  if (theme === 'dark') Object.assign(s, darkDecls);
  /* The ink scope sits on top of whichever theme is active, because that is
   * how the cascade applies it. Stage drift does not reach inside it. */
  if (theme === 'ink-light') Object.assign(s, inkDecls);
  if (theme === 'ink-dark') Object.assign(s, darkDecls, inkDecls);
  if (stage && (theme === 'light' || theme === 'dark')) {
    Object.assign(s, stageDecls[`${theme}-${stage}`] || {});
  }
  return s;
}

/* ───────────────────────────────────────────────────── WCAG maths ───── */

const lin = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
function ratio(fg, bg) {
  const a = lum(fg), b = lum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/* ──────────────────────────────────────────── the pairs the UI uses ─── */

const SIGNALS = ['green', 'blue', 'violet', 'amber', 'red', 'brand'];

/* Each entry: [foreground token, background token, min ratio, what uses it] */
function pairs() {
  const p = [
    ['--text-rgb', '--bg-rgb', 4.5, 'body copy on the page'],
    ['--dim-rgb', '--bg-rgb', 4.5, 'secondary copy on the page'],
    ['--faint-rgb', '--bg-rgb', 4.5, '.label mono caps — 10px, so no large-text relief'],
    ['--text-rgb', '--panel-rgb', 4.5, 'copy inside a card'],
    ['--dim-rgb', '--panel-rgb', 4.5, 'secondary copy inside a card'],
    ['--faint-rgb', '--panel-rgb', 4.5, 'labels inside a card'],
    ['--text-rgb', '--panel2-rgb', 4.5, 'copy on a raised panel'],
    ['--text-rgb', '--bg2-rgb', 4.5, 'copy on the secondary ground'],
    ['--dim-rgb', '--bg2-rgb', 4.5, 'secondary copy on the secondary ground'],
    ['--on-brand-rgb', '--brand-glow-rgb', 4.5, '.btn.primary label on the heliotrope fill'],
    ['--on-signal-rgb', '--red-rgb', 4.5, 'BLACKVAULT track pill label on the red fill'],
    ['--on-signal-rgb', '--brand-rgb', 4.5, 'label on a solid brand fill'],
    ['--on-signal-rgb', '--green-rgb', 4.5, 'label on a solid green fill'],
    /* --line2 is a decorative hairline: the cards it outlines are already
     * identifiable by their fill and their shadow, so 1.4.11 does not bite.
     * --edge is the token for boundaries that ARE the only thing making a
     * control identifiable — a text input, a ghost button, a focus ring —
     * and that one has to clear 3:1. Splitting them was the honest fix;
     * relaxing the threshold on --line2 would have been the other one. */
    ['--edge-rgb', '--bg-rgb', 3.0, 'input and ghost-button boundary (1.4.11 non-text)'],
    ['--edge-rgb', '--panel-rgb', 3.0, 'input boundary inside a card'],
    ['--focus-rgb', '--bg-rgb', 3.0, 'focus ring against the page (1.4.11)'],
    ['--focus-rgb', '--panel-rgb', 3.0, 'focus ring against a card'],
  ];
  for (const s of SIGNALS) {
    // -b is the only variant allowed to carry text.
    p.push([`--${s}-b-rgb`, '--bg-rgb', 4.5, `.t-${s} text on the page`]);
    p.push([`--${s}-b-rgb`, `--${s}-deep-rgb`, 4.5, `.t-${s} chip: -b text on its own -deep fill`]);
    p.push([`--${s}-b-rgb`, '--panel-rgb', 4.5, `.t-${s} text inside a card`]);
    // The base variant is a border, a stroke or an icon: non-text threshold.
    p.push([`--${s}-rgb`, '--bg-rgb', 3.0, `.t-${s} border/icon stroke against the page`]);
  }
  return p;
}

/* ──────────────────────────────────────────────────────── run it ────── */

const failures = [];
const results = [];

for (const theme of ['light', 'dark', 'ink-light', 'ink-dark']) {
  for (const stage of theme.startsWith('ink') ? [null] : [null, 1, 2, 3, 4, 5]) {
    const scope = scopeFor(theme, stage);
    for (const [fg, bg, min, why] of pairs()) {
      let r;
      try {
        r = ratio(resolve(fg, scope), resolve(bg, scope));
      } catch (e) {
        failures.push({ theme, stage, fg, bg, min, why, error: e.message });
        continue;
      }
      const row = { theme, stage: stage ?? '-', fg, bg, min, r, why, pass: r >= min };
      results.push(row);
      if (!row.pass) failures.push(row);
    }
  }
}

/* ─────────────────────── token-layer discipline: no literals outside ── */

const literalFiles = [];
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) { if (!p.includes('assets')) walk(p); }
    else if (/\.(css|js)$/.test(p) && p !== TOKENS) literalFiles.push(p);
  }
})(SRC);

/* The bare keywords must not match inside a hyphenated identifier, or
 * `white-space: nowrap` reads as a colour decision. */
const LITERAL = /(#[0-9a-fA-F]{3,8}\b|\brgba?\(\s*\d|\bhsla?\(|(^|[\s:(,])(white|black)($|[\s;,)]))/;
const bypasses = [];
for (const f of literalFiles) {
  const lines = readFileSync(f, 'utf8').split('\n');
  let inBlockComment = false;
  lines.forEach((line, i) => {
    const t = line.trim();
    if (inBlockComment) { if (t.includes('*/')) inBlockComment = false; return; }
    if (t.startsWith('/*') && !t.includes('*/')) { inBlockComment = true; return; }
    if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return;
    /* Two sanctioned forms are not colour decisions:
     *   rgb(var(--x-rgb) / N%)  the alpha mechanism
     *   /* token-fallback *\/    a restatement of a token for the case where
     *                           the token cannot be read at all (the QR
     *                           encoder runs in Node, where there is no
     *                           computed style to read from).
     * The second is an annotation rather than a silent exemption so that
     * `grep token-fallback src/` lists every one of them. */
    if (line.includes('token-fallback')) return;
    const stripped = line.replace(/rgba?\(\s*var\([^)]*\)[^)]*\)/g, '');
    if (LITERAL.test(stripped)) {
      bypasses.push(`${relative(join(HERE, '..'), f)}:${i + 1}  ${t.slice(0, 88)}`);
    }
  });
}

/* ── subtree scopes must set resolved tokens as well as triples ───────── */

/* `--x: rgb(var(--x-rgb))` is computed on :root and inherits as a finished
 * string, so a scope that is not a :root state has to set both forms or
 * half its subtree silently reads the root palette. This caught the
 * stage-five countdown rendering at 2.6:1; it is worth a check rather than
 * a comment. */
/* Tokens that are surface-dependent but are not `-rgb` triples, so the
 * pairing rule below cannot infer them. A scope that redefines the ground
 * has to redefine these too. */
const REQUIRED_IN_SCOPE = ['--fill-1', '--fill-2', '--fill-3', '--scrim', '--shadow', '--shadow-sm'];

const scopeGaps = [];
for (const [selector, decls] of [['.on-ink', inkDecls]]) {
  for (const key of Object.keys(decls)) {
    if (!key.endsWith('-rgb')) continue;
    const resolved = key.slice(0, -4);
    // Only tokens that actually exist in resolved form at :root matter.
    if (base[resolved] === undefined) continue;
    if (decls[resolved] === undefined) scopeGaps.push(`${selector} sets ${key} but not ${resolved}`);
  }
  if (decls['--bg-rgb'] !== undefined) {
    for (const t of REQUIRED_IN_SCOPE) {
      if (decls[t] === undefined) scopeGaps.push(`${selector} redefines the ground but not ${t}`);
    }
  }
}

/* ────────────────────────────────────────────────────────── report ──── */

console.log('Threat Response — contrast audit\n');
if (verbose) {
  const seen = new Set();
  for (const r of results) {
    const k = `${r.theme}|${r.fg}|${r.bg}`;
    if (r.stage !== '-' && seen.has(k)) continue;
    seen.add(k);
    console.log(
      `  ${r.pass ? 'pass' : 'FAIL'}  ${r.theme.padEnd(5)} ` +
      `${r.r.toFixed(2).padStart(6)}:1  (min ${r.min})  ` +
      `${r.fg.replace('-rgb', '').padEnd(14)} on ${r.bg.replace('-rgb', '').padEnd(14)} ${r.why}`
    );
  }
  console.log('');
}

/* Reported per threshold. One number for "worst ratio" mixes text pairs
 * with border pairs and reads as a failure when it is not — a 3.95 on a
 * 3.0-threshold hairline is fine, a 3.95 on body text is not. */
const perTheme = {};
for (const r of results) {
  const t = (perTheme[r.theme] ??= { n: 0, fail: 0, text: Infinity, nonText: Infinity });
  t.n++;
  if (!r.pass) t.fail++;
  if (r.min >= 4.5) t.text = Math.min(t.text, r.r);
  else t.nonText = Math.min(t.nonText, r.r);
}
for (const [name, s] of Object.entries(perTheme)) {
  const states = name.startsWith('ink') ? '1 state' : '6 stage states';
  console.log(
    `  ${name.padEnd(10)} ${String(s.n).padStart(3)} pairs / ${states}  ` +
    `worst text ${s.text.toFixed(2)}:1 (min 4.5)  worst non-text ${s.nonText.toFixed(2)}:1 (min 3.0)  ` +
    `${s.fail} failing`
  );
}

if (failures.length) {
  console.log(`\n${failures.length} CONTRAST FAILURE(S):`);
  const shown = new Set();
  for (const f of failures) {
    const k = `${f.theme}|${f.fg}|${f.bg}|${f.stage}`;
    if (shown.has(k)) continue;
    shown.add(k);
    if (f.error) console.log(`  ${f.theme} stage ${f.stage}: ${f.fg} on ${f.bg} — ${f.error}`);
    else console.log(`  ${f.theme} stage ${f.stage}: ${f.r.toFixed(2)}:1 < ${f.min} — ${f.fg.replace('-rgb','')} on ${f.bg.replace('-rgb','')} (${f.why})`);
  }
}

console.log(`\n  token discipline: ${bypasses.length} colour literal(s) outside tokens.css`);
if (bypasses.length) for (const b of bypasses.slice(0, 40)) console.log('    ' + b);
if (bypasses.length > 40) console.log(`    …and ${bypasses.length - 40} more`);

console.log(`  subtree scopes:   ${scopeGaps.length} token(s) set as a triple but not resolved`);
for (const g of scopeGaps) console.log('    ' + g);

const bad = failures.length + bypasses.length + scopeGaps.length;
console.log(bad ? `\nFAIL — ${failures.length} contrast, ${bypasses.length} literals, ${scopeGaps.length} scope gaps` : '\nOK');
process.exit(bad ? 1 : 0);
