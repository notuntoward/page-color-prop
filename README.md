# Page Color Prop - Obsidian Plugin

Color note page backgrounds based on file properties. Fixed minimal CSS approach that doesn't block content.

## Key Fix in v1.2.3

**Problem**: Multiple background layers were creating "two shades of pink" and obscuring images.

**Solution**: Apply background to ONLY the main container, set ALL content to transparent.

## CSS Fix Details

```css
/* Single background target */
.workspace-leaf.mod-active .workspace-leaf-content[data-type="markdown"] {
  background-color: ${color} !important;
}

/* All content transparent */
.workspace-leaf.mod-active .workspace-leaf-content[data-type="markdown"] .view-content,
.workspace-leaf.mod-active .workspace-leaf-content[data-type="markdown"] .markdown-source-view,
/* ... other content selectors ... */ {
  background: transparent !important;
}

/* Images explicitly transparent */
.workspace-leaf.mod-active .workspace-leaf-content[data-type="markdown"] img {
  background: transparent !important;
}
```

## Installation

1. Extract zip to `YourVault/.obsidian/plugins/page-color-prop/`
2. Run `npm install && npm run build`
3. Enable in Obsidian Settings → Community plugins

## Result

- Single background color behind all content
- All text, images, diagrams fully visible
- No more "two shades" or blocked content
- Clean, minimal rendering

## License

MIT License