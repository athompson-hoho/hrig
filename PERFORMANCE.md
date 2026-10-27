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
