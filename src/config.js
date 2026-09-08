/* Deployment configuration and the single source of version truth.
 *
 * VERSION is emitted everywhere a version string leaves the game: lead
 * records, completion metrics, abandon events, the CSV export and the QR
 * payload. v11/v12 shipped two different strings from two different code
 * paths ('v11' on leads, 'v8' on completions), which made any later
 * analysis of the funnel unreliable. One constant, used everywhere.
 */
export const VERSION = 'v14';

/* The localStorage key is deliberately NOT versioned to match VERSION.
 *
 * It has stayed at nable_tr_v8 since v8. Bumping it orphans every booth
 * leaderboard entry and every captured lead already sitting on an event
 * tablet, and there is no migration path off a device you do not have in
 * your hand. If it ever has to change, write a migration that reads the
 * old key first, and do it between events, not during one.
 */
export const STORE_KEY = 'nable_tr_v8';

/* Defaults for the per-event settings.
 *
 * The values that actually ship are in the plain inline script at the top
 * of index.html, merged over these at runtime. That indirection is
 * load-bearing rather than tidy-looking: read straight off a module const,
 * the bundler constant-folds them. With `metricsEndpoint` at '' the whole
 * POST path was eliminated from the output, and `kioskId`, `prize` and
 * `emailFulfillment` did not appear in the built file at all — so the one
 * thing CONFIG exists for, being editable per event, was the one thing you
 * could not do to the delivered file. Correct minification, bad deployment
 * model.
 *
 * Anything that must be settable on a tablet with a text editor and no
 * toolchain belongs in the inline block. Anything that is a fact about the
 * build belongs up here as a real const.
 */
const DEFAULTS = {
  /* Set per event. Appears on the attract screen and tags every lead. */
  eventName: 'the event',

  /* e.g. 'stand-A-left'. Tags leads and scans so two tablets at the same
   * stand can be told apart after the fact. */
  kioskId: '',

  /* '' hides the prize line on the attract screen entirely. */
  prize: '',

  /* Where the scorecard QR points. Until the campaign landing page exists
   * this is the company homepage — the QR resolves to something real rather
   * than a 404, and the run's result is carried in the query string so the
   * page can pick it up when it does exist. */
  landingUrl: 'https://www.n-able.com',

  /* POST target for metrics and leads. Empty string = local only, which is
   * the correct default: an event tablet on venue wifi should never block
   * on a network call, and nothing leaves the device without consent. */
  metricsEndpoint: '',

  /* The link in the GDPR consent line. Still pending legal confirmation —
   * it resolves, but the wording it sits next to is not signed off. */
  privacyUrl: 'https://www.n-able.com/legal/privacy-notice',

  /* Scorecard delivery. The game does not send email and has never had a
   * mail path. Set this true only when metricsEndpoint actually fulfills
   * one, because it is what switches the confirmation copy from "saved on
   * this device" to "on its way to your inbox". Promising a mail that no
   * code sends is the one bug a prospect experiences personally. */
  emailFulfillment: false,
};

/* globalThis rather than window, so this module can be imported in Node —
 * neither the balance harness nor the integrity tests run in a browser. */
const overrides = (typeof globalThis !== 'undefined' && globalThis.TR_CONFIG) || {};

/* Known keys only, so a typo in the inline block complains at the point of
 * the typo rather than silently doing nothing three screens later. */
export const CONFIG = { ...DEFAULTS };
for (const [key, value] of Object.entries(overrides)) {
  if (key in DEFAULTS) CONFIG[key] = value;
  else console.warn(`TR_CONFIG: unknown setting "${key}" ignored`);
}
