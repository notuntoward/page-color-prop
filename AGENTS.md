# Agent Instructions for page-color-prop

## Task scope and validation

Cache exact instructions per checkout/task; read guides only for changed areas.
Restore only missing/changed sections after compaction.
- Docs/instructions-only: text/link/format checks, not application tests/builds,
  browsers, installs or consumer sweeps. This qualifies completion gates below.
- Publication-only: reuse green checks/artifacts for unchanged code, dependencies,
  build inputs AND linked commons; validate unchecked pending source once.
- Source changes: targeted iteration tests, required final checks once; reuse
  composite steps and verify their bundle rather than rebundling.
Keep fresh Git branch/identity/message/hook checks and final remote-tip verification.

## Shared library: commons

Use commons for workspace/window/tab/focus, per-window timers/clipboard, modal,
search, geometry, page-color and line-flash helpers; never duplicate its
undocumented Obsidian adapters in plugin code. For an owned-area change, consult
the installed module exports and relevant commons guide sections. Change commons
with a regression test if needed, never a local copy. Docs/publication-only work
does not require opening the library or rebuilding its consumers.
Local adoption uses file:../obsidian-commons; obey the library's existing
commons-adoption branch and explicit-ref/tag-disabled publication rules.


## Hard rules for page-color-prop

1. Theme-switching on `<body>` (such as in `computeColorFromThemeVarsForTheme` and `readBothThemeVars`) must always restore the initial body theme classes in a `finally` block to prevent leaving Obsidian stuck in the wrong theme.
2. In `openColorPickerAtElement`, element style overrides must be restored in a `finally` block if `showPicker` throws, and next-frame restoration must be dispatched via owner-window `requestFrameIn(ownerWindow(input) ?? window, ...)` rather than bare `window.requestAnimationFrame`.
3. In `updateAllTabHeaderColors`, access to `tabHeaderEl` must always go through `getTabHeaderEl(leaf)` from `commons/internals`.
4. Style cleanup in `removeStaleStyles` and link observation in `link-decorator.ts` must use `getOpenWindows` and `forEachWindow` to support multi-window Obsidian vaults and popout panes.
5. All file line endings in this repository must be LF (`* text=auto eol=lf`).
