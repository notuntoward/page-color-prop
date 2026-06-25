import { MarkdownView, Notice, Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import {
	DEFAULT_DARK_AUTO_COLOR,
	DEFAULT_LIGHT_AUTO_COLOR,
	PageColorPropSettings,
	DEFAULT_SETTINGS,
	PageColorPropSettingTab,
	PropertyColorMapping
} from './settings';

type FrontmatterValue = string | number | boolean | null | undefined | FrontmatterValue[];
type Frontmatter = Record<string, FrontmatterValue>;

interface ColorMappingMatch {
	mapping: PropertyColorMapping;
	index: number;
	propertyValue: FrontmatterValue;
}

interface LegacyPropertyColorMapping extends Partial<PropertyColorMapping> {
	color?: string;
}

export default class PageColorPropPlugin extends Plugin {
	settings: PageColorPropSettings;
	private isDarkTheme: boolean = false;
	private themeObserver: MutationObserver | null = null;
	private multipleMatchNoticeKeys: Set<string> = new Set();
	private pendingRetryHandles: Set<number> = new Set();

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

		this.registerEvent(
			this.app.workspace.on('layout-change', this.onLayoutChange.bind(this))
		);

		this.registerEvent(
			this.app.workspace.on('file-open', this.onFileOpen.bind(this))
		);

		// Initialize theme state
		this.updateThemeState();

		// Listen for theme changes
		this.registerThemeChangeListener();

		// Apply colors to all visible files on load
		this.applyColorsToAllLeaves();
	}

	onunload() {
		this.removeAllStyles();
		this.clearPendingRetries();
		if (this.themeObserver) {
			this.themeObserver.disconnect();
		}
	}

	private clearPendingRetries() {
		this.pendingRetryHandles.forEach(handle => window.clearTimeout(handle));
		this.pendingRetryHandles.clear();
	}

	async loadSettings() {
		const loadedData = await this.loadData() as Partial<PageColorPropSettings> | null;

		if (!loadedData || !Array.isArray(loadedData.colorMappings)) {
			this.settings = { ...DEFAULT_SETTINGS, colorMappings: [] };
		} else {
			this.settings = {
				colorMappings: loadedData.colorMappings.filter(this.isValidMapping),
				notifyOnMultipleMatches: loadedData.notifyOnMultipleMatches ?? DEFAULT_SETTINGS.notifyOnMultipleMatches
			};
		}

		this.migrateSettings();
	}

	private isValidMapping(mapping: unknown): mapping is PropertyColorMapping {
		if (!mapping || typeof mapping !== 'object') return false;

		const candidate = mapping as Partial<PropertyColorMapping>;
		return typeof candidate.property === 'string' &&
			typeof candidate.value === 'string' &&
			(candidate.matchType === 'exact' || candidate.matchType === 'contains');
	}

	private migrateSettings() {
		let needsSave = false;

		this.settings.colorMappings.forEach((mapping: LegacyPropertyColorMapping) => {
			// If old format exists (has 'color' but not 'colorLight' or 'colorDark')
			if (mapping.color && (!mapping.colorLight || !mapping.colorDark)) {
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
				mapping.colorLight = 'hsla(var(--accent-h), var(--accent-s), 90%, 0.35)';
				needsSave = true;
			}

			if (mapping.colorDark === 'hsla(var(--accent-h), var(--accent-s), 18%, 0.12)') {
				mapping.colorDark = 'hsla(var(--accent-h), var(--accent-s), 25%, 0.30)';
				needsSave = true;
			}

			// Ensure both colorLight and colorDark exist
			if (!mapping.colorLight) {
				mapping.colorLight = 'hsla(var(--accent-h), var(--accent-s), 90%, 0.35)';
				needsSave = true;
			}

			if (!mapping.colorDark) {
				mapping.colorDark = 'hsla(var(--accent-h), var(--accent-s), 25%, 0.30)';
				needsSave = true;
			}

			// Ensure isAutoLight and isAutoDark exist
			if (mapping.isAutoLight === undefined) {
				mapping.isAutoLight = false;
				needsSave = true;
			}

			if (mapping.isAutoDark === undefined) {
				mapping.isAutoDark = false;
				needsSave = true;
			}
		});

		if (this.settings.notifyOnMultipleMatches === undefined) {
			this.settings.notifyOnMultipleMatches = DEFAULT_SETTINGS.notifyOnMultipleMatches;
			needsSave = true;
		}

		if (needsSave) {
			this.saveSettings();
		}
	}

	async saveSettings() {
		try {
			await this.saveData(this.settings);
		} catch (error) {
			console.error('Page Color Prop: ERROR saving settings!', error);
		}

		this.multipleMatchNoticeKeys.clear();

		// Reapply colors when settings change
		this.applyColorsToAllLeaves();
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
						this.applyColorsToAllLeaves();
					}
				}
			}
		});

		this.themeObserver.observe(document.body, themeConfig);
	}

	private onActiveLeafChange(leaf: WorkspaceLeaf | null) {
		this.applyColorsToAllLeaves();
	}

	private onMetadataChanged(file: TFile) {
		// When metadata changes, reapply colors to all leaves
		this.applyColorsToAllLeaves();
	}

	private onLayoutChange() {
		// When layout changes (split, close pane, etc.), reapply colors
		this.applyColorsToAllLeaves();
	}

	private onFileOpen() {
		// When a file is opened in a leaf (e.g., via Quick Switcher++), reapply colors
		this.applyColorsToAllLeaves();
	}

	public applyColorsToAllLeaves(retriesLeft: number = 3) {
		const leaves = this.app.workspace.getLeavesOfType('markdown');
		let needsRetry = false;
		// Elements whose color must be preserved during the stale-style sweep:
		// either we just colored them, or their metadata isn't ready yet.
		const protectedElements = new Set<HTMLElement>();

		leaves.forEach((leaf) => {
			if (!(leaf.view instanceof MarkdownView)) return;

			const file = leaf.view.file;
			if (!file) return;

			const targetEl = this.getLeafTargetEl(leaf);

			const metadata = this.app.metadataCache.getFileCache(file);
			if (!metadata) {
				// Metadata cache not populated yet for this file. This happens when a
				// note is opened before Obsidian finishes parsing it. Don't strip the
				// existing color, and schedule a retry in case the metadataCache
				// 'changed' event does not fire (e.g. the cache is reused/unchanged).
				needsRetry = true;
				if (targetEl) protectedElements.add(targetEl);
				return;
			}

			// metadata exists but has no frontmatter: the file genuinely has no
			// frontmatter, so remove any stale color.
			if (!metadata.frontmatter) {
				this.removeBackgroundColorFromLeaf(leaf);
				return;
			}

			const matchResult = this.findMatchingColorMappings(metadata.frontmatter);
			const colorMapping = matchResult.selected?.mapping;

			if (colorMapping) {
				this.notifyIfMultipleMappingsMatch(file, matchResult.matches);

				const color = this.getMappingColor(colorMapping);
				if (color && this.isValidColor(color)) {
					this.applyBackgroundColorToLeaf(leaf, color);
					if (targetEl) protectedElements.add(targetEl);
				} else {
					// Invalid color - remove any existing color
					this.removeBackgroundColorFromLeaf(leaf);
				}
			} else {
				// No mapping matches - remove color from this leaf
				this.removeBackgroundColorFromLeaf(leaf);
			}
		});

		// Sweep away stale styles left on elements that are no longer active
		// markdown leaves (e.g. closed panes, views switched to non-markdown),
		// without touching elements we are intentionally keeping colored.
		this.removeStaleStyles(protectedElements);

		// Only schedule a retry if one isn't already in flight. Multiple workspace
		// events can fire in quick succession while a note's metadata is still
		// parsing; without this guard each would spawn its own overlapping retry
		// chain doing redundant full-workspace scans.
		if (needsRetry && retriesLeft > 0 && this.pendingRetryHandles.size === 0) {
			const handle = window.setTimeout(() => {
				this.pendingRetryHandles.delete(handle);
				this.applyColorsToAllLeaves(retriesLeft - 1);
			}, 100);
			this.pendingRetryHandles.add(handle);
		}
	}

	private getLeafTargetEl(leaf: WorkspaceLeaf): HTMLElement | null {
		const targetEl = leaf.view.containerEl.querySelector('.workspace-leaf-content[data-type="markdown"]') ?? leaf.view.containerEl;
		return targetEl.instanceOf(HTMLElement) ? targetEl : null;
	}

	private getMappingColor(mapping: PropertyColorMapping): string {
		if (this.isDarkTheme) {
			return mapping.isAutoDark ? DEFAULT_DARK_AUTO_COLOR : mapping.colorDark;
		}

		return mapping.isAutoLight ? DEFAULT_LIGHT_AUTO_COLOR : mapping.colorLight;
	}

	private findMatchingColorMappings(frontmatter: Frontmatter): { selected: ColorMappingMatch | null; matches: ColorMappingMatch[] } {
		const matches: ColorMappingMatch[] = [];

		this.settings.colorMappings.forEach((mapping, index) => {
			const propertyValue = frontmatter[mapping.property];

			if (propertyValue === undefined || propertyValue === null) return;

			if (mapping.matchType === 'exact') {
				if (Array.isArray(propertyValue)) {
					if (propertyValue.length === 1 && String(propertyValue[0]) === mapping.value) {
						matches.push({ mapping, index, propertyValue });
					}
				} else if (String(propertyValue) === mapping.value) {
					matches.push({ mapping, index, propertyValue });
				}
			} else if (mapping.matchType === 'contains') {
				if (Array.isArray(propertyValue)) {
					if (propertyValue.map(String).includes(mapping.value)) {
						matches.push({ mapping, index, propertyValue });
					}
				} else {
					if (String(propertyValue).includes(mapping.value)) {
						matches.push({ mapping, index, propertyValue });
					}
				}
			}
		});

		return {
			selected: matches.length > 0 ? matches[matches.length - 1] : null,
			matches
		};
	}

	private notifyIfMultipleMappingsMatch(file: TFile, matches: ColorMappingMatch[]) {
		if (!this.settings.notifyOnMultipleMatches || matches.length <= 1) return;

		const matchSignature = matches.map(match => match.index).join(',');
		const noticeKey = `${file.path}:${matchSignature}`;
		if (this.multipleMatchNoticeKeys.has(noticeKey)) return;

		this.multipleMatchNoticeKeys.add(noticeKey);
		const selectedMatch = matches[matches.length - 1];
		const matchedRules = matches
			.map(match => `#${match.index + 1} ${match.mapping.property} ${match.mapping.matchType} ${match.mapping.value}`)
			.join('; ');

		new Notice(
			`Page Color Prop: ${matches.length} rules match "${file.basename}". Using lowest rule #${selectedMatch.index + 1}. Matched: ${matchedRules}. Mute in settings.`,
			10000
		);
	}

	private applyBackgroundColorToLeaf(leaf: WorkspaceLeaf, color: string) {
		if (!this.isValidColor(color)) {
			return;
		}

		const targetEl = this.getLeafTargetEl(leaf);
		if (!targetEl) return;

		targetEl.addClass('page-color-prop-active');
		targetEl.style.setProperty('--page-color-prop-background', color);
	}

	private removeBackgroundColorFromLeaf(leaf: WorkspaceLeaf) {
		const targetEl = this.getLeafTargetEl(leaf);
		if (!targetEl) return;

		targetEl.removeClass('page-color-prop-active');
		targetEl.style.removeProperty('--page-color-prop-background');
	}

	private removeStaleStyles(protectedElements: Set<HTMLElement>) {
		document.querySelectorAll('.page-color-prop-active').forEach(el => {
			if (el.instanceOf(HTMLElement) && !protectedElements.has(el)) {
				el.removeClass('page-color-prop-active');
				el.style.removeProperty('--page-color-prop-background');
			}
		});
	}

	private removeAllStyles() {
		this.removeStaleStyles(new Set());
	}

	isValidColor(color: string): boolean {
		if (!color || typeof color !== 'string') {
			return false;
		}

		if (/[;{}<>]/.test(color)) {
			return false;
		}

		return CSS.supports('background-color', color);
	}
}
