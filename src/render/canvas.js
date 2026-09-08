/* The background field.
 *
 * Two layers:
 *   drift    slow particles with proximity links — the estate, at rest
 *   packets  streaks travelling left to right — the attacker's traffic
 *
 * ── What changed for the light theme ─────────────────────────────────────
 *
 * v13 held its palette as four hardcoded `{r,g,b}` triples, so the field
 * could not follow a theme at all — it was the single largest reason the
 * re-theme was not a find-and-replace. The palette is now read from the
 * CSS custom properties at runtime and re-read on a theme change, so this
 * file contains no colour of its own.
 *
 * The rendering also had to invert, not just recolour. On a dark ground the
 * particles were bright marks on black and intensity read as *brightness*.
 * Bright marks on near-white are invisible, and turning them up makes them
 * more invisible. So on light they are dark marks at low alpha, and
 * intensity reads as **density and speed** instead: as the intrusion
 * deepens there are more of them, they drift faster, and more packets cross
 * the screen. That is a better mapping anyway — it is closer to what an
 * intrusion actually looks like on a console.
 *
 * It is also the first thing dropped under prefers-reduced-motion, where it
 * says nothing the estate map does not already say in text.
 */

/* Frame budget.
 *
 * The particle count is not a constant: it is whatever the device can draw
 * inside this budget. A mid-range Android at a stand is running this behind
 * a game loop and a Web Audio graph, and the honest way to size the field
 * is to measure rather than to guess a number that happens to work on a
 * laptop. 6ms leaves the rest of the frame to everything else at 60fps.
 */
const FRAME_BUDGET_MS = 6;
const MIN_PARTICLES = 14;

export function createField(canvas) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ctx = canvas.getContext('2d', { alpha: true });
  let w = 0, h = 0, dpr = 1;
  let drift = [];
  let packets = [];
  let raf = null;
  let intensity = 0;      // 0..1, the intrusion depth
  let target = 0;
  let mood = 'calm';
  let last = 0;

  /* Rolling frame cost, and the cap it drives. */
  let cost = 0;
  let cap = 0;
  let budgetChecks = 0;

  /* Palette, read from the token layer. `--x-rgb` tokens are unwrapped
   * channel triples ("176 0 32"), which is exactly what a canvas fillStyle
   * string wants, so no parsing is needed beyond a trim. */
  let pal = { ink: '20 6 40', mood: '122 31 184', light: false };

  function readPalette() {
    const cs = getComputedStyle(document.documentElement);
    const get = (n, fallback) => (cs.getPropertyValue(n).trim() || fallback);
    const moodToken = {
      calm: '--brand-glow-rgb',
      alert: '--amber-glow-rgb',
      crit: '--red-glow-rgb',
      won: '--green-glow-rgb',
    }[mood] || '--brand-glow-rgb';
    pal = {
      /* The mark colour. On light the field is drawn in ink; on dark it is
       * drawn in the mood colour, which is what made it glow. */
      ink: get('--ink-rgb', '20 6 40'),
      mood: get(moodToken, '192 70 255'),
      light: document.documentElement.getAttribute('data-theme') !== 'dark',
    };
  }

  /* How many particles the field wants before the budget trims it. */
  function wanted() {
    const byArea = Math.round((w * h) / 16000);
    /* Density is how intensity is expressed on light, so the ceiling rises
     * with the intrusion rather than the brightness doing the work. */
    const withIntensity = Math.round(byArea * (0.72 + intensity * 0.55));
    return Math.max(MIN_PARTICLES, Math.min(cap || 999, withIntensity, 110));
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
  }

  function makeParticle() {
    return {
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.14,
      vy: (Math.random() - 0.5) * 0.14,
      r: 0.7 + Math.random() * 1.5,
      a: 0.15 + Math.random() * 0.4,
    };
  }

  function seed() {
    drift = Array.from({ length: wanted() }, makeParticle);
    packets = [];
  }

  /* Grow or shrink toward the wanted count a few at a time, so a budget
   * adjustment or a stage change does not visibly re-seed the field. */
  function reconcile() {
    const want = wanted();
    if (drift.length < want) for (let i = 0; i < Math.min(3, want - drift.length); i++) drift.push(makeParticle());
    else if (drift.length > want) drift.length = Math.max(MIN_PARTICLES, drift.length - 3);
  }

  function spawnPacket() {
    packets.push({
      x: -60,
      y: Math.random() * h,
      len: 40 + Math.random() * 110,
      /* Speed is the other half of how intensity reads on a light ground. */
      v: 2.2 + Math.random() * 3.4 + intensity * 9,
      a: 0.25 + Math.random() * 0.4,
    });
  }

  function frame(t) {
    const started = performance.now();
    const dt = Math.min(48, t - last || 16);
    last = t;

    /* Ease toward the target so a stage change reads as pressure building
     * rather than as a jump cut. */
    intensity += (target - intensity) * Math.min(1, dt / 420);
    reconcile();

    const markRgb = pal.light ? pal.ink : pal.mood;
    const moodRgb = pal.mood;
    /* On light the marks have to stay faint or they compete with the type;
     * on dark they are the only thing on screen. */
    const markAlpha = pal.light ? 0.055 + intensity * 0.05 : 0.22 + intensity * 0.18;
    const linkAlpha = pal.light ? 0.045 + intensity * 0.035 : 0.1;

    ctx.clearRect(0, 0, w, h);

    /* A wash that deepens with intensity. Kept very low on light — the
     * surface warming is handled by the token drift on :root, and doing it
     * twice turns the page muddy. */
    if (intensity > 0.02) {
      const g = ctx.createRadialGradient(w * 0.5, h * 0.1, 0, w * 0.5, h * 0.1, Math.max(w, h) * 0.9);
      g.addColorStop(0, `rgb(${moodRgb} / ${(pal.light ? 0.05 : 0.07) * intensity})`);
      g.addColorStop(1, `rgb(${moodRgb} / 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    // links
    ctx.lineWidth = 1;
    for (let i = 0; i < drift.length; i++) {
      const p = drift[i];
      p.x += p.vx * (dt / 16) * (1 + intensity * 2.1);
      p.y += p.vy * (dt / 16) * (1 + intensity * 2.1);
      if (p.x < -20) p.x = w + 20;
      if (p.x > w + 20) p.x = -20;
      if (p.y < -20) p.y = h + 20;
      if (p.y > h + 20) p.y = -20;

      for (let j = i + 1; j < drift.length; j++) {
        const q = drift[j];
        const dx = p.x - q.x, dy = p.y - q.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 12000) {
          ctx.strokeStyle = `rgb(${markRgb} / ${(1 - d2 / 12000) * linkAlpha})`;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
          ctx.stroke();
        }
      }
    }

    // nodes
    for (const p of drift) {
      ctx.fillStyle = `rgb(${markRgb} / ${p.a * markAlpha * 3})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // packets — the attacker's traffic, always in the mood colour
    if (Math.random() < 0.02 + intensity * 0.3) spawnPacket();
    for (let i = packets.length - 1; i >= 0; i--) {
      const s = packets[i];
      s.x += s.v * (dt / 16);
      if (s.x - s.len > w) {
        packets.splice(i, 1);
        continue;
      }
      const g = ctx.createLinearGradient(s.x - s.len, s.y, s.x, s.y);
      const peak = s.a * (pal.light ? 0.34 + intensity * 0.4 : 0.4 + intensity * 0.6);
      g.addColorStop(0, `rgb(${moodRgb} / 0)`);
      g.addColorStop(1, `rgb(${moodRgb} / ${peak})`);
      ctx.strokeStyle = g;
      ctx.lineWidth = pal.light ? 1.6 : 1.4;
      ctx.beginPath();
      ctx.moveTo(s.x - s.len, s.y);
      ctx.lineTo(s.x, s.y);
      ctx.stroke();
    }

    /* The budget. Rolling average of actual draw cost; if the field is over
     * budget the cap comes down, if it has headroom the cap drifts back up.
     * Settles within a couple of seconds on whatever the device can do. */
    cost = cost * 0.9 + (performance.now() - started) * 0.1;
    if (++budgetChecks % 30 === 0) {
      if (cost > FRAME_BUDGET_MS) cap = Math.max(MIN_PARTICLES, drift.length - 8);
      else if (cost < FRAME_BUDGET_MS * 0.55) cap = Math.min(110, (cap || drift.length) + 4);
    }

    raf = requestAnimationFrame(frame);
  }

  const api = {
    /* depth 0-100 from the engine */
    setDepth(depth) {
      target = Math.max(0, Math.min(1, depth / 100));
    },
    setMood(next) {
      if (next === mood) return;
      mood = next;
      readPalette();
    },
    /* Called when the theme attribute changes. */
    refresh: readPalette,
    /* Exposed so the verification harness can assert the field is actually
     * being trimmed to a budget rather than trusting that it is. */
    stats: () => ({ particles: drift.length, packets: packets.length, frameMs: +cost.toFixed(2), cap }),
    stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      window.removeEventListener('resize', resize);
    },
    reduced,
  };

  if (reduced) {
    canvas.style.display = 'none';
    return api;
  }

  readPalette();
  window.addEventListener('resize', resize, { passive: true });
  resize();
  raf = requestAnimationFrame(frame);
  return api;
}
