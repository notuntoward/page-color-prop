import { MarkdownView, Notice, Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import {
	PageColorPropSettings,
	DEFAULT_SETTINGS,
	PageColorPropSettingTab,
	PropertyColorMapping
} from './settings';
import { DEFAULT_LINK_TUNING } from './color-optimizer';
import { LinkDecorator } from './link-decorator';
import { computeAutoRuleColors, findMatchingColorMappings } from './link-color-service';
import { buildPageColorPropLivePreviewExtension, forceRecomputeEffect } from './live-preview-links';

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
	isDarkTheme: boolean = false;
	private themeObserver: MutationObserver | null = null;
	private multipleMatchNoticeKeys: Set<string> = new Set();
	private pendingRetryHandles: Set<number> = new Set();
	linkDecorator: LinkDecorator | null = null;

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

		// Initialize link decoration.
		this.linkDecorator = new LinkDecorator(this);
		this.linkDecorator.invalidateCaches();
		this.linkDecorator.observeDocument();
		this.registerMarkdownPostProcessor((el, ctx) => {
			this.linkDecorator?.decorateLinksInContainer(el, ctx.sourcePath, 'a.internal-link');
		});
		// CodeMirror 6 Live Preview extension.
		this.registerEditorExtension(buildPageColorPropLivePreviewExtension(this));
		this.app.workspace.onLayoutReady(() => {
			this.installViewObservers();
		});

		// Re-decorate on layout changes.
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				this.installViewObservers();
			})
		);
	}

	onunload() {
		this.removeAllStyles();
		this.clearPendingRetries();
		if (this.themeObserver) {
			this.themeObserver.disconnect();
		}
		if (this.linkDecorator) {
			this.linkDecorator.dispose();
			this.linkDecorator = null;
		}
	}

	private installViewObservers() {
		if (!this.linkDecorator) return;
		// File explorer, backlinks, outgoing links, search, bookmarks,
		// starred, file properties, recent files — all share the
		// workspace-ribbon / left-sidebar / right-sidebar containers.
		const selectors = [
			'.workspace-leaf-content[data-type="file-explorer"]',
			'.workspace-leaf-content[data-type="backlink"]',
			'.workspace-leaf-content[data-type="outgoing-link"]',
			'.workspace-leaf-content[data-type="search"]',
			'.workspace-leaf-content[data-type="bookmarks"]',
			'.workspace-leaf-content[data-type="starred"]',
			'.workspace-leaf-content[data-type="recent-files"]',
			'.workspace-leaf-content[data-type="file-properties"]'
		];
		for (const sel of selectors) {
			document.querySelectorAll(sel).forEach((node) => {
				if (node.instanceOf(HTMLElement)) {
					this.linkDecorator!.observeContainer(
						node,
						'',
						'.tree-item-inner, .nav-file-title-content, .metadata-link-inner, .multi-select-pill-content'
					);
				}
			});
		}
	}

	/** Refresh all link decorations. Called after settings/theme/metadata changes. */
	public refreshLinkDecorations() {
		if (this.linkDecorator) {
			this.linkDecorator.invalidateCaches();
			this.linkDecorator.refreshAllVisible();
		}
		this.dispatchLivePreviewRecompute();
	}

	private linkDecoratorVersion = 0;

	private dispatchLivePreviewRecompute() {
		const version = ++this.linkDecoratorVersion;
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			if (!(leaf.view instanceof MarkdownView)) continue;
			const cmView = (leaf.view.editor as any)?.cm;
			if (cmView && typeof cmView.dispatch === 'function') {
				cmView.dispatch({ effects: forceRecomputeEffect.of(version) });
			}
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
				notifyOnMultipleMatches: loadedData.notifyOnMultipleMatches ?? DEFAULT_SETTINGS.notifyOnMultipleMatches,
				colorTabText: loadedData.colorTabText ?? DEFAULT_SETTINGS.colorTabText,
				colorLinks: loadedData.colorLinks ?? DEFAULT_SETTINGS.colorLinks,
				experimentalLinkTuning: { ...DEFAULT_LINK_TUNING, ...(loadedData.experimentalLinkTuning ?? {}) }
			};
		}

		this.migrateSettings();
	}

	private isValidMapping(mapping: unknown): mapping is PropertyColorMapping {
		if (!mapping || typeof mapping !== 'object') return false;

		const candidate = mapping as Partial<PropertyColorMapping>;
		return typeof candidate.id === 'string' && candidate.id.length > 0 &&
			typeof candidate.property === 'string' &&
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

			// Migrate link-color fields: default to auto-mode (empty stored
			// hex; the optimizer will fill it in on first display()).
			if (mapping.linkColorLight === undefined) {
				mapping.linkColorLight = '';
				needsSave = true;
			}
			if (mapping.linkColorDark === undefined) {
				mapping.linkColorDark = '';
				needsSave = true;
			}
			if (mapping.isAutoLinkLight === undefined) {
				mapping.isAutoLinkLight = true;
				needsSave = true;
			}
			if (mapping.isAutoLinkDark === undefined) {
				mapping.isAutoLinkDark = true;
				needsSave = true;
			}
		});

		if (this.settings.notifyOnMultipleMatches === undefined) {
			this.settings.notifyOnMultipleMatches = DEFAULT_SETTINGS.notifyOnMultipleMatches;
			needsSave = true;
		}

		if (this.settings.colorTabText === undefined) {
			this.settings.colorTabText = DEFAULT_SETTINGS.colorTabText;
			needsSave = true;
		}

		if (this.settings.colorLinks === undefined) {
			this.settings.colorLinks = DEFAULT_SETTINGS.colorLinks;
			needsSave = true;
		}

		if (!this.settings.experimentalLinkTuning) {
			this.settings.experimentalLinkTuning = { ...DEFAULT_LINK_TUNING };
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
		try {
			this.applyColorsToAllLeaves();
		} catch (e) {
			console.error('Page Color Prop: error applying colors', e);
		}
		try {
			this.refreshLinkDecorations();
		} catch (e) {
			console.error('Page Color Prop: error refreshing link decorations', e);
		}
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
						this.refreshLinkDecorations();
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
		// Invalidate this file's cache entry and refresh visible link
		// decorations. Other rules' colors are unchanged, so we just
		// redecorate; theme is unchanged, so caches only need clearing
		// for this file.
		if (this.linkDecorator) {
			this.linkDecorator.invalidateCaches();
			this.linkDecorator.refreshAllVisible();
		}
	}

	private onLayoutChange() {
		// When layout changes (split, close pane, etc.), reapply colors
		this.applyColorsToAllLeaves();
		this.installViewObservers();
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
		const protectedTabs = new Set<HTMLElement>();

		leaves.forEach((leaf) => {
			try {
				if (!(leaf.view instanceof MarkdownView)) return;

				const file = leaf.view.file;
				if (!file) return;

				const targetEl = this.getLeafTargetEl(leaf);
				const tabEl = this.getLeafTabEl(leaf);

				const metadata = this.app.metadataCache.getFileCache(file);
				if (!metadata) {
					// Metadata cache not populated yet for this file. This happens when a
					// note is opened before Obsidian finishes parsing it. Don't strip the
					// existing color, and schedule a retry in case the metadataCache
					// 'changed' event does not fire (e.g. the cache is reused/unchanged).
					needsRetry = true;
					if (targetEl) protectedElements.add(targetEl);
					if (tabEl) protectedTabs.add(tabEl);
					return;
				}

				// metadata exists but has no frontmatter: the file genuinely has no
				// frontmatter, so remove any stale color.
				if (!metadata.frontmatter) {
					this.removeColorsFromLeaf(leaf);
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
						if (tabEl) {
							this.applyTabColorToLeaf(leaf, colorMapping);
							protectedTabs.add(tabEl);
						}
					} else {
						// Invalid color - remove any existing color
						this.removeColorsFromLeaf(leaf);
					}
				} else {
					// No mapping matches - remove color from this leaf
					this.removeColorsFromLeaf(leaf);
				}
			} catch (e) {
				console.error('Page Color Prop: error coloring leaf', e);
			}
		});

		// Sweep away stale styles left on elements that are no longer active
		// markdown leaves (e.g. closed panes, views switched to non-markdown),
		// without touching elements we are intentionally keeping colored.
		this.removeStaleStyles(protectedElements, protectedTabs);

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

	private getLeafTabEl(leaf: WorkspaceLeaf): HTMLElement | null {
		try {
			const tabEl = (leaf as any).tabHeaderEl;
			if (!tabEl) return null;
			return tabEl.instanceOf(HTMLElement) ? tabEl : null;
		} catch {
			return null;
		}
	}

	private getMappingColor(mapping: PropertyColorMapping): string {
		// Resolve through the shared rule-color resolver so the page
		// background, the link decoration, the tab text, and the
		// settings preview all derive their automatic colors from the
		// same palette base.
		return this.getMappingBackgroundColor(mapping) ?? '';
	}

	/**
	 * Resolves the page background color for a single mapping in the
	 * current theme. Manual colors pass through untouched. Automatic
	 * colors are produced by the same shared resolver
	 * (`computeAutoRuleColors`) that powers the link decoration, so
	 * the runtime tint and the runtime link stay in the same color
	 * family.
	 */
	private getMappingBackgroundColor(mapping: PropertyColorMapping): string | null {
		const isLight = !this.isDarkTheme;

		if (isLight && !mapping.isAutoLight) {
			return mapping.colorLight;
		}

		if (!isLight && !mapping.isAutoDark) {
			return mapping.colorDark;
		}

		const themeVars = this.linkDecorator?.getThemeVarsForSharedUse();
		if (!themeVars) return null;

		const otherManualLinkHexes: string[] = [];
		for (const m of this.settings.colorMappings) {
			if (m === mapping) continue;
			const otherIsAuto = isLight ? m.isAutoLinkLight : m.isAutoLinkDark;
			if (otherIsAuto) continue;
			const otherHex = isLight ? m.linkColorLight : m.linkColorDark;
			if (otherHex) otherManualLinkHexes.push(otherHex);
		}

		return computeAutoRuleColors(
			mapping,
			this.settings.colorMappings,
			isLight ? 'Light' : 'Dark',
			themeVars,
			otherManualLinkHexes,
			this.settings.experimentalLinkTuning
		).backgroundHex;
	}

	private findMatchingColorMappings(frontmatter: Frontmatter): { selected: ColorMappingMatch | null; matches: ColorMappingMatch[] } {
		return findMatchingColorMappings(this.settings.colorMappings, frontmatter) as {
			selected: ColorMappingMatch | null;
			matches: ColorMappingMatch[];
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

	private applyTabColorToLeaf(leaf: WorkspaceLeaf, mapping: PropertyColorMapping) {
		if (!this.settings.colorTabText || !this.linkDecorator) {
			// Setting is off or decorator unavailable: actively remove any existing
			// tab color rather than leaving stale styling in place. This mirrors how
			// removeBackgroundColorFromLeaf works — when a color shouldn't be applied,
			// we explicitly clear it instead of just skipping.
			this.removeTabColorFromLeaf(leaf);
			return;
		}

		try {
			const tabEl = this.getLeafTabEl(leaf);
			if (!tabEl) return;

			const color = this.linkDecorator.getResolvedLinkColor(mapping);
			if (!color) {
				this.removeTabColorFromLeaf(leaf);
				return;
			}

			tabEl.addClass('page-color-prop-tab');
			tabEl.style.setProperty('--page-color-prop-tab-color', color);
		} catch (e) {
			console.error('Page Color Prop: error applying tab color', e);
		}
	}

	private removeTabColorFromLeaf(leaf: WorkspaceLeaf) {
		const tabEl = this.getLeafTabEl(leaf);
		if (!tabEl) return;

		tabEl.removeClass('page-color-prop-tab');
		tabEl.style.removeProperty('--page-color-prop-tab-color');
	}

	private removeColorsFromLeaf(leaf: WorkspaceLeaf) {
		this.removeBackgroundColorFromLeaf(leaf);
		this.removeTabColorFromLeaf(leaf);
	}

	private removeStaleStyles(protectedElements: Set<HTMLElement>, protectedTabs: Set<HTMLElement> = new Set()) {
		document.querySelectorAll('.page-color-prop-active').forEach(el => {
			if (el.instanceOf(HTMLElement) && !protectedElements.has(el)) {
				el.removeClass('page-color-prop-active');
				el.style.removeProperty('--page-color-prop-background');
			}
		});

		document.querySelectorAll('.page-color-prop-tab').forEach(el => {
			if (el.instanceOf(HTMLElement) && !protectedTabs.has(el)) {
				el.removeClass('page-color-prop-tab');
				el.style.removeProperty('--page-color-prop-tab-color');
			}
		});
	}

	private removeAllStyles() {
		this.removeStaleStyles(new Set(), new Set());
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
