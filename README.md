# Obsidian Page Color Prop

[](https://www.google.com/search?q=https://github.com/YOUR_USERNAME/obsidian-page-color-prop/releases/latest)
[](https://www.google.com/search?q=https://github.com/YOUR_USERNAME/obsidian-page-color-prop/releases)

Dynamically change the background color of your notes based on their frontmatter properties.

This plugin allows you to create visual cues for your notes, such as setting a red background for notes with `status: urgent` or a green background for `status: complete`.

-----

## Features

  * **Dynamic Note Coloring:** Automatically applies a background color to the active note based on its frontmatter.
  * **Flexible Matching:**
      * **Exact Match:** Triggers on a specific property-value pair (e.g., `priority: high`).
      * **Contains:** Triggers if the property's value *contains* the text (e.g., for a `tags` array).
  * **Theme Aware:** Set different colors for **Light** and **Dark** themes.
  * **Auto-Color:** A one-click "Auto" mode that picks a subtle, theme-aware accent color.
  * **Manual Color:** Use a full color-picker to select any specific color you want.
  * **Easy Management:** A settings panel to add, delete, duplicate, and re-order your color-mapping rules.

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
3.  **Match Type:** `Exact Match`
4.  **Light/Dark Theme:** Click "Color Picker" and pick a light green for the light theme and a dark green for the dark theme.

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
3.  **Match Type:** `Contains` (This is important for tag arrays\!)
4.  **Light/Dark Theme:** Leave this on "Auto (from theme)" for a simple, theme-aware blue tint.

Now, any note you open with that tag will be colored:

```yaml
---
status: in-progress
tags: [source, hydropower, research]
---

This note will have a blue background because the "tags"
property *contains* "hydropower".
```

-----

## Settings Panel Explained

  * **Property:** The name of the frontmatter key (e.g., `status`, `tags`, `priority`).
  * **Value:** The value you want to match (e.g., `complete`, `hydropower`, `high`).
  * **Match Type:**
      * `Exact Match`: The property's value must be *exactly* what you typed.
      * `Contains`: The property's value (string or array) must *include* what you typed. **Use this for tags\!**
  * **Theme Backgrounds (Light/Dark):**
      * **Sample Box:** The large square on the left shows a preview of the color.
      * **Mode Label:** Tells you if the color is `Auto` or `Manual`.
      * `Color Picker/Auto` **Button:** Toggles between the two modes.
      * **Color Picker:** When in `Manual` mode, a small color dot appears. Click this to open the color picker and choose any color.
  * **Mapping Controls:**
      * **Duplicate:** Copies the current mapping.
      * **Up/Down:** Changes the priority of the mapping. The plugin uses the *first* mapping it finds that matches, from top to bottom.
      * **Delete:** Removes the mapping.

-----

## How to Install

### Manual Installation

1.  Download the `main.js`, `styles.css`, and `manifest.json` files from the [latest release](https://www.google.com/search?q=https://github.com/YOUR_USERNAME/obsidian-page-color-prop/releases/latest) on GitHub.
2.  Find your Obsidian vault's plugin folder. This is usually `.obsidian/plugins/` in the root of your vault.
3.  Create a new folder inside `plugins` named `page-color-prop`.
4.  Copy the three downloaded files into this new folder.
5.  Reload Obsidian (or close and re-open it).
6.  Go to **Settings** \> **Community plugins**, find "Page Color Prop", and **Enable** it.

### SOMEDAY BUT NOT YET: From the Community Plugin Browser (Recommended)

1.  Open **Settings** in Obsidian.
2.  Go to **Community plugins** \> **Browse**.
3.  Search for "Page Color Prop".
4.  Click **Install**, then click **Enable**.
5.  
-----

## Contributing

Found a bug or have a feature request? Feel free to open an issue on the [GitHub repository](https://www.google.com/search?q=https://github.com/notuntoward/obsidian-page-color-prop/issues).

## License

This plugin is licensed under the [MIT License](https://www.google.com/search?q=LICENSE).
