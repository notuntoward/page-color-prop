# Agent Instructions for page-color-prop

## Shared library: commons

This plugin uses `commons` (repo `obsidian-commons`, normally `C:\Users\scott\repos\obsidian-commons`).
Window, tab group, tab, pop-out, window-focus and modal-chooser logic (and later color
logic) comes from `commons/*`. Never reimplement it here and never read Obsidian's
undocumented fields (`leaf.detached`, `container.win`, `rootSplit`, `tabHeaderEl`,
`chooser.setSelectedItem`, ...) in this plugin. If commons lacks something or is wrong,
change commons and tell the user: see the global rule "Obsidian shared library" and
`obsidian-commons/AGENTS.md`. Rules that moved to commons are enforced by its guardrail
tests; the rules below are the plugin-specific ones that remain.

Window resolution (`getOpenWindows`, `ownerWindow`), multi-window DOM event and observer hooking (`forEachWindow`), owner-window animation frames (`requestFrameIn`), and undocumented property access (`getTabHeaderEl`) are imported from `commons/*`.

## Hard rules for page-color-prop

1. Theme-switching on `<body>` (such as in `computeColorFromThemeVarsForTheme` and `readBothThemeVars`) must always restore the initial body theme classes in a `finally` block to prevent leaving Obsidian stuck in the wrong theme.
2. In `openColorPickerAtElement`, element style overrides must be restored in a `finally` block if `showPicker` throws, and next-frame restoration must be dispatched via owner-window `requestFrameIn(ownerWindow(input) ?? window, ...)` rather than bare `window.requestAnimationFrame`.
3. In `updateAllTabHeaderColors`, access to `tabHeaderEl` must always go through `getTabHeaderEl(leaf)` from `commons/internals`.
4. Style cleanup in `removeStaleStyles` and link observation in `link-decorator.ts` must use `getOpenWindows` and `forEachWindow` to support multi-window Obsidian vaults and popout panes.
5. All file line endings in this repository must be LF (`* text=auto eol=lf`).
