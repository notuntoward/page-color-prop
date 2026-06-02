import { App, Debouncer, debounce, Modal, PluginSettingTab, Setting } from 'obsidian';
import type PageColorPropPlugin from './main';

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

export const DEFAULT_LIGHT_AUTO_COLOR = 'hsla(var(--accent-h), var(--accent-s), 90%, 0.35)';
export const DEFAULT_DARK_AUTO_COLOR = 'hsla(var(--accent-h), var(--accent-s), 25%, 0.30)';

// EMPTY defaults - no example mappings!
export const DEFAULT_SETTINGS: PageColorPropSettings = {
	colorMappings: [],
	notifyOnMultipleMatches: true
};

export class PageColorPropSettingTab extends PluginSettingTab {
	plugin: PageColorPropPlugin;
	private debouncedSave: Debouncer<[], Promise<void>>;

	constructor(app: App, plugin: PageColorPropPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		this.debouncedSave = debounce(() => this.plugin.saveSettings(), 500, true);
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
			text: 'Rule priority: if multiple rules match a note, the lowest matching rule below sets the background. Use Move up and Move down to reorder.'
		});

		if (this.plugin.settings.colorMappings.length > 0) {
			new Setting(containerEl)
				.setName(`Color mappings (${this.plugin.settings.colorMappings.length})`)
				.setHeading();

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
		this.debouncedSave.run();
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

	private queueSave() {
		this.debouncedSave();
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

		// Light Theme Color Setting
		this.createThemeColorSetting(
			mappingCard,
			'Light theme background',
			'Color for light-mode backgrounds',
			mapping,
			'Light'
		);

		// Dark Theme Color Setting
		this.createThemeColorSetting(
			mappingCard,
			'Dark theme background',
			'Color for dark-mode backgrounds',
			mapping,
			'Dark'
		);

		new Setting(mappingCard)
			.addButton(button => {
				button.setButtonText('Duplicate').onClick(async () => {
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
					.setButtonText('Move up')
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
					.setButtonText('Move down')
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
					.setButtonText('Delete')
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
			? DEFAULT_LIGHT_AUTO_COLOR
			: DEFAULT_DARK_AUTO_COLOR;

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

		const getDisplayColor = () => this.resolveColorForDisplay(getIsAuto() ? autoDefault : getColor());
		const updateSwatch = () => {
			const mode = getIsAuto() ? 'Auto from theme' : 'Manual';
			const displayColor = getDisplayColor();

			sampleBox.style.backgroundColor = displayColor;
			sampleBox.ariaLabel = `${mode} color: ${displayColor}. Click to choose a manual color.`;
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

			if ('showPicker' in colorPickerInput) {
				(colorPickerInput as any).showPicker();
			} else {
				(colorPickerInput as any).click();
			}
		};
		const sampleBox = settingEl.controlEl.createEl('button', {
			cls: 'page-color-prop-sample-box',
			type: 'button'
		});
		addColorPicker(value => {
			setIsAuto(false);
			setColor(value);
			updateSwatch();
			this.plugin.applyColorsToAllLeaves();
			this.queueSave();
		});
		updateSwatch();

		// Toggle button
		settingEl.addButton(button => {
			button
				.setButtonText(isAuto ? 'Use color picker' : 'Use auto color')
				.onClick(async () => {
					const nowAuto = !getIsAuto();
					setIsAuto(nowAuto);

					if (!nowAuto && colorPickerInput) {
						setColor(colorPickerInput.value);
					}
					
					await this.plugin.saveSettings();

					updateSwatch();
					button.setButtonText(nowAuto ? 'Use color picker' : 'Use auto color');
					if (!nowAuto) openColorPicker();
				});

			sampleBox.onClickEvent(async () => {
				if (getIsAuto()) {
					setIsAuto(false);
					if (colorPickerInput) {
						setColor(colorPickerInput.value);
					}
					await this.plugin.saveSettings();
					updateSwatch();
					button.setButtonText('Use auto color');
				}

				openColorPicker();
			});
		});
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
