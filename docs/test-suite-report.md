# Test-suite speed and flakiness report (X15)

Report only; no test was changed for speed. Measured on the shared Linux build box,
`node --test --test-concurrency=2 tests/*.test.cjs`, wave-10 head, load 3-6 from other seats.

## Totals
- 797 tests (790 pass, 5 skip, plus 2 failures that were mine and fixed right after: both were
  older tests that asserted "no new timer" or evaluated a panel in a fixed scope).
- Wall time 293 s. Sum of individual test durations 461 s (concurrency 2).

## Where the time goes (per-file sum of test durations; names mapped back to files)
| Seconds | Tests | File |
| --- | --- | --- |
| 94 | 22 | `long-list-consumers.test.cjs` (one test alone: 66 s, "Sidebar long fully disabled stale inventory settles Home and End") |
| 57 | 21 | `file-explorer.test.cjs` |
| 32 | 31 | `seat-search.test.cjs` |
| 32 | 1 | `file-explorer-prohibition.test.cjs` |
| 21 | 1 | `git-badges-prohibition.test.cjs` |
| 17 | 12 | `seat-notifications-consumer.test.cjs` |
| 16 | 12 | `deferred-panel-consumers.test.cjs` |
| 48 | 231 | tests whose names are built in loops or templates (not attributable by name) |

About 60% of the sum sits in six files that mount the real Sidebar or file explorer with long
synthetic lists through `tests/helpers/virtual-list-harness.cjs`.

## Likely causes (from reading the harness; not profiled)
1. The harness transpiles each source module with `ts.transpileModule` again for every
   `mountComponent` call. Sidebar pulls in many modules, so each mount repeats that work.
   A per-process cache keyed by file path and mtime would likely remove most of the cost.
2. A few tests render thousands of rows and press Home/End through the real virtual list.
3. Some files are single large tests (one test = one file), so concurrency cannot split them.

## Suggested follow-ups (each needs its own change and review)
- Cache transpile output in the harness (expected biggest win, no test logic changes).
- Split the 66 s and 32 s tests into smaller cases, or reduce their synthetic row counts if the
  assertion does not depend on them.
- Run slow files first when sharding to keep both workers busy.

## Flakiness
- Over this wave, repeated full runs (mine and QA's) gave consistent counts (765/760/0/5 at
  `f920a90`; 766/761/0/5 at `ee39b93`) and no test passed on one run and failed on another.
  That is evidence of stability on this box, not proof.
- Known environment-dependent failure documented in the repo instructions: one test needs
  `/bin/bash`, which does not exist on NixOS; it is excluded from the current baseline counts.
- Timing-sensitive tests: the Markdown input-size tests (`tests/markdown-preview.test.cjs`) assert
  wall-clock limits (0.3-1.5 s). They have wide margins today but can fail on a heavily loaded
  machine; if one ever flakes, raise its limit before suspecting the parser.
- Tests that assert "no timer" by counting source occurrences (`seat-activity-age`,
  `attention-inbox-app`) broke when polling moved to a helper. Prefer checking behavior to
  counting source text when next touched.
