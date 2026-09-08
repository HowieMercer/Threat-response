/* Deployment configuration and the single source of version truth.
 *
 * VERSION is emitted everywhere a version string leaves the game: lead
 * records, completion metrics, abandon events, the CSV export and the QR
 * payload. v11/v12 shipped two different strings from two different code
 * paths ('v11' on leads, 'v8' on completions), which made any later
 * analysis of the funnel unreliable. One constant, used everywhere.
 */
export const VERSION = 'v13';

/* The localStorage key is deliberately NOT versioned to match VERSION.
 *
 * It has stayed at nable_tr_v8 since v8. Bumping it orphans every booth
 * leaderboard entry and every captured lead already sitting on an event
 * tablet, and there is no migration path off a device you do not have in
 * your hand. If it ever has to change, write a migration that reads the
 * old key first, and do it between events, not during one.
 */
export const STORE_KEY = 'nable_tr_v8';

export const CONFIG = {
  /* Where the scorecard QR points. Until the campaign landing page exists,
   * this is the company homepage — the QR resolves to something real rather
   * than a 404, and the run's result is carried in the query string so the
   * page can pick it up when it does exist. */
  landingUrl: 'https://www.n-able.com',

  /* POST target for metrics and leads. Empty string = local only, which is
   * the correct default: an event tablet on venue wifi should never block
   * on a network call, and nothing leaves the device without consent. */
  metricsEndpoint: '',

  /* Set per event. Appears on the attract screen and tags every lead. */
  eventName: 'the event',

  /* e.g. 'stand-A-left'. Tags leads and scans so two tablets at the same
   * stand can be told apart after the fact. */
  kioskId: '',

  /* '' hides the prize line on the attract screen entirely. */
  prize: '',

  /* The link in the GDPR consent line. Still pending legal confirmation —
   * it resolves, but the wording it sits next to is not signed off. */
  privacyUrl: 'https://www.n-able.com/legal/privacy-notice',

  /* Scorecard delivery. The game does not send email and has never had a
   * mail path. Set this true only when CONFIG.metricsEndpoint actually
   * fulfills one, because it is what switches the confirmation copy from
   * "saved on this device" to "on its way to your inbox". Promising a mail
   * that no code sends is the one bug a prospect experiences personally. */
  emailFulfillment: false,
};

/* Stage pacing. The intrusion track crosses the board in this many seconds
 * at each stage, which is where escalation actually lives — the numbers get
 * smaller, the attacker moves faster, nothing on screen has to shout. */
export const STAGE_SECONDS = [20, 18, 16, 14, 13];

export const THREAT_LEVELS = ['Elevated', 'Elevated', 'High', 'Severe', 'Critical'];
