import { App, PluginSettingTab, Setting } from 'obsidian';
import PageColorPropPlugin from './main';

export interface PropertyColorMapping {
	property: string;
	value: string;
	colorLight: string;
	colorDark: string;
	isAutoLight: boolean;
	isAutoDark: boolean;
	matchType: 'exact' | 'contains';
}

export interface PageColorPropSettings {
	colorMappings: PropertyColorMapping[];
	notifyOnMultipleMatches: boolean;
}

// EMPTY defaults - no example mappings!
export const DEFAULT_SETTINGS: PageColorPropSettings = {
	colorMappings: [],
	notifyOnMultipleMatches: true
};

export class PageColorPropSettingTab extends PluginSettingTab {
	plugin: PageColorPropPlugin;
	private styleEl: HTMLStyleElement | null = null;

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
					.onClick(async () => {
						this.plugin.settings.colorMappings.push({
							property: '',
							value: '',
							colorLight: 'hsla(var(--accent-h), var(--accent-s), 90%, 0.35)',
							colorDark: 'hsla(var(--accent-h), var(--accent-s), 25%, 0.30)',
							isAutoLight: true,
							isAutoDark: true,
							matchType: 'exact'
						});
						await this.plugin.saveSettings();
						this.display();
					});
			});

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

		containerEl.createDiv({
			cls: 'page-color-prop-rule-priority-note',
			text: 'Rule priority: if multiple rules match a note, the lowest matching rule below sets the background. Use ↑ and ↓ to reorder.'
		});

		if (this.plugin.settings.colorMappings.length > 0) {
			containerEl.createEl('h3', {
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
							const confirmClearAll = confirm(
								`Delete all ${this.plugin.settings.colorMappings.length} color mappings?\n\nThis action cannot be undone.`
							);
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
Click "Add New Mapping" above to create your first property-to-color mapping.

<strong>Example:</strong> Map <code>tags: ai-generated</code> to a tinted background

<strong>Property:</strong> <code>tags</code><br>
<strong>Value:</strong> <code>ai-generated</code><br>
<strong>Light Theme:</strong> Auto (theme-aware)<br>
<strong>Dark Theme:</strong> Auto (theme-aware)<br>
<strong>Match Type:</strong> Contains<br>

<strong>Result:</strong> Notes with the tag <code>ai-generated</code> will have a subtle tinted background that adapts to your theme

<strong>Supported Color Formats for Manual Mode:</strong><br>
<code>#FF5733</code>, <code>#123ABC</code><br>
<code>rgb(255, 87, 51)</code>, <code>rgba(255, 87, 51, 0.5)</code><br>
<code>red</code>, <code>blue</code>, <code>lightgreen</code>
`;
		}
	}

	onunload(): void {
		if (this.styleEl) {
			this.styleEl.remove();
			this.styleEl = null;
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
					this.plugin.saveSettings();
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
					this.plugin.saveSettings();
				});
				text.inputEl.disabled = false;
			});

		new Setting(mappingCard)
			.setName('Match Type')
			.setDesc('Exact match or contains (for arrays like tags)')
			.addDropdown(dropdown => {
				dropdown
					.addOption('exact', 'Exact Match')
					.addOption('contains', 'Contains')
					.setValue(mapping.matchType || 'exact')
					.onChange(value => {
						mapping.matchType = value as 'exact' | 'contains';
						updateSummary();
						this.plugin.saveSettings();
					});
			});

		// Light Theme Color Setting
		this.createThemeColorSetting(
			mappingCard,
			'Light Theme Background',
			'Color for light-mode backgrounds',
			mapping,
			'Light'
		);

		// Dark Theme Color Setting
		this.createThemeColorSetting(
			mappingCard,
			'Dark Theme Background',
			'Color for dark-mode backgrounds',
			mapping,
			'Dark'
		);

		new Setting(mappingCard)
			.addButton(button => {
				button.setButtonText('🔄 Duplicate').onClick(async () => {
					const duplicateIndex = index + 1;
					this.plugin.settings.colorMappings.splice(duplicateIndex, 0, {
						...JSON.parse(JSON.stringify(mapping))
					});
					await this.plugin.saveSettings();
					this.display();
					this.scrollToMapping(duplicateIndex);
				});
			})
			.addButton(button => {
				button
					.setButtonText('↑ Up')
					.onClick(async () => {
						if (index > 0) {
							[this.plugin.settings.colorMappings[index], this.plugin.settings.colorMappings[index - 1]] = [
								this.plugin.settings.colorMappings[index - 1],
								this.plugin.settings.colorMappings[index]
							];
							await this.plugin.saveSettings();
							this.display();
						}
					});
				button.buttonEl.disabled = index === 0;
			})
			.addButton(button => {
				button
					.setButtonText('↓ Down')
					.onClick(async () => {
						if (index < this.plugin.settings.colorMappings.length - 1) {
							[this.plugin.settings.colorMappings[index], this.plugin.settings.colorMappings[index + 1]] = [
								this.plugin.settings.colorMappings[index + 1],
								this.plugin.settings.colorMappings[index]
							];
							await this.plugin.saveSettings();
							this.display();
						}
					});
				button.buttonEl.disabled = index === this.plugin.settings.colorMappings.length - 1;
			})
			.addButton(button => {
				button
					.setButtonText('🗑️ Delete')
					.setWarning()
					.onClick(async () => {
						this.plugin.settings.colorMappings.splice(index, 1);
						await this.plugin.saveSettings();
						this.display();
					});
			});
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

	private createThemeColorSetting(
		containerEl: HTMLElement,
		name: string,
		desc: string,
		mapping: PropertyColorMapping,
		themeType: 'Light' | 'Dark'
	) {
		const isLight = themeType === 'Light';
		const autoDefault = isLight
			? 'hsla(var(--accent-h), var(--accent-s), 90%, 0.35)'
			: 'hsla(var(--accent-h), var(--accent-s), 25%, 0.30)';

		// Create a container for this color setting - divider will be above this
		const colorSettingContainer = containerEl.createDiv('page-color-prop-color-setting-container');
		
		const settingEl = new Setting(colorSettingContainer);
		settingEl.setName(name);
		settingEl.setDesc(desc);

		// Get current state
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

		// Color sample display (BEFORE the setting controls)
		const colorDisplay = colorSettingContainer.createDiv('page-color-prop-color-display');
		const sampleBox = colorDisplay.createDiv('page-color-prop-sample-box');
		const currentColor = getColor();
		const displayColor = this.resolveColorForDisplay(isAuto ? autoDefault : currentColor);
		sampleBox.style.backgroundColor = displayColor;
		
		const modeLabel = colorDisplay.createDiv('page-color-prop-mode-label');
		modeLabel.setText(isAuto ? 'Auto (from theme)' : `Manual`);

		let colorPickerInput: HTMLInputElement | null = null;
		const addColorPicker = () => {
			settingEl.addColorPicker(colorPicker => {
				const currentColor = getColor();
				const pickerColor = this.resolveColorForPicker(currentColor);
				
				colorPicker
					.setValue(pickerColor)
					.onChange(value => {
						// **FIX**: Update UI *first* in case saving fails
						sampleBox.style.backgroundColor = value;
						modeLabel.setText(`Manual`);
						
						// Then update data and save
						setColor(value);
						this.plugin.saveSettings();
						this.plugin.applyColorsToAllLeaves();
					});
			});

			const colorInputs = colorSettingContainer.querySelectorAll('input[type="color"]');
			colorPickerInput = colorInputs[colorInputs.length - 1] as HTMLInputElement | null;
		};

		// Toggle button
		settingEl.addButton(button => {
			button
				.setButtonText(isAuto ? 'Color Picker' : 'Switch to Auto')
				.onClick(async () => {
					const wasAuto = getIsAuto();
					const nowAuto = !wasAuto;
					setIsAuto(nowAuto);
					
					if (nowAuto) {
						setColor(autoDefault);
					} else {
						if (!colorPickerInput) {
							addColorPicker();
						}
						if (colorPickerInput) {
							setColor(colorPickerInput.value);
						}
					}
					
					await this.plugin.saveSettings();
					this.plugin.applyColorsToAllLeaves();

					const currentDisplayColor = this.resolveColorForDisplay(nowAuto ? autoDefault : getColor());
					sampleBox.style.backgroundColor = currentDisplayColor;
					modeLabel.setText(nowAuto ? 'Auto (from theme)' : `Manual`);
					button.setButtonText(nowAuto ? 'Color Picker' : 'Switch to Auto');

					if (wasAuto && !nowAuto) {
						if (colorPickerInput) {
							colorPickerInput.style.display = '';
						}
						window.setTimeout(() => {
							if (colorPickerInput) {
								colorPickerInput.click();
							}
						}, 50);
					} else if (!wasAuto && nowAuto && colorPickerInput) {
						colorPickerInput.style.display = 'none';
					}
				});
		});

		// Color picker (only show if manual mode)
		if (!isAuto) {
			addColorPicker();
		}
	}

	private resolveColorForPicker(color: string): string {
		// Null/undefined check
		if (!color || typeof color !== 'string') {
			return '#808080';
		}

		// If it's already a hex color, return it
		const hexMatch = color.match(/#[0-9A-Fa-f]{6}/);
		if (hexMatch) return hexMatch[0];

		// If it contains CSS variables, compute the actual color
		if (color.includes('var(--')) {
			return this.computeColorFromThemeVars(color);
		}

		// Try to convert rgb/rgba to hex
		const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
		if (rgbMatch) {
			const r = parseInt(rgbMatch[1]).toString(16).padStart(2, '0');
			const g = parseInt(rgbMatch[2]).toString(16).padStart(2, '0');
			const b = parseInt(rgbMatch[3]).toString(16).padStart(2, '0');
			return `#${r}${g}${b}`;
		}

		// Default to a neutral color
		return '#808080';
	}

	private resolveColorForDisplay(color: string): string {
		// For display, we want the actual CSS value to use theme variables if present
		// But computed for preview
		if (!color || typeof color !== 'string') {
			return '#808080';
		}

		// If it contains CSS variables, compute the actual color for display
		if (color.includes('var(--')) {
			return this.computeColorFromThemeVars(color);
		}

		// Otherwise return as-is (hex, rgb, or color name)
		return color;
	}

	private computeColorFromThemeVars(colorStr: string): string {
		// Create a temporary element to compute the color
		const temp = document.createElement('div');
		temp.style.color = colorStr;
		document.body.appendChild(temp);
		
		const computed = window.getComputedStyle(temp).color;
		document.body.removeChild(temp);

		// Parse the computed rgb/rgba and convert to hex
		const rgbMatch = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
		if (rgbMatch) {
			const r = parseInt(rgbMatch[1]).toString(16).padStart(2, '0');
			const g = parseInt(rgbMatch[2]).toString(16).padStart(2, '0');
			const b = parseInt(rgbMatch[3]).toString(16).padStart(2, '0');
			return `#${r}${g}${b}`;
		}

		return '#808080';
	}

	private addZoomResponsiveStyles() {
		// Remove old style if it exists
		if (this.styleEl) {
			this.styleEl.remove();
		}

		// Create NEW style element scoped to this plugin only
		this.styleEl = document.createElement('style');
		this.styleEl.setAttribute('data-plugin', 'page-color-prop');
		
		this.styleEl.textContent = `
			/* Page Color Prop plugin styles - scoped carefully */
			.page-color-prop-mapping-card {
				border: 1px solid var(--background-modifier-border);
				border-radius: 4px;
				padding: 10px 12px;
				margin-bottom: 8px;
				background-color: var(--background-secondary);
			}

			.page-color-prop-mapping-card .setting-item {
				padding: 6px 0;
			}

			.page-color-prop-mapping-card .setting-item-name {
				font-size: 13px;
			}

			.page-color-prop-mapping-card .setting-item-description {
				font-size: 12px;
				line-height: 1.3;
			}

			.page-color-prop-mapping-card .setting-item-control input,
			.page-color-prop-mapping-card .setting-item-control select {
				min-height: 28px;
			}

			.page-color-prop-mapping-header {
				display: flex;
				align-items: center;
				gap: 8px;
				margin-bottom: 4px;
			}

			.page-color-prop-rule-number {
				font-size: 12px;
				font-weight: 700;
				color: var(--text-accent);
				white-space: nowrap;
			}

			.page-color-prop-rule-summary {
				font-size: 12px;
				color: var(--text-muted);
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			.page-color-prop-rule-priority-note {
				margin: 8px 0 12px;
				padding: 8px 10px;
				border-left: 3px solid var(--interactive-accent);
				background-color: var(--background-secondary);
				color: var(--text-muted);
				font-size: 13px;
				line-height: 1.35;
			}
			
			.page-color-prop-section-title {
				margin-top: 14px;
				margin-bottom: 8px;
				font-weight: 600;
			}
			
			.page-color-prop-description {
				margin-bottom: 10px;
				color: var(--text-muted);
				font-size: 14px;
			}
			
			.page-color-prop-empty-state {
				padding: 24px;
				border: 1px dashed var(--background-modifier-border);
				border-radius: 4px;
				background-color: var(--background-secondary);
				font-size: 14px;
				color: var(--text-muted);
				line-height: 1.6;
			}
			
			.page-color-prop-color-setting-container {
				border-top: 1px solid var(--background-modifier-border);
				padding-top: 8px;
				margin-top: 6px;
			}
			
			.page-color-prop-color-display {
				display: flex;
				align-items: center;
				gap: 8px;
				padding: 0 0 4px 0;
				margin-bottom: 2px;
			}
			
			.page-color-prop-sample-box {
				width: 32px;
				height: 32px;
				border-radius: 4px;
				border: 2px solid var(--background-modifier-border);
				box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.15);
				flex-shrink: 0;
			}
			
			.page-color-prop-mode-label {
				font-size: 13px;
				color: var(--text-normal);
				font-weight: 500;
				flex: 1;
			}
			
			@media (max-width: 768px) {
				.page-color-prop-mapping-card {
					padding: 8px;
					margin-bottom: 8px;
				}
				
				.page-color-prop-sample-box {
					width: 30px;
					height: 30px;
				}
			}
		`;
		
		document.head.appendChild(this.styleEl);
	}
}
