# Website audit — 25 October 2026

## Result

Local fixes are ready; they have not been deployed. Production authenticated leaderboard reads succeeded. Full production sign-off still requires deploying the frontend, applying the SQL migration, and a browser/device check against the public URL.

## Fixed in this change

- Leaderboard caches are separate for ALL, BRANCH, and YEAR and cleared when driver details change.
- Slow responses cannot replace a newer selected tab. Scoped standings no longer overwrite the global rank badge.
- Active standings refresh after five seconds; background global rank requests cannot overlap. Closing/unmounting the screen prevents late responses from restarting polling.
- Final results refresh so late confirmed scores and network recovery appear. Stale and unavailable data are identified.
- Player names, quiz options/explanations, and error/loading messages are escaped before HTML interpolation.
- Leaderboard dialog has focus management, Escape handling, labelled controls, selected-filter semantics, narrow-screen wrapping, and reduced-motion styles.
- Connection retry and closed-race recheck restart initialization. Change-driver navigation is allowed. Join requests reject duplicate submissions.
- Answer submission calls the current `answer_question` RPC. Anti-farming `TOO_SOON` and `waitMs` fields reach pit retry logic.
- Lap durations are rounded to integer milliseconds for the SQL RPC. Rejected server lap totals are also persisted.
- Pit lockout/resume timers and late async responses cannot revive a removed screen.
- The answer-key CSV moved from `public/` to `questions/`; validation and seed scripts use its new location. The production bundle excludes the mock adapter and its question bank. Mock builds do not initialize Supabase.
- Existing lint errors were repaired without disabling their rules.

## Live backend evidence

Using the configured Supabase project:

- `get_config`: HTTP 200, race open, fuel reward 10,000 ms.
- Anonymous sign-in: HTTP 200.
- Authenticated `get_leaderboard`: HTTP 200 for ALL, BRANCH, YEAR; ten ordered rows from 22 players at the time of the check.
- The audit auth session had no player profile: BRANCH/YEAR correctly exercised the existing fallback to ALL, **not** filtering for a registered player's branch/year. No racer was registered and no scores were changed. The temporary auth session was signed out.
- Unauthenticated `get_leaderboard`: HTTP 500, PostgreSQL `55000`, `record "v_player" is not assigned yet`.
- Both answer RPC names exist; unauthenticated calls reject before changing data. Local SQL migrations define newer behavior under `answer_question`.

## Database change awaiting application

Apply `supabase/migrations/20261026000003_leaderboard_hardening.sql` through the project's normal migration process or Supabase SQL Editor. It uses a typed player row for unauthenticated calls, explicitly orders returned rankings, and bounds the requested limit to 1–100. It does not modify player scores.

Only the public API key was available; no database administration connection or deployment access was available. The SQL migration has not been executed or tested against PostgreSQL here.

After application, verify unauthenticated ALL returns HTTP 200, then test two registered racers from different branches/years to confirm filtering, personal rank, and score changes across devices. Deploy the frontend with `VITE_USE_MOCK=false`.

## Verification

- 70 automated tests, including eight new API/DOM regression tests.
- TypeScript and production Vite build pass; mock-mode Vite build also passes.
- ESLint: zero errors, 17 existing typing/unused-variable warnings remain.
- Dependency installation audit: zero vulnerabilities reported.
- Question bank: all 195 rows pass syntax/constraint validation. Several difficulty/branch/year pools remain below recommended coverage.
- Production output no longer contains the question CSV or mock racer/question module.
- Real browser/mobile visual checks were unavailable: no browser connection and native computer-use startup failed. DOM tests do not verify layout, WebGL rendering, or actual device performance.
- CodeRabbit is installed but signed out; external CodeRabbit review was not run.

## Remaining audit findings

- The shipped SQL answer functions check `answered_at` before updating without locking the issued-question row. Concurrent submissions could double-credit an answer. Database concurrency hardening needs validation against the actually deployed function before event sign-off.
- Lap retry queues are in memory and can be lost on reload; the runbook's durability language overstates protection. Extended-offline multiple laps also need reconciliation testing before claiming lossless recovery.
- Runtime configuration is fetched at startup; the runbook's instant kill-switch/end-time claims are not implemented as continuous client checks. Several scripts intentionally make the race always open. Confirm the intended event control behavior before changing it.
- The Phaser entry chunk remains large (~1.46 MB before gzip); device performance/load testing is still needed for venue conditions.
- The answer key may already have been downloaded from an earlier deployment. Removing it from future builds cannot retract copies.
