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

export interface ResolveLinkColorInputs {
	base: string;
	bo_l: string;
	bo_d: string;
	to_l: string;
	to_d: string;
	lo_l: string;
	lo_d: string;
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
 * Computes the auto link color for a mapping in the requested theme,
 * using the rule's *own* background (auto or manual) as the base accent
 * and the surrounding theme colors as constraints.
 *
 * `otherHexes` should contain the hex strings of link colors already
 * assigned to OTHER rules in the same theme, so we don't pick a color
 * that visually collides with them.
 */
export function computeAutoLinkHex(
	mapping: PropertyColorMapping,
	theme: 'Light' | 'Dark',
	themeVars: ThemeCssVars,
	otherHexes: string[],
	tuning: LinkColorTuning = DEFAULT_LINK_TUNING
): string {
	const isLight = theme === 'Light';
	const baseColor = isLight
		? (mapping.isAutoLight
			? 'hsla(var(--accent-h), var(--accent-s), 90%, 0.35)'
			: mapping.colorLight)
		: (mapping.isAutoDark
			? 'hsla(var(--accent-h), var(--accent-s), 25%, 0.30)'
			: mapping.colorDark);
	const baseHex = readThemeCssVar(baseColor);
	if (!baseHex) return '#808080';

	const bo = isLight ? themeVars.bo_l : themeVars.bo_d;
	const to = isLight ? themeVars.to_l : themeVars.to_d;
	const lo = isLight ? themeVars.lo_l : themeVars.lo_d;

	const inputs: ResolveLinkColorInputs = {
		base: baseHex,
		bo_l: bo,
		bo_d: bo,
		to_l: to,
		to_d: to,
		lo_l: lo,
		lo_d: lo
	};
	const existing = { light: isLight ? otherHexes : [], dark: isLight ? [] : otherHexes };
	const result = ColorOptimizer.optimize(inputs, existing, tuning);
	return isLight ? result.lc_l : result.lc_d;
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
