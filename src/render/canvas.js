/* The background field.
 *
 * A SOC under pressure, carried by color temperature and density rather
 * than by anything flashing. Two layers:
 *
 *   drift    slow particles with proximity links — the estate, quiet
 *   packets  streaks that travel left to right, faster and redder as the
 *            intrusion deepens — the attacker's traffic
 *
 * Intensity is driven by the game's intrusion depth, so the background is
 * a readout rather than decoration. It is also the first thing dropped
 * under prefers-reduced-motion, where it adds nothing the estate map does
 * not already say in text.
 */

const MOODS = {
  calm:  { r: 139, g: 92,  b: 246 },
  alert: { r: 255, g: 178, b: 62 },
  crit:  { r: 255, g: 77,  b: 103 },
  won:   { r: 51,  g: 230, b: 174 },
};

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
  let moodMix = { ...MOODS.calm };
  let last = 0;

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
  }

  /* Particle count scales with area and is hard-capped. A phone at a stand
   * is doing this on battery, behind a game loop and a Web Audio graph. */
  function seed() {
    const count = Math.min(90, Math.round((w * h) / 16000));
    drift = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.14,
      vy: (Math.random() - 0.5) * 0.14,
      r: 0.7 + Math.random() * 1.5,
      a: 0.15 + Math.random() * 0.4,
    }));
    packets = [];
  }

  function spawnPacket() {
    packets.push({
      x: -60,
      y: Math.random() * h,
      len: 40 + Math.random() * 110,
      v: 2.2 + Math.random() * 3.4 + intensity * 7,
      a: 0.25 + Math.random() * 0.4,
    });
  }

  function frame(t) {
    const dt = Math.min(48, t - last || 16);
    last = t;

    /* Ease toward the target so a stage change reads as pressure building
     * rather than as a jump cut. */
    intensity += (target - intensity) * Math.min(1, dt / 420);
    const m = MOODS[mood] || MOODS.calm;
    moodMix.r += (m.r - moodMix.r) * Math.min(1, dt / 500);
    moodMix.g += (m.g - moodMix.g) * Math.min(1, dt / 500);
    moodMix.b += (m.b - moodMix.b) * Math.min(1, dt / 500);
    const c = `${Math.round(moodMix.r)},${Math.round(moodMix.g)},${Math.round(moodMix.b)}`;

    ctx.clearRect(0, 0, w, h);

    /* A wash that deepens with intensity, so the whole page gets warmer as
     * the attacker gets closer. */
    if (intensity > 0.02) {
      const g = ctx.createRadialGradient(w * 0.5, h * 0.1, 0, w * 0.5, h * 0.1, Math.max(w, h) * 0.9);
      g.addColorStop(0, `rgba(${c},${0.07 * intensity})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    // links
    ctx.lineWidth = 1;
    for (let i = 0; i < drift.length; i++) {
      const p = drift[i];
      p.x += p.vx * (dt / 16) * (1 + intensity * 1.6);
      p.y += p.vy * (dt / 16) * (1 + intensity * 1.6);
      if (p.x < -20) p.x = w + 20;
      if (p.x > w + 20) p.x = -20;
      if (p.y < -20) p.y = h + 20;
      if (p.y > h + 20) p.y = -20;

      for (let j = i + 1; j < drift.length; j++) {
        const q = drift[j];
        const dx = p.x - q.x, dy = p.y - q.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 12000) {
          ctx.strokeStyle = `rgba(${c},${(1 - d2 / 12000) * 0.1})`;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
          ctx.stroke();
        }
      }
    }

    // nodes
    for (const p of drift) {
      ctx.fillStyle = `rgba(${c},${p.a * 0.7})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // packets
    if (Math.random() < 0.02 + intensity * 0.22) spawnPacket();
    for (let i = packets.length - 1; i >= 0; i--) {
      const s = packets[i];
      s.x += s.v * (dt / 16);
      if (s.x - s.len > w) {
        packets.splice(i, 1);
        continue;
      }
      const g = ctx.createLinearGradient(s.x - s.len, s.y, s.x, s.y);
      g.addColorStop(0, `rgba(${c},0)`);
      g.addColorStop(1, `rgba(${c},${s.a * (0.4 + intensity * 0.6)})`);
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(s.x - s.len, s.y);
      ctx.lineTo(s.x, s.y);
      ctx.stroke();
    }

    raf = requestAnimationFrame(frame);
  }

  const api = {
    /* depth 0-100 from the engine */
    setDepth(depth) {
      target = Math.max(0, Math.min(1, depth / 100));
    },
    setMood(next) {
      mood = next in MOODS ? next : 'calm';
    },
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

  window.addEventListener('resize', resize, { passive: true });
  resize();
  raf = requestAnimationFrame(frame);
  return api;
}
