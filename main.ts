import { Plugin, TFile, MetadataCache, WorkspaceLeaf } from 'obsidian';
import { PageColorPropSettings, DEFAULT_SETTINGS, PageColorPropSettingTab, PropertyColorMapping } from './settings';

export default class PageColorPropPlugin extends Plugin {
	settings: PageColorPropSettings;
	private currentStyleEl: HTMLStyleElement | null = null;
	private isDarkTheme: boolean = false;
	private themeObserver: MutationObserver | null = null;

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

		// Initialize theme state
		this.updateThemeState();

		// Listen for theme changes
		this.registerThemeChangeListener();

		// Apply color to current active file on load
		this.applyColorToActiveFile();
	}

	onunload() {
		this.removeCurrentStyle();
		if (this.themeObserver) {
			this.themeObserver.disconnect();
		}
	}

	async loadSettings() {
		const loadedData = await this.loadData();
		
		console.log('Page Color Prop: Loading settings...');
		console.log('Page Color Prop: Loaded data from disk:', JSON.stringify(loadedData, null, 2));
		
		// Only use defaults if no data exists at all
		if (!loadedData || !loadedData.colorMappings) {
			console.log('Page Color Prop: No saved data found, using defaults (empty array)');
			this.settings = { colorMappings: [] };
		} else {
			console.log('Page Color Prop: Using saved data (NOT merging with defaults)');
			// Load saved data - DO NOT MERGE WITH DEFAULTS
			this.settings = {
				colorMappings: loadedData.colorMappings
			};
		}
		
		console.log('Page Color Prop: Final settings after load:', JSON.stringify(this.settings, null, 2));
		console.log(`Page Color Prop: Total mappings loaded: ${this.settings.colorMappings.length}`);
		
		// Migrate old format to new format
		this.migrateSettings();
	}

	private migrateSettings() {
		let needsSave = false;
		
		console.log('Page Color Prop: Checking for migrations...');
		
		this.settings.colorMappings.forEach((mapping: any, index) => {
			// If old format exists (has 'color' but not 'colorLight' or 'colorDark')
			if (mapping.color && (!mapping.colorLight || !mapping.colorDark)) {
				console.log(`Page Color Prop: Migrating mapping ${index} from old single-color format`);
				mapping.colorLight = mapping.color;
				mapping.colorDark = mapping.color;
				mapping.isAutoLight = false;
				mapping.isAutoDark = false;
				delete mapping.color;
				needsSave = true;
			}
			
			// Update old auto colors to new more visible values
			if (mapping.colorLight === 'hsla(var(--accent-h), var(--accent-s), 95%, 0.10)' ||
			    mapping.colorLight === 'hsla(var(--accent-h), var(--accent-s), 90%, 0.25)') {
				console.log(`Page Color Prop: Updating mapping ${index} light color to more visible version`);
				mapping.colorLight = 'hsla(var(--accent-h), var(--accent-s), 90%, 0.35)';
				needsSave = true;
			}
			if (mapping.colorDark === 'hsla(var(--accent-h), var(--accent-s), 18%, 0.12)') {
				console.log(`Page Color Prop: Updating mapping ${index} dark color to more visible version`);
				mapping.colorDark = 'hsla(var(--accent-h), var(--accent-s), 25%, 0.30)';
				needsSave = true;
			}
			
			// Ensure both colorLight and colorDark exist
			if (!mapping.colorLight) {
				console.log(`Page Color Prop: Adding missing colorLight to mapping ${index}`);
				mapping.colorLight = 'hsla(var(--accent-h), var(--accent-s), 90%, 0.35)';
				needsSave = true;
			}
			if (!mapping.colorDark) {
				console.log(`Page Color Prop: Adding missing colorDark to mapping ${index}`);
				mapping.colorDark = 'hsla(var(--accent-h), var(--accent-s), 25%, 0.30)';
				needsSave = true;
			}
			
			// Ensure isAutoLight and isAutoDark exist
			if (mapping.isAutoLight === undefined) {
				console.log(`Page Color Prop: Adding missing isAutoLight to mapping ${index}`);
				mapping.isAutoLight = true;
				needsSave = true;
			}
			if (mapping.isAutoDark === undefined) {
				console.log(`Page Color Prop: Adding missing isAutoDark to mapping ${index}`);
				mapping.isAutoDark = true;
				needsSave = true;
			}
		});
		
		if (needsSave) {
			console.log('Page Color Prop: Migrations applied, saving settings');
			this.saveSettings();
		} else {
			console.log('Page Color Prop: No migrations needed');
		}
	}

	async saveSettings() {
		console.log('Page Color Prop: SAVING settings...');
		console.log('Page Color Prop: About to save:', JSON.stringify(this.settings, null, 2));
		console.log(`Page Color Prop: Saving ${this.settings.colorMappings.length} mappings`);
		
		// Completely replace the saved data (no merging with old data)
		try {
			await this.saveData(this.settings);
			console.log('Page Color Prop: Settings saved SUCCESSFULLY to disk');
			
			// Verify what was saved
			const verify = await this.loadData();
			console.log('Page Color Prop: Verification - data read back from disk:', JSON.stringify(verify, null, 2));
			console.log(`Page Color Prop: Verification - mappings count after save: ${verify?.colorMappings?.length || 0}`);
		} catch (error) {
			console.error('Page Color Prop: ERROR saving settings!', error);
		}
		
		// Reapply color when settings change
		this.applyColorToActiveFile();
	}

	private updateThemeState() {
		this.isDarkTheme = document.body.classList.contains('theme-dark');
	}

	private registerThemeChangeListener() {
		const themeConfig: MutationObserverInit = {
			attributes: true,
			attributeFilter: ['class'],
			attributeOldValue: true
		};

		this.themeObserver = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
					const wasLight = !this.isDarkTheme;
					this.updateThemeState();
					const isNowLight = !this.isDarkTheme;

					if (wasLight !== isNowLight) {
						this.applyColorToActiveFile();
					}
				}
			}
		});

		this.themeObserver.observe(document.body, themeConfig);
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

	applyColorToActiveFile() {
		this.removeCurrentStyle();

		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) return;

		const metadata = this.app.metadataCache.getFileCache(activeFile);
		if (!metadata?.frontmatter) return;

		const colorMapping = this.findMatchingColorMapping(metadata.frontmatter);
		if (!colorMapping) return;

		const color = this.isDarkTheme ? colorMapping.colorDark : colorMapping.colorLight;

		if (color) {
			this.applyBackgroundColor(color);
		}
	}

	private findMatchingColorMapping(frontmatter: any): PropertyColorMapping | null {
		for (const mapping of this.settings.colorMappings) {
			const propertyValue = frontmatter[mapping.property];

			if (propertyValue === undefined || propertyValue === null) continue;

			if (mapping.matchType === 'exact') {
				if (propertyValue === mapping.value) {
					return mapping;
				}
			} else if (mapping.matchType === 'contains') {
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
		if (!this.isValidColor(color)) {
			console.warn(`Page Color Prop: Invalid color format: ${color}`);
			return;
		}

		this.currentStyleEl = document.createElement('style');
		this.currentStyleEl.textContent = `
.workspace-leaf.mod-active .workspace-leaf-content[data-type="markdown"] {
	background-color: ${color} !important;
}

.workspace-leaf.mod-active .workspace-leaf-content[data-type="markdown"] .view-content,
.workspace-leaf.mod-active .workspace-leaf-content[data-type="markdown"] .markdown-source-view,
.workspace-leaf.mod-active .workspace-leaf-content[data-type="markdown"] .markdown-preview-view,
.workspace-leaf.mod-active .workspace-leaf-content[data-type="markdown"] .cm-editor,
.workspace-leaf.mod-active .workspace-leaf-content[data-type="markdown"] .cm-scroller,
.workspace-leaf.mod-active .workspace-leaf-content[data-type="markdown"] .markdown-preview-sizer {
	background: transparent !important;
}

.workspace-leaf.mod-active .workspace-leaf-content[data-type="markdown"] img {
	background: transparent !important;
	mix-blend-mode: normal !important;
}

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
		if (!color || typeof color !== 'string') {
			return false;
		}

		if (color.startsWith('--') || color.startsWith('var(--')) {
			return true;
		}

		const testEl = document.createElement('div');
		testEl.style.color = color;
		return testEl.style.color !== '';
	}
}
