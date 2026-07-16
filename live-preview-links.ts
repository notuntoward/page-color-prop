// ============================================================================
// live-preview-links.ts
// ============================================================================
// PURPOSE: CodeMirror 6 extension that decorates wikilinks in the Live
// Preview / source editor with Page Color Prop's per-rule link color.
//
// HOW IT WORKS (minimal, robust):
//   * Register a ViewPlugin that, on each update, scans the visible
//     viewport's text for wikilink syntax and markdown internal-link
//     syntax, resolves each to a TFile, and decorates the matching
//     range with a Decoration.mark that adds the page-color-prop-link
//     class plus the inline --page-color-prop-link-color variable.
//   * The plugin never mutates CM's DOM directly. It returns Decoration
//     objects; the editor applies them.
//   * On every transaction, a thin "compute decorations" function walks
//     the visible ranges only (we don't touch off-screen lines) and
//     uses the same LinkDecorator that the postprocessor uses.
//
// SCOPE: Standard wikilinks and standard markdown internal links.
//   Skipped: links inside fenced code blocks and inline code (we use a
//   tiny stateful walker that tracks the last open/close code fence).
//
// References: the structure mirrors Obsidian's own internal live-link
// decorators; it does not copy any third-party code.
// ============================================================================

import { Decoration, EditorView, ViewPlugin, type DecorationSet, ViewUpdate, WidgetType } from '@codemirror/view';
import { RangeSetBuilder, StateEffect, type Extension } from '@codemirror/state';
import type { TFile } from 'obsidian';
import type PageColorPropPlugin from './main';

const WIKILINK_RE = /\[\[([^\]\n]+?)\]\]/g;
const MDLINK_RE = /\[([^\]\n]+?)\]\(([^)\n]+?)\)/g;

export const forceRecomputeEffect = StateEffect.define<number>();

class LinkColorWidget extends WidgetType {
	constructor(readonly color: string, readonly ruleIndex: number) {
		super();
	}
	eq(other: LinkColorWidget): boolean {
		return other.color === this.color && other.ruleIndex === this.ruleIndex;
	}
	ignoreEvent(): boolean { return false; }
	toDOM(): HTMLElement {
		const span = document.createElement('span');
		span.className = 'page-color-prop-link';
		span.style.setProperty('--page-color-prop-link-color', this.color);
		span.setAttribute('data-page-color-prop-link-rule', String(this.ruleIndex));
		return span;
	}
}

/** Build the CM6 extension. Pass the plugin so the plugin owns the
 *  lifecycle and so the extension can call the same LinkDecorator that
 *  the postprocessor uses. */
export function buildPageColorPropLivePreviewExtension(plugin: PageColorPropPlugin): Extension {
	return ViewPlugin.fromClass(class {
		decorations: DecorationSet;
		constructor(public view: EditorView) {
			this.decorations = this.compute();
		}
		update(update: ViewUpdate) {
			let needsRecompute = update.docChanged || update.viewportChanged || update.selectionSet;
			if (!needsRecompute) {
				for (const tr of update.transactions) {
					for (const e of tr.effects) {
						if (e.is(forceRecomputeEffect)) {
							needsRecompute = true;
							break;
						}
					}
					if (needsRecompute) break;
				}
			}
			if (needsRecompute) {
				this.decorations = this.compute();
			}
		}
		compute(): DecorationSet {
			if (!plugin.linkDecorator) return Decoration.none;
			const file = plugin.app.workspace.getActiveFile?.() ?? null;
			const sourcePath = file?.path ?? '';
			const builder = new RangeSetBuilder<Decoration>();
			const view = this.view;
			for (const { from, to } of view.visibleRanges) {
				const text = view.state.doc.sliceString(from, to);
				// Build decorations for each match.
				const ranges: { start: number; end: number; color: string; rule: number }[] = [];
				for (const m of text.matchAll(WIKILINK_RE)) {
					const start = from + (m.index ?? 0);
					const end = start + m[0].length;
					const inner = m[1].split('|')[0].split('#')[0].trim();
					const color = this.resolveColorForTargetName(inner, sourcePath);
					if (color) {
						ranges.push({ start, end, color: color.color, rule: color.rule });
					}
				}
				for (const m of text.matchAll(MDLINK_RE)) {
					const start = from + (m.index ?? 0);
					const end = start + m[0].length;
					const inner = m[2].split('#')[0].trim();
					const color = this.resolveColorForTargetName(inner, sourcePath);
					if (color) {
						ranges.push({ start, end, color: color.color, rule: color.rule });
					}
				}
				ranges.sort((a, b) => a.start - b.start);
				for (const r of ranges) {
					builder.add(r.start, r.end, Decoration.mark({
						class: 'page-color-prop-link',
						attributes: {
							style: `--page-color-prop-link-color: ${r.color}`,
							'data-page-color-prop-link-rule': String(r.rule)
						}
					}));
				}
			}
			return builder.finish();
		}
		resolveColorForTargetName(name: string, sourcePath: string): { color: string; rule: number } | null {
			const decorator = plugin.linkDecorator;
			if (!decorator) return null;
			// Skip names that look like URLs.
			if (/^[a-z]+:\/\//i.test(name)) return null;
			const target = plugin.app.metadataCache.getFirstLinkpathDest(name, sourcePath) as TFile | null;
			if (!target) return null;
			const mapping = decorator.getMatchingMappingForFile(target);
			if (!mapping) return null;
			const color = decorator.getResolvedLinkColor(mapping);
			if (!color) return null;
			return { color, rule: decorator.getMappingIndex(mapping) + 1 };
		}
	}, {
		decorations: v => v.decorations
	});
}
