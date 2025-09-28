import { App, PluginSettingTab, Setting } from 'obsidian';
import PageColorPropPlugin from './main';

export interface PropertyColorMapping {
  property: string;
  value: string;
  color: string;
  matchType: 'exact' | 'contains';
}

export interface PageColorPropSettings {
  colorMappings: PropertyColorMapping[];
}

export const DEFAULT_SETTINGS: PageColorPropSettings = {
  colorMappings: [
    {
      property: 'status',
      value: 'completed',
      color: '#90EE90',
      matchType: 'exact'
    },
    {
      property: 'tags',
      value: 'urgent',
      color: 'rgba(255, 0, 0, 0.1)',
      matchType: 'contains'
    }
  ]
};

export class PageColorPropSettingTab extends PluginSettingTab {
  plugin: PageColorPropPlugin;

  constructor(app: App, plugin: PageColorPropPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.addZoomResponsiveStyles();

    containerEl.createEl('h2', { text: 'Page Color Prop Settings' });
    containerEl.createEl('p', { 
      text: 'Color note backgrounds based on frontmatter properties. Configure property-to-color mappings below.',
      cls: 'page-color-prop-description'
    });

    new Setting(containerEl)
      .setName('Add Color Mapping')
      .setDesc('Create a new property-to-color mapping')
      .addButton(button => {
        button
          .setButtonText('+ Add New Mapping')
          .setCta()
          .onClick(() => {
            this.plugin.settings.colorMappings.push({
              property: '',
              value: '',
              color: '#ffffff',
              matchType: 'exact'
            });
            this.plugin.saveSettings();
            this.display();
          });
      });

    if (this.plugin.settings.colorMappings.length > 0) {
      const mappingsTitle = containerEl.createEl('h3', { 
        text: `Color Mappings (${this.plugin.settings.colorMappings.length})`,
        cls: 'page-color-prop-section-title'
      });

      this.plugin.settings.colorMappings.forEach((mapping, index) => {
        this.createMappingSettings(containerEl, mapping, index);
      });

      new Setting(containerEl)
        .setName('Clear All Mappings')
        .setDesc('Remove all color mappings (cannot be undone)')
        .addButton(button => {
          button
            .setButtonText('Clear All')
            .setWarning()
            .onClick(async () => {
              const confirmClearAll = confirm(`Delete all ${this.plugin.settings.colorMappings.length} color mappings?\n\nThis action cannot be undone.`);
              if (confirmClearAll) {
                this.plugin.settings.colorMappings = [];
                await this.plugin.saveSettings();
                this.display();
              }
            });
        });
    } else {
      const emptyState = containerEl.createDiv('page-color-prop-empty-state');
      emptyState.innerHTML = `
        <div class="empty-state-content">
          <h3>No Color Mappings Yet</h3>
          <p>Click "Add New Mapping" above to create your first property-to-color mapping.</p>
          <p><strong>Example:</strong> Map <code>status: completed</code> to a green background</p>
        </div>
      `;
    }

    this.createHelpSection(containerEl);
  }

  private createMappingSettings(container: HTMLElement, mapping: PropertyColorMapping, index: number) {
    const card = container.createDiv('page-color-prop-card');

    const header = card.createDiv('card-header');
    header.createEl('h4', { text: `Mapping ${index + 1}`, cls: 'card-title' });

    const deleteBtn = header.createEl('button', { 
      text: '×', 
      cls: 'card-delete-btn',
      attr: { 'aria-label': 'Delete mapping' }
    });
    deleteBtn.addEventListener('click', async () => {
      const propertyDisplay = mapping.property || 'empty';
      const valueDisplay = mapping.value || 'empty';
      const confirmDelete = confirm(`Delete this mapping?\n\nProperty: "${propertyDisplay}"\nValue: "${valueDisplay}"`);
      if (confirmDelete) {
        this.plugin.settings.colorMappings.splice(index, 1);
        await this.plugin.saveSettings();
        this.display();
      }
    });

    new Setting(card)
      .setName('Property')
      .setDesc('The property name to check (e.g., "status", "tags", "project")')
      .addText(text => {
        text
          .setPlaceholder('e.g., status, tags, project')
          .setValue(mapping.property)
          .onChange(async (value) => {
            mapping.property = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(card)
      .setName('Value')
      .setDesc('The value to match against')
      .addText(text => {
        text
          .setPlaceholder('e.g., completed, urgent')
          .setValue(mapping.value)
          .onChange(async (value) => {
            mapping.value = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(card)
      .setName('Match Type')
      .setDesc('How to match the value: "exact" for single values, "contains" for arrays')
      .addDropdown(dropdown => {
        dropdown
          .addOption('exact', 'Exact Match')
          .addOption('contains', 'Contains (for arrays)')
          .setValue(mapping.matchType)
          .onChange(async (value: 'exact' | 'contains') => {
            mapping.matchType = value;
            await this.plugin.saveSettings();
          });
      });

    const colorSetting = new Setting(card)
      .setName('Background Color')
      .setDesc('CSS color value (hex, rgba, color name, or CSS variable)')
      .addText(text => {
        text
          .setPlaceholder('#ffffff or rgba(255,255,255,0.1)')
          .setValue(mapping.color)
          .onChange(async (value) => {
            mapping.color = value;
            await this.plugin.saveSettings();
            this.updateColorPreview(colorPreview, value);
          });
      });

    const colorPreview = colorSetting.controlEl.createDiv('color-preview');
    colorPreview.style.backgroundColor = mapping.color;

    const testColorBtn = colorSetting.controlEl.createEl('button', { 
      text: 'Test',
      cls: 'test-color-btn'
    });
    testColorBtn.addEventListener('click', () => {
      this.testColor(mapping.color);
    });

    const actionsSetting = new Setting(card)
      .setName('Actions')
      .setDesc('Move, duplicate, or remove this mapping');

    if (index > 0) {
      actionsSetting.addButton(button => {
        button
          .setButtonText('↑ Up')
          .onClick(async () => {
            const temp = this.plugin.settings.colorMappings[index - 1];
            this.plugin.settings.colorMappings[index - 1] = this.plugin.settings.colorMappings[index];
            this.plugin.settings.colorMappings[index] = temp;
            await this.plugin.saveSettings();
            this.display();
          });
      });
    }

    if (index < this.plugin.settings.colorMappings.length - 1) {
      actionsSetting.addButton(button => {
        button
          .setButtonText('↓ Down')
          .onClick(async () => {
            const temp = this.plugin.settings.colorMappings[index + 1];
            this.plugin.settings.colorMappings[index + 1] = this.plugin.settings.colorMappings[index];
            this.plugin.settings.colorMappings[index] = temp;
            await this.plugin.saveSettings();
            this.display();
          });
      });
    }

    actionsSetting.addButton(button => {
      button
        .setButtonText('📋 Duplicate')
        .onClick(async () => {
          const duplicatedMapping = { 
            ...mapping,
            property: mapping.property + '_copy'
          };
          this.plugin.settings.colorMappings.splice(index + 1, 0, duplicatedMapping);
          await this.plugin.saveSettings();
          this.display();
        });
    });

    actionsSetting.addButton(button => {
      button
        .setButtonText('🗑️ Remove')
        .setWarning()
        .onClick(async () => {
          if (confirm(`Delete mapping for "${mapping.property}: ${mapping.value}"?`)) {
            this.plugin.settings.colorMappings.splice(index, 1);
            await this.plugin.saveSettings();
            this.display();
          }
        });
    });
  }

  private updateColorPreview(previewEl: HTMLElement, color: string) {
    previewEl.style.backgroundColor = color;
  }

  private createHelpSection(container: HTMLElement) {
    const helpContainer = container.createDiv('page-color-prop-help');

    helpContainer.createEl('h3', { text: 'How to Use' });

    const exampleSection = helpContainer.createDiv();
    exampleSection.innerHTML = `
      <h4>Example Setup</h4>
      <div class="example-card">
        <p><strong>Property:</strong> <code>status</code></p>
        <p><strong>Value:</strong> <code>completed</code></p>
        <p><strong>Color:</strong> <code>#90EE90</code></p>
        <p><strong>Match Type:</strong> Exact Match</p>
        <p><strong>Result:</strong> Notes with <code>status: completed</code> will have a light green background</p>
      </div>
    `;

    const colorFormats = helpContainer.createDiv();
    colorFormats.innerHTML = `
      <h4>Supported Color Formats</h4>
      <ul>
        <li><strong>Hex codes:</strong> <code>#FF5733</code>, <code>#123ABC</code></li>
        <li><strong>RGB/RGBA:</strong> <code>rgb(255, 87, 51)</code>, <code>rgba(255, 87, 51, 0.5)</code></li>
        <li><strong>Color names:</strong> <code>red</code>, <code>blue</code>, <code>lightgreen</code></li>
      </ul>
    `;
  }

  private addZoomResponsiveStyles() {
    const styleEl = document.createElement('style');
    styleEl.textContent = `
      .page-color-prop-description {
        color: var(--text-muted);
        margin-bottom: 1.25rem;
      }

      .page-color-prop-section-title {
        margin: 1.875rem 0 1.25rem 0;
        color: var(--text-accent);
        border-bottom: 1px solid var(--background-modifier-border);
        padding-bottom: 0.5rem;
      }

      .page-color-prop-card {
        border: 1px solid var(--background-modifier-border);
        border-radius: 0.5rem;
        margin-bottom: 1.25rem;
        background-color: var(--background-primary);
        box-shadow: 0 0.125rem 0.25rem rgba(0, 0, 0, 0.1);
        padding: 0;
      }

      .card-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1rem 1.25rem;
        background-color: var(--background-secondary);
        border-bottom: 1px solid var(--background-modifier-border);
        border-radius: 0.5rem 0.5rem 0 0;
      }

      .card-title {
        font-weight: 600;
        color: var(--text-normal);
        margin: 0;
      }

      .card-delete-btn {
        background: var(--interactive-accent);
        color: var(--text-on-accent);
        border: none;
        border-radius: 0.25rem;
        width: 1.5rem;
        height: 1.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        font-size: 1.125rem;
        font-weight: bold;
      }

      .card-delete-btn:hover {
        background: var(--interactive-accent-hover);
      }

      .color-preview {
        width: 2rem;
        height: 2rem;
        border: 1px solid var(--background-modifier-border);
        border-radius: 0.25rem;
        cursor: pointer;
        flex-shrink: 0;
        margin-left: 0.5rem;
        display: inline-block;
      }

      .test-color-btn {
        padding: 0.25rem 0.5rem;
        background: var(--interactive-normal);
        color: var(--text-normal);
        border: 1px solid var(--background-modifier-border);
        border-radius: 0.25rem;
        cursor: pointer;
        font-size: 0.75rem;
        margin-left: 0.5rem;
      }

      .test-color-btn:hover {
        background: var(--interactive-hover);
      }

      .page-color-prop-empty-state {
        text-align: center;
        padding: 2.5rem 1.25rem;
        background-color: var(--background-secondary);
        border-radius: 0.5rem;
        margin: 1.25rem 0;
      }

      .empty-state-content h3 {
        color: var(--text-normal);
        margin-bottom: 1rem;
      }

      .empty-state-content p {
        color: var(--text-muted);
        margin-bottom: 0.75rem;
      }

      .page-color-prop-help {
        margin-top: 2.5rem;
        padding: 1.25rem;
        background-color: var(--background-secondary);
        border-radius: 0.5rem;
        border-left: 0.25rem solid var(--interactive-accent);
      }

      .page-color-prop-help h3,
      .page-color-prop-help h4 {
        color: var(--text-normal);
        margin-bottom: 1rem;
      }

      .example-card {
        background-color: var(--background-primary);
        border: 1px solid var(--background-modifier-border);
        border-radius: 0.375rem;
        padding: 1rem;
        margin-bottom: 1rem;
      }

      .example-card p {
        margin: 0.5rem 0;
        color: var(--text-normal);
      }

      .example-card code {
        background-color: var(--background-modifier-form-field);
        padding: 0.125rem 0.375rem;
        border-radius: 0.1875rem;
        font-family: var(--font-monospace);
        color: var(--text-accent);
      }

      .page-color-prop-help ul {
        margin-left: 1.25rem;
      }

      .page-color-prop-help li {
        margin-bottom: 0.5rem;
        color: var(--text-normal);
      }

      .page-color-prop-card input[type="text"],
      .page-color-prop-card select {
        font-size: 0.875rem !important;
        padding: 0.5rem 0.75rem !important;
        min-height: 2.25rem !important;
        line-height: 1.4 !important;
      }

      .page-color-prop-card select {
        line-height: 1.2 !important;
      }
    `;

    document.head.appendChild(styleEl);
  }

  private testColor(color: string) {
    const testEl = document.createElement('div');
    testEl.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 18.75rem;
      height: 9.375rem;
      background-color: ${color};
      border: 0.125rem solid var(--text-normal);
      border-radius: 0.5rem;
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-normal);
      font-size: 1rem;
      cursor: pointer;
      box-shadow: 0 0.5rem 1.5rem rgba(0, 0, 0, 0.3);
      backdrop-filter: blur(0.25rem);
    `;
    testEl.innerHTML = `
      <div style="text-align: center; background: rgba(0, 0, 0, 0.8); padding: 0.75rem; border-radius: 0.375rem; color: white;">
        <div>Color Preview</div>
        <div style="font-size: 0.75rem; margin-top: 0.25rem; opacity: 0.8;">Click to close</div>
      </div>
    `;

    testEl.addEventListener('click', () => {
      testEl.remove();
    });

    document.body.appendChild(testEl);

    setTimeout(() => {
      if (testEl.parentNode) {
        testEl.remove();
      }
    }, 4000);
  }
}