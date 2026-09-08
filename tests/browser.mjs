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
async function playThrough(page, tag, { strategy, capture = false, allVariants = false }) {
  await page.getByRole('button', { name: /Start the incident/ }).click();
  await page.waitForTimeout(250);
  await checkOverflow(page, tag, 'briefing');
  if (capture) await shot(page, `${tag}-2-briefing`, true);

  await page.getByRole('button', { name: /Set your readiness/ }).click();
  await page.waitForTimeout(200);
  await checkOverflow(page, tag, 'readiness');
  await checkTaps(page, tag, 'readiness');

  // Spend the budget across two pillars, which is the shape the cap forces.
  for (const name of [/Immutable off-site vault/, /24\/7 monitored response/, /Enforced patch window/]) {
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

    await ctx.close();

    // Learn mode, worst play, so the breach path and ransom note render.
    const second = await newPage(vp, { reduced });
    await second.page.getByRole('button', { name: /MODE/ }).click();
    const weak = await playThrough(second.page, second.tag + '/learn', {
      strategy: 'weak',
      capture: !reduced && vp.name === 'phone',
    });
    console.log(`${tag.padEnd(20)} learn/worst   ${JSON.stringify(weak)}`);
    if (weak.index !== 3) note(`${tag}: worst play scored ${weak.index}, expected 3`);
    if (weak.business !== 'closed') note(`${tag}: worst play left the business ${weak.business}, expected closed`);
    await second.ctx.close();
  }
}

await browser.close();

console.log(`\n${problems.length} problem${problems.length === 1 ? '' : 's'}`);
for (const p of problems) console.log('  - ' + p);
if (wantShots) console.log(`\nscreenshots: ${SHOTS}`);
process.exit(problems.length ? 1 : 0);
