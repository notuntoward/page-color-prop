// ============================================================================
// link-color-service.ts
// ============================================================================
// PURPOSE: Single source of truth for runtime link-color resolution, shared
// by the settings UI, the markdown postprocessor, the CodeMirror 6 live-
// preview extension, and the view observers.
//
// Why this exists separately from settings.ts and the plugin class:
//   * settings.ts is UI-driven; the user may never open the settings tab,
//     so we can't rely on it to populate auto link colors.
//   * main.ts already has the rule matcher (findMatchingColorMappings);
//     we reuse that here.
//   * Callers should never need to know whether a mapping is in auto mode
//     or which theme is active — they ask for a color, they get a color
//     (or null if nothing matches).
// ============================================================================

import type { TFile } from 'obsidian';
import { ColorOptimizer, DEFAULT_LINK_TUNING, type LinkColorTuning } from './color-optimizer';
import type { PropertyColorMapping } from './settings';

// Frontmatter shape used by the rule matcher. Mirrors main.ts.
type FrontmatterValue = string | number | boolean | null | undefined | FrontmatterValue[];
type Frontmatter = Record<string, FrontmatterValue>;

interface ColorMappingMatch {
	mapping: PropertyColorMapping;
	index: number;
	propertyValue: FrontmatterValue;
}

export interface ThemeCssVars {
	/** Light-theme `--background-primary` resolved to a hex string. */
	bo_l: string;
	/** Dark-theme `--background-primary` resolved to a hex string. */
	bo_d: string;
	/** Light-theme `--text-normal` resolved to a hex string. */
	to_l: string;
	/** Dark-theme `--text-normal` resolved to a hex string. */
	to_d: string;
	/** Light-theme `--link-color` resolved to a hex string. */
	lo_l: string;
	/** Dark-theme `--link-color` resolved to a hex string. */
	lo_d: string;
}

/**
 * The seed color used for the link-color optimizer's hue search.
 *
 * This is a constant *CSS expression*, not a fixed hex value. When we
 * pass it to `readThemeCssVar`, the browser resolves the `var(--accent-h)`
 * and `var(--accent-s)` references against the CURRENT theme's CSS
 * variables at the moment the call runs. That means:
 *   * If the user picks a different accent in Obsidian's appearance
 *     settings, this seed automatically follows.
 *   * If the user switches light/dark theme, this seed automatically
 *     follows (each theme defines its own `--accent-h` / `--accent-s`).
 *   * If a third-party theme overrides `--accent-h` / `--accent-s`, this
 *     seed automatically follows.
 *
 * The shape `hsl(<h>, <s>, 50%)` is deliberate: 50% lightness, full
 * saturation, no alpha. The rule's resolved *background* is a washed-out
 * tint by design (e.g. 90% lightness with 0.35 alpha in light mode) —
 * correct for a background, but a terrible hue source for a link color,
 * because the optimizer would start its search from a nearly colorless
 * point (especially in light mode). Seeding from the accent directly
 * gives the optimizer a strong, stable hue anchor. Background and link
 * colors still come from the same accent hue family, so the "link feels
 * related to its target's background" design goal is preserved.
 * Contrast against the actual background is still enforced by the
 * optimizer via the `bo` input.
 */
export const ACCENT_SEED_COLOR = 'hsl(var(--accent-h), var(--accent-s), 50%)';

/**
 * Reads a CSS variable from `<body>` in the CURRENT theme, returns it as
 * a 6-digit hex string (or null if it can't be resolved). Synchronous;
 * uses a temp probe div as in the settings tab.
 */
export function readThemeCssVar(colorStr: string): string | null {
	if (!colorStr || typeof colorStr !== 'string') return null;
	if (!colorStr.includes('var(--')) {
		// Already a flat color — try to normalize to hex.
		const hexMatch = colorStr.match(/#[0-9A-Fa-f]{6}/);
		if (hexMatch) return hexMatch[0];
		const rgbMatch = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
		if (rgbMatch) {
			const r = parseInt(rgbMatch[1]).toString(16).padStart(2, '0');
			const g = parseInt(rgbMatch[2]).toString(16).padStart(2, '0');
			const b = parseInt(rgbMatch[3]).toString(16).padStart(2, '0');
			return `#${r}${g}${b}`;
		}
		return null;
	}

	const temp = document.createElement('div');
	temp.style.position = 'absolute';
	temp.style.left = '-9999px';
	temp.style.top = '-9999px';
	temp.style.visibility = 'hidden';
	temp.style.color = colorStr;
	document.body.appendChild(temp);

	const computed = window.getComputedStyle(temp).color;
	document.body.removeChild(temp);

	const rgbMatch = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
	if (rgbMatch) {
		const r = parseInt(rgbMatch[1]).toString(16).padStart(2, '0');
		const g = parseInt(rgbMatch[2]).toString(16).padStart(2, '0');
		const b = parseInt(rgbMatch[3]).toString(16).padStart(2, '0');
		return `#${r}${g}${b}`;
	}
	return null;
}

/**
 * Pulls the six theme variables the optimizer needs, for BOTH themes,
 * by reading the current theme once and the opposite theme once. Always
 * restores the original theme class on `<body>` before returning, even
 * on error paths, so the user never sees a flicker.
 */
export function readBothThemeVars(): ThemeCssVars | null {
	const body = document.body;
	const wasDark = body.classList.contains('theme-dark');

	const readVars = (): { bo: string; to: string; lo: string } | null => {
		const bo = readThemeCssVar('var(--background-primary)');
		const to = readThemeCssVar('var(--text-normal)');
		const lo = readThemeCssVar('var(--link-color)');
		if (!bo || !to || !lo) return null;
		return { bo, to, lo };
	};

	let light: { bo: string; to: string; lo: string } | null = null;
	let dark: { bo: string; to: string; lo: string } | null = null;
	try {
		light = wasDark ? readWithBodyClass(body, 'Light') : readVars();
		dark = wasDark ? readVars() : readWithBodyClass(body, 'Dark');
	} finally {
		body.classList.remove('theme-light', 'theme-dark');
		body.classList.add(wasDark ? 'theme-dark' : 'theme-light');
	}

	if (!light || !dark) return null;
	return {
		bo_l: light.bo,
		to_l: light.to,
		lo_l: light.lo,
		bo_d: dark.bo,
		to_d: dark.to,
		lo_d: dark.lo
	};
}

function readWithBodyClass(body: HTMLElement, to: 'Light' | 'Dark') {
	body.classList.remove('theme-light', 'theme-dark');
	body.classList.add(to === 'Dark' ? 'theme-dark' : 'theme-light');
	const bo = readThemeCssVar('var(--background-primary)');
	const to2 = readThemeCssVar('var(--text-normal)');
	const lo = readThemeCssVar('var(--link-color)');
	return { bo: bo ?? '', to: to2 ?? '', lo: lo ?? '' };
}

/**
 * The pair of auto-computed colors for a single rule: a tinted page
 * background and a readable special link. Both come from the same
 * rule base hue so they feel related. The shared resolver (used by the
 * page background path, the link-decoration path, the tab color path,
 * and the settings preview) returns this shape so all four call sites
 * can stay in lockstep.
 */
export interface ResolvedRuleColors {
  backgroundHex: string;
  linkHex: string;
}

/**
 * The single source of truth for auto background + auto link color for
 * one rule in one theme. Reads the theme accent via `ACCENT_SEED_COLOR`,
 * derives a palette-relative base hue from the rule's id, and asks the
 * optimizer to pick the best (background, link) pair that satisfies
 * the hard contrast / Delta E / gamut constraints.
 *
 * All four runtime callers (page background, link decoration, tab
 * text, settings preview) go through this function so they cannot
 * drift apart.
 */
export function computeAutoRuleColors(
  mapping: PropertyColorMapping,
  allMappings: PropertyColorMapping[],
  theme: 'Light' | 'Dark',
  themeVars: ThemeCssVars,
  otherLinkHexes: string[],
  tuning: LinkColorTuning = DEFAULT_LINK_TUNING
): ResolvedRuleColors {
  const isLight = theme === 'Light';

  const accentHex = readThemeCssVar(ACCENT_SEED_COLOR);
  if (!accentHex) {
    return {
      backgroundHex: '#808080',
      linkHex: '#808080',
    };
  }

  const result = ColorOptimizer.optimizeRuleFromAccent(
    accentHex,
    mapping.id,
    allMappings.map(other => other.id),
    {
      backgroundHex: isLight ? themeVars.bo_l : themeVars.bo_d,
      textHex: isLight ? themeVars.to_l : themeVars.to_d,
      defaultLinkHex: isLight ? themeVars.lo_l : themeVars.lo_d,
      isLight,
    },
    otherLinkHexes,
    tuning
  );

  return {
    backgroundHex: result.backgroundHex,
    linkHex: result.linkHex,
  };
}

/**
 * Computes the auto link color for a mapping in the requested theme.
 *
 * Thin wrapper over `computeAutoRuleColors` kept for callers (and
 * existing tests) that only need the link half. New code should prefer
 * `computeAutoRuleColors` so the runtime page background, the link
 * decoration, the tab color, and the settings preview all share one
 * resolution path.
 */
export function computeAutoLinkHex(
  mapping: PropertyColorMapping,
  theme: 'Light' | 'Dark',
  themeVars: ThemeCssVars,
  otherHexes: string[],
  tuning: LinkColorTuning = DEFAULT_LINK_TUNING
): string {
  return computeAutoRuleColors(
    mapping,
    [mapping],
    theme,
    themeVars,
    otherHexes,
    tuning
  ).linkHex;
}

// Re-export types the plugin needs to reference.
export type { ColorMappingMatch, Frontmatter, FrontmatterValue };

/**
 * Reusable rule-matcher. Returns the same shape as main.ts' private
 * findMatchingColorMappings, but extracted here so link-decoration and
 * background-color logic can share it.
 */
export function findMatchingColorMappings(
	mappings: PropertyColorMapping[],
	frontmatter: Frontmatter
): { selected: ColorMappingMatch | null; matches: ColorMappingMatch[] } {
	const matches: ColorMappingMatch[] = [];

	mappings.forEach((mapping, index) => {
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
