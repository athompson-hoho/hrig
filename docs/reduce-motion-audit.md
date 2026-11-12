# Reduce-motion audit (X11)

Scope: every place HRig animates, and whether the HRig setting `appearance.reduceMotion`
and the operating system's reduced-motion preference both stop it.

| Motion | Kind | HRig setting | OS preference | Result |
| --- | --- | --- | --- | --- |
| `fade-in` on menus and modals, `toast-in`, button colour transitions | CSS | stops (`:root[data-reduced-motion]` rule, also in popout windows) | stops (`@media (prefers-reduced-motion)`) | OK |
| `spin` on loading icons | CSS | stops | stops | OK. The spinner stands still, and every loading state also has visible text ("Loading…", "Connecting"), so no information is lost. |
| `scroll-behavior` | CSS | stops | not covered | Minor: only the HRig setting. No HRig element sets smooth scrolling today. |
| Editor smooth scrolling (Monaco `smoothScrolling`) | script | stopped | **not honored** | **Fixed** by `motionReduced()`. |
| Terminal cursor blink (xterm `cursorBlink`) | script | stopped (but only after the first settings effect) | **not honored**, and blinking was on at creation | **Fixed**: created with blink off when the OS asks, and the setting path uses the same helper. |
| Monaco cursor animation, minimap slider, hover delays | script | defaults | defaults | Monaco's caret animation is off by default; no change. |
| Terminal bell visual flash (T07) | script | n/a here | n/a here | Not part of this audit's scope; its style setting is an explicit opt-in. |

Not audited (needs a real display): third-party animation inside xterm.js and Monaco beyond
their documented options.

Changes: `src/reduced-motion.ts` (`motionReduced(setting, matchMedia)`), used by `EditorPanel`
and `TerminalPanel`. Behavior with the setting on is unchanged. With the setting off, an OS
reduced-motion preference now also turns off editor smooth scrolling and cursor blink.
