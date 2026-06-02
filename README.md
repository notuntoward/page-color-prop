# Obsidian Page Color Prop

[![Build](https://github.com/notuntoward/page-color-prop/actions/workflows/build.yml/badge.svg)](https://github.com/notuntoward/page-color-prop/actions/workflows/build.yml)
[![CodeQL](https://github.com/notuntoward/page-color-prop/actions/workflows/codeql.yml/badge.svg)](https://github.com/notuntoward/page-color-prop/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://github.com/notuntoward/page-color-prop/actions/workflows/scorecard.yml/badge.svg)](https://github.com/notuntoward/page-color-prop/actions/workflows/scorecard.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/notuntoward/page-color-prop/badge)](https://securityscorecards.dev/viewer/?uri=github.com/notuntoward/page-color-prop)

Dynamically change the background color of your notes based on their frontmatter properties.

This plugin allows you to create visual cues for your notes, such as setting a red background for notes with `status: urgent` or a green background for `status: complete`.

-----

## Features

  * **Dynamic note coloring:** Automatically applies a background color to the active note based on its frontmatter.
  * **Flexible matching:**
      * **Exact match:** Triggers on a specific property-value pair (e.g., `priority: high`).
      * **Contains:** Triggers if the property's value *contains* the text (e.g., for a `tags` array).
  * **Theme aware:** Set different colors for **Light** and **Dark** themes.
  * **Auto color:** A one-click "Auto" mode that picks a subtle, theme-aware accent color.
  * **Manual color:** Use a color picker to select any specific color you want.
  * **Conflict awareness:** Optionally notify when more than one mapping applies to the same note.
  * **Easy management:** A settings panel to add, delete, duplicate, and reorder your color-mapping rules.

## How to Use

Once the plugin is installed, you can create rules (called "mappings") to connect your frontmatter to specific colors.

1.  Open Obsidian **Settings**.
2.  Go to **Community Plugins** \> **Page Color Prop**.
3.  Click `+ Add New Mapping` to create your first rule.
4.  Fill out the fields for the new mapping.

### Example Use Case: Color-coding a "Status"

Let's say you want all notes with `status: complete` in their frontmatter to have a green background.

1.  **Property:** `status`
2.  **Value:** `complete`
3.  **Match type:** `Exact match`
4.  **Light/dark theme:** Click "Use color picker" and pick a light green for the light theme and a dark green for the dark theme.

Now, any note you open with this frontmatter will have a green background:

```yaml
---
status: complete
tags: [project, done]
---

This note will have a green background.
```

### Example Use Case: Color-coding a "Tag"

Let's say you want all notes with the `#hydropower` tag to have a blue-tinted background.

1.  **Property:** `tags`
2.  **Value:** `hydropower`
3.  **Match type:** `Contains` (This is important for tag arrays\!)
4.  **Light/dark theme:** Leave this on "Auto (from theme)" for a simple, theme-aware blue tint.

Now, any note you open with that tag will be colored:

```yaml
---
status: in-progress
tags: [source, hydropower, research]
---

This note will have a blue background because the "tags"
property *contains* "hydropower".
```

### Rule Priority and Multiple Matches

More than one mapping can apply to the same note. For example, a note might have `source: literaturenote` and also include `ai-generated` in its `tags`. In that case, the plugin uses the matching rule that appears lowest in the settings list.

**Notify when multiple rules match** is on by default and can be turned off in the settings panel.

-----

## Settings panel explained

  * **Property:** The name of the frontmatter key (e.g., `status`, `tags`, `priority`).
  * **Value:** The value you want to match (e.g., `complete`, `hydropower`, `high`).
  * **Match type:**
      * `Exact match`: The property's value must be *exactly* what you typed.
      * `Contains`: The property's value (string or array) must *include* what you typed. **Use this for tags\!**
  * **Theme backgrounds (light/dark):**
      * **Sample box:** The large square on the left shows a preview of the color.
      * **Mode label:** Tells you if the color is `Auto` or `Manual`.
      * **Use color picker / Use auto color:** Toggles between the two modes.
      * **Color picker:** When in `Manual` mode, a small color dot appears. Click this to open the color picker and choose any color.
  * **Notify when multiple rules match:** Shows a notification when more than one mapping matches a note. When this happens, the lowest matching rule in the list sets the background color.
  * **Mapping Controls:**
      * **Duplicate:** Copies the current mapping.
      * **Up/Down:** Changes the priority of the mapping. If multiple mappings match, the plugin uses the lowest matching mapping in the list.
      * **Delete:** Removes the mapping.

-----



## Contributing

Found a bug or have a feature request? Feel free to open an issue on the [GitHub repository](https://github.com/notuntoward/page-color-prop/issues).

## License

This plugin is licensed under the [MIT License](LICENSE).
