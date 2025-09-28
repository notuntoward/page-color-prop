import { Plugin, TFile, MetadataCache, WorkspaceLeaf } from 'obsidian';
import { PageColorPropSettings, DEFAULT_SETTINGS, PageColorPropSettingTab } from './settings';

interface PropertyColorMapping {
  property: string;
  value: string;
  color: string;
  matchType: 'exact' | 'contains';
}

export default class PageColorPropPlugin extends Plugin {
  settings: PageColorPropSettings;
  private currentStyleEl: HTMLStyleElement | null = null;

  async onload() {
    await this.loadSettings();

    // Add settings tab
    this.addSettingTab(new PageColorPropSettingTab(this.app, this));

    // Register events
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', this.onActiveLeafChange.bind(this))
    );

    this.registerEvent(
      this.app.metadataCache.on('changed', this.onMetadataChanged.bind(this))
    );

    // Apply color to current active file on load
    this.applyColorToActiveFile();
  }

  onunload() {
    this.removeCurrentStyle();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    // Reapply color when settings change
    this.applyColorToActiveFile();
  }

  private onActiveLeafChange(leaf: WorkspaceLeaf | null) {
    this.applyColorToActiveFile();
  }

  private onMetadataChanged(file: TFile) {
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile && activeFile.path === file.path) {
      this.applyColorToActiveFile();
    }
  }

  private applyColorToActiveFile() {
    // Remove existing styles
    this.removeCurrentStyle();

    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) return;

    const metadata = this.app.metadataCache.getFileCache(activeFile);
    if (!metadata?.frontmatter) return;

    // Find matching color mapping
    const colorMapping = this.findMatchingColorMapping(metadata.frontmatter);
    if (!colorMapping) return;

    // Apply the color
    this.applyBackgroundColor(colorMapping.color);
  }

  private findMatchingColorMapping(frontmatter: any): PropertyColorMapping | null {
    for (const mapping of this.settings.colorMappings) {
      const propertyValue = frontmatter[mapping.property];

      if (propertyValue === undefined || propertyValue === null) continue;

      if (mapping.matchType === 'exact') {
        // Exact match for single values
        if (propertyValue === mapping.value) {
          return mapping;
        }
      } else if (mapping.matchType === 'contains') {
        // Contains match for arrays (like tags)
        if (Array.isArray(propertyValue)) {
          if (propertyValue.includes(mapping.value)) {
            return mapping;
          }
        } else if (typeof propertyValue === 'string') {
          if (propertyValue.includes(mapping.value)) {
            return mapping;
          }
        }
      }
    }

    return null;
  }

  private applyBackgroundColor(color: string) {
    // Validate color format
    if (!this.isValidColor(color)) {
      console.warn(`Page Color Prop: Invalid color format: ${color}`);
      return;
    }

    // MINIMAL CSS: Only target the main container, make everything else transparent
    this.currentStyleEl = document.createElement('style');
    this.currentStyleEl.textContent = `
      /* MINIMAL APPROACH: Single background container only */
      .workspace-leaf.mod-active .workspace-leaf-content[data-type="markdown"] {
        background-color: ${color} !important;
      }

      /* Make ALL content elements transparent to eliminate multiple layers */
      .workspace-leaf.mod-active .workspace-leaf-content[data-type="markdown"] .view-content,
      .workspace-leaf.mod-active .workspace-leaf-content[data-type="markdown"] .markdown-source-view,
      .workspace-leaf.mod-active .workspace-leaf-content[data-type="markdown"] .markdown-preview-view,
      .workspace-leaf.mod-active .workspace-leaf-content[data-type="markdown"] .cm-editor,
      .workspace-leaf.mod-active .workspace-leaf-content[data-type="markdown"] .cm-scroller,
      .workspace-leaf.mod-active .workspace-leaf-content[data-type="markdown"] .markdown-preview-sizer {
        background: transparent !important;
      }

      /* Explicitly make images transparent */
      .workspace-leaf.mod-active .workspace-leaf-content[data-type="markdown"] img {
        background: transparent !important;
        mix-blend-mode: normal !important;
      }

      /* Preserve important element backgrounds */
      .workspace-leaf.mod-active .workspace-leaf-content[data-type="markdown"] pre,
      .workspace-leaf.mod-active .workspace-leaf-content[data-type="markdown"] code {
        background-color: var(--code-background) !important;
      }
    `;

    document.head.appendChild(this.currentStyleEl);
  }

  private removeCurrentStyle() {
    if (this.currentStyleEl) {
      this.currentStyleEl.remove();
      this.currentStyleEl = null;
    }
  }

  private isValidColor(color: string): boolean {
    // Check if it's a CSS variable
    if (color.startsWith('--') || color.startsWith('var(--')) {
      return true;
    }

    // Check if it's a valid CSS color by creating a temporary element
    const testEl = document.createElement('div');
    testEl.style.color = color;
    return testEl.style.color !== '';
  }
}