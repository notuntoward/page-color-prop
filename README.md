# Page Color Prop - Obsidian Plugin

[![GitHub release (latest SemVer)](https://img.shields.io/github/v/release/your-username/page-color-prop?style=for-the-badge&sort=semver)](https://github.com/your-username/page-color-prop/releases/latest)
[![GitHub All Releases](https://img.shields.io/github/downloads/your-username/page-color-prop/total?style=for-the-badge)](https://github.com/your-username/page-color-prop/releases)

Color your Obsidian note backgrounds based on frontmatter properties. Create visual organization by automatically applying background colors when notes contain specific property values.

## ✨ Features

- **🎨 Property-Based Coloring**: Automatically color note backgrounds based on frontmatter property values
- **🔍 Flexible Matching**: Support for both exact matches and "contains" matching for array properties like tags
- **⚡ Real-Time Updates**: Colors change instantly when you modify properties or switch between notes
- **🖥️ Universal Compatibility**: Works in Reading view, Edit mode, and Live Preview
- **🔧 Intuitive Interface**: Beautiful, zoom-responsive settings panel with live color previews
- **🎯 Non-Intrusive**: Clean background rendering that never blocks content visibility
- **🌈 Flexible Colors**: Support for hex codes, RGB/RGBA, CSS color names, and CSS variables

## 📸 Screenshots

### Settings Interface
Clean, card-based settings interface with live color previews and intuitive controls:

*[Settings interface screenshot would go here]*

### Background Colors in Action
Example of notes with different background colors based on their properties:

*[Before/after screenshots would go here]*

## 🚀 Quick Start

1. **Install the plugin** (see [Installation](#-installation) below)
2. **Open plugin settings**: Settings → Community plugins → Page Color Prop
3. **Add a color mapping**:
   - **Property**: `status`
   - **Value**: `completed` 
   - **Color**: `#90EE90` (light green)
   - **Match Type**: `Exact Match`
4. **Create a note** with frontmatter:
   ```yaml
   ---
   status: completed
   ---
   ```
5. **See the magic**: Your note now has a light green background! ✨

## 📋 Use Cases

### 📊 Project Status Tracking
```yaml
---
status: in-progress
priority: high
---
```
- `status: completed` → Green background
- `status: in-progress` → Yellow background  
- `priority: high` → Light red background

### 🏷️ Tag-Based Organization
```yaml
---
tags: [work, urgent, meeting]
---
```
- Contains `urgent` → Red background
- Contains `work` → Blue background
- Contains `personal` → Purple background

### 📚 Content Type Classification
```yaml
---
type: reference
category: programming
---
```
- `type: reference` → Light gray background
- `type: tutorial` → Light blue background
- `category: programming` → Dark theme background

## 🛠️ Installation

### From Obsidian Community Plugins (Recommended)

1. Open **Settings** in Obsidian
2. Go to **Community plugins** → **Browse**
3. Search for **"Page Color Prop"**
4. Click **Install**, then **Enable**

### Manual Installation

1. Download the latest release from [GitHub Releases](https://github.com/your-username/page-color-prop/releases)
2. Extract the zip file to `YourVault/.obsidian/plugins/page-color-prop/`
3. Reload Obsidian
4. Enable the plugin in **Settings** → **Community plugins**

### For Developers

```bash
# Clone the repository
git clone https://github.com/your-username/page-color-prop.git
cd page-color-prop

# Install dependencies
npm install

# Build the plugin
npm run build

# For development with auto-rebuild
npm run dev
```

## ⚙️ Configuration

### Adding Color Mappings

1. Go to **Settings** → **Page Color Prop**
2. Click **"+ Add New Mapping"**
3. Configure your mapping:

| Field | Description | Example |
|-------|-------------|---------|
| **Property** | The frontmatter property name | `status`, `tags`, `priority` |
| **Value** | The value to match | `completed`, `urgent`, `high` |
| **Match Type** | How to match the value | `Exact Match` or `Contains` |
| **Background Color** | CSS color value | `#90EE90`, `rgba(255,0,0,0.1)` |

### Match Types Explained

- **Exact Match**: Property value must exactly equal the specified value
  ```yaml
  status: completed  # Matches "completed" exactly
  ```

- **Contains**: Property value (especially arrays) must contain the specified value
  ```yaml
  tags: [work, urgent, meeting]  # Contains "urgent"
  ```

### Supported Color Formats

- **Hex codes**: `#FF5733`, `#123ABC`
- **RGB/RGBA**: `rgb(255, 87, 51)`, `rgba(255, 87, 51, 0.5)`
- **Color names**: `red`, `blue`, `lightgreen`, `cornflowerblue`
- **CSS variables**: `var(--accent-color)`, `var(--background-secondary)`

### Managing Mappings

- **🔄 Reorder**: Use ↑ Up / ↓ Down buttons to change priority
- **📋 Duplicate**: Clone existing mappings to create similar ones
- **🗑️ Delete**: Remove individual mappings or clear all at once
- **🎨 Test**: Preview colors with the "Test" button

## 🎯 Advanced Usage

### Priority System

Color mappings are processed in order from top to bottom. The **first matching** rule wins:

1. `tags` contains `urgent` → Red background
2. `tags` contains `work` → Blue background  
3. `status` equals `completed` → Green background

If a note has `tags: [work, urgent]`, it gets a **red** background (urgent wins).

### Complex Properties

The plugin works with any frontmatter property:

```yaml
---
project: "Website Redesign"
team: [design, frontend, backend]
deadline: 2024-12-31
complexity: high
client: "Acme Corp"
---
```

You can create mappings for:
- `project` contains `"Website"` → Project-specific color
- `team` contains `design` → Design team color
- `complexity` equals `high` → High complexity color

### CSS Variable Integration

Use Obsidian's CSS variables for theme consistency:

```css
/* Your snippet.css */
:root {
  --my-urgent-color: rgba(255, 100, 100, 0.15);
  --my-completed-color: rgba(100, 255, 100, 0.15);
}
```

Then in plugin settings:
- **Color**: `var(--my-urgent-color)`
- **Color**: `var(--my-completed-color)`

## 🔧 Technical Details

### How It Works

1. **Property Detection**: Plugin monitors active file changes and metadata updates
2. **Rule Matching**: Checks frontmatter properties against your configured mappings
3. **CSS Injection**: Dynamically applies background color using minimal CSS targeting
4. **Clean Rendering**: Uses transparent overlays to ensure content remains visible

### CSS Implementation

The plugin uses a minimal CSS approach to avoid content blocking:

```css
/* Single background target */
.workspace-leaf.mod-active .workspace-leaf-content[data-type="markdown"] {
  background-color: #90EE90 !important;
}

/* All content transparent */
.workspace-leaf.mod-active .workspace-leaf-content[data-type="markdown"] .view-content,
.workspace-leaf.mod-active .workspace-leaf-content[data-type="markdown"] .markdown-source-view {
  background: transparent !important;
}
```

### Performance

- **Lightweight**: Minimal overhead, only processes active file
- **Efficient**: Uses Obsidian's built-in event system
- **Clean**: Automatically removes styles when switching files

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Development Setup

1. Clone the repo: `git clone https://github.com/your-username/page-color-prop.git`
2. Install dependencies: `npm install`
3. Start development: `npm run dev`
4. Make changes and test in your Obsidian vault
5. Submit a pull request

### Reporting Issues

Found a bug? Have a feature request? Please [open an issue](https://github.com/your-username/page-color-prop/issues) with:

- **Obsidian version**
- **Plugin version**
- **Steps to reproduce**
- **Expected vs actual behavior**
- **Screenshots if applicable**

## 📝 Changelog

### v1.2.3 - Latest
- ✅ **Fixed**: Eliminated multiple background layers causing content blocking
- ✅ **Improved**: Minimal CSS targeting for clean rendering
- ✅ **Enhanced**: Images and content now fully visible

### v1.2.2
- 🔧 Fixed background rendering issues
- 🎨 Improved CSS layer management

### v1.2.1
- ⌨️ **Fixed**: Input fields now accept typing properly
- 🔧 Switched to proper Obsidian Setting API
- ✅ All form interactions now work correctly

### v1.2.0
- 📱 **Added**: Complete zoom responsiveness for all interface elements
- 🎯 **Improved**: Settings interface scales properly from 50% to 200% zoom
- 🔧 **Fixed**: Dropdown text clipping at various zoom levels

### v1.1.0
- 🎨 **Redesigned**: Complete settings interface overhaul
- 📋 **Added**: Card-based layout with intuitive form structure
- 🌈 **Added**: Live color preview boxes
- ⚡ **Added**: Color test functionality

### v1.0.0
- 🎉 Initial release
- 🎨 Basic property-to-color mapping functionality
- ⚙️ Settings interface for managing mappings

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built for the amazing [Obsidian](https://obsidian.md/) community
- Inspired by the need for visual organization in knowledge management
- Thanks to all contributors and users who provide feedback

## 🔗 Links

- **🏠 Homepage**: [GitHub Repository](https://github.com/your-username/page-color-prop)
- **📥 Download**: [Latest Release](https://github.com/your-username/page-color-prop/releases/latest)
- **🐛 Issues**: [Bug Reports & Feature Requests](https://github.com/your-username/page-color-prop/issues)
- **💬 Discussions**: [Community Discussions](https://github.com/your-username/page-color-prop/discussions)
- **☕ Support**: [Buy me a coffee](https://buymeacoffee.com/your-username)

---

**Made with ❤️ for the Obsidian community**