/* Screen effects. The game's main feedback channel.
 *
 * Every function here answers a player action or signals a state change.
 * Nothing in this file animates an idle element — ambient motion on a
 * screen where nothing has happened reads as noise, and it makes the
 * moments that matter cost less.
 *
 * All of it no-ops under prefers-reduced-motion except the vignette's
 * color state, which carries information rather than motion.
 */

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let flashEl = null;
let vignetteEl = null;
let burstLayer = null;

export function initFx() {
  flashEl = document.querySelector('.flash');
  vignetteEl = document.querySelector('.vignette');
  burstLayer = document.createElement('div');
  burstLayer.className = 'burst-layer';
  document.body.appendChild(burstLayer);
}

export function shake(big = false) {
  if (reduced()) return;
  const cls = big ? 'shake-big' : 'shake';
  document.body.classList.remove('shake', 'shake-big');
  // Force a reflow so the animation restarts even on a repeat hit.
  void document.body.offsetWidth;
  document.body.classList.add(cls);
  setTimeout(() => document.body.classList.remove(cls), big ? 620 : 440);
}

export function flash(tone = 'red') {
  if (reduced() || !flashEl) return;
  flashEl.className = 'flash';
  void flashEl.offsetWidth;
  flashEl.classList.add('go');
  if (tone !== 'red') flashEl.classList.add(tone);
  setTimeout(() => (flashEl.className = 'flash'), 520);
}

/* Threat band on the page edge. Kept under reduced motion: it is a color
 * state change, and removing it would remove a signal. */
export function vignette(band) {
  if (!vignetteEl) return;
  vignetteEl.classList.remove('alert', 'crit', 'won');
  if (band && band !== 'calm') vignetteEl.classList.add(band);
}

/* A burst at a point on screen, used where a consequence lands — the
 * system that just fell, the pillar card that just resolved. */
export function burst(el, tone = 'red', count = 14) {
  if (reduced() || !el || !burstLayer) return;
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i');
    p.className = `spark t-${tone}`;
    const a = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    const d = 26 + Math.random() * 58;
    p.style.setProperty('--x', `${Math.cos(a) * d}px`);
    p.style.setProperty('--y', `${Math.sin(a) * d}px`);
    p.style.left = `${cx}px`;
    p.style.top = `${cy}px`;
    p.style.animationDelay = `${Math.random() * 60}ms`;
    burstLayer.appendChild(p);
    setTimeout(() => p.remove(), 800);
  }
}

/* Consequence-first feedback.
 *
 * The chips fire before any prose. The order is deliberate: the player
 * feels what it cost, then reads why. Reversing it turns a consequence
 * into a paragraph, which is the difference between a game and a
 * questionnaire.
 */
export function deltaChips(host, chips, { onDone } = {}) {
  if (!host) return;
  host.innerHTML = '';
  const step = reduced() ? 0 : 180;
  chips.forEach((c, i) => {
    const el = document.createElement('div');
    el.className = `delta t-${c.tone || 'brand'}`;
    el.innerHTML = `<span class="delta-v">${c.value}</span><span class="delta-l">${c.label}</span>`;
    el.style.animationDelay = `${i * step}ms`;
    host.appendChild(el);
  });
  const total = chips.length * step + 320;
  if (onDone) setTimeout(onDone, reduced() ? 0 : total);
}

/* Count a number up. Used once, on the index reveal, because it is the
 * one number the whole run has been building toward. */
export function countTo(el, to, { ms = 1100, suffix = '' } = {}) {
  if (!el) return;
  if (reduced()) {
    el.textContent = `${to}${suffix}`;
    return;
  }
  const start = performance.now();
  const from = 0;
  function step(t) {
    const p = Math.min(1, (t - start) / ms);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = `${Math.round(from + (to - from) * eased)}${suffix}`;
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* Typewriter, for BlackVault's lines and the ransom note. Resolves when
 * finished so a caller can sequence after it, and finishes instantly
 * under reduced motion rather than being skipped — the text is content. */
export function type(el, text, { cps = 42 } = {}) {
  return new Promise((resolve) => {
    if (!el) return resolve();
    if (reduced()) {
      el.textContent = text;
      return resolve();
    }
    el.textContent = '';
    el.classList.add('typing');
    let i = 0;
    const per = 1000 / cps;
    let acc = 0;
    let last = performance.now();
    function step(t) {
      acc += t - last;
      last = t;
      while (acc > per && i < text.length) {
        acc -= per;
        el.textContent += text[i++];
      }
      if (i < text.length) requestAnimationFrame(step);
      else {
        el.classList.remove('typing');
        resolve();
      }
    }
    requestAnimationFrame(step);
  });
}
