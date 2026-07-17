// ============================================================================
// link-decorator.ts
// ============================================================================
// PURPOSE: Decorates rendered link elements with the per-rule link color
// when the link's destination note matches a Page Color Prop rule.
//
// SCOPE: Adds ONLY its own class, data attribute, and CSS custom property
// to the element. Never touches theme, supercharged-links, or other plugin
// decorations. Never removes anything except its own properties.
//
// CONTEXTS SUPPORTED:
//   * Markdown reading view (via registerMarkdownPostProcessor)
//   * CodeMirror 6 live preview (via live-preview-links.ts)
//   * View containers observed by MutationObserver (file explorer,
//     backlinks, outgoing links, search, file properties, etc.)
//   * Suggestion popups (quick switcher / note completion)
//
// THEME: All decoration is theme-aware. A separate color is stored per
// rule per theme (light + dark); the active theme is consulted at
// decoration time, not at rule-save time, so switching themes works
// without re-saving settings.
// ============================================================================

import { TFile, getLinkpath } from 'obsidian';
import type PageColorPropPlugin from './main';
import type { PropertyColorMapping } from './settings';
import {
	computeAutoRuleColors,
	findMatchingColorMappings,
	readBothThemeVars,
	type ThemeCssVars
} from './link-color-service';

const PAGE_COLOR_PROP_LINK_CLASS = 'page-color-prop-link';
const DATA_ATTR = 'data-page-color-prop-link-rule';
const CSS_VAR = '--page-color-prop-link-color';

/** Selectors that contain a navigable link to a vault note. */
const DEFAULT_CONTAINER_SELECTORS = [
	'a.internal-link',
	'.tree-item-inner',
	'.nav-file-title-content',
	'.metadata-link-inner',
	'.multi-select-pill-content',
	'.suggestion-title',
	'.suggestion-note'
];

export class LinkDecorator {
	/** Per-target cache: file path -> (mappingIndex | null) at linkStyleVersion. */
	private matchCache = new Map<string, { index: number | null; version: number }>();
	private linkStyleVersion = 0;
	private themeVars: ThemeCssVars | null = null;
	private readonly observers: Map<HTMLElement, MutationObserver> = new Map();
	private readonly observedRoots: WeakSet<Document | HTMLElement> = new WeakSet();
	/** Document-level observer to catch modal/popup mountings (suggestion popups). */
	private documentObserver: MutationObserver | null = null;

	constructor(private readonly plugin: PageColorPropPlugin) {}

	/**
	 * Invalidate all per-target caches and bump the style version. Call after:
	 *   * settings change (any rule color, auto-mode toggle, match criterion)
	 *   * theme change
	 */
	public invalidateCaches() {
		this.matchCache.clear();
		this.linkStyleVersion++;
		this.themeVars = readBothThemeVars();
	}

	/** Returns the cached theme vars, reading them if they were never read. */
	private getThemeVars(): ThemeCssVars | null {
		if (!this.themeVars) {
			this.themeVars = readBothThemeVars();
		}
		return this.themeVars;
	}

	/**
	 * Public read-only access to the cached theme variables. Used by
	 * the page background path in main.ts so it can resolve the same
	 * automatic pair that the link decoration uses, without poking at
	 * private internals.
	 */
	public getThemeVarsForSharedUse(): ThemeCssVars | null {
		return this.getThemeVars();
	}

	/**
	 * Find the matching mapping for `file` (or null if no rule matches).
	 * Result is cached per file path until caches are invalidated.
	 */
	public getMatchingMappingForFile(file: TFile): PropertyColorMapping | null {
		const cache = this.matchCache.get(file.path);
		if (cache && cache.version === this.linkStyleVersion) {
			if (cache.index === null) return null;
			return this.plugin.settings.colorMappings[cache.index] ?? null;
		}

		const fileCache = this.plugin.app.metadataCache.getFileCache(file);
		const frontmatter = fileCache?.frontmatter;
		if (!frontmatter) {
			this.matchCache.set(file.path, { index: null, version: this.linkStyleVersion });
			return null;
		}

		const result = findMatchingColorMappings(this.plugin.settings.colorMappings, frontmatter);
		const idx = result.selected?.index ?? null;
		this.matchCache.set(file.path, { index: idx, version: this.linkStyleVersion });
		return idx === null ? null : this.plugin.settings.colorMappings[idx] ?? null;
	}

	/** Compute the resolved link color for `mapping` in the current theme. */
	public getResolvedLinkColor(mapping: PropertyColorMapping): string | null {
		// The "Color links" setting is the global switch for link tinting.
		// Honor it here so every caller — the reading-view postprocessor,
		// the view observers, and the CodeMirror Live Preview extension —
		// stops coloring links when it is off, not just the ones that go
		// through decorateLink's own early-return.
		if (!this.plugin.settings.colorLinks) {
			return null;
		}

		const isLight = !this.plugin.isDarkTheme;
		const isAuto = isLight ? mapping.isAutoLinkLight : mapping.isAutoLinkDark;
		if (!isAuto) {
			return isLight ? mapping.linkColorLight : mapping.linkColorDark;
		}

		const themeVars = this.getThemeVars();
		if (!themeVars) return null;

		// Gather other rules' resolved link colors for the active theme, so
		// the optimizer can avoid colliding with them.
		const otherHexes: string[] = [];
		for (const m of this.plugin.settings.colorMappings) {
			if (m === mapping) continue;
			const otherIsAuto = isLight ? m.isAutoLinkLight : m.isAutoLinkDark;
			if (otherIsAuto) {
				// We deliberately skip computing OTHER rules' auto colors here
				// to avoid an N^2 cascade. The optimizer's collision check
				// against this rule's own output is still enforced; a rule
				// with a stored manual color will be included.
				continue;
			}
			const otherHex = isLight ? m.linkColorLight : m.linkColorDark;
			if (otherHex) otherHexes.push(otherHex);
		}

		try {
			return computeAutoRuleColors(
				mapping,
				this.plugin.settings.colorMappings,
				isLight ? 'Light' : 'Dark',
				themeVars,
				otherHexes,
				this.plugin.settings.experimentalLinkTuning
			).linkHex;
		} catch (e) {
			console.error('Page Color Prop: failed to compute auto link color', e);
			return null;
		}
	}

	/** Look up the mapping index for a given mapping object. */
	public getMappingIndex(mapping: PropertyColorMapping): number {
		return this.plugin.settings.colorMappings.indexOf(mapping);
	}

	/**
	 * Resolve the destination TFile for a link element. Walks up the DOM
	 * looking for a `data-path`/`data-href`/`href` so file-list entries
	 * (where the visible text is an alias) resolve correctly.
	 */
	public resolveTarget(
		element: HTMLElement,
		sourcePath: string,
		explicitLinkName?: string
	): TFile | null {
		const raw = this.extractLinkText(element, explicitLinkName);
		if (!raw) return null;

		// Strip alias, anchor, and embeds.
		const pipe = raw.indexOf('|');
		const cleaned = (pipe >= 0 ? raw.substring(0, pipe) : raw)
			.replace(/#.*$/, '')
			.replace(/\^.*$/, '')
			.trim();
		if (!cleaned) return null;

		const linkPath = getLinkpath(cleaned);
		if (!linkPath) return null;

		return this.plugin.app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath);
	}

	/** Read a usable link text from the element, walking up the DOM. */
	private extractLinkText(element: HTMLElement, explicitLinkName?: string): string {
		if (explicitLinkName) return explicitLinkName;

		// Try the element itself first.
		const fromSelf =
			element.getAttribute('data-href') ??
			element.getAttribute('href') ??
			element.textContent ??
			'';
		if (this.looksLikePath(fromSelf)) return fromSelf;

		// Walk up looking for a data-path on a parent (file-list / search rows).
		let parent: HTMLElement | null = element.parentElement;
		for (let i = 0; parent && i < 4; i++) {
			const fromParent =
				parent.getAttribute('data-path') ??
				parent.getAttribute('data-href') ??
				parent.getAttribute('href');
			if (fromParent && this.looksLikePath(fromParent)) return fromParent;
			parent = parent.parentElement;
		}
		return fromSelf;
	}

	private looksLikePath(s: string): boolean {
		if (!s) return false;
		// A bare "Note Name" suggestion title is also a valid target, so we
		// accept anything non-empty and let Obsidian's getFirstLinkpathDest
		// disambiguate.
		return s.trim().length > 0;
	}

	/** Apply the Page Color Prop decoration to one link element. */
	public decorateLink(
		element: HTMLElement,
		sourcePath: string,
		explicitLinkName?: string
	): void {
		if (!element.instanceOf(HTMLElement)) return;
		if (!this.plugin.settings.colorLinks) {
			this.clearDecoration(element);
			return;
		}
		const target = this.resolveTarget(element, sourcePath, explicitLinkName);
		if (!target) {
			this.clearDecoration(element);
			return;
		}
		const mapping = this.getMatchingMappingForFile(target);
		if (!mapping) {
			this.clearDecoration(element);
			return;
		}
		const color = this.getResolvedLinkColor(mapping);
		if (!color) {
			this.clearDecoration(element);
			return;
		}
		element.addClass(PAGE_COLOR_PROP_LINK_CLASS);
		element.setAttribute(DATA_ATTR, String(this.getMappingIndex(mapping) + 1));
		element.style.setProperty(CSS_VAR, color);
	}

	/** Remove ONLY Page Color Prop's own class, data attribute, and CSS var. */
	public clearDecoration(element: HTMLElement): void {
		if (!element) return;
		element.removeClass(PAGE_COLOR_PROP_LINK_CLASS);
		element.removeAttribute(DATA_ATTR);
		element.style.removeProperty(CSS_VAR);
	}

	/** Decorate all matching links in `container`. */
	public decorateLinksInContainer(
		container: HTMLElement | Document,
		sourcePath: string,
		selector: string = 'a.internal-link'
	): void {
		const nodes = container.querySelectorAll(selector);
		nodes.forEach((node) => {
			if (node.instanceOf(HTMLElement)) {
				this.decorateLink(node, sourcePath);
			}
		});
	}

	// ========================================================================
	// Observer registry
	// ========================================================================

	/**
	 * Install a MutationObserver on `container` that decorates any links
	 * appearing in it (and any child containers registered later).
	 * The plugin's main module calls this for each top-level Obsidian view
	 * it wants to cover.
	 */
	public observeContainer(
		container: HTMLElement,
		sourcePath: string,
		selector: string = 'a.internal-link'
	): void {
		if (this.observers.has(container)) return;
		// Initial sweep.
		this.decorateLinksInContainer(container, sourcePath, selector);

		const observer = new MutationObserver((mutations) => {
			for (const m of mutations) {
				m.addedNodes.forEach((node) => {
					if (!node.instanceOf(HTMLElement)) return;
					if (node.matches(selector)) {
						this.decorateLink(node, sourcePath);
					}
					// Also recurse into the added subtree.
					node.querySelectorAll(selector).forEach((child) => {
						if (child.instanceOf(HTMLElement)) {
							this.decorateLink(child, sourcePath);
						}
					});
				});
			}
		});
		observer.observe(container, { childList: true, subtree: true });
		this.observers.set(container, observer);
	}

	/** Stop watching one container. */
	public unobserveContainer(container: HTMLElement): void {
		const obs = this.observers.get(container);
		if (obs) {
			obs.disconnect();
			this.observers.delete(container);
		}
	}

	/**
	 * Install a document-level observer that watches for suggestion popups,
	 * modals, and other transient overlays. These aren't attached to a
	 * stable workspace container, so we observe document.body for
	 * additions and decorate anything new.
	 */
	public observeDocument(): void {
		if (this.documentObserver) return;
		this.documentObserver = new MutationObserver((mutations) => {
			for (const m of mutations) {
				m.addedNodes.forEach((node) => {
					if (!node.instanceOf(HTMLElement)) return;
					DEFAULT_CONTAINER_SELECTORS.forEach((sel) => {
						if (node.matches(sel)) {
							// Suggestion rows resolve against "" (root) source path.
							this.decorateLink(node, '');
						}
						node.querySelectorAll(sel).forEach((child) => {
							if (child.instanceOf(HTMLElement)) {
								this.decorateLink(child, '');
							}
						});
					});
				});
			}
		});
		this.documentObserver.observe(document.body, { childList: true, subtree: true });
	}

	/** Decorate every already-rendered link in the workspace. */
	public refreshAllVisible(): void {
		// Reading-view internal links in markdown panes.
		this.app.workspace.getLeavesOfType('markdown').forEach((leaf) => {
			const view = (leaf as any).view;
			if (view && view.containerEl.instanceOf(HTMLElement)) {
				// The reading view's content is a child; we don't know sourcePath
				// here without inspecting the leaf's file. The postprocessor
				// handles those, so we just defensively re-decorate root
				// children that look like internal links.
				this.decorateLinksInContainer(view.containerEl, '', 'a.internal-link');
			}
		});

		// View containers (file explorer, backlinks, etc.).
		this.observers.forEach((_obs, container) => {
			this.decorateLinksInContainer(container, '', '.tree-item-inner, .nav-file-title-content, .metadata-link-inner, .multi-select-pill-content');
		});

		// Anything else floating in document.body.
		this.decorateLinksInContainer(document.body, '', '.suggestion-title, .suggestion-note, a.internal-link');
	}

	/** Disconnect every observer, clear caches, and remove our decorations
	 *  from any element that still carries them. Called on plugin unload. */
	public dispose(): void {
		this.observers.forEach((obs) => obs.disconnect());
		this.observers.clear();
		if (this.documentObserver) {
			this.documentObserver.disconnect();
			this.documentObserver = null;
		}
		// Remove our decorations from any element still carrying them.
		document.querySelectorAll(`.${PAGE_COLOR_PROP_LINK_CLASS}`).forEach((el) => {
			if (el.instanceOf(HTMLElement)) {
				this.clearDecoration(el);
			}
		});
		this.matchCache.clear();
		this.themeVars = null;
	}

	// expose a few private getters via a private `app` reference for refreshAllVisible
	private get app() { return this.plugin.app; }
}
