import { App, Modal, PluginSettingTab, setIcon, Setting } from 'obsidian';
import type PageColorPropPlugin from './main';
import { DEFAULT_LINK_TUNING, type LinkColorTuning } from './color-optimizer';
import { computeAutoLinkHex as resolveAutoLinkHex, readBothThemeVars, readThemeCssVar } from './link-color-service';

export interface PropertyColorMapping {
  property: string;
  value: string;
  colorLight: string;
  colorDark: string;
  isAutoLight: boolean;
  isAutoDark: boolean;
  matchType: 'exact' | 'contains';
  linkColorLight: string;
  linkColorDark: string;
  isAutoLinkLight: boolean;
  isAutoLinkDark: boolean;
}

export interface PageColorPropSettings {
  colorMappings: PropertyColorMapping[];
  notifyOnMultipleMatches: boolean;
  colorTabText: boolean;
  experimentalLinkTuning: LinkColorTuning;
}

export const DEFAULT_LIGHT_AUTO_COLOR = 'hsla(var(--accent-h), var(--accent-s), 90%, 0.35)';
export const DEFAULT_DARK_AUTO_COLOR = 'hsla(var(--accent-h), var(--accent-s), 25%, 0.30)';

// EMPTY defaults - no example mappings!
export const DEFAULT_SETTINGS: PageColorPropSettings = {
  colorMappings: [],
  notifyOnMultipleMatches: true,
  colorTabText: true,
  experimentalLinkTuning: { ...DEFAULT_LINK_TUNING }
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

    containerEl.createEl('p', {
      text: 'Color note backgrounds based on frontmatter properties. Configure property-to-color mappings below.',
      cls: 'page-color-prop-description'
    });

    new Setting(containerEl)
      .setName('Add color mapping')
      .setDesc('Create a new property-to-color mapping')
      .addButton(button => {
        button
          .setButtonText('Add new mapping')
          .setCta()
          .onClick(async () => {
            this.plugin.settings.colorMappings.push({
              property: '',
              value: '',
              colorLight: DEFAULT_LIGHT_AUTO_COLOR,
              colorDark: DEFAULT_DARK_AUTO_COLOR,
              isAutoLight: true,
              isAutoDark: true,
              matchType: 'exact',
              linkColorLight: '',
              linkColorDark: '',
              isAutoLinkLight: true,
              isAutoLinkDark: true
            });
            await this.plugin.saveSettings();
            this.display();
          });
      });

    // TEMPORARY — remove once algorithm parameters are finalized
    this.createExperimentalTuningSection(containerEl);

    new Setting(containerEl)
      .setName('Notify when multiple rules match')
      .setDesc('Show a notification when more than one color mapping applies to a note. The lowest matching rule in this list sets the background color.')
      .addToggle(toggle => {
        toggle
          .setValue(this.plugin.settings.notifyOnMultipleMatches)
          .onChange(async value => {
            this.plugin.settings.notifyOnMultipleMatches = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Color tab text')
      .setDesc('Tint the text of a note’s tab to match its rule’s link color. Toggle off to keep tabs using the default theme text color.')
      .addToggle(toggle => {
        toggle
          .setValue(this.plugin.settings.colorTabText)
          .onChange(async value => {
            this.plugin.settings.colorTabText = value;
            await this.plugin.saveSettings();
          });
      });

    containerEl.createDiv({
      cls: 'page-color-prop-rule-priority-note',
      text: 'Rule priority: if multiple rules match a note, the lowest matching rule below sets the background. Use Move up and Move down to reorder.'
    });

    if (this.plugin.settings.colorMappings.length > 0) {
      containerEl.createEl('div', {
        text: `Color mappings (${this.plugin.settings.colorMappings.length})`,
        cls: 'page-color-prop-group-heading'
      });

      this.plugin.settings.colorMappings.forEach((mapping, index) => {
        this.createMappingSettings(containerEl, mapping, index);
      });

      new Setting(containerEl)
        .setName('Clear all mappings')
        .setDesc('Remove all color mappings (cannot be undone)')
        .addButton(button => {
          button
            .setButtonText('Clear all')
            .setWarning()
            .onClick(async () => {
              const confirmed = await ConfirmModal.confirm(
                this.app,
                'Clear all mappings',
                `Delete all ${this.plugin.settings.colorMappings.length} color mappings? This action cannot be undone.`,
                'Clear all'
              );
              if (confirmed) {
                this.plugin.settings.colorMappings = [];
                await this.plugin.saveSettings();
                this.display();
              }
            });
        });
    } else {
      this.createEmptyState(containerEl);
    }
  }

  onunload(): void {
    this.flushSave();
  }

  private createEmptyState(containerEl: HTMLElement) {
    const emptyState = containerEl.createDiv('page-color-prop-empty-state');

    emptyState.createDiv({ text: 'Click "Add new mapping" above to create your first property-to-color mapping.' });
    emptyState.createEl('br');

    const example = emptyState.createDiv();
    example.createEl('strong', { text: 'Example: ' });
    example.appendText('Map ');
    example.createEl('code', { text: 'tags: ai-generated' });
    example.appendText(' to a tinted background');

    const details = [
      ['Property:', 'tags'],
      ['Value:', 'ai-generated'],
      ['Light theme:', 'Auto (theme-aware)'],
      ['Dark theme:', 'Auto (theme-aware)'],
      ['Match type:', 'Contains']
    ];

    details.forEach(([label, value]) => {
      const row = emptyState.createDiv();
      row.createEl('strong', { text: `${label} ` });
      row.createEl('code', { text: value });
    });

    const result = emptyState.createDiv();
    result.createEl('strong', { text: 'Result: ' });
    result.appendText('Notes with the tag ');
    result.createEl('code', { text: 'ai-generated' });
    result.appendText(' will have a subtle tinted background that adapts to your theme.');

    const supportedFormats = emptyState.createDiv();
    supportedFormats.createEl('strong', { text: 'Supported color formats for manual mode: ' });
    ['#FF5733', '#123ABC', 'rgb(255, 87, 51)', 'rgba(255, 87, 51, 0.5)', 'red', 'blue', 'lightgreen'].forEach((format, index) => {
      if (index > 0) supportedFormats.appendText(', ');
      supportedFormats.createEl('code', { text: format });
    });
  }

  private saveTimeout: number | undefined = undefined;
  private pendingSave = false;

  private queueSave() {
    if (this.saveTimeout === undefined) {
      // First change in a sequence: save immediately so the UI refreshes
      // right away (e.g., when dragging a color picker).
      this.pendingSave = false;
      this.plugin.saveSettings();
    } else {
      // Subsequent change: mark that we still need a final trailing save.
      this.pendingSave = true;
    }

    window.clearTimeout(this.saveTimeout);
      this.saveTimeout = window.setTimeout(() => {
      if (this.pendingSave) {
        this.plugin.saveSettings();
      }
      this.saveTimeout = undefined;
      this.pendingSave = false;
    }, 500);
  }

  private flushSave() {
    window.clearTimeout(this.saveTimeout);
    this.saveTimeout = undefined;
    if (this.pendingSave) {
      this.pendingSave = false;
      this.plugin.saveSettings();
    }
  }

  private createMappingSettings(containerEl: HTMLElement, mapping: PropertyColorMapping, index: number) {
    const mappingCard = containerEl.createDiv('page-color-prop-mapping-card');
    const mappingHeader = mappingCard.createDiv('page-color-prop-mapping-header');
    mappingHeader.createSpan({
      text: `Rule ${index + 1}`,
      cls: 'page-color-prop-rule-number'
    });
    const mappingSummary = mappingHeader.createSpan('page-color-prop-rule-summary');
    const updateSummary = () => {
      const property = mapping.property || 'property';
      const value = mapping.value || 'value';
      mappingSummary.setText(`${property} ${mapping.matchType || 'exact'} ${value}`);
    };
    updateSummary();

    new Setting(mappingCard)
      .setName('Property')
      .setDesc('Frontmatter property name (e.g., status, tags, priority)')
      .addText(text => {
        text.setValue(mapping.property || '').onChange(value => {
          mapping.property = value;
          updateSummary();
          this.queueSave();
        });
        text.inputEl.disabled = false;
      });

    new Setting(mappingCard)
      .setName('Value')
      .setDesc('Property value to match (e.g., completed, urgent, high)')
      .addText(text => {
        text.setValue(mapping.value || '').onChange(value => {
          mapping.value = value;
          updateSummary();
          this.queueSave();
        });
        text.inputEl.disabled = false;
      });

    new Setting(mappingCard)
      .setName('Match type')
      .setDesc('Exact match or contains (for arrays like tags)')
      .addDropdown(dropdown => {
        dropdown
          .addOption('exact', 'Exact match')
          .addOption('contains', 'Contains')
          .setValue(mapping.matchType || 'exact')
          .onChange(value => {
            mapping.matchType = value as 'exact' | 'contains';
            updateSummary();
            this.plugin.saveSettings();
          });
      });

    // Table replaces the two separate light/dark theme-group blocks.
    // Row label appears once per theme; column header appears once per role
    // — this removes the previously duplicated "Color for light/dark-mode..."
    // description text.
    const table = this.createRuleColorTable(mappingCard, mapping);
    const tbody = table.createEl('tbody');

    this.createThemeTableRow(tbody, mapping, 'Light');
    this.createThemeTableRow(tbody, mapping, 'Dark');

    const footer = mappingCard.createDiv('page-color-prop-mapping-footer');

    this.createFooterButton(footer, 'copy', 'Duplicate', async () => {
      const duplicateIndex = index + 1;
      this.plugin.settings.colorMappings.splice(duplicateIndex, 0, {
        ...JSON.parse(JSON.stringify(mapping))
      });
      await this.plugin.saveSettings();
      this.display();
      this.scrollToMapping(duplicateIndex);
    });

    this.createFooterButton(footer, 'chevron-up', 'Move up', async () => {
      if (index > 0) {
        [this.plugin.settings.colorMappings[index], this.plugin.settings.colorMappings[index - 1]] = [
          this.plugin.settings.colorMappings[index - 1],
          this.plugin.settings.colorMappings[index]
        ];
        await this.plugin.saveSettings();
        this.display();
      }
    }, { disabled: index === 0 });

    this.createFooterButton(footer, 'chevron-down', 'Move down', async () => {
      if (index < this.plugin.settings.colorMappings.length - 1) {
        [this.plugin.settings.colorMappings[index], this.plugin.settings.colorMappings[index + 1]] = [
          this.plugin.settings.colorMappings[index + 1],
          this.plugin.settings.colorMappings[index]
        ];
        await this.plugin.saveSettings();
        this.display();
      }
    }, { disabled: index === this.plugin.settings.colorMappings.length - 1 });

    this.createFooterButton(footer, 'trash-2', 'Delete', async () => {
      this.plugin.settings.colorMappings.splice(index, 1);
      await this.plugin.saveSettings();
      this.display();
    }, { warning: true });
  }

  private scrollToMapping(index: number) {
    window.requestAnimationFrame(() => {
      const mappingCards = this.containerEl.querySelectorAll('.page-color-prop-mapping-card');
      const targetCard = mappingCards[index] as HTMLElement | undefined;
      if (targetCard) {
        targetCard.scrollIntoView({ block: 'start' });
      }
    });
  }

  private createFooterButton(
    container: HTMLElement,
    icon: string,
    label: string,
    onClick: () => void | Promise<void>,
    opts: { warning?: boolean; disabled?: boolean } = {}
  ): HTMLButtonElement {
    const btn = container.createEl('button', { cls: 'page-color-prop-footer-btn' });
    if (opts.warning) {
      btn.addClass('mod-warning');
    }
    if (opts.disabled) {
      btn.disabled = true;
      btn.setAttr('aria-disabled', 'true');
    }

    const iconSpan = btn.createSpan('page-color-prop-footer-btn-icon');
    setIcon(iconSpan, icon);

    btn.createSpan({ cls: 'page-color-prop-footer-btn-label', text: label });

    btn.setAttr('aria-label', label);
    btn.setAttr('title', label);
    btn.onclick = () => {
      if (!btn.disabled) onClick();
    };
    return btn;
  }

  private createRuleColorTable(mappingCard: HTMLElement, mapping: PropertyColorMapping): HTMLTableElement {
    const table = mappingCard.createEl('table', { cls: 'page-color-prop-rule-table' });

    // Explicit column widths: prevents the browser from auto-sizing columns
    // based on cell content, which was causing the Link column (wide preview
    // box) to have uneven left/right spacing compared to the Background
    // column (small swatch). Percentages are relative to the table's own
    // width, which is already set to 100% of the card.
    const colgroup = table.createEl('colgroup');
    colgroup.createEl('col', { attr: { style: 'width: 15%;' } });
    colgroup.createEl('col', { attr: { style: 'width: 25%;' } });
    colgroup.createEl('col', { attr: { style: 'width: 60%;' } });

    const thead = table.createEl('thead');
    const headerRow = thead.createEl('tr');
    headerRow.createEl('th', { text: 'Theme' });
    headerRow.createEl('th', { text: 'Background' });
    headerRow.createEl('th', { text: 'Link' });

    return table;
  }

  private createThemeTableRow(tbody: HTMLTableSectionElement, mapping: PropertyColorMapping, themeType: 'Light' | 'Dark') {
    const row = tbody.createEl('tr');

    row.createEl('td', { text: themeType, cls: 'page-color-prop-theme-row-label' });

    const bgCell = row.createEl('td');
    this.createThemeColorSetting(bgCell, '', '', mapping, themeType, true);

    const linkCell = row.createEl('td');
    this.createThemeLinkColorSetting(linkCell, '', '', mapping, themeType, true);
  }

  private createThemeColorSetting(
    containerEl: HTMLElement,
    name: string,
    desc: string,
    mapping: PropertyColorMapping,
    themeType: 'Light' | 'Dark',
    compact = false
  ) {
    const isLight = themeType === 'Light';
    const autoDefault = isLight
      ? DEFAULT_LIGHT_AUTO_COLOR
      : DEFAULT_DARK_AUTO_COLOR;

    const colorSettingContainer = containerEl.createDiv('page-color-prop-color-setting-container');
    const settingEl = new Setting(colorSettingContainer);
    if (!compact) {
      settingEl.setName(name);
      settingEl.setDesc(desc);
    }

    const getIsAuto = () => isLight ? mapping.isAutoLight : mapping.isAutoDark;
    const getColor = () => isLight ? mapping.colorLight : mapping.colorDark;
    const setIsAuto = (value: boolean) => {
      if (isLight) {
        mapping.isAutoLight = value;
      } else {
        mapping.isAutoDark = value;
      }
    };
    const setColor = (value: string) => {
      if (isLight) {
        mapping.colorLight = value;
      } else {
        mapping.colorDark = value;
      }
    };

    const isAuto = getIsAuto();

    const getDisplayColor = () => this.resolveColorForDisplay(getIsAuto() ? autoDefault : getColor());
    const updateSwatch = () => {
      const mode = getIsAuto() ? 'Auto from theme' : 'Manual';
      const displayColor = getDisplayColor();
      sampleBox.style.backgroundColor = displayColor;
      sampleBox.ariaLabel = `${mode} color: ${displayColor}. Click to open color picker.`;
      sampleBox.title = `${mode}: ${displayColor}`;
    };

    let colorPickerInput: HTMLInputElement | null = null;
    const addColorPicker = (onChange: (value: string) => void) => {
      settingEl.addColorPicker(colorPicker => {
        const currentColor = getColor();
        const pickerColor = this.resolveColorForPicker(currentColor);
        colorPicker
          .setValue(pickerColor)
          .onChange(value => {
            onChange(value);
          });
      });

      const colorInputs = colorSettingContainer.querySelectorAll('input[type="color"]');
      colorPickerInput = colorInputs[colorInputs.length - 1] as HTMLInputElement | null;
      colorPickerInput?.addClass('page-color-prop-hidden-color-picker');
    };

    const openColorPicker = () => {
      if (!colorPickerInput) return;
      this.openColorPickerAtElement(colorPickerInput, sampleBox);
    };

    addColorPicker(value => {
      setIsAuto(false);
      setColor(value);
      updateSwatch();
      this.plugin.applyColorsToAllLeaves();
      this.plugin.refreshLinkDecorations();
      this.queueSave();
    });

    // Icon-toggle button — shows the ACTION available, not the current state
    // (per spec section 1).  pipette = currently Auto, click to switch to
    // manual picking.  sparkles = currently Manual, click to switch to Auto.
    let toggleBtnComponent: any = null;
    settingEl.addButton(button => {
      toggleBtnComponent = button;
      button.setIcon(getIsAuto() ? 'pipette' : 'sparkles');
      button.setTooltip(getIsAuto() ? 'Switch to manual color' : 'Switch to auto color');
      button.onClick(async () => {
        const nowAuto = !getIsAuto();
        setIsAuto(nowAuto);

        if (!nowAuto && colorPickerInput) {
          setColor(colorPickerInput.value);
        }

        await this.plugin.saveSettings();
        updateSwatch();
        button.setIcon(nowAuto ? 'pipette' : 'sparkles');
        button.setTooltip(nowAuto ? 'Switch to manual color' : 'Switch to auto color');
        if (!nowAuto) openColorPicker();
      });
    });

    // Swatch — appended after the button so it sits to the right
    const sampleBox = settingEl.controlEl.createEl('button', {
      cls: 'page-color-prop-sample-box',
      type: 'button'
    });
    updateSwatch();

    sampleBox.onClickEvent(async () => {
      if (getIsAuto()) {
        setIsAuto(false);
        if (colorPickerInput) {
          setColor(colorPickerInput.value);
        }
        await this.plugin.saveSettings();
        updateSwatch();
        if (toggleBtnComponent) {
          toggleBtnComponent.setIcon('sparkles');
          toggleBtnComponent.setTooltip('Switch to auto color');
        }
      }
      openColorPicker();
    });
  }

  private createExperimentalTuningSection(containerEl: HTMLElement) {
    // TEMPORARY — remove once algorithm parameters are finalized
    const section = containerEl.createDiv('page-color-prop-experimental');
    const heading = section.createDiv('page-color-prop-experimental-heading');
    heading.createEl('strong', { text: 'Experimental: auto-color tuning' });
    heading.createEl('p', {
      text: 'Temporary sliders for tuning the auto link-color algorithm. Delete this block once values are locked in.',
      cls: 'page-color-prop-experimental-desc'
    });

    const tuning = this.plugin.settings.experimentalLinkTuning;
    if (!tuning) {
      this.plugin.settings.experimentalLinkTuning = { ...DEFAULT_LINK_TUNING };
    }
    const t = this.plugin.settings.experimentalLinkTuning;

    new Setting(section)
      .setName('Hue offset step (degrees)')
      .setDesc('How far to rotate the hue between search attempts when constraints fail')
      .addSlider(slider => slider
        .setLimits(5, 60, 1)
        .setValue(t.hueStepDegrees)
        .setDynamicTooltip()
        .onChange(async value => {
          t.hueStepDegrees = value;
          await this.plugin.saveSettings();
          this.display();
        }));

    new Setting(section)
      .setName('Minimum link distinctness (Delta E)')
      .setDesc('Minimum perceptual distance a link must have from body text and the theme default link')
      .addSlider(slider => slider
        .setLimits(0.02, 0.30, 0.01)
        .setValue(t.minDeltaE)
        .setDynamicTooltip()
        .onChange(async value => {
          t.minDeltaE = value;
          await this.plugin.saveSettings();
          this.display();
        }));

    new Setting(section)
      .setName('Minimum contrast ratio')
      .setDesc('WCAG contrast ratio the link must meet against both backgrounds (4.5 = AA normal text)')
      .addSlider(slider => slider
        .setLimits(3.0, 7.0, 0.1)
        .setValue(t.minContrast)
        .setDynamicTooltip()
        .onChange(async value => {
          t.minContrast = value;
          await this.plugin.saveSettings();
          this.display();
        }));
  }

  private createThemeLinkColorSetting(
    containerEl: HTMLElement,
    name: string,
    desc: string,
    mapping: PropertyColorMapping,
    themeType: 'Light' | 'Dark',
    compact = false
  ) {
    const isLight = themeType === 'Light';

    const getIsAuto = () => isLight ? mapping.isAutoLinkLight : mapping.isAutoLinkDark;
    const getColor = () => isLight ? mapping.linkColorLight : mapping.linkColorDark;
    const setIsAuto = (value: boolean) => {
      if (isLight) mapping.isAutoLinkLight = value;
      else mapping.isAutoLinkDark = value;
    };
    const setColor = (value: string) => {
      if (isLight) mapping.linkColorLight = value;
      else mapping.linkColorDark = value;
    };

    // Compute the auto link color using the EXACT same function and inputs
    // that link-decorator.ts uses to color real links (file navigator,
    // tabs, in-note links). Previously this settings preview had its own
    // divergent formula (seeded from the rule's background color instead
    // of the theme accent), which made the preview swatch show a color
    // that never actually got applied anywhere else. Delegating to the
    // shared service guarantees the preview is always what you get.
    const computeAutoLinkHex = (): string => {
      const themeVars = readBothThemeVars();
      if (!themeVars) return '#808080';

      const tuning = this.plugin.settings.experimentalLinkTuning ?? { ...DEFAULT_LINK_TUNING };

      // Gather other rules' already-assigned (manual) link hexes for the
      // same theme, so this one doesn't collide visually with them. Other
      // rules that are themselves in auto mode are skipped here, mirroring
      // link-decorator.ts's getResolvedLinkColor to avoid an N^2 cascade
      // and to keep the preview and the real renderer in lockstep.
      const otherHexes = this.plugin.settings.colorMappings
        .filter(m => m !== mapping)
        .filter(m => !(isLight ? m.isAutoLinkLight : m.isAutoLinkDark))
        .map(m => isLight ? m.linkColorLight : m.linkColorDark)
        .filter((h): h is string => !!h);

      try {
        return resolveAutoLinkHex(mapping, themeType, themeVars, otherHexes, tuning);
      } catch (e) {
        console.error('Page Color Prop: failed to compute auto link color preview', e);
        return '#808080';
      }
    };

    const settingContainer = containerEl.createDiv('page-color-prop-color-setting-container page-color-prop-link-setting');
    const settingEl = new Setting(settingContainer);
    if (!compact) {
      settingEl.setName(name);
      settingEl.setDesc(desc);
    }

    let colorPickerInput: HTMLInputElement | null = null;
    settingEl.addColorPicker(colorPicker => {
      const initial = this.resolveColorForPicker(getColor() || computeAutoLinkHex());
      colorPicker.setValue(initial).onChange(value => {
        setIsAuto(false);
        setColor(value);
        updatePreview();
        this.plugin.applyColorsToAllLeaves();
        this.plugin.refreshLinkDecorations();
        this.queueSave();
      });
      const inputs = settingContainer.querySelectorAll('input[type="color"]');
      colorPickerInput = inputs[inputs.length - 1] as HTMLInputElement | null;
      colorPickerInput?.addClass('page-color-prop-hidden-color-picker');
    });

    const openColorPicker = () => {
      if (!colorPickerInput) return;
      this.openColorPickerAtElement(colorPickerInput, preview);
    };

    // Icon-toggle button: shows the ACTION available (per spec section 1).
    //   currently Auto  -> pipette icon (click to switch to manual)
    //   currently Manual -> sparkles icon (click to switch to auto)
    let toggleBtnComponent: any = null;
    settingEl.addButton(button => {
      toggleBtnComponent = button;
      button.setIcon(getIsAuto() ? 'pipette' : 'sparkles');
      button.setTooltip(getIsAuto() ? 'Switch to manual color' : 'Switch to auto color');
      button.onClick(async () => {
        const nowAuto = !getIsAuto();
        setIsAuto(nowAuto);
        if (nowAuto) {
          setColor(computeAutoLinkHex());
        } else if (colorPickerInput) {
          setColor(colorPickerInput.value);
        }
        await this.plugin.saveSettings();
        updatePreview();
        button.setIcon(nowAuto ? 'pipette' : 'sparkles');
        button.setTooltip(nowAuto ? 'Switch to manual color' : 'Switch to auto color');
        if (!nowAuto) openColorPicker();
      });
    });

    const toggleBtn = toggleBtnComponent?.buttonEl as HTMLButtonElement | undefined;

    // Live preview swatch — renders on THIS theme's default (untouched)
    // page background with three stacked text samples: body text, default
    // link, and this rule's link color. Per spec section 1. The theme is
    // forced via a hidden element so the preview shows dark-theme defaults
    // even while the user is currently in light mode (and vice versa).
    const themeName: 'Light' | 'Dark' = isLight ? 'Light' : 'Dark';
    const preview = settingEl.controlEl.createDiv('page-color-prop-link-preview');
    const defaultBg = this.computeColorFromThemeVarsForTheme('var(--background-primary)', themeName);
    const defaultLink = this.computeColorFromThemeVarsForTheme('var(--link-color)', themeName);
    const defaultText = this.computeColorFromThemeVarsForTheme('var(--text-normal)', themeName);
    preview.style.backgroundColor = defaultBg || '';
    preview.style.color = defaultText || '';

    const sampleText = preview.createDiv('page-color-prop-link-preview-sample');
    sampleText.setText('Sample text');
    const defaultLinkEl = preview.createDiv('page-color-prop-link-preview-sample');
    defaultLinkEl.setText('Default link');
    defaultLinkEl.style.color = defaultLink || '';
    const ruleLinkEl = preview.createDiv('page-color-prop-link-preview-sample page-color-prop-link-preview-rule');
    ruleLinkEl.setText('Rule link');

    const updatePreview = () => {
      const mode = getIsAuto() ? 'Auto (computed from background hue)' : 'Manual';
      const displayed = getIsAuto() ? computeAutoLinkHex() : (getColor() || computeAutoLinkHex());
      ruleLinkEl.style.color = displayed;
      preview.title = `${mode}: ${displayed}`;
      preview.ariaLabel = `${mode} link color: ${displayed}`;
    };
    updatePreview();

    // Clicking the preview also opens the picker (matches the background
    // swatch's affordance for symmetry).
    preview.onClickEvent(() => {
      if (getIsAuto()) {
        setIsAuto(false);
        if (colorPickerInput) setColor(colorPickerInput.value);
        if (toggleBtnComponent) {
          toggleBtnComponent.setIcon('sparkles');
          toggleBtnComponent.setTooltip('Switch to auto color');
        }
      }
      this.queueSave();
      updatePreview();
      openColorPicker();
    });
  }

  /** Resolves any color string (hex, rgb, or var(--...)) to a 6-digit hex
   *  suitable for the native <input type="color"> element, which requires
   *  a strict hex value. Delegates entirely to readThemeCssVar so this
   *  logic has exactly one implementation. */
  private resolveColorForPicker(color: string): string {
    return readThemeCssVar(color) ?? '#808080';
  }

  private resolveColorForDisplay(color: string): string {
    if (!color || typeof color !== 'string') {
      return '#808080';
    }

    if (color.includes('var(--')) {
      return this.computeColorFromThemeVars(color);
    }

    return color;
  }

  private computeColorFromThemeVars(colorStr: string): string {
    return this.computeColorFromThemeVarsForTheme(colorStr, null);
  }

  /** Computes a CSS variable's value for a specific theme (light/dark),
   *  regardless of the current theme. Pass `null` for the current theme.
   *
   *  Obsidian theme CSS selectors are typically `body.theme-dark { ... }`,
   *  so adding the class to a child element does NOT activate those
   *  variables. The only reliable approach is to temporarily swap the
   *  class on `<body>` itself. We do this synchronously — the browser
   *  cannot repaint between the add and remove, so the user sees no flash.
   *
   *  The actual CSS-variable-to-hex resolution is delegated to the shared
   *  readThemeCssVar (link-color-service.ts) so this file never carries its
   *  own copy of that DOM-measurement logic. Two copies of "read a CSS
   *  color expression and convert it to hex" is exactly how the auto
   *  link-color preview bug happened elsewhere in this file — one copy
   *  quietly drifted from the other. */
  private computeColorFromThemeVarsForTheme(colorStr: string, theme: 'Light' | 'Dark' | null): string {
    const body = document.body;
    const isCurrentlyDark = body.classList.contains('theme-dark');
    const wantDark = theme === 'Dark';
    const needsSwitch = theme !== null && isCurrentlyDark !== wantDark;

    if (needsSwitch) {
      body.classList.remove('theme-light', 'theme-dark');
      body.classList.add(wantDark ? 'theme-dark' : 'theme-light');
    }

    const hex = readThemeCssVar(colorStr);

    if (needsSwitch) {
      body.classList.remove('theme-light', 'theme-dark');
      body.classList.add(isCurrentlyDark ? 'theme-dark' : 'theme-light');
    }

    return hex ?? '#808080';
  }

  /** Open a hidden color-picker input anchored to a visible element so the
   *  native browser color picker popup appears near the user's click
   *  instead of drifting off-screen. The input is restored to its hidden
   *  state on the next animation frame. */
  private openColorPickerAtElement(
    input: HTMLInputElement,
    anchor: HTMLElement
  ): void {
    const rect = anchor.getBoundingClientRect();
    const prevStyles = {
      position: input.style.position,
      left: input.style.left,
      top: input.style.top,
      width: input.style.width,
      height: input.style.height,
      zIndex: input.style.zIndex,
      padding: input.style.padding,
      border: input.style.border,
      opacity: input.style.opacity,
      pointerEvents: input.style.pointerEvents
    };

    input.style.position = 'fixed';
    input.style.left = `${rect.left}px`;
    input.style.top = `${rect.top}px`;
    input.style.width = `${rect.width}px`;
    input.style.height = `${rect.height}px`;
    input.style.zIndex = '1';
    input.style.padding = '0';
    input.style.border = 'none';
    input.style.opacity = '0';
    input.style.pointerEvents = 'auto';

    if ('showPicker' in input) {
      (input as any).showPicker();
    } else {
      (input as any).click();
    }

    window.requestAnimationFrame(() => {
      input.style.position = prevStyles.position;
      input.style.left = prevStyles.left;
      input.style.top = prevStyles.top;
      input.style.width = prevStyles.width;
      input.style.height = prevStyles.height;
      input.style.zIndex = prevStyles.zIndex;
      input.style.padding = prevStyles.padding;
      input.style.border = prevStyles.border;
      input.style.opacity = prevStyles.opacity;
      input.style.pointerEvents = prevStyles.pointerEvents;
    });
  }
}

class ConfirmModal extends Modal {
  private resolve: (confirmed: boolean) => void;
  private confirmed = false;

  constructor(
    app: App,
    private title: string,
    private message: string,
    private confirmText: string,
    resolve: (confirmed: boolean) => void
  ) {
    super(app);
    this.resolve = resolve;
  }

  static confirm(app: App, title: string, message: string, confirmText: string): Promise<boolean> {
    return new Promise(resolve => {
      new ConfirmModal(app, title, message, confirmText, resolve).open();
    });
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    new Setting(contentEl)
      .setName(this.title)
      .setHeading();
    contentEl.createEl('p', { text: this.message });

    new Setting(contentEl)
      .addButton(button => button
        .setButtonText('Cancel')
        .onClick(() => this.close()))
      .addButton(button => button
        .setButtonText(this.confirmText)
        .setWarning()
        .onClick(() => {
          this.confirmed = true;
          this.close();
        }));
  }

  onClose() {
    this.contentEl.empty();
    this.resolve(this.confirmed);
  }
}