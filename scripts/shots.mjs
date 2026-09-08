/* Screenshot every screen state at every width.
 *   node scripts/shots.mjs <outDir> [--theme dark|light]
 * Also asserts zero external requests and no horizontal overflow. */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + join(HERE, '..', 'dist', 'index.html');
const OUT = process.argv[2] || join(HERE, '..', 'docs', 'shots', 'v14');
mkdirSync(OUT, { recursive: true });

/* The theme is a URL override, which is the whole mechanism — see
 * render/theme.js. Passing it here is what makes the dark theme something
 * that gets looked at rather than something that is asserted to exist. */
const themeArg = process.argv[process.argv.indexOf('--theme') + 1];
const THEME = themeArg === 'dark' ? 'dark' : 'light';
const URL_ = FILE + (THEME === 'dark' ? '?theme=dark' : '');

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return undefined;
  for (const d of readdirSync(root)) {
    if (!d.startsWith('chromium-')) continue;
    for (const rel of ['chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-win/chrome.exe']) {
      const p = join(root, d, rel);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

const WIDTHS = [
  { name: '375', width: 375, height: 812, phone: true },
  { name: '768', width: 768, height: 1024 },
  { name: '1024', width: 1024, height: 768 },
  { name: '1440', width: 1440, height: 900 },
];

const problems = [];
const browser = await chromium.launch({
  executablePath: findChromium(),
  args: ['--no-sandbox', '--disable-renderer-backgrounding',
         '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling',
         '--disable-background-networking', '--disable-component-update',
         '--disable-sync', '--no-first-run', '--metrics-recording-only',
         '--disable-features=OptimizationHints,MediaRouter,Translate'],
});

for (const vp of WIDTHS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    hasTouch: !!vp.phone, isMobile: !!vp.phone,
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${vp.name}: pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`${vp.name}: console ${m.text()}`); });
  await page.route('**', (r) => {
    const u = r.request().url();
    if (!/^(file|data|blob):/.test(u)) { problems.push(`${vp.name}: OUTBOUND ${u}`); return r.abort(); }
    return r.continue();
  });

  const shot = async (n) => {
    await page.screenshot({ path: join(OUT, `${vp.name}-${n}.png`), fullPage: true });
    const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    if (r.sw > r.cw + 1) problems.push(`${vp.name} ${n}: h-overflow ${r.sw}>${r.cw}`);

    /* Page-level overflow is the easy half. The half that actually bites
     * is content clipped INSIDE a panel with overflow:hidden — a flex item
     * defaults to min-width:auto, so a sentence that cannot shrink runs
     * off the end of its own card and the page never scrolls, so nothing
     * upstream notices. That is how the one line booth staff read out loud
     * shipped truncated at 375px. */
    const clipped = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('*')) {
        if (el.scrollWidth - el.clientWidth <= 1) continue;
        const cs = getComputedStyle(el);
        if (cs.overflowX !== 'hidden' && cs.overflowX !== 'clip') continue;
        /* text-overflow: ellipsis is a decision, not an accident: the text
         * is truncated visibly and on purpose. Silent clipping is the bug
         * this looks for. */
        if (cs.textOverflow === 'ellipsis') continue;
        /* A deliberately scrollable strip is not a bug. */
        if (el.scrollWidth > el.clientWidth * 3) continue;
        out.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]} by ${el.scrollWidth - el.clientWidth}px`);
      }
      return out.slice(0, 6);
    });
    for (const c of clipped) problems.push(`${vp.name} ${n}: clipped ${c}`);
  };

  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForTimeout(450);
  const applied = await page.evaluate(() => document.documentElement.getAttribute('data-theme') || 'light');
  if (applied !== THEME) problems.push(`${vp.name}: asked for ${THEME}, got ${applied}`);
  await shot('01-attract');

  await page.getByRole('button', { name: /Start the incident/ }).click();
  await page.waitForTimeout(300);
  await shot('02-briefing');

  await page.getByRole('button', { name: /Set your readiness/ }).click();
  await page.waitForTimeout(250);
  await shot('03-prep-empty');
  for (const n of [/Immutable off-site vault/, /24\/7 monitored response/, /Enforced patch window/]) {
    const b = page.getByRole('button', { name: n });
    if (await b.count()) await b.first().click();
  }
  await shot('04-prep-spent');

  await page.locator('.posture-foot .btn.primary').click();
  await page.waitForTimeout(700);

  for (let s = 0; s < 5; s++) {
    if (s === 0) await shot('05-stage1-prepick');
    if (s === 2) {
      await page.evaluate(() => window.TR.scan());
      await page.waitForTimeout(300);
      await shot('06-stage3-scanned');
    }
    /* Wait out the inject schedule before picking. Injects fire under 3
     * seconds into a stage and never into a half-built stack, so a harness
     * that commits a lead in 200ms would never see one. */
    if (await page.evaluate(() => !!window.TR.S.variant.inject)) {
      await page.waitForTimeout(3200);
    }
    if (await page.locator('.inject').count()) {
      await shot(`07-inject-stage${s + 1}`);
      await page.locator('.inject .btn').first().click();
      await page.waitForTimeout(200);
    }
    const lead = await page.evaluate(() => {
      const r = window.TR.S.variant.rank;
      return Object.keys(r).find((k) => r[k] === 'best');
    });
    await page.evaluate((l) => window.TR.choose(l), lead);
    await page.waitForTimeout(200);
    await page.evaluate((l) => window.TR.choose(window.TR.rightBackupFor(window.TR.S.variant, l)), lead);
    await page.waitForTimeout(1000);
    if (s === 0) await shot('08-stage1-resolved');

    const next = page.locator('.resolve .btn.primary');
    await next.waitFor({ state: 'visible', timeout: 6000 });
    if (s === 4) break;
    await next.click();
    await page.waitForTimeout(400);
    if (await page.locator('.climax').count()) {
      await shot('09-climax-countdown');
      await page.locator('.climax .btn').first().click();
      await page.waitForTimeout(450);
    }
  }
  await page.locator('.resolve .btn.primary').click();
  await page.waitForTimeout(3600);
  if (await page.locator('.climax').count()) {
    await shot('10-impact');
    await page.locator('.climax .btn').first().click();
  }
  await page.waitForTimeout(1800);
  await shot('11-result');
  await page.evaluate(() => document.querySelector('#ld-email')?.scrollIntoView());
  await page.waitForTimeout(200);
  await shot('12-lead-form');
  await page.evaluate(() => window.TR.openStats());
  await page.waitForTimeout(300);
  await shot('13-stats-sheet');
  await ctx.close();
}
await browser.close();

console.log(`shots -> ${OUT}`);
console.log(`${problems.length} problem${problems.length === 1 ? '' : 's'}`);
for (const p of problems) console.log('  - ' + p);
process.exit(problems.length ? 1 : 0);
