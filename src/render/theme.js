/* Theme and escalation state.
 *
 * Both are attributes on the documentElement, because that is where the
 * token layer listens:
 *
 *   data-theme="dark"   swaps every colour triple. Light is the default and
 *                       has no attribute.
 *   data-stage="1".."5" drifts the surface warm, hardens the borders,
 *                       tightens the radii and deepens the shadows.
 *
 * Nothing else in the codebase touches these. Anything that wants to know
 * the current theme asks here.
 */

const ROOT = document.documentElement;

/* Read once at boot. A URL override is the whole mechanism for now — the
 * persisted settings-sheet toggle is a follow-up, and doing it this way
 * proves the token layer works without committing to a UI. */
function initialTheme() {
  const params = new URLSearchParams(location.search);
  const fromQuery = params.get('theme');
  if (fromQuery === 'dark' || fromQuery === 'light') return fromQuery;
  /* A seed fragment can carry it too, so a shared dark-mode link survives:
   * #ABCDE,dark */
  if ((location.hash || '').includes(',dark')) return 'dark';
  return 'light';
}

let theme = initialTheme();
let onChange = null;

function apply() {
  if (theme === 'dark') ROOT.setAttribute('data-theme', 'dark');
  else ROOT.removeAttribute('data-theme');
  /* The particle field holds a cached copy of the palette, because reading
   * computed style every frame is not free. Tell it to re-read. */
  if (onChange) onChange(theme);
}

export const Theme = {
  get current() {
    return theme;
  },
  set(next) {
    theme = next === 'dark' ? 'dark' : 'light';
    apply();
    return theme;
  },
  toggle() {
    return Theme.set(theme === 'dark' ? 'light' : 'dark');
  },
  /* Called by main with the field's refresh, so this module needs no
   * import of the renderer. */
  onChange(fn) {
    onChange = fn;
  },
  init() {
    apply();
  },
};

/* Escalation. Set on entering a stage, cleared everywhere else so the
 * attract, briefing, prep and result screens all sit at the calm end. */
export const Escalation = {
  set(stageIndex) {
    ROOT.setAttribute('data-stage', String(stageIndex + 1));
  },
  clear() {
    ROOT.removeAttribute('data-stage');
  },
};
