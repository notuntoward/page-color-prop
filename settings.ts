import { App, Modal, PluginSettingTab, setIcon, Setting, type ButtonComponent, type SettingDefinitionItem } from 'obsidian';
import { ownerWindow, requestFrameIn, setTimeoutIn, type CancelTimer } from 'commons/windows';
import {
  collectVaultMetadata, isListProperty, navigatePropertyRows,
  propertyNamePickerOptions, propertyValuePickerOptions, ValuePicker
} from 'commons/properties';
import type PageColorPropPlugin from './main';
import { DEFAULT_LINK_TUNING, ColorMath, type LinkColorTuning } from './color-optimizer';
import { computeAutoRuleColors, readBothThemeVars, readThemeCssVar, type ThemeCssVars } from './link-color-service';

export interface PropertyColorMapping {
  id: string;
  baseColor: string; // NEW — "#RRGGBB", replaces accent-derived hue-rotation logic
  property: string;
  value: string | string[];
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

export const DEFAULT_RULE_BASE_COLOR = '#4f8cc9';

export function newRuleId(): string {
  return crypto.randomUUID();
}

export interface PageColorPropSettings {
  colorMappings: PropertyColorMapping[];
  notifyOnMultipleMatches: boolean;
  colorUiLabels: boolean;
  colorLinks: boolean;
  experimentalLinkTuning: LinkColorTuning;
}

export const DEFAULT_LIGHT_AUTO_COLOR = 'hsla(var(--accent-h), var(--accent-s), 90%, 0.35)';
export const DEFAULT_DARK_AUTO_COLOR = 'hsla(var(--accent-h), var(--accent-s), 25%, 0.30)';

// EMPTY defaults - no example mappings!
export const DEFAULT_SETTINGS: PageColorPropSettings = {
  colorMappings: [],
  notifyOnMultipleMatches: true,
  colorUiLabels: true,
  colorLinks: true,
  experimentalLinkTuning: { ...DEFAULT_LINK_TUNING }
};



export class PageColorPropSettingTab extends PluginSettingTab {
  plugin: PageColorPropPlugin;
  private catalog: ReturnType<typeof collectVaultMetadata> = { properties: [], tags: [] };
  private catalogRefreshRegistered = false;
  private readonly activePickers = new Set<ValuePicker>();
  private readonly valuePickerRefreshers = new Set<() => void>();

  constructor(app: App, plugin: PageColorPropPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  override getControlValue(key: string): unknown {
    const settings = this.plugin.settings as unknown as Record<string, unknown>;
    return settings[key];
  }

  override async setControlValue(key: string, value: unknown): Promise<void> {
    const settings = this.plugin.settings as unknown as Record<string, unknown>;
    settings[key] = value;
    await this.plugin.saveSettings();
  }

  public refreshUI(): void {
    this.update();
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    this.catalog = collectVaultMetadata(this.app);
    if (!this.catalogRefreshRegistered) {
      const ref = this.app.metadataCache.on('resolved', () => {
        this.catalog = collectVaultMetadata(this.app);
        for (const refresh of this.valuePickerRefreshers) refresh();
        for (const picker of this.activePickers) picker.refresh();
      });
      this.plugin.registerEvent(ref);
      this.catalogRefreshRegistered = true;
    }
    const definitions: SettingDefinitionItem[] = [
      {
        name: '',
        desc: 'Color note backgrounds based on frontmatter properties. Configure property-to-color mappings below.'
      },
      {
        name: 'Add color mapping',
        desc: 'Create a new property-to-color mapping',
        render: (setting: Setting) => {
          setting.addButton(button => {
            button
              .setButtonText('Add new mapping')
              .setCta()
              .onClick(async () => {
                this.plugin.settings.colorMappings.push({
                  id: newRuleId(),
                  baseColor: DEFAULT_RULE_BASE_COLOR,
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
                this.refreshUI();
              });
          });
        }
      },
      {
        name: 'Notify when multiple rules match',
        desc: 'Show a notification when more than one color mapping applies to a note. The lowest matching rule in this list sets the background color.',
        control: {
          type: 'toggle',
          key: 'notifyOnMultipleMatches'
        }
      },
      {
        name: 'Color UI labels',
        desc: 'Color and bold note titles/names in tabs, file explorer/navigator, completions, and other UI elements. Toggle off to keep standard theme UI styling.',
        render: (setting: Setting) => {
          setting.addToggle(toggle => {
            toggle
              .setValue(this.plugin.settings.colorUiLabels)
              .onChange(async value => {
                this.plugin.settings.colorUiLabels = value;
                await this.plugin.saveSettings();
                this.plugin.applyColorsToAllLeaves();
                this.plugin.refreshLinkDecorations();
                this.refreshUI();
              });
          });
        }
      },
      {
        name: 'Color links',
        desc: 'Tint links inside the note body pointing to notes matching a rule. Toggle off to keep default theme link coloring.',
        render: (setting: Setting) => {
          setting.addToggle(toggle => {
            toggle
              .setValue(this.plugin.settings.colorLinks)
              .onChange(async value => {
                this.plugin.settings.colorLinks = value;
                await this.plugin.saveSettings();
                this.plugin.applyColorsToAllLeaves();
                this.plugin.refreshLinkDecorations();
                this.refreshUI();
              });
          });
        }
      }
    ];

    if (this.plugin.settings.colorMappings.length === 0) {
      definitions.push({
        name: '',
        render: (setting: Setting) => {
          this.createEmptyState(this.createBlockContainer(setting));
        }
      });
    } else {
      definitions.push({
        name: '',
        render: (setting: Setting) => {
          const blockEl = this.createBlockContainer(setting);
          blockEl.createDiv({
            cls: 'page-color-prop-rule-priority-note',
            text: 'Rule priority: if multiple rules match a note, the lowest matching rule below sets the background. Use Move up and Move down to reorder.'
          });
          blockEl.createDiv({
            text: `Color mappings (${this.plugin.settings.colorMappings.length})`,
            cls: 'page-color-prop-group-heading'
          });
        }
      });

      this.plugin.settings.colorMappings.forEach((mapping, index) => {
        definitions.push({
          name: '',
          render: (setting: Setting) => {
            const cleanup = this.createMappingSettings(this.createBlockContainer(setting), mapping, index);
            const dispose = () => {
              if (!this.renderCleanups.delete(dispose)) return;
              cleanup();
            };
            this.renderCleanups.add(dispose);
            return dispose;
          }
        });
      });

      definitions.push({
        name: 'Clear all mappings',
        desc: 'Remove all color mappings (cannot be undone)',
        render: (setting: Setting) => {
          setting.addButton(button => {
            button
              .setButtonText('Clear all')
              .setDestructive()
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
                  this.refreshUI();
                }
              });
          });
        }
      });
    }

    return definitions;
  }

  private renderCleanups = new Set<() => void>();

  private createBlockContainer(setting: Setting): HTMLElement {
    const settingEl = setting.settingEl;
    settingEl.addClass('page-color-prop-block-setting-row');
    return setting.controlEl.createDiv({ cls: 'page-color-prop-block-setting' });
  }

  onunload(): void {
    this.runRenderCleanups();
    this.flushSave();
  }

  private runRenderCleanups(): void {
    for (const cleanup of this.renderCleanups) cleanup();
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

  private saveTimeout: CancelTimer | undefined = undefined;
  private pendingSave = false;

  private applyRuleChangesImmediately() {
    this.plugin.applyColorsToAllLeaves();
    this.plugin.refreshLinkDecorations();
  }

  private queueSave() {
    if (this.saveTimeout === undefined) {
      // First change in a sequence: save immediately so the UI refreshes
      // right away (e.g., when dragging a color picker).
      this.pendingSave = false;
      void this.plugin.saveSettings();
    } else {
      // Subsequent change: mark that we still need a final trailing save.
      this.pendingSave = true;
    }

    this.saveTimeout?.();
    const win = ownerWindow(this.containerEl) ?? activeWindow;
    this.saveTimeout = setTimeoutIn(win, () => {
      if (this.pendingSave) {
        void this.plugin.saveSettings();
      }
      this.saveTimeout = undefined;
      this.pendingSave = false;
    }, 500);
  }

  private flushSave() {
    this.saveTimeout?.();
    this.saveTimeout = undefined;
    if (this.pendingSave) {
      this.pendingSave = false;
      void this.plugin.saveSettings();
    }
  }

  private createMappingSettings(
    containerEl: HTMLElement,
    mapping: PropertyColorMapping,
    index: number
  ): () => void {
    const mappingCard = containerEl.createDiv('page-color-prop-mapping-card');
    const mappingHeader = mappingCard.createDiv('page-color-prop-mapping-header');
    mappingHeader.createSpan({
      text: `Rule ${index + 1}`,
      cls: 'page-color-prop-rule-number'
    });
    const mappingSummary = mappingHeader.createSpan('page-color-prop-rule-summary');
    const updateSummary = () => {
      const property = mapping.property || 'property';
      const value = Array.isArray(mapping.value) ? mapping.value.join(', ') : mapping.value || 'value';
      mappingSummary.setText(`${property} ${mapping.matchType || 'exact'} ${value}`);
    };
    updateSummary();

    let valuePicker: ValuePicker | null = null;
    let valuePickerMultiple = false;
    let conditionHint: HTMLElement | undefined;
    const updateConditionHint = () => {
      if (!conditionHint) return;
      const base = 'Choose existing properties and values, or type to create one. New entries require confirmation. For lists, Contains matches any selected value; Exact match requires the entire list in any order.';
      const warning = Array.isArray(mapping.value) && !isListProperty(this.catalog, mapping.property)
        ? ' For scalar properties, Exact match requires one selected value; remove extras or choose a list property.'
        : '';
      conditionHint.setText(base + warning);
    };
    const condition = mappingCard.createDiv('page-color-prop-condition');
    const propertySetting = new Setting(condition)
      .setName('Property');
    const propertyPicker = new ValuePicker(this.app, propertySetting.controlEl, {
      ...propertyNamePickerOptions(() => this.catalog),
      appearance: 'property',
      classPrefix: 'page-color-prop',
      value: mapping.property || '',
      multiple: false,
      showSingleValueChip: true,
      placeholder: 'Property…',
      ariaLabel: 'Frontmatter property name',
      onChange: values => {
        mapping.property = values[0] ?? '';
        updateValuePicker();
        updateConditionHint();
        updateSummary();
        this.applyRuleChangesImmediately();
        this.queueSave();
      }
    });
    this.activePickers.add(propertyPicker);

    const valueSetting = new Setting(condition)
      .setName('Value');
    const valueOptions = () => ({
      ...propertyValuePickerOptions(this.catalog, mapping.property, Array.isArray(mapping.value) ? mapping.value[0] ?? '' : mapping.value, mapping.matchType === 'contains'),
      suggestions: () => {
        const initial = Array.isArray(mapping.value) ? mapping.value[0] ?? '' : mapping.value;
        const options = propertyValuePickerOptions(this.catalog, mapping.property, initial, mapping.matchType === 'contains');
        return typeof options.suggestions === 'function' ? options.suggestions() : options.suggestions;
      },
      context: () => mapping.property
    });
    const updateValuePicker = (preserveInput = false) => {
      const oldInput = valuePicker?.inputEl;
      const draft = preserveInput ? oldInput?.value : undefined;
      const hadFocus = preserveInput && oldInput?.ownerDocument.activeElement === oldInput;
      const oldType = oldInput?.type;
      const multiple = isListProperty(this.catalog, mapping.property) || Array.isArray(mapping.value);
      if (valuePicker && multiple !== valuePickerMultiple) {
        this.activePickers.delete(valuePicker);
        valuePicker.destroy();
        valuePicker = null;
      }
      if (valuePicker) {
        valuePicker.updateOptions({ ...valueOptions(), multiple });
      } else {
        valuePickerMultiple = multiple;
        valuePicker = new ValuePicker(this.app, valueSetting.controlEl, {
          ...valueOptions(),
          appearance: 'property',
          classPrefix: 'page-color-prop',
          value: mapping.value,
          multiple,
          showSingleValueChip: true,
          placeholder: 'Value…',
          ariaLabel: 'Property value to match',
          onChange: values => {
            mapping.value = values.length > 1 ? values : values[0] ?? '';
            updateSummary();
            updateConditionHint();
            this.applyRuleChangesImmediately();
            this.queueSave();
          }
        });
        this.activePickers.add(valuePicker);
      }
      if (draft !== undefined && valuePicker.inputEl.type === oldType) {
        valuePicker.inputEl.value = draft;
      }
      if (hadFocus && valuePicker.inputEl !== oldInput) valuePicker.inputEl.focus();
    };
    updateValuePicker();
    const refreshValuePicker = () => {
      updateValuePicker(true);
      updateConditionHint();
    };
    this.valuePickerRefreshers.add(refreshValuePicker);
    const stopNavigation = navigatePropertyRows(mappingCard, [propertySetting.settingEl, valueSetting.settingEl]);

    const matchSetting = new Setting(condition)
      .setName('Match type')
      .addDropdown(dropdown => {
        dropdown
          .addOption('exact', 'Exact match')
          .addOption('contains', 'Contains')
          .setValue(mapping.matchType || 'exact')
          .onChange(value => {
            mapping.matchType = value as 'exact' | 'contains';
            updateValuePicker();
            updateSummary();
            this.applyRuleChangesImmediately();
            void this.plugin.saveSettings();
          });
      });
    condition.insertBefore(matchSetting.settingEl, valueSetting.settingEl);
    conditionHint = mappingCard.createDiv({ cls: 'page-color-prop-condition-hint' });
    updateConditionHint();

    this.createBaseColorSetting(mappingCard, mapping);

    // Table replaces the two separate light/dark theme-group blocks.
    // Row label appears once per theme; column header appears once per role
    // — this removes the previously duplicated "Color for light/dark-mode..."
    // description text.
    const table = this.createRuleColorTable(mappingCard, mapping);
    const tbody = table.createEl('tbody');

    this.createThemeTableRow(tbody, mapping, 'Light');
    this.createThemeTableRow(tbody, mapping, 'Dark');

    const themeVars = readBothThemeVars();
    if (themeVars) {
      this.renderCrossRuleCheck(
        mappingCard,
        mapping,
        this.plugin.settings.colorMappings,
        themeVars,
        this.plugin.settings.experimentalLinkTuning ?? DEFAULT_LINK_TUNING
      );
    }

    const footer = mappingCard.createDiv('page-color-prop-mapping-footer');

    this.createFooterButton(footer, 'copy', 'Duplicate', async () => {
      const duplicateIndex = index + 1;
      const duplicate = JSON.parse(JSON.stringify(mapping)) as PropertyColorMapping;
      duplicate.id = newRuleId();
      this.plugin.settings.colorMappings.splice(duplicateIndex, 0, duplicate);
      await this.plugin.saveSettings();
      this.refreshUI();
      this.scrollToMapping(duplicateIndex);
    });

    this.createFooterButton(footer, 'chevron-up', 'Move up', async () => {
      if (index > 0) {
        [this.plugin.settings.colorMappings[index], this.plugin.settings.colorMappings[index - 1]] = [
          this.plugin.settings.colorMappings[index - 1],
          this.plugin.settings.colorMappings[index]
        ];
        await this.plugin.saveSettings();
        this.refreshUI();
      }
    }, { disabled: index === 0 });

    this.createFooterButton(footer, 'chevron-down', 'Move down', async () => {
      if (index < this.plugin.settings.colorMappings.length - 1) {
        [this.plugin.settings.colorMappings[index], this.plugin.settings.colorMappings[index + 1]] = [
          this.plugin.settings.colorMappings[index + 1],
          this.plugin.settings.colorMappings[index]
        ];
        await this.plugin.saveSettings();
        this.refreshUI();
      }
    }, { disabled: index === this.plugin.settings.colorMappings.length - 1 });

    this.createFooterButton(footer, 'trash-2', 'Delete', async () => {
      this.plugin.settings.colorMappings.splice(index, 1);
      await this.plugin.saveSettings();
      this.refreshUI();
    }, { warning: true });

    return () => {
      stopNavigation();
      this.valuePickerRefreshers.delete(refreshValuePicker);
      propertyPicker.destroy();
      this.activePickers.delete(propertyPicker);
      if (valuePicker) {
        valuePicker.destroy();
        this.activePickers.delete(valuePicker);
      }
    };
  }

  private scrollToMapping(index: number) {
    const root = this.containerEl;
    const win = ownerWindow(root) ?? activeWindow;
    requestFrameIn(win, () => {
      const mappingCards = root.querySelectorAll('.page-color-prop-mapping-card');
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
      btn.setAttribute('aria-disabled', 'true');
    }

    const iconSpan = btn.createSpan('page-color-prop-footer-btn-icon');
    setIcon(iconSpan, icon);

    btn.createSpan({ cls: 'page-color-prop-footer-btn-label', text: label });

    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
    btn.onclick = () => {
      if (!btn.disabled) void onClick();
    };
    return btn;
  }

  private createRuleColorTable(mappingCard: HTMLElement, mapping: PropertyColorMapping): HTMLTableElement {
    const table = mappingCard.createEl('table', { cls: 'page-color-prop-rule-table' });

    const showUiColumn = this.plugin.settings.colorUiLabels;
    const colgroup = table.createEl('colgroup');
    if (showUiColumn) {
      colgroup.createEl('col', { attr: { style: 'width: 15%;' } });
      colgroup.createEl('col', { attr: { style: 'width: 25%;' } });
      colgroup.createEl('col', { attr: { style: 'width: 30%;' } });
      colgroup.createEl('col', { attr: { style: 'width: 30%;' } });
    } else {
      colgroup.createEl('col', { attr: { style: 'width: 15%;' } });
      colgroup.createEl('col', { attr: { style: 'width: 25%;' } });
      colgroup.createEl('col', { attr: { style: 'width: 60%;' } });
    }

    const thead = table.createEl('thead');
    const headerRow = thead.createEl('tr');
    headerRow.createEl('th', { text: 'Theme' });
    headerRow.createEl('th', { text: 'Background' });
    headerRow.createEl('th', { text: 'Links: uncolored notes' });
    if (showUiColumn) {
      headerRow.createEl('th', { text: 'Links: app UI' });
    }

    return table;
  }

  private createThemeTableRow(tbody: HTMLTableSectionElement, mapping: PropertyColorMapping, themeType: 'Light' | 'Dark') {
    const row = tbody.createEl('tr');

    row.createEl('td', { text: themeType, cls: 'page-color-prop-theme-row-label' });

    const bgCell = row.createEl('td');
    this.createThemeColorSetting(bgCell, '', '', mapping, themeType, true);

    let updateLinkPreview: (() => void) | null = null;
    let updateUiPreview: (() => void) | null = null;

    const linkCell = row.createEl('td');
    this.createThemeLinkColorSetting(linkCell, '', '', mapping, themeType, true, () => {
      if (updateUiPreview) updateUiPreview();
    }, (updater) => {
      updateLinkPreview = updater;
    });

    const showUiColumn = this.plugin.settings.colorUiLabels;
    if (showUiColumn) {
      const uiCell = row.createEl('td');
      this.createThemeUiLinkColorSetting(uiCell, '', '', mapping, themeType, true, () => {
        if (updateLinkPreview) updateLinkPreview();
      }, (updater) => {
        updateUiPreview = updater;
      });
    }
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

    // Compute the auto colors using the EXACT same function and inputs
    // that the page background path and link-decorator.ts use, so the
    // background swatch always matches the rendered note tint. When auto
    // mode is on, we show the resolved background hex, not the stored
    // CSS expression (e.g. hsla(var(--accent-h) ... 35%)).
    const computeAutoColors = (): { backgroundHex: string; linkHex: string } => {
      const themeVars = readBothThemeVars();
      if (!themeVars) return { backgroundHex: '#808080', linkHex: '#808080' };

      const tuning = this.plugin.settings.experimentalLinkTuning ?? { ...DEFAULT_LINK_TUNING };

      const otherHexes = this.plugin.settings.colorMappings
        .filter(m => m !== mapping)
        .filter(m => !(isLight ? m.isAutoLinkLight : m.isAutoLinkDark))
        .map(m => isLight ? m.linkColorLight : m.linkColorDark)
        .filter((h): h is string => !!h);

      try {
        return computeAutoRuleColors(
          mapping,
          this.plugin.settings.colorMappings,
          themeType,
          themeVars,
          otherHexes,
          tuning
        );
      } catch (e) {
        console.error('Page Color Prop: failed to compute auto background preview', e);
        return { backgroundHex: '#808080', linkHex: '#808080' };
      }
    };

    const getDisplayColor = () => this.resolveColorForDisplay(getIsAuto() ? computeAutoColors().backgroundHex : getColor());
    const updateSwatch = () => {
      const mode = getIsAuto() ? 'Auto from theme' : 'Manual';
      const displayColor = getDisplayColor();
      sampleBox.style.backgroundColor = displayColor;
      const label = `${mode} color: ${displayColor}. Activate to choose a color.`;
      sampleBox.setAttribute('aria-label', label);
      sampleBox.title = label;
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
      if (colorPickerInput) {
        colorPickerInput.tabIndex = -1;
        colorPickerInput.setAttribute('aria-hidden', 'true');
      }
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
    let toggleBtnComponent: ButtonComponent | null = null;
    settingEl.addButton(button => {
      toggleBtnComponent = button;
      button.setIcon(getIsAuto() ? 'pipette' : 'sparkles');
      const tooltip = getIsAuto() ? 'Switch to manual color' : 'Switch to auto color';
      button.setTooltip(tooltip);
      button.buttonEl.setAttribute('aria-label', tooltip);
      button.onClick(async () => {
        const nowAuto = !getIsAuto();
        setIsAuto(nowAuto);

        if (!nowAuto && colorPickerInput) {
          setColor(colorPickerInput.value);
        }

        await this.plugin.saveSettings();
        updateSwatch();
        button.setIcon(nowAuto ? 'pipette' : 'sparkles');
        const nextTooltip = nowAuto ? 'Switch to manual color' : 'Switch to auto color';
        button.setTooltip(nextTooltip);
        button.buttonEl.setAttribute('aria-label', nextTooltip);
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
          toggleBtnComponent.buttonEl.setAttribute('aria-label', 'Switch to auto color');
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
        .onChange(async value => {
          t.hueStepDegrees = value;
          await this.plugin.saveSettings();
          this.refreshUI();
        }));

    new Setting(section)
      .setName('Minimum link distinctness (Delta E)')
      .setDesc('Minimum perceptual distance a link must have from body text and the theme default link')
      .addSlider(slider => slider
        .setLimits(0.02, 0.30, 0.01)
        .setValue(t.minDeltaE)
        .onChange(async value => {
          t.minDeltaE = value;
          await this.plugin.saveSettings();
          this.refreshUI();
        }));

    new Setting(section)
      .setName('Minimum contrast ratio')
      .setDesc('WCAG contrast ratio the link must meet against both backgrounds (4.5 = AA normal text)')
      .addSlider(slider => slider
        .setLimits(3.0, 7.0, 0.1)
        .setValue(t.minContrast)
        .onChange(async value => {
          t.minContrast = value;
          await this.plugin.saveSettings();
          this.refreshUI();
        }));
  }

  private createThemeLinkColorSetting(
    containerEl: HTMLElement,
    name: string,
    desc: string,
    mapping: PropertyColorMapping,
    themeType: 'Light' | 'Dark',
    compact = false,
    onChanged?: () => void,
    registerUpdater?: (updater: () => void) => void
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

    // Compute the auto colors using the EXACT same function and inputs
    // that link-decorator.ts and the page background path use, so the
    // preview swatch always matches what gets applied at runtime. The
    // shared resolver returns both the tinted background and the link
    // color; the preview paints both. Previously this preview had its
    // own divergent formula (seeded from the rule's background color
    // instead of the theme accent), which made the preview swatch
    // show a color that never actually got applied anywhere else.
    // Delegating to the shared service guarantees the preview is
    // always what you get.
    const computeAutoColors = (): { backgroundHex: string; linkHex: string } => {
      const themeVars = readBothThemeVars();
      if (!themeVars) return { backgroundHex: '#808080', linkHex: '#808080' };

      const tuning = this.plugin.settings.experimentalLinkTuning ?? { ...DEFAULT_LINK_TUNING };

      // Gather other rules' already-assigned (manual) link hexes for
      // the same theme, so this one doesn't collide visually with
      // them. Other rules that are themselves in auto mode are
      // skipped here, mirroring link-decorator.ts's getResolvedLinkColor
      // to avoid an N^2 cascade and to keep the preview and the real
      // renderer in lockstep.
      const otherHexes = this.plugin.settings.colorMappings
        .filter(m => m !== mapping)
        .filter(m => !(isLight ? m.isAutoLinkLight : m.isAutoLinkDark))
        .map(m => isLight ? m.linkColorLight : m.linkColorDark)
        .filter((h): h is string => !!h);

      try {
        return computeAutoRuleColors(
          mapping,
          this.plugin.settings.colorMappings,
          themeType,
          themeVars,
          otherHexes,
          tuning
        );
      } catch (e) {
        console.error('Page Color Prop: failed to compute auto link color preview', e);
        return { backgroundHex: '#808080', linkHex: '#808080' };
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
      const initial = this.resolveColorForPicker(getColor() || computeAutoColors().linkHex);
      colorPicker.setValue(initial).onChange(value => {
        setIsAuto(false);
        setColor(value);
        updatePreview();
        onChanged?.();
        this.plugin.applyColorsToAllLeaves();
        this.plugin.refreshLinkDecorations();
        this.queueSave();
      });
      const inputs = settingContainer.querySelectorAll('input[type="color"]');
      colorPickerInput = inputs[inputs.length - 1] as HTMLInputElement | null;
      colorPickerInput?.addClass('page-color-prop-hidden-color-picker');
      if (colorPickerInput) {
        colorPickerInput.tabIndex = -1;
        colorPickerInput.setAttribute('aria-hidden', 'true');
      }
    });

    const openColorPicker = () => {
      if (!colorPickerInput) return;
      this.openColorPickerAtElement(colorPickerInput, preview);
    };

    // Icon-toggle button: shows the ACTION available (per spec section 1).
    //   currently Auto  -> pipette icon (click to switch to manual)
    //   currently Manual -> sparkles icon (click to switch to auto)
    let toggleBtnComponent: ButtonComponent | null = null;
    settingEl.addButton(button => {
      toggleBtnComponent = button;
      button.setIcon(getIsAuto() ? 'pipette' : 'sparkles');
      const tooltip = getIsAuto() ? 'Switch to manual color' : 'Switch to auto color';
      button.setTooltip(tooltip);
      button.buttonEl.setAttribute('aria-label', tooltip);
      button.onClick(async () => {
        const nowAuto = !getIsAuto();
        setIsAuto(nowAuto);
        if (nowAuto) {
          setColor(computeAutoColors().linkHex);
        } else if (colorPickerInput) {
          setColor(colorPickerInput.value);
        }
        await this.plugin.saveSettings();
        updatePreview();
        onChanged?.();
        button.setIcon(nowAuto ? 'pipette' : 'sparkles');
        const nextTooltip = nowAuto ? 'Switch to manual color' : 'Switch to auto color';
        button.setTooltip(nextTooltip);
        button.buttonEl.setAttribute('aria-label', nextTooltip);
        if (!nowAuto) openColorPicker();
      });
    });

    // Live preview swatch — renders on THIS theme's default (untouched)
    // page background with three stacked text samples: body text, default
    // link, and this rule's link color. Per spec section 1. The theme is
    // forced via a hidden element so the preview shows dark-theme defaults
    // even while the user is currently in light mode (and vice versa).
    const themeName: 'Light' | 'Dark' = isLight ? 'Light' : 'Dark';
    const preview = settingEl.controlEl.createEl('button', {
      cls: 'page-color-prop-link-preview',
      type: 'button'
    });
    const defaultBg = this.computeColorFromThemeVarsForTheme('var(--background-primary)', themeName);
    const defaultLink = this.computeColorFromThemeVarsForTheme('var(--link-color)', themeName);
    const defaultText = this.computeColorFromThemeVarsForTheme('var(--text-normal)', themeName);
    preview.style.backgroundColor = defaultBg || '';
    preview.style.color = defaultText || '';

    const sampleText = preview.createSpan('page-color-prop-link-preview-sample');
    sampleText.setText('Sample text');
    const defaultLinkEl = preview.createSpan('page-color-prop-link-preview-sample');
    defaultLinkEl.setText('Default link');
    defaultLinkEl.style.color = defaultLink || '';
    const ruleLinkEl = preview.createSpan('page-color-prop-link-preview-sample page-color-prop-link-preview-rule');
    ruleLinkEl.setText('Rule link');

    const updatePreview = () => {
      const mode = getIsAuto() ? 'Auto (computed from background hue)' : 'Manual';
      const displayed = getIsAuto() ? computeAutoColors().linkHex : (getColor() || computeAutoColors().linkHex);
      ruleLinkEl.style.color = displayed;
      const label = `${themeName} theme link color preview. ${mode} color: ${displayed}. Activate to choose a color.`;
      preview.title = label;
      preview.setAttribute('aria-label', label);
      if (colorPickerInput) {
        colorPickerInput.value = this.resolveColorForPicker(displayed);
      }
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
          toggleBtnComponent.buttonEl.setAttribute('aria-label', 'Switch to auto color');
        }
      }
      this.queueSave();
      updatePreview();
      onChanged?.();
      openColorPicker();
    });

    if (registerUpdater) {
      registerUpdater(() => {
        updatePreview();
        if (toggleBtnComponent) {
          toggleBtnComponent.setIcon(getIsAuto() ? 'pipette' : 'sparkles');
          const tooltip = getIsAuto() ? 'Switch to manual color' : 'Switch to auto color';
          toggleBtnComponent.setTooltip(tooltip);
          toggleBtnComponent.buttonEl.setAttribute('aria-label', tooltip);
        }
      });
    }
  }

  private createThemeUiLinkColorSetting(
    containerEl: HTMLElement,
    name: string,
    desc: string,
    mapping: PropertyColorMapping,
    themeType: 'Light' | 'Dark',
    compact = false,
    onChanged?: () => void,
    registerUpdater?: (updater: () => void) => void
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

    const computeAutoColors = (): { backgroundHex: string; linkHex: string } => {
      const themeVars = readBothThemeVars();
      if (!themeVars) return { backgroundHex: '#808080', linkHex: '#808080' };

      const tuning = this.plugin.settings.experimentalLinkTuning ?? { ...DEFAULT_LINK_TUNING };

      const otherHexes = this.plugin.settings.colorMappings
        .filter(m => m !== mapping)
        .filter(m => !(isLight ? m.isAutoLinkLight : m.isAutoLinkDark))
        .map(m => isLight ? m.linkColorLight : m.linkColorDark)
        .filter((h): h is string => !!h);

      try {
        return computeAutoRuleColors(
          mapping,
          this.plugin.settings.colorMappings,
          themeType,
          themeVars,
          otherHexes,
          tuning
        );
      } catch (e) {
        console.error('Page Color Prop: failed to compute auto UI link color preview', e);
        return { backgroundHex: '#808080', linkHex: '#808080' };
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
      const initial = this.resolveColorForPicker(getColor() || computeAutoColors().linkHex);
      colorPicker.setValue(initial).onChange(value => {
        setIsAuto(false);
        setColor(value);
        updatePreview();
        onChanged?.();
        this.plugin.applyColorsToAllLeaves();
        this.plugin.refreshLinkDecorations();
        this.queueSave();
      });
      const inputs = settingContainer.querySelectorAll('input[type="color"]');
      colorPickerInput = inputs[inputs.length - 1] as HTMLInputElement | null;
      colorPickerInput?.addClass('page-color-prop-hidden-color-picker');
      if (colorPickerInput) {
        colorPickerInput.tabIndex = -1;
        colorPickerInput.setAttribute('aria-hidden', 'true');
      }
    });

    const openColorPicker = () => {
      if (!colorPickerInput) return;
      this.openColorPickerAtElement(colorPickerInput, preview);
    };

    let toggleBtnComponent: ButtonComponent | null = null;
    settingEl.addButton(button => {
      toggleBtnComponent = button;
      button.setIcon(getIsAuto() ? 'pipette' : 'sparkles');
      const tooltip = getIsAuto() ? 'Switch to manual color' : 'Switch to auto color';
      button.setTooltip(tooltip);
      button.buttonEl.setAttribute('aria-label', tooltip);
      button.onClick(async () => {
        const nowAuto = !getIsAuto();
        setIsAuto(nowAuto);
        if (nowAuto) {
          setColor(computeAutoColors().linkHex);
        } else if (colorPickerInput) {
          setColor(colorPickerInput.value);
        }
        await this.plugin.saveSettings();
        updatePreview();
        onChanged?.();
        button.setIcon(nowAuto ? 'pipette' : 'sparkles');
        const nextTooltip = nowAuto ? 'Switch to manual color' : 'Switch to auto color';
        button.setTooltip(nextTooltip);
        button.buttonEl.setAttribute('aria-label', nextTooltip);
        if (!nowAuto) openColorPicker();
      });
    });

    const themeName: 'Light' | 'Dark' = isLight ? 'Light' : 'Dark';
    const preview = settingEl.controlEl.createEl('button', {
      cls: 'page-color-prop-link-preview',
      type: 'button'
    });
    const defaultBg = this.computeColorFromThemeVarsForTheme('var(--background-secondary)', themeName);
    const defaultText = this.computeColorFromThemeVarsForTheme('var(--nav-item-color)', themeName);
    const defaultMutedText = this.computeColorFromThemeVarsForTheme('var(--text-muted)', themeName);
    preview.style.backgroundColor = defaultBg || '';
    preview.style.color = defaultText || '';

    const sampleText = preview.createSpan('page-color-prop-link-preview-sample');
    sampleText.setText('Sample UI text');
    sampleText.addClass('page-color-prop-link-preview-emphasis');

    const defaultMutedEl = preview.createSpan('page-color-prop-link-preview-sample');
    defaultMutedEl.setText('Muted UI text');
    defaultMutedEl.style.color = defaultMutedText || '';

    const ruleLinkEl = preview.createSpan('page-color-prop-link-preview-sample page-color-prop-link-preview-rule');
    ruleLinkEl.setText('Rule link');
    ruleLinkEl.addClass('page-color-prop-link-preview-emphasis');

    const updatePreview = () => {
      const mode = getIsAuto() ? 'Auto (computed from background hue)' : 'Manual';
      const displayed = getIsAuto() ? computeAutoColors().linkHex : (getColor() || computeAutoColors().linkHex);
      ruleLinkEl.style.color = displayed;
      const label = `${themeName} theme UI link color preview. ${mode} color: ${displayed}. Activate to choose a color.`;
      preview.title = label;
      preview.setAttribute('aria-label', label);
      if (colorPickerInput) {
        colorPickerInput.value = this.resolveColorForPicker(displayed);
      }
    };
    updatePreview();

    preview.onClickEvent(() => {
      if (getIsAuto()) {
        setIsAuto(false);
        if (colorPickerInput) setColor(colorPickerInput.value);
        if (toggleBtnComponent) {
          toggleBtnComponent.setIcon('sparkles');
          toggleBtnComponent.setTooltip('Switch to auto color');
          toggleBtnComponent.buttonEl.setAttribute('aria-label', 'Switch to auto color');
        }
      }
      this.queueSave();
      updatePreview();
      onChanged?.();
      openColorPicker();
    });

    if (registerUpdater) {
      registerUpdater(() => {
        updatePreview();
        if (toggleBtnComponent) {
          toggleBtnComponent.setIcon(getIsAuto() ? 'pipette' : 'sparkles');
          const tooltip = getIsAuto() ? 'Switch to manual color' : 'Switch to auto color';
          toggleBtnComponent.setTooltip(tooltip);
          toggleBtnComponent.buttonEl.setAttribute('aria-label', tooltip);
        }
      });
    }
  }

  private createBaseColorSetting(containerEl: HTMLElement, mapping: PropertyColorMapping): void {
    const group = containerEl.createDiv("page-color-prop-base-color-group");

    group.createDiv({ text: "Rule base color", cls: "page-color-prop-base-color-label" });

    group.createEl("p", {
      cls: "page-color-prop-base-color-helper",
      text: "Choose the rule's base color. Page tints and links adapt automatically for each theme.",
    });

    const settingContainer = group.createDiv("page-color-prop-base-color-setting");
    const setting = new Setting(settingContainer);

    let swatch: HTMLButtonElement | null = null;
    let colorInput: HTMLInputElement | null = null;
    setting.addColorPicker(picker => {
      picker.setValue(mapping.baseColor).onChange(async value => {
        mapping.baseColor = value;
        updateSwatch();
        this.applyRuleChangesImmediately();
        await this.plugin.saveSettings();
        this.refreshUI();
      });
      const inputs = settingContainer.querySelectorAll("input[type=color]");
      colorInput = inputs[inputs.length - 1] as HTMLInputElement;
      colorInput?.addClass("page-color-prop-hidden-color-picker");
      if (colorInput) {
        colorInput.tabIndex = -1;
        colorInput.setAttribute("aria-hidden", "true");
      }
    });

    setting.addButton(button => {
      button.setIcon('pipette').setTooltip('Pick rule base color');
      button.buttonEl.setAttribute('aria-label', 'Pick rule base color');
      button.onClick(() => {
        if (colorInput && swatch) this.openColorPickerAtElement(colorInput, swatch);
      });
    });

    swatch = setting.controlEl.createEl("button", { cls: "page-color-prop-base-swatch", type: "button" });
    const updateSwatch = () => {
      if (!swatch) return;
      const label = `Rule base color ${mapping.baseColor}. Activate to choose a color.`;
      swatch.style.backgroundColor = mapping.baseColor;
      swatch.setAttribute("aria-label", label);
      swatch.title = label;
    };
    updateSwatch();
    swatch.onClickEvent(() => {
      if (colorInput && swatch) this.openColorPickerAtElement(colorInput, swatch);
    });
  }

  private renderCrossRuleCheck(
    containerEl: HTMLElement,
    mapping: PropertyColorMapping,
    allMappings: PropertyColorMapping[],
    themeVars: ThemeCssVars,
    tuning: LinkColorTuning,
  ): void {
    const others = allMappings.filter(m => m.id !== mapping.id);
    if (others.length === 0) return;

    const details = containerEl.createEl("details", { cls: "page-color-prop-cross-check" });
    details.createEl("summary", { text: "Check against other rules" });
    details.createEl("p", {
      cls: "page-color-prop-cross-check-caption",
      text: "Verifies this rule's link color stays readable on other rules' backgrounds (since matching pages can link to each other).",
    });

    const isLight = !this.plugin.isDarkTheme;
    const theme = isLight ? "Light" : "Dark";
    const thisResult = computeAutoRuleColors(mapping, allMappings, theme, themeVars, [], tuning);

    let anyFailed = false;

    for (const other of others) {
      const otherResult = computeAutoRuleColors(other, allMappings, theme, themeVars, [], tuning);
      const contrast = ColorMath.getContrast(
        ColorMath.hexToRgb(thisResult.linkHex),
        ColorMath.hexToRgb(otherResult.backgroundHex),
      );
      const passed = contrast >= tuning.minContrast;
      if (!passed) anyFailed = true;

      const row = details.createDiv("page-color-prop-cross-check-row");
      const preview = row.createDiv("page-color-prop-cross-check-preview");
      preview.style.backgroundColor = otherResult.backgroundHex;
      const sample = preview.createSpan({ text: "Rule link" });
      sample.style.color = thisResult.linkHex;

      row.createSpan({ text: `${other.property || "Unnamed rule"} background` });
      row.createSpan({
        cls: passed ? "page-color-prop-badge-pass" : "page-color-prop-badge-fail",
        text: passed
          ? `Pass (${contrast.toFixed(1)}:1)`
          : `Low contrast (${contrast.toFixed(1)}:1, needs ${tuning.minContrast}:1)`,
      });
    }

    details.open = anyFailed;
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
    const body = this.containerEl.ownerDocument.body;
    const isCurrentlyDark = body.classList.contains('theme-dark');
    const wantDark = theme === 'Dark';
    const needsSwitch = theme !== null && isCurrentlyDark !== wantDark;

    if (needsSwitch) {
      body.classList.remove('theme-light', 'theme-dark');
      body.classList.add(wantDark ? 'theme-dark' : 'theme-light');
    }

    try {
      const hex = readThemeCssVar(colorStr, this.containerEl.ownerDocument);
      return hex ?? '#808080';
    } finally {
      if (needsSwitch) {
        body.classList.remove('theme-light', 'theme-dark');
        body.classList.add(isCurrentlyDark ? 'theme-dark' : 'theme-light');
      }
    }
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
    const pickerProperties = [
      '--page-color-prop-color-picker-left',
      '--page-color-prop-color-picker-top',
      '--page-color-prop-color-picker-width',
      '--page-color-prop-color-picker-height'
    ];
    const previousProperties: Record<string, string> = {};
    for (const property of pickerProperties) {
      previousProperties[property] = input.style.getPropertyValue(property);
    }
    const hadOpenClass = input.hasClass('page-color-prop-color-picker-open');
    const restoreStyles = () => {
      input.removeClass('page-color-prop-color-picker-open');
      if (hadOpenClass) input.addClass('page-color-prop-color-picker-open');
      const restoredProperties: Record<string, string> = {};
      for (const property of pickerProperties) {
        const previous = previousProperties[property];
        if (previous) {
          restoredProperties[property] = previous;
        } else {
          input.style.removeProperty(property);
        }
      }
      input.setCssProps(restoredProperties);
    };

    input.addClass('page-color-prop-color-picker-open');
    input.setCssProps({
      '--page-color-prop-color-picker-left': `${rect.left}px`,
      '--page-color-prop-color-picker-top': `${rect.top}px`,
      '--page-color-prop-color-picker-width': `${rect.width}px`,
      '--page-color-prop-color-picker-height': `${rect.height}px`
    });

    let pickerOpened = false;
    try {
      const showPicker = (input as HTMLInputElement & { showPicker?: () => void }).showPicker;
      if (showPicker) {
        showPicker.call(input);
      } else {
        input.click();
      }
      pickerOpened = true;
    } finally {
      if (!pickerOpened) restoreStyles();
    }

    const win = ownerWindow(input) ?? activeWindow;
    requestFrameIn(win, () => {
      restoreStyles();
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
        .setDestructive()
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