/* The three pillars. This is the product story, so it is the one piece of
 * content that lives in code rather than JSON — nothing about a run should
 * be able to add a fourth pillar or rename one of these. */

export const PILLARS = ['manage', 'secure', 'recover'];

export const DEF = {
  manage: {
    key: 'manage',
    name: 'Manage',
    product: 'N-central',
    capability: 'Patch and monitor everything',
    verb: 'Manage the estate',
    tone: 'blue',
    /* Shown on the pillar card so a player who has never heard of any of
     * this still knows what they are choosing between. */
    hint: 'Configuration, patching, inventory. Acts on every machine at once, on a cycle.',
  },
  secure: {
    key: 'secure',
    name: 'Secure',
    product: 'Adlumin MDR',
    capability: 'Detect and stop threats 24/7',
    verb: 'Detect and respond',
    tone: 'violet',
    hint: 'Detection and response. Acts on what is happening right now, on one host or one account.',
  },
  recover: {
    key: 'recover',
    name: 'Recover',
    product: 'Cove Backup',
    capability: 'Restore from immutable backup',
    verb: 'Recover the data',
    tone: 'green',
    hint: 'Immutable copies and tested restores. Puts data back — and only works if it was set up first.',
  },
};

/* The gap diagnosis. Weakest phase maps to a pillar, a product, and an
 * opener a member of booth staff can use without any script training. That
 * mapping is the feature that turns a score into a conversation. */
export const PHASE_MAP = {
  before: {
    key: 'before',
    label: 'Before',
    stages: [0, 1],
    pillar: 'manage',
    title: 'Your weakest phase was before the attack',
    body: 'The stages you lost were the ones where the entry point was already open. That is a configuration problem, and it is solved on a schedule rather than on the night.',
    opener: 'Ask how N-central closes unpatched entry points across every client estate at once.',
  },
  during: {
    key: 'during',
    label: 'During',
    stages: [2, 3],
    pillar: 'secure',
    title: 'Your weakest phase was during the attack',
    body: 'You held the perimeter and you had a recovery path. What went wrong happened in the hours in between, while it was moving and nobody was watching.',
    opener: 'Ask how Adlumin MDR detects and responds in minutes, including at 04:00.',
  },
  after: {
    key: 'after',
    label: 'After',
    stages: [4],
    pillar: 'recover',
    title: 'Your weakest phase was after impact',
    body: 'You slowed the attack down and then had nothing to put back. Recovery is not a decision available at the end — it is capability that either existed beforehand or did not.',
    opener: 'Ask how Cove keeps immutable backups that a stolen credential cannot delete.',
  },
};
