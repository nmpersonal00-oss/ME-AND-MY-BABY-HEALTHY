# Sakinah Study — Personal Observational Research Notebook

A separate, private, two-participant research notebook located exclusively under \`/research/\`. It does **not** replace, import from, or alter the existing Wifey & Hubby app. It uses new \`rb_\`-prefixed tables in the existing Wifey & Hubby Supabase project. It deliberately keeps its own browser authentication storage key.

## Protocol (version 1.0.0, fixed)

- **Question:** During a period of maintaining mutually agreed physical boundaries, do the participants observe calmer days and fewer episodes of tension or anger?
- **Design:** Prospective, single-dyad, observational N-of-2 study with repeated personal daily reports. This is not a randomized intervention, a controlled trial, or medical/relationship advice.
- **Hypothesis:** When the four boundaries are maintained, disagreement frequency, tension, and anger will be lower, and calm will be higher than the participants recall from earlier times. **Earlier recollections are qualitative background, not measured baseline data.** No quantitative baseline comparison or causal claims are possible without baseline observations.
- **Start:** November 13, 2026 (date fixed in the database). Each study chooses a common reporting time zone (California / Manitoba / UTC).
- **Boundaries:** (1) no physical contact, (2) maintain body covering in each other's presence, (3) no sexual flirting, (4) no undressing in each other's presence, including nonsexual reasons.
- **Stopping:** At the first reported boundary crossing, **either participant** chooses the relevant boundary and stops the observation for both people. Either participant may also withdraw or stop voluntarily. The database records a server-generated stop time, disallows restart and blocks new check-ins after stopping. Participants should promptly report a crossing; the database cannot detect one on its own.
- **Participation:** Completely voluntary. A participant may refuse or withdraw without being judged or penalized; the app is not for monitoring or disciplining a partner.
- **Faith:** Islamic commitments can motivate the hypothesis; the measurements capture reported experiences, not divine reward, sin, or outcomes in the akhirah.

## What the app does

1. Uses Supabase email/password authentication for **two distinct user accounts**. The owner invites one partner using a one-use SHA-256-hashed invitation code that expires after seven days.
2. Each participant enters their own daily ratings and episode counts; **only the author can see their individual observations and notes**. The shared study status and stopping reason are visible to both.
3. Stores one record per person per local calendar day, with controlled value ranges, immutable observation dates, server timestamps, and an audit trail of corrections.
4. Computes descriptive metrics with missing-day counts, daily plotted observations, and CSV export of **only the exporting person's** rows.
5. Stops new entries in the database, not merely through a disabled UI, when either participant stops the observation.

### Data dictionary

| Field | Type | Interpretation |
| --- | --- | --- |
| local_date | Date (study time zone) | Observation day; unique for each participant |
| calm | Integer 0–10 | 0 = not calm, 10 = very calm |
| tension | Integer 0–10 | 0 = no tension, 10 = very high tension |
| anger | Integer 0–10 | 0 = no anger, 10 = very high anger |
| happiness | Integer 0–10 | 0 = not happy, 10 = very happy |
| connectedness | Integer 0–10 | 0 = not close, 10 = very close |
| disagreement_episodes | Integer 0–30 | Distinct tense disagreements within the day |
| tension_episodes | Integer 0–30 | Distinct sustained tension episodes within the day |
| anger_episodes | Integer 0–30 | Distinct sustained anger episodes within the day |
| outside_stress | Optional integer 0–10 | Stress from factors outside the relationship |
| communication_quality | Optional integer 0–10 | Perceived quality of communication that day |
| sleep_hours | Optional decimal 0–24 | Previous-night sleep duration, in hours |
| together_minutes | Optional integer 0–1440 | Minutes spent in each other's company |
| notes | Optional text, <=2000 chars | Free-text contextual notes, visible only to author |
| created_at / updated_at | Database timestamps | Creation / correction metadata |

**Episode counting rule (predefine before observing):** Count a new sustained tension or anger episode when it lasts at least five minutes and follows at least fifteen calmer minutes since the previous episode of that type. The same event can be both a tense disagreement and an anger/tension episode because these are different indicators. If a day has no episode, record 0. If no diary was submitted, leave the day *missing* rather than entering zeros for it. Complete each diary once daily, ideally at a similar time, without showing each other scores first. Avoid filling in past days based on guesses; the current interface allows retrospective recording from the study start, so note any delay if applicable.

## Pre-specified descriptive analysis

**Primary outcomes:** Daily disagreement episode count, daily tension episode count, daily anger episode count; daily calm, tension and anger ratings.

**Secondary outcomes:** Happiness and connectedness ratings. Stress, communication, sleep and time together are contextual covariates only—not evidence of causal effects.

The dashboard provides: total and average episode counts per recorded day, mean ratings, observation coverage, and a daily trend plot. Missing daily observations are not considered zeros, and the chart breaks its trend lines across missing dates. A CSV export supports additional offline analysis by the individual participant.

Avoid confirmatory hypothesis tests, p-values, or correlation-driven causal conclusions for this one dyad without an appropriate design and sufficiently measured comparison period. Data are self-reported and may be affected by expectancy, time trends, workload, sleep, changes in communication, and knowledge of the study. An early stopping event also causes informative truncation of follow-up. A participant cannot see the other's raw data or generate a combined CSV without that person's separate export and consent.

## Architecture and privacy

- \`index.html\`: standalone mobile-responsive research interface (existing app untouched).
- \`app.js\`: browser-side Supabase Auth + Data API integration, study management, forms, charts and CSV.
- \`stats.mjs\`: pure descriptive-statistics module, without external dependencies.
- \`schema.sql\`: initial Postgres schema, functions, triggers, RLS and constrained grants.
- \`schema_v2.sql\`: episode frequencies and server-timestamp hardening; apply after \`schema.sql\`.
- \`stats.test.mjs\`: Node test runner for analysis logic.

No private observations or invitations are stored in GitHub. The browser receives only the existing **public** Supabase configuration from \`../cloud-config.js\`; no service-role key is used. All seven new \`rb_\` tables have RLS enabled. Only authenticated members can view their study status; daily check-ins and revision histories are accessible to the author only. Do not store passwords, private diary entries or invitation codes in the repo.

**Important limitations:** The two apps share the existing Supabase project and authentication backend, but not database tables, local-storage auth keys or UI code. Anyone with access to the Supabase project dashboard or privileged backup credentials may be able to administer the research data. Security depends on proper Supabase Auth configuration and account security. Research data stored in the service are not end-to-end encrypted.

## Deployment instructions

**Current status:** Research code lives on a dedicated development branch until deliberately merged. Existing \`main\` app assets are unchanged.

1. Review the additions in the pull request. Only \`research/\` paths should be included.
2. **Database:** Both migrations have already been applied to the \`Wifey & Hubby\` Supabase project. Do **not** re-run them there. For a new Supabase project, apply \`schema.sql\` and then \`schema_v2.sql\` once each.
3. In Supabase Authentication → URL Configuration, add the deployed HTTPS research page URL to the allowed **Redirect URLs** (without deleting any existing URLs). Verify email/password auth and email confirmation settings.
4. When you choose to publish it, merge the PR if the main branch is the published GitHub Pages branch. Open \`<your website base URL>/research/\` directly. No existing \`index.html\` needs editing.
5. On two separate browsers/devices, create/enter **different verified email accounts**, create one study, generate an invitation, privately send it to the second participant, and join after consent.
6. Test the daily write, correction, CSV download and study stopping rule using a **separate test study**, because stopping is irreversible. Do not enter real observations as test records.
7. Never send real notes in issue reports, screenshots, or GitHub commits.

### Verification

- All seven new public tables have RLS enabled and per-table policies.
- The database migrations completed without error.
- Pure statistical test cases cover no records, missing days, episode totals, date calculations and CSV formula escaping.
- No full end-to-end test with two verified human accounts has been performed. Real email confirmation, browser access, permissions and multi-device behavior require testing after publishing.

The repository's other application files and database tables were not changed.
