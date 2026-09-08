/* Tiny DOM helper. Not a framework and not on the way to becoming one —
 * the game is a linear state machine with six screens and a render pass
 * per screen. `h` exists so screen modules read as structure rather than
 * as string concatenation, and so attributes get set as properties where
 * that matters (aria, disabled, value).
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'g', 'path', 'circle', 'rect', 'line', 'text', 'polyline', 'polygon', 'defs', 'linearGradient', 'stop', 'clipPath']);

export function h(tag, attrs = null, ...kids) {
  const el = SVG_TAGS.has(tag) ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);

  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.setAttribute('class', v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'disabled' || k === 'checked' || k === 'hidden') el[k] = !!v;
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v);
    }
  }

  for (const kid of kids.flat(4)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

/* Screen swap. Replaces the whole wrap contents and moves focus to the
 * new screen's heading, which is what makes the game completable with a
 * keyboard and announceable with a screen reader. */

/* Things the browser already puts in the tab order. Anything else needs a
 * tabindex before .focus() will take, and giving one to something in this
 * list takes it OUT of the tab order — which is the bug below. */
const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex], [contenteditable]';

export function mount(node, { focus = true } = {}) {
  const wrap = qs('.wrap');
  wrap.replaceChildren(node);
  if (focus) {
    const target = node.querySelector('[data-autofocus]') || node.querySelector('h1, h2');
    if (target) {
      /* Only a heading needs the tabindex. Every screen's autofocus target
       * is its primary button, and setting tabindex="-1" on a button
       * focuses it once and then removes it from the tab order for good —
       * so a keyboard player who tabbed away from "Begin the attack" to
       * choose a readiness card could never tab back to it. Programmatic
       * focus works either way, which is exactly why this survived: the
       * screen looked correct the moment it appeared, and only broke for
       * the player who then used the keyboard for anything. */
      if (!target.matches(FOCUSABLE)) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    }
  }
  window.scrollTo({ top: 0, behavior: 'auto' });
  return node;
}

/* A live region for things that happen without a screen change: a delta
 * chip firing, a system falling, an inject appearing. Color and motion
 * carry these visually; this is the same information as text. */
let liveEl = null;
export function announce(text) {
  if (!liveEl) {
    liveEl = h('div', { class: 'sr', 'aria-live': 'assertive', 'aria-atomic': 'true' });
    document.body.appendChild(liveEl);
  }
  liveEl.textContent = '';
  // A fresh text node in the next frame is what actually re-announces.
  requestAnimationFrame(() => (liveEl.textContent = text));
}

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
