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

<!-- BEGIN SUITE IMPACT -->
## Suite impact

Before and after source or contract changes, run
`node ../obsidian-commons/scripts/inventory.mjs impact`. Read only the listed required contract peers and
same-surface symmetry candidates; do not scan every sibling repository. Run
their configured checks only when the report or changed contract requires them.

Run `node ../obsidian-commons/scripts/inventory.mjs release-check` before source release. The report
distinguishes a valid bundled runtime artifact from reproducible source
dependencies. If the project declares a shared-package link, pin an immutable
tag/commit before release and pass the check again.

Run `node ../obsidian-commons/scripts/inventory.mjs community-review <project|all>` for the Obsidian
community-rule lint gate. This command runs only each selected repository's
local `npm run lint:community-review`; a consumer check/build must never start a
suite traversal. Standalone browser userscripts are outside the Obsidian
runtime profile and remain under the repository's normal lint rules.

For manual repository maintenance, run `node ../obsidian-commons/scripts/inventory.mjs bot-prs
<project...>` and `node ../obsidian-commons/scripts/inventory.mjs maintain <project...>`. They default to
dry-run; add `--apply` only to approve/update eligible bot PRs and synchronized
rule dependencies. `maintain` implicitly adds commons for any Obsidian review
target; positional `all` selects the entire inventory.
<!-- END SUITE IMPACT -->
Before and after source or contract changes, run
`node ../obsidian-commons/scripts/inventory.mjs impact`. Read only the listed
required contract peers and same-surface symmetry candidates; do not scan every
sibling repository. Run their configured checks only when the report or changed
contract requires them.

`file:../obsidian-commons` is valid local build input because esbuild bundles
imported commons source into `main.js`. Before source release, pin an immutable
commons tag/commit and pass
`node ../obsidian-commons/scripts/inventory.mjs release-check`.

## Hard rules for page-color-prop

1. Theme-switching on `<body>` (such as in `computeColorFromThemeVarsForTheme` and `readBothThemeVars`) must always restore the initial body theme classes in a `finally` block to prevent leaving Obsidian stuck in the wrong theme.
2. In `openColorPickerAtElement`, element style overrides must be restored in a `finally` block if `showPicker` throws, and next-frame restoration must be dispatched via owner-window `requestFrameIn(ownerWindow(input) ?? window, ...)` rather than bare `window.requestAnimationFrame`.
3. In `updateAllTabHeaderColors`, access to `tabHeaderEl` must always go through `getTabHeaderEl(leaf)` from `commons/internals`.
4. Style cleanup in `removeStaleStyles` and link observation in `link-decorator.ts` must use `getOpenWindows` and `forEachWindow` to support multi-window Obsidian vaults and popout panes.
5. All file line endings in this repository must be LF (`* text=auto eol=lf`).
