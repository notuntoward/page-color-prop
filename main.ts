import { getTabHeaderEl } from 'commons/internals';
import { forEachWindow, setTimeoutIn, type CancelTimer } from 'commons/windows';
import { getOpenWindows } from 'commons/workspace';
import { FileView, MarkdownView, Notice, Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import {
	PageColorPropSettings,
	DEFAULT_SETTINGS,
	PageColorPropSettingTab,
	PropertyColorMapping,
	DEFAULT_RULE_BASE_COLOR
} from './settings';
import { DEFAULT_LINK_TUNING } from './color-optimizer';
import { LinkDecorator } from './link-decorator';
import { computeAutoRuleColors, findMatchingColorMappings, getRuleMatchProperties } from './link-color-service';
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
	private fileExplorerObservers: MutationObserver[] = [];
	private multipleMatchNoticeKeys: Set<string> = new Set();
	private pendingRetryHandles: Set<CancelTimer> = new Set();
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
			this.app.metadataCache.on('resolved', () => {
				this.linkDecorator?.invalidateCaches();
				this.updateFileExplorerColors();
				this.updateAllTabHeaderColors();
				this.applyColorsToAllLeaves();
			})
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
		this.linkDecorator.observeDocument(true);
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
				this.installFileExplorerObserver();
				this.updateFileExplorerColors();
				this.updateAllTabHeaderColors();
			})
		);

		this.app.workspace.onLayoutReady(() => {
			this.installViewObservers();
			this.updateFileExplorerColors();
			this.updateAllTabHeaderColors();
			this.installFileExplorerObserver();
		});
	}

	private installFileExplorerObserver(): void {
		if (this.fileExplorerObservers?.length > 0) {
			this.fileExplorerObservers.forEach((obs) => obs.disconnect());
			this.fileExplorerObservers = [];
		}

		for (const win of getOpenWindows(this.app)) {
			const doc = win.document;
			if (!doc) continue;
			const navContainers = doc.querySelectorAll<HTMLElement>('.nav-files-container');
			navContainers.forEach((navContainer) => {
				const obs = new MutationObserver(() => {
					this.updateFileExplorerColors();
				});
				obs.observe(navContainer, { childList: true, subtree: true });
				this.fileExplorerObservers.push(obs);
			});
		}
	}

	onunload() {
		this.removeAllStyles();
		this.clearPendingRetries();
		if (this.themeObserver) {
			this.themeObserver.disconnect();
		}
		if (this.fileExplorerObservers.length > 0) {
			this.fileExplorerObservers.forEach((obs) => obs.disconnect());
			this.fileExplorerObservers = [];
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
		for (const win of getOpenWindows(this.app)) {
			const doc = win.document;
			if (!doc) continue;
			for (const sel of selectors) {
				doc.querySelectorAll(sel).forEach((node) => {
					if (node.instanceOf(HTMLElement)) {
						this.linkDecorator!.observeContainer(
							node,
							'',
							'.tree-item-inner, .nav-file-title-content, .metadata-link-inner, .multi-select-pill-content',
							true
						);
					}
				});
			}
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
		this.pendingRetryHandles.forEach(cancel => cancel());
		this.pendingRetryHandles.clear();
	}

	private scheduleRetry(callback: () => void, delay: number): void {
		let cancel: CancelTimer;
		cancel = setTimeoutIn(activeWindow, () => {
			this.pendingRetryHandles.delete(cancel);
			callback();
		}, delay);
		this.pendingRetryHandles.add(cancel);
	}

	async loadSettings() {
		const loadedData = await this.loadData() as Partial<PageColorPropSettings> | null;

		if (!loadedData || !Array.isArray(loadedData.colorMappings)) {
			this.settings = { ...DEFAULT_SETTINGS, colorMappings: [] };
		} else {
			this.settings = {
				colorMappings: loadedData.colorMappings.filter(this.isValidMapping),
				notifyOnMultipleMatches: loadedData.notifyOnMultipleMatches ?? DEFAULT_SETTINGS.notifyOnMultipleMatches,
				colorUiLabels: loadedData.colorUiLabels ?? (loadedData as any).colorTabText ?? DEFAULT_SETTINGS.colorUiLabels,
				colorLinks: loadedData.colorLinks ?? DEFAULT_SETTINGS.colorLinks,
				experimentalLinkTuning: { ...DEFAULT_LINK_TUNING }
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
			if (!mapping.baseColor) {
				mapping.baseColor = DEFAULT_RULE_BASE_COLOR;
				needsSave = true;
			}

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

		if (this.settings.colorUiLabels === undefined) {
			this.settings.colorUiLabels = DEFAULT_SETTINGS.colorUiLabels;
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

	private updateThemeState(doc: Document = activeDocument) {
		this.isDarkTheme = doc.body.classList.contains('theme-dark');
	}

	private registerThemeChangeListener() {
		const themeConfig: MutationObserverInit = {
			attributes: true,
			attributeFilter: ['class'],
			attributeOldValue: true
		};

		forEachWindow(this, (win) => {
			const body = win.document?.body;
			if (!body) return;
			const obs = new MutationObserver((mutations) => {
				for (const mutation of mutations) {
					if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
						const wasLight = !this.isDarkTheme;
						this.updateThemeState(win.document);
						const isNowLight = !this.isDarkTheme;

						if (wasLight !== isNowLight) {
							this.applyColorsToAllLeaves();
							this.refreshLinkDecorations();
						}
					}
				}
			});
			obs.observe(body, themeConfig);
			return () => obs.disconnect();
		});
	}

	private onActiveLeafChange(leaf: WorkspaceLeaf | null) {
		this.applyColorsToAllLeaves();
	}

	private onMetadataChanged(file: TFile) {
		if (this.linkDecorator) {
			this.linkDecorator.invalidateCaches();
			this.linkDecorator.refreshAllVisible();
		}
		this.applyColorsToAllLeaves();
		this.updateFileExplorerColors();
		this.updateAllTabHeaderColors();
	}

	private onLayoutChange() {
		this.applyColorsToAllLeaves();
		this.updateFileExplorerColors();
		this.updateAllTabHeaderColors();
		this.installViewObservers();
	}

	private onFileOpen() {
		this.applyColorsToAllLeaves();
		this.updateAllTabHeaderColors();
	}

	public applyColorsToAllLeaves(retriesLeft: number = 3) {
		this.updateFileExplorerColors();
		this.updateAllTabHeaderColors();

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

				const matchResult = this.findMatchingColorMappings(getRuleMatchProperties(metadata));
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
			this.scheduleRetry(() => this.applyColorsToAllLeaves(retriesLeft - 1), 100);
		}
	}

	private getLeafTargetEl(leaf: WorkspaceLeaf): HTMLElement | null {
		const targetEl = leaf.view.containerEl.querySelector('.workspace-leaf-content[data-type="markdown"]') ?? leaf.view.containerEl;
		return targetEl.instanceOf(HTMLElement) ? targetEl : null;
	}

	private getLeafTabEl(leaf: WorkspaceLeaf): HTMLElement | null {
		return getTabHeaderEl(leaf);
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
		if (!this.settings.colorUiLabels || !this.linkDecorator) {
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

			const color = this.linkDecorator.getResolvedLinkColor(mapping, true);
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
		for (const win of getOpenWindows(this.app)) {
			const doc = win.document;
			if (!doc) continue;
			doc.querySelectorAll('.page-color-prop-active').forEach(el => {
				if (el.instanceOf(HTMLElement) && !protectedElements.has(el)) {
					el.removeClass('page-color-prop-active');
					el.style.removeProperty('--page-color-prop-background');
				}
			});

			doc.querySelectorAll('.page-color-prop-tab').forEach(el => {
				if (el.instanceOf(HTMLElement) && !protectedTabs.has(el)) {
					el.removeClass('page-color-prop-tab');
					el.style.removeProperty('--page-color-prop-tab-color');
				}
			});
		}
	}

	private removeAllStyles() {
		this.removeStaleStyles(new Set(), new Set());
	}

	private updateFileExplorerColors(retriesLeft: number = 3): void {
		const explorerLeaves = this.app.workspace.getLeavesOfType('file-explorer');
		if (!explorerLeaves.length) return;

		let hasUncachedFiles = false;

		for (const leaf of explorerLeaves) {
			const container = leaf.view?.containerEl;
			if (!container || !container.instanceOf(HTMLElement)) continue;

			const fileItems = container.querySelectorAll<HTMLElement>('.tree-item-self[data-path], .nav-file-title[data-path]');

			fileItems.forEach((el) => {
				const filePath = el.getAttribute('data-path');
				if (!filePath) return;

				const abstractFile = this.app.vault.getAbstractFileByPath(filePath);
				if (!abstractFile || !(abstractFile instanceof TFile)) return;

				if (!this.app.metadataCache.getFileCache(abstractFile)) {
					hasUncachedFiles = true;
				}

				const mapping = this.linkDecorator?.getMatchingMappingForFile(abstractFile);
				const color = mapping ? this.linkDecorator?.getResolvedLinkColor(mapping, true) : null;

				if (color) {
					el.style.setProperty('--page-color-prop-link-color', color);
					el.style.setProperty('--page-color', color);
					el.addClass('page-color-prop-link');
					el.addClass('has-page-color');
				} else {
					el.style.removeProperty('--page-color-prop-link-color');
					el.style.removeProperty('--page-color');
					el.removeClass('page-color-prop-link');
					el.removeClass('has-page-color');
				}
			});
		}

		if (hasUncachedFiles && retriesLeft > 0 && this.pendingRetryHandles.size === 0) {
			this.scheduleRetry(() => this.updateFileExplorerColors(retriesLeft - 1), 250);
		}
	}

	private updateAllTabHeaderColors(): void {
		this.app.workspace.iterateAllLeaves((leaf) => {
			const tabHeaderEl = getTabHeaderEl(leaf);
			if (!tabHeaderEl) return;

			const file = leaf.view instanceof FileView ? leaf.view.file : null;

			if (file) {
				tabHeaderEl.setAttribute('data-path', file.path);
				const mapping = this.linkDecorator?.getMatchingMappingForFile(file);
				const color = mapping ? this.linkDecorator?.getResolvedLinkColor(mapping, true) : null;

				if (color) {
					tabHeaderEl.style.setProperty('--page-color-prop-tab-color', color);
					tabHeaderEl.style.setProperty('--page-color', color);
					tabHeaderEl.addClass('page-color-prop-tab');
					tabHeaderEl.addClass('has-page-color');
				} else {
					this.removeTabColorFromElement(tabHeaderEl);
				}
			} else {
				this.removeTabColorFromElement(tabHeaderEl);
			}
		});
	}

	private removeTabColorFromElement(el: HTMLElement): void {
		el.style.removeProperty('--page-color-prop-tab-color');
		el.style.removeProperty('--page-color');
		el.removeClass('page-color-prop-tab');
		el.removeClass('has-page-color');
	}

	/**
	 * Returns the resolved color for a file or path, or null if no mapping matches.
	 */
	public getFileColor(file: TFile | string): string | null {
		let tfile: TFile | null = null;
		if (typeof file === 'string') {
			const abs = this.app.vault.getAbstractFileByPath(file);
			if (abs instanceof TFile) {
				tfile = abs;
			} else {
				const dest = this.app.metadataCache.getFirstLinkpathDest(file, '');
				if (dest instanceof TFile) {
					tfile = dest;
				}
			}
		} else if (file instanceof TFile) {
			tfile = file;
		}
		if (!tfile) return null;
		const mapping = this.linkDecorator?.getMatchingMappingForFile(tfile);
		return (mapping && this.linkDecorator ? this.linkDecorator.getResolvedLinkColor(mapping, true) : null) ?? null;
	}

	/**
	 * Applies the resolved page color of a file to an element and returns the color (or null).
	 */
	public applyFileColor(el: HTMLElement, file: TFile | string): string | null {
		const color = this.getFileColor(file);
		if (color) {
			el.style.setProperty('--page-color-prop-link-color', color);
			el.style.setProperty('--page-color', color);
			el.style.color = color;
			el.addClass('page-color-prop-link');
			el.addClass('has-page-color');
			return color;
		} else {
			el.style.removeProperty('--page-color-prop-link-color');
			el.style.removeProperty('--page-color');
			el.style.removeProperty('color');
			el.removeClass('page-color-prop-link');
			el.removeClass('has-page-color');
			return null;
		}
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
