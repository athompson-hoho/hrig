# Desktop performance baseline

Measured from the packaged 0.9.0 release in [native CI](https://github.com/athompson-hoho/hrig/actions/runs/40511570258). Full machine context and results are attached as [NATIVE-QA.json](https://github.com/athompson-hoho/hrig/releases/download/v0.9.0/HRig-0.9.0-NATIVE-QA.json).

Each case starts a fresh application process with disposable local shells and a shared OS cache. These are single-run CI baselines, not controlled cold-start measurements or desktop guarantees. Memory sums Electron working sets before opening Monaco; shared pages may be counted twice, and external shells/agents are excluded. CPU uses cumulative process CPU deltas over two seconds immediately after readiness; startup activity can remain, so this is not a sustained idle or battery measurement.

| Target | Terminals | Workspace ready ms | All terminals ready ms | Electron MiB | Editor open ms | Settings open ms | CPU % |
|---|---:|---:|---:|---:|---:|---:|---:|
| win32 x64 | 0 | 618 | 618 | 310 | 1017 | 108 | 0.43 |
| win32 x64 | 12 | 1060 | 1090 | 434 | 1052 | 121 | 0.27 |
| win32 x64 | 24 | 1708 | 1742 | 554 | 1067 | 120 | 0.11 |
| darwin arm64 | 0 | 677 | 677 | 382 | 606 | 122 | 15.74 |
| darwin arm64 | 12 | 896 | 928 | 399 | 587 | 83 | 5.65 |
| darwin arm64 | 24 | 1086 | 1114 | 421 | 541 | 137 | 4.6 |
| darwin x64 | 0 | 2229 | 2229 | 301 | 2098 | 212 | 15.6 |
| darwin x64 | 12 | 2728 | 3112 | 323 | 1386 | 185 | 4.56 |
| darwin x64 | 24 | 4559 | 4920 | 337 | 3823 | 171 | 5.27 |
| linux x64 | 0 | 424 | 424 | 511 | 513 | 96 | 2 |
| linux x64 | 12 | 1055 | 1222 | 539 | 502 | 100 | 2 |
| linux x64 | 24 | 1752 | 1888 | 553 | 504 | 150 | 0 |
| linux arm64 | 0 | 333 | 333 | 510 | 984 | 68 | 1.5 |
| linux arm64 | 12 | 578 | 711 | 536 | 574 | 78 | 2.49 |
| linux arm64 | 24 | 1221 | 1283 | 554 | 586 | 75 | 0 |

Compare future measurements on equivalent hardware before setting budgets. The Intel macOS runner has the slowest readiness/editor timings in this sample; repeat and profile that workload before treating the difference as a runtime limitation.

## Controlled renderer reproduction

From the repository root, after a fresh build of the exact candidate and with the existing Playwright-managed Chromium executable available, use:

```sh
node scripts/benchmark.mjs --controlled-renderer --samples=5
```

The explicit `--controlled-renderer` flag selects this mode before packaged release metadata access. The original packaged benchmark remains available through its existing invocation and retains its 0/12/24-terminal scenarios; it is a separate workload. Do not use the default invocation as an availability probe. Controlled mode needs existing project dependencies, readable candidate Git metadata, fresh `dist/index.html` and `dist/assets/` output, and an already installed compatible runtime. It does not build or install prerequisites. Coordinate fresh builds with the shared build owner; an old or missing `dist` cannot establish current-candidate results.

The default is five samples **per scenario** (ten total), with a fresh browser context per sample, one headless browser process and shared OS cache. `--samples=N` accepts integers from 1 through 20. These scenarios use zero terminals and a before-script, in-memory fake preload:

- `welcome-only`: synthetic workspace with the welcome tab selected; explicitly open the synthetic file through Explorer, then Settings, then revisit the editor.
- `restored-hidden`: welcome selected with saved unopened editor/diff/Settings tabs and saved global/tab render-on-demand flags false; select the editor, open Settings, then revisit the editor. Diff stays unopened and is not a separately timed activation.

Only fixed synthetic connection/workspace/inventory/file responses and inert persistence/subscriptions are supplied. The harness never loads production preload or Electron main. Unknown capabilities and host actions are denied; networking is confined to GET requests for `/index.html`, allowlisted `/assets/` filenames and the fixed `/icon.svg` favicon at the synthetic origin. The favicon is served as `image/svg+xml`. Known regular `popout.html` build output is ignored and never served, including if a forged asset map contains it. Unknown root files, symlinks, traversal requests, query/hash-bearing requests, other methods, external origins and forged-map unknown root entries remain denied; service workers, websockets and unexpected requests are blocked. No authenticated host, PTY, shell, owner workspace or host input belongs to this workload.

All four elapsed values use one monotonic orchestration `performance.now()` clock, in **milliseconds**:

| Field | Observed interval |
|---|---|
| `workspaceReadyMs` | Before navigation through the actual committed Layout model-ready selector |
| `editorOpenMs` | Explicit first editor activation through visible Monaco view-lines readiness |
| `settingsOpenMs` | Explicit Settings activation through its heading readiness |
| `revisitMs` | Editor tab selection through visible Monaco readiness after Settings |

Readiness includes automation, navigation, asset routing and selector-observation overhead. The model marker checks the committed model's ownership; it is not the earlier loaded log. Fixed editor/Settings chunk-request keys are recorded before and after activation; optional requests before activation fail the run. Component readiness and resource requests do not prove module evaluation, paint or native retention.

The JSON report reconstructs allowlisted fields: candidate commit/dirty boolean, SHA-256 artifact fingerprint, platform/architecture, Node/browser versions, method, sample count, individual scenario samples and metric summaries. The artifact hash covers the collected served map, with sorted asset names and bytes each separated by NULs: `/index.html`, collected `/assets/` files and the fixed `/icon.svg` when present. Ignored `/popout.html` is excluded. This identifies the collected assets available to the router, without proving every asset was requested or certifying build freshness. An independent fingerprint over all build files uses a different scope and is not equivalent to this production collector hash. Summaries provide min/max/arithmetic mean/median for each field across **both scenarios combined**; compare individual scenario samples separately when interpreting them. Invalid/nonfinite/regressing clock observations and duplicate completion are rejected. Failures use fixed labels, without raw errors, private identities, paths or environment dumps.

Validate asset acceptance with a newly coordinated build and the actual production collector against that fresh `dist`; representative-tree tests and historical build results alone do not establish it. Keep candidate-specific acceptance status, fingerprints and observed output in the local execution report. Asset acceptance supplies no startup samples or native/performance judgment approval.

Missing runtime or assets returns unavailable with zero samples and `metrics: null`; failed runs likewise supply no measured values. Exit zero alone is insufficient: inspect JSON `status`, `reason`, candidate/artifact and samples. A candidate-metadata subprocess restriction can instead produce `failed / controlled-run-failed` before the availability branch; retain that result separately from a read-only executable check. Do not interpret null metrics as numeric zero. Pure clock tests, Node loader duration, TAP execution time and bundle sizes are not startup measurements.

These observations exclude renderer-entry evaluation as a separately timed interval, first paint, Electron/OS launch, backend/PTY readiness and cold-cache startup. The synthetic backend, headless browser, shared caches and automation differ from a native application. The packaged baseline above remains historical and is not a comparable before/after pair. No performance improvement follows without equivalent conditions and actual samples. Native focus, AT, layout, popout, restart, ReactDOM retention and report judgment require their own evidence.
