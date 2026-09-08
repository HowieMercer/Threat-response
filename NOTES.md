# Notes

Open items, decisions that need a person rather than a patch, and things
deliberately left alone. Anything that is a real bug should be fixed rather
than recorded here.

## Not code problems — someone has to decide

All of these live in the `window.TR_CONFIG` block at the top of
`index.html`, which is also the top of the built file. Change them there;
no rebuild needed.

- **`landingUrl`** points at `https://www.n-able.com`. The campaign
  scorecard landing page does not exist yet. The QR resolves to something
  real and carries the run's result in the query string (`?tr=…&s=…&i=…&d=…
  &z=…&r=…&c=…&g=…`), so the page can read it the day it exists. Until then
  the loop does not close.
- **`privacyUrl`** resolves, but the GDPR consent wording it sits beside
  has not had legal sign-off.
- **`eventName`, `kioskId`, `prize`** are per-event and unset.
- **Official N-able brand hex codes** are still a pre-launch confirmation
  item. The palette in `CLAUDE.md` is the v12 palette, carried over.

## Closed, and worth knowing they were open

- **"One offline file, no network" is now true.** v12 loaded four families
  from Google Fonts, so with no network the game rendered in system
  sans-serif on exactly the machines it was built for. Three families are
  now self-hosted and subset to Latin plus the typographic marks the UI
  actually uses: 44.8 KB of woff2, about 60 KB inlined as base64. Inter and
  JetBrains Mono are variable fonts so one file each covers every weight.
  Space Grotesk is gone. `npm run verify` fails the run on any request that
  is not `file:`, `data:` or `blob:`, so this cannot quietly regress.
- **The scorecard email promise is gone.** Nothing in the codebase has ever
  sent mail. The confirmation now says the scorecard is saved on the device
  and that booth staff will export it. `emailFulfillment` switches
  the copy back to "on its way" and should be set only when an endpoint
  actually sends something.
- **One `VERSION` constant**, emitted in leads, completions, abandons, the
  CSV and the QR payload. v11/v12 shipped `v11` on leads and `v8` on
  completions from two different code paths.
- **The per-event settings survive the build.** They were being read off a
  module const, which the bundler constant-folded: `metricsEndpoint` at
  `''` removed the whole POST path, and `kioskId`, `prize` and
  `emailFulfillment` were not in the built file at all. They now come from
  an inline block at the top of the file, read at runtime — which is also
  the only way a per-kiosk value can be set on the delivered artifact.
- **`STORE_KEY` stays `nable_tr_v8`**, with a comment in `config.js` saying
  why. It does not track `VERSION`.

## Known limits

- **The leaderboard is per device.** Two tablets at the same stand keep
  separate boards and separate lead lists. The stats panel says so on
  screen. A shared board needs a backend.
- **Leads stop at CSV export.** No CRM integration, no owner assignment, no
  SLA on the lead-to-pipeline path.
- **`localStorage` can be unavailable** (private browsing on some Safari
  versions throws on access, not just on write). Every read and write is
  wrapped and the game runs without persistence rather than failing to load.
- **Landscape phone is the tightest layout.** At 844×390 the whole board
  fits with about 20px to spare, achieved by moving the intrusion clock onto
  the rail and the three cards into a row. Anything added above the pillar
  cards will push them off the bottom, so re-run `npm run verify` after
  touching the stage screen.

## Balance, and how to tell if it has drifted

`npm run balance` simulates a player who takes time to read rather than one
who answers instantly, because pacing measured against an instant player is
not measured at all. The first version of that harness ran in learn mode,
where the clock does not move, and reported that scanning every stage got a
player to Threat Hunter 80% of the time. That number was an artifact — it
led to scan being priced at two capacity plus a ground cost, which is a real
balance change made off a measurement that was wrong. Worth remembering.

Current figures, 1,000 runs per strategy:

| strategy | Threat Hunter+ | Champion | contained |
|---|---|---|---|
| blind, uniform random | ~20% | ~0.3% | 1.65/5 |
| always Manage | ~24% | ~0.3% | 1.75/5 |
| always Secure | ~25% | ~0.5% | 1.75/5 |
| always Recover | ~13% | ~0.3% | 1.50/5 |
| positional heuristic | ~17% | ~0.2% | 1.75/5 |
| scan then guess | ~48% | ~1.5% | 2.12/5 |
| scan + 24/7 SOC bought | ~80% | ~3.5% | 2.50/5 |
| expert, perfect stacks | 100% | 100% | 5.00/5 |

**These are lower than the v11 figures in the context document** (41.4% to
Threat Hunter, 1.9% to Champion, 2.37/5 contained under blind play). That is
a real difference and not a drift: defense points now subtract for estate
damage, and this scenario pool gives a uniform-random player exactly a one
in three chance of the correct lead with no positional pattern to exploit.
The v11 blind heuristic was almost certainly positional rather than uniform,
which its 2.37/5 contained rate is consistent with. Do not "fix" the pool to
match the old numbers — the shape of the curve is what matters, and it is:
knowing nothing lands you in First Responder, paying attention gets you to
Threat Hunter, and only knowing the answer key reaches Champion.

## Deliberately not built

- Cross-device or cross-event leaderboards.
- CRM integration and the nurture sequence.
- The partner white-label build.
- Any figure that would have to be estimated. There is no currency amount,
  no "average cost of downtime" and no ransom number anywhere in the game,
  including in the ransom note itself. That is a constraint, not an
  oversight.

## Distribution

Microsoft Teams and SharePoint serve an HTML file as a download, not as a
rendered page. Interactive sharing needs real hosting — Netlify Drop, GitHub
Pages, Azure Static Web Apps. A Teams website tab works once it is hosted.
