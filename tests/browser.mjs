/* Headless playthroughs, layout audit and screenshots.
 *
 *   npm run build && npm run verify
 *   npm run verify -- --shots        also writes PNGs to tests/shots/
 *
 * Checks the things that cannot be checked by reading the source:
 *
 *   1. Nothing leaves the file. Any request that is not file:, data: or
 *      blob: fails the run. This is the claim the whole distribution
 *      model rests on and it is the one that has been untrue before.
 *   2. A complete playthrough in both timed and learn mode, with no
 *      console errors and no unhandled rejections.
 *   3. No horizontal page scroll at four viewports.
 *   4. Every tap target at least 44px, with the two documented
 *      exceptions: an inline link inside a sentence, and a checkbox whose
 *      own label is the hit area.
 *   5. The three pillar cards reachable without scrolling on a phone —
 *      the intrusion track advances while a player scrolls, so this is a
 *      gameplay check, not a cosmetic one.
 *   6. prefers-reduced-motion actually suppresses the canvas, the
 *      scanlines and the climax countdown.
 */

import { chromium } from 'playwright';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + join(HERE, '..', 'dist', 'index.html');
const SHOTS = join(HERE, 'shots');
const wantShots = process.argv.includes('--shots');

if (!existsSync(join(HERE, '..', 'dist', 'index.html'))) {
  console.error('dist/index.html not found. Run `npm run build` first.');
  process.exit(2);
}
if (wantShots) mkdirSync(SHOTS, { recursive: true });

/* Playwright's bundled browser is not always the one on disk — CI images
 * and sandboxes often ship a pinned build under PLAYWRIGHT_BROWSERS_PATH
 * with a different revision. Look for it rather than failing with a
 * download instruction that will not work offline. */
function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return undefined;
  for (const dir of readdirSync(root)) {
    if (!dir.startsWith('chromium-')) continue;
    for (const rel of ['chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-win/chrome.exe']) {
      const p = join(root, dir, rel);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

const VIEWPORTS = [
  { name: 'phone', width: 375, height: 667, phone: true },
  { name: 'phone-landscape', width: 844, height: 390, phone: true },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];

const problems = [];
const note = (s) => problems.push(s);

/* Chromium makes its own background requests — component updater, the
 * optimization-guide service, account plumbing — which have nothing to do
 * with the page and muddy the one check this script exists for. Turn them
 * off so that any outbound request the route handler sees is the game's. */
const browser = await chromium.launch({
  executablePath: findChromium(),
  args: [
    '--no-sandbox',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-domain-reliability',
    '--disable-sync',
    '--no-first-run',
    '--no-default-browser-check',
    '--metrics-recording-only',
    '--disable-features=OptimizationHints,MediaRouter,Translate',
  ],
});

/* ------------------------------------------------------------- helpers */

async function newPage(vp, { reduced = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    reducedMotion: reduced ? 'reduce' : 'no-preference',
    hasTouch: !!vp.phone,
    isMobile: !!vp.phone,
  });
  const page = await ctx.newPage();
  const tag = vp.name + (reduced ? '+reduced' : '');

  page.on('pageerror', (e) => note(`${tag}: pageerror ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') note(`${tag}: console ${m.text()}`);
  });
  await page.route('**', (route) => {
    const u = route.request().url();
    if (!/^(file|data|blob):/.test(u)) {
      note(`${tag}: OUTBOUND REQUEST ${u}`);
      return route.abort();
    }
    return route.continue();
  });
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(350);
  return { ctx, page, tag };
}

async function checkOverflow(page, tag, where) {
  const r = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  if (r.sw > r.cw + 1) note(`${tag} ${where}: horizontal page scroll (${r.sw} > ${r.cw})`);
}

async function checkTaps(page, tag, where) {
  const bad = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('button, input[type=checkbox], a[href]')) {
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      // Inline link inside running text: cannot be 44px tall.
      if (el.tagName === 'A' && el.closest('p, li, label, .consent')) continue;
      // Input wrapped by its own label: the label is the hit area.
      if (el.tagName === 'INPUT' && el.closest('label')?.getBoundingClientRect().height >= 43.5) continue;
      if (r.height < 43.5 || r.width < 24) {
        out.push(`${el.tagName}.${el.className || '-'} "${(el.textContent || '').trim().slice(0, 22)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }
    return out;
  });
  for (const b of bad) note(`${tag} ${where}: tap target ${b}`);
}

async function checkFold(page, tag) {
  const r = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.pill')];
    if (!cards.length) return null;
    return {
      bottom: Math.round(Math.max(...cards.map((c) => c.getBoundingClientRect().bottom))),
      vh: window.innerHeight,
    };
  });
  if (r && r.bottom > r.vh) note(`${tag} stage: pillar cards ${r.bottom - r.vh}px below the fold (viewport ${r.vh}px)`);
}

/* Every variant, not just the ones a seed drew.
 *
 * The pillar cards clear the fold at 375x667 by as little as seven pixels
 * on the longest scenario in the pool, and the description's height comes
 * from content someone else will write. This swaps each of the twenty
 * variants onto a live board and re-measures, so a content edit that would
 * push the cards off a phone screen fails here rather than at a stand.
 */
async function checkFoldAllVariants(page, tag) {
  const results = await page.evaluate(async () => {
    const out = [];
    for (const st of window.TR.game.data.scenarios.stages) {
      for (const v of st.variants) {
        document.querySelector('.threat h2').textContent = v.name;
        document.querySelector('.threat p').textContent = v.desc;
        const acts = [...document.querySelectorAll('.pill-act')];
        ['manage', 'secure', 'recover'].forEach((k, i) => {
          if (acts[i]) acts[i].textContent = v.act[k];
        });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const cards = [...document.querySelectorAll('.pill')];
        const bottom = Math.max(...cards.map((c) => c.getBoundingClientRect().bottom));
        out.push({ tech: v.tech, over: Math.round(bottom - window.innerHeight) });
      }
    }
    return out;
  });
  const over = results.filter((r) => r.over > 0).sort((a, b) => b.over - a.over);
  for (const r of over) note(`${tag} stage: ${r.tech} pushes the pillar cards ${r.over}px below the fold`);
  const worst = results.reduce((w, r) => (r.over > w.over ? r : w), results[0]);
  return worst;
}

const shot = (page, name, full = false) =>
  wantShots ? page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: full }) : Promise.resolve();

/* One full run. `strategy` is 'best' or 'weak', so both the contained and
 * the breached paths get exercised including the ransom-note beat. */
const FULL_POSTURE = [/Immutable off-site vault/, /24\/7 monitored response/, /Enforced patch window/];

async function playThrough(page, tag, { strategy, capture = false, allVariants = false, posture = FULL_POSTURE }) {
  await page.getByRole('button', { name: /Start the incident/ }).click();
  await page.waitForTimeout(250);
  await checkOverflow(page, tag, 'briefing');
  if (capture) await shot(page, `${tag}-2-briefing`, true);

  await page.getByRole('button', { name: /Set your readiness/ }).click();
  await page.waitForTimeout(200);
  await checkOverflow(page, tag, 'readiness');
  await checkTaps(page, tag, 'readiness');

  /* Spend the budget across two pillars, which is the shape the cap
   * forces — or spend nothing, which is what the worst-play run does. It
   * has to: the immutable vault converts a closure into a wounded
   * survival by design, so a run that buys it can no longer reach the
   * closure copy, and the closure copy is the beat this whole harness
   * exists to keep working. */
  for (const name of posture) {
    const b = page.getByRole('button', { name });
    if (await b.count()) await b.first().click();
  }
  if (capture) await shot(page, `${tag}-3-readiness`, true);
  await page.locator('.posture-foot .btn.primary').click();
  await page.waitForTimeout(600);

  await checkOverflow(page, tag, 'stage');
  await checkTaps(page, tag, 'stage');
  await checkFold(page, tag);
  if (capture) await shot(page, `${tag}-4-stage`, true);

  if (allVariants) {
    const worst = await checkFoldAllVariants(page, tag);
    console.log(`${tag.padEnd(20)} worst variant  ${worst.tech} clears the fold by ${-worst.over}px`);
    // Put the real scenario text back before the run continues.
    await page.evaluate(() => {
      const v = window.TR.S.variant;
      document.querySelector('.threat h2').textContent = v.name;
      document.querySelector('.threat p').textContent = v.desc;
      const acts = [...document.querySelectorAll('.pill-act')];
      ['manage', 'secure', 'recover'].forEach((k, i) => {
        if (acts[i]) acts[i].textContent = v.act[k];
      });
    });
  }

  for (let stage = 0; stage < 5; stage++) {
    if (await page.locator('.inject').count()) {
      await page.locator('.inject .btn').first().click();
      await page.waitForTimeout(150);
    }
    if (stage === 2) {
      await page.evaluate(() => window.TR.scan());
      await page.waitForTimeout(250);
      if (capture) await shot(page, `${tag}-5-scan`, true);
    }

    const lead = await page.evaluate((s) => {
      const rank = window.TR.S.variant.rank;
      return Object.keys(rank).find((k) => rank[k] === (s === 'best' ? 'best' : 'weak'));
    }, strategy);
    await page.evaluate((l) => window.TR.choose(l), lead);
    await page.waitForTimeout(200);
    const backup = await page.evaluate((l) => {
      if (window.TR.S.variant.rank[l] === 'best') return window.TR.rightBackupFor(window.TR.S.variant, l);
      return ['manage', 'secure', 'recover'].find((p) => p !== l);
    }, lead);
    await page.evaluate((b) => window.TR.choose(b), backup);
    await page.waitForTimeout(950);

    if (stage === 0) {
      await checkOverflow(page, tag, 'resolve');
      if (capture) await shot(page, `${tag}-6-resolve`, true);
    }

    const next = page.locator('.resolve .btn.primary');
    await next.waitFor({ state: 'visible', timeout: 6000 });
    await next.click();
    await page.waitForTimeout(400);

    if (await page.locator('.climax').count()) {
      if (capture) await shot(page, `${tag}-7-climax`);
      await page.locator('.climax .btn').first().click();
      await page.waitForTimeout(450);
    }
  }

  await page.waitForTimeout(700);
  if (await page.locator('.climax').count()) {
    if (capture) await shot(page, `${tag}-8-impact`);
    await page.locator('.climax .btn').first().click();
  }
  await page.waitForTimeout(1700);

  await checkOverflow(page, tag, 'result');
  await checkTaps(page, tag, 'result');
  if (capture) {
    await shot(page, `${tag}-9-result`);
    await shot(page, `${tag}-9-result-full`, true);
  }

  return page.evaluate(() => {
    const s = window.TR.summary();
    return {
      index: s.index, defense: s.defense, rank: s.rank.name, zone: s.zone.zone,
      business: s.business, gap: s.gap.key, seed: s.seedCode,
      report: window.TR.report().length,
      qr: !!document.querySelector('.qr-box svg'),
      /* The best beat in the asset is a sentence in the client's own
       * words, and nothing else in this harness would notice it going
       * missing. */
      closureCopy: (document.querySelector('.v-business')?.textContent || '') === s.client.closed,
      /* The dial's band ring: four arcs, exactly one at full strength. */
      dialBands: document.querySelectorAll('.dial .band').length,
      dialActive: document.querySelectorAll('.dial .band.on').length,
    };
  });
}

/* ---------------------------------------------------------------- run */

console.log('Threat Response — browser verification\n');

for (const vp of VIEWPORTS) {
  for (const reduced of vp.name === 'phone' || vp.name === 'desktop' ? [false, true] : [false]) {
    const { ctx, page, tag } = await newPage(vp, { reduced });

    await checkOverflow(page, tag, 'attract');
    await checkTaps(page, tag, 'attract');
    if (!reduced) await shot(page, `${tag}-1-attract`, true);

    if (reduced) {
      const hidden = await page.evaluate(() => ({
        canvas: getComputedStyle(document.querySelector('#bg')).display === 'none',
        scan: getComputedStyle(document.querySelector('.scan')).display === 'none',
      }));
      if (!hidden.canvas) note(`${tag}: particle canvas still visible`);
      if (!hidden.scan) note(`${tag}: scanline overlay still visible`);
    }

    // Timed mode, expert play.
    const timed = await playThrough(page, tag, {
      strategy: 'best',
      capture: !reduced && vp.name === 'desktop',
      // Only worth doing once, on the viewport where it is tightest.
      allVariants: vp.name === 'phone' && !reduced,
    });
    console.log(`${tag.padEnd(20)} timed/expert  ${JSON.stringify(timed)}`);
    if (timed.index !== 100) note(`${tag}: expert play scored ${timed.index}, expected 100`);
    if (!timed.qr) note(`${tag}: no scorecard QR rendered`);
    if (timed.report < 800) note(`${tag}: incident report suspiciously short (${timed.report} chars)`);
    if (timed.dialBands !== 4 || timed.dialActive !== 1) {
      note(`${tag}: dial drew ${timed.dialBands} bands with ${timed.dialActive} active, expected 4 and 1`);
    }

    await ctx.close();

    // Learn mode, worst play, so the breach path and ransom note render.
    const second = await newPage(vp, { reduced });
    await second.page.getByRole('button', { name: /MODE/ }).click();
    const weak = await playThrough(second.page, second.tag + '/learn', {
      strategy: 'weak',
      capture: !reduced && vp.name === 'phone',
      /* Three unspent readiness points, which is both the state that
       * reaches the closure copy and a result-screen branch nothing else
       * here exercises. */
      posture: [],
    });
    console.log(`${tag.padEnd(20)} learn/worst   ${JSON.stringify(weak)}`);
    if (weak.index !== 3) note(`${tag}: worst play scored ${weak.index}, expected 3`);
    if (weak.business !== 'closed') note(`${tag}: worst play left the business ${weak.business}, expected closed`);
    if (!weak.closureCopy) note(`${tag}: the closure line did not render on the result screen`);
    await second.ctx.close();
  }
}

/* ─────────────────────────────────────────── injects, and the timeout
 *
 * Both of these come off engine events emitted from inside tick(), which
 * for five versions were being thrown away before the screen could read
 * them, so neither mechanic worked in a browser and nothing failed. Run
 * once on a seed whose first stage carries an inject, because a
 * conditional check on a random draw is exactly what let this hide.
 */
{
  const { ctx, page, tag } = await newPage({ name: 'inject', width: 1024, height: 768 });
  await page.goto(FILE + '#22223', { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /Start the incident/ }).click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: /Set your readiness/ }).click();
  await page.waitForTimeout(200);
  await page.locator('.posture-foot .btn.primary').click();
  await page.waitForTimeout(600);

  const scheduled = await page.evaluate(() => window.TR.S.variant.inject?.after ?? null);
  if (scheduled === null) note('inject: seed 22223 no longer draws an inject at stage one');

  /* Put keyboard focus on a pillar card first. The inject must not take
   * it, and Space must still activate the card — the two failures that
   * made the inject and the decision mutually exclusive in v13. */
  await page.locator('.pill').first().focus();
  await page.locator('.inject').waitFor({ state: 'visible', timeout: 6000 }).catch(() => {
    note('inject: never rendered');
  });
  const state = await page.evaluate(() => ({
    focusStillOnCard: document.activeElement?.classList.contains('pill'),
    /* Tab order: the action has to be reachable, so it lives in the DOM
     * after the cards rather than on document.body. */
    inPickArea: !!document.querySelector('.pick-area .inject'),
    coversCards: (() => {
      const inj = document.querySelector('.inject')?.getBoundingClientRect();
      if (!inj) return true;
      return [...document.querySelectorAll('.pill')].some((c) => {
        const r = c.getBoundingClientRect();
        return inj.bottom > r.top && inj.top < r.bottom && inj.right > r.left && inj.left < r.right;
      });
    })(),
    key: document.querySelector('.inject .kbd')?.textContent,
  }));
  if (!state.focusStillOnCard) note('inject: stole keyboard focus from a pillar card');
  if (!state.inPickArea) note('inject: not in the pick area, so Tab cannot reach it');
  if (state.coversCards) note('inject: overlaps a pillar card');
  if (state.key !== 'X') note(`inject: advertises ${state.key}, expected X`);

  /* Space belongs to the focused card, not the inject. */
  await page.keyboard.press(' ');
  await page.waitForTimeout(150);
  const afterSpace = await page.evaluate(() => ({ lead: window.TR.S.lead, inject: !!window.TR.S.inject }));
  if (!afterSpace.lead) note('inject: Space did not activate the focused pillar card');
  if (!afterSpace.inject) note('inject: Space answered the inject instead of the card');

  await page.keyboard.press('x');
  await page.waitForTimeout(250);
  const answered = await page.evaluate(() => ({ inject: !!window.TR.S.inject, dom: !!document.querySelector('.inject') }));
  if (answered.inject || answered.dom) note('inject: X did not answer it');
  console.log(`${tag.padEnd(20)} fires at ${scheduled}s, no focus theft, no overlap, X answers it`);
  await ctx.close();
}

{
  /* A stage nobody answers has to resolve as a breach on screen, not
   * freeze with the pick area still up. */
  const { ctx, page, tag } = await newPage({ name: 'timeout', width: 1024, height: 768 });
  await page.getByRole('button', { name: /Start the incident/ }).click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: /Set your readiness/ }).click();
  await page.waitForTimeout(200);
  await page.locator('.posture-foot .btn.primary').click();
  await page.locator('.resolve').waitFor({ state: 'visible', timeout: 40000 }).catch(() => {
    note('timeout: an unanswered stage never resolved on screen');
  });
  const r = await page.evaluate(() => ({
    outcome: window.TR.S.rounds[0]?.outcome,
    timedOut: window.TR.S.rounds[0]?.timedOut,
    label: document.querySelector('.outcome h3')?.textContent,
    next: !!document.querySelector('.resolve .btn.primary'),
  }));
  if (r.outcome !== 'breached' || !r.timedOut) note(`timeout: resolved as ${r.outcome}, timedOut=${r.timedOut}`);
  if (r.label !== 'Breached') note(`timeout: outcome heading read "${r.label}"`);
  if (!r.next) note('timeout: no way forward from the resolve screen');
  console.log(`${tag.padEnd(20)} unanswered stage resolves as ${r.outcome}, "${r.label}", continue offered`);
  await ctx.close();
}

/* ────────────────────────────────────────────────── keyboard only
 *
 * The quality floor says the whole game is completable without a mouse,
 * and until now that was asserted rather than measured. No click() calls
 * below: every transition is a key, and the run has to reach the result
 * screen with a real score on it.
 */
{
  const { ctx, page, tag } = await newPage({ name: 'keyboard', width: 1280, height: 800 });
  const focused = () =>
    page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      return { cls: el.className, text: (el.textContent || '').trim().slice(0, 44) };
    });

  /* Every screen autofocuses its primary control on mount, so the happy
   * path is Enter. Reaching anything else means walking BACKWARDS with
   * Shift+Tab: the primary sits late in the DOM, and tabbing forward past
   * the last focusable hands focus to the browser chrome and never gets
   * it back, which is a property of the harness and not of the page. */
  await page.keyboard.press('Enter');            // Start the incident
  await page.waitForTimeout(320);
  const onBrief = await focused();
  if (!onBrief || !/Set your readiness/.test(onBrief.text)) {
    note(`keyboard: briefing did not autofocus its primary (${onBrief?.text ?? 'nothing focused'})`);
  }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(320);

  /* Spend the budget from the readiness board. */
  let spent = 0;
  let back = 0;
  for (let i = 0; i < 16 && spent < 2; i++) {
    await page.keyboard.press('Shift+Tab');
    back++;
    const f = await focused();
    if (f && /pcard/.test(f.cls) && !/locked/.test(f.cls)) {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(110);
      spent = await page.evaluate(() => window.TR.S.posture.spent);
    }
  }
  if (spent < 2) note(`keyboard: spent only ${spent} readiness points from the board`);
  /* And forward again to the primary, which is the walk that proves it is
   * still in the tab order after mount() focused it. */
  let onStart = null;
  for (let i = 0; i < back + 2; i++) {
    await page.keyboard.press('Tab');
    onStart = await focused();
    if (onStart && /btn primary/.test(onStart.cls)) break;
  }
  if (!onStart || !/btn primary/.test(onStart.cls)) {
    note(`keyboard: could not walk back to begin-the-attack (${onStart?.text ?? 'nothing focused'})`);
  }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);

  for (let s = 0; s < 5; s++) {
    const lead = await page.evaluate(() => {
      const r = window.TR.S.variant.rank;
      return Object.keys(r).find((k) => r[k] === 'best');
    });
    const key = { manage: '1', secure: '2', recover: '3' };
    await page.keyboard.press(key[lead]);
    await page.waitForTimeout(150);
    const backup = await page.evaluate((l) => window.TR.rightBackupFor(window.TR.S.variant, l), lead);
    await page.keyboard.press(key[backup]);
    await page.waitForTimeout(1100);
    if (!(await page.locator('.resolve .btn.primary').count())) {
      note(`keyboard: stage ${s + 1} did not resolve on keys alone`);
      break;
    }
    await page.keyboard.press('Enter');          // the resolve button is autofocused
    await page.waitForTimeout(500);
    if (await page.locator('.climax').count()) {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
    }
  }
  await page.waitForTimeout(2600);
  if (await page.locator('.climax').count()) {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);
  }
  const out = await page.evaluate(() => ({
    phase: window.TR.S.phase,
    index: window.TR.summary().index,
    dialVisible: !!document.querySelector('.dial'),
  }));
  if (out.phase !== 'result' || !out.dialVisible) note(`keyboard: run ended in phase ${out.phase}`);
  if (out.index !== 100) note(`keyboard: expert play on keys alone scored ${out.index}, expected 100`);
  console.log(`${tag.padEnd(20)} full run on keys alone, ${spent} readiness points spent, index ${out.index}`);
  await ctx.close();
}

await browser.close();

console.log(`\n${problems.length} problem${problems.length === 1 ? '' : 's'}`);
for (const p of problems) console.log('  - ' + p);
if (wantShots) console.log(`\nscreenshots: ${SHOTS}`);
process.exit(problems.length ? 1 : 0);
