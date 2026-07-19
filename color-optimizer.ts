// ============================================================================
// color-optimizer.ts
// ============================================================================
// PURPOSE: Automatically compute a "page background" color and a "link" color
// for each theme (light/dark), given the user's chosen accent/base color.
//
// WHY THIS EXISTS: Manually picking colors that (a) look good, (b) stay
// readable, and (c) don't visually collide with other rules is hard for
// humans to eyeball reliably. This engine does the color math so the user
// doesn't have to.
//
// CORE IDEA: We don't work in normal RGB or HSL, because those don't match
// how human eyes actually perceive color differences (see Oklab section
// below). We convert everything into "Oklab"/"Oklch" space, search for a
// color that satisfies all our rules, then convert back to a hex string
// Obsidian can use.
// ============================================================================

import type { PropertyColorMapping } from './settings';

// ---------------------------------------------------------------------------
// VARIABLE / CONCEPT GLOSSARY (read this first, refer back to it later)
// ---------------------------------------------------------------------------
// RGB    = standard Red/Green/Blue color, values 0-255 each. What hex codes
//          like "#ff0000" represent.
// Linear RGB = RGB with the "gamma correction" removed. Monitors don't
//          display brightness in a straight line with the RGB number you
//          feed them — they curve it. "Linear" undoes that curve so we can
//          do real math (like brightness calculations) correctly.
// LMS    = Long/Medium/Short wavelength cone response. Models how the three
//          types of light-sensing cells in the human eye actually react to
//          a color. This is an intermediate step, not something you'll
//          touch directly.
// Oklab  = A color space (L, a, b) where equal numeric distances = roughly
//          equal PERCEIVED differences. This is the perceptual color space
//          designed by Björn Ottosson.
//            L = Lightness (0 = black, 1 = white)
//            a = green(-) to red(+) axis
//            b = blue(-) to yellow(+) axis
// Oklch  = Same space as Oklab, but described with polar coordinates
//          instead of a/b:
//            L = Lightness (same as above)
//            C = Chroma = how saturated/vivid the color is (0 = gray,
//                ~0.35 = very vivid)
//            h = Hue = the color's angle on a color wheel, 0-360 degrees
//          Oklch is easier to search over because "keep the same hue, vary
//          brightness" is just "keep h fixed, vary L".
// Delta E ("ΔE_OK") = A single number measuring how DIFFERENT two colors
//          look to a human eye. Computed as the straight-line (Euclidean)
//          distance between two colors' Oklab coordinates. Bigger number =
//          more visually different. This is our "distinguishability" ruler.
// Contrast Ratio = The official WCAG (web accessibility) measurement of how
//          READABLE text is against a background. Ranges roughly 1 (no
//          contrast, invisible) to 21 (black on white, maximum contrast).
//          4.5 is the standard minimum for normal-sized body text.
// Gamut  = The set of colors a normal screen can actually display. Oklch
//          math can produce colors that are mathematically valid but
//          physically impossible to show on an sRGB screen (like "negative
//          red"). We must check every candidate color is inside gamut
//          before using it.
// ---------------------------------------------------------------------------

export interface RGB { r: number; g: number; b: number; }
export interface OKLab { L: number; a: number; b: number; }
export interface OKLCh { L: number; C: number; h: number; }

/**
 * All the theme colors we need as INPUT to compute new colors.
 * Naming convention: "_l" = light theme variant, "_d" = dark theme variant.
 *   base = the plugin's accent/base color (the color the user picked as
 *          the starting point — e.g. the rule's chosen background hue)
 *   bo_l / bo_d = "Background, Original" — the theme's normal page
 *          background color (before this plugin touches anything)
 *   to_l / to_d = "Text, Original" — the theme's normal body text color
 *   lo_l / lo_d = "Link, Original" — the theme's normal (default) link color
 */
export interface ThemeInputs {
  base: string;
  bo_l: string;
  bo_d: string;
  to_l: string;
  to_d: string;
  lo_l: string;
  lo_d: string;
}

/**
 * The colors this engine COMPUTES as output.
 *   bc_l / bc_d = "Background, Computed" — new tinted page background
 *   lc_l / lc_d = "Link, Computed" — new link color to pair with it
 */
export interface ThemeOutputs {
  bc_l: string;
  bc_d: string;
  lc_l: string;
  lc_d: string;
}

// ---------------------------------------------------------------------------
// TEMPORARY: tuning knobs exposed in the settings UI so the user can
// experiment before we lock in final values. DELETE THIS INTERFACE (and the
// UI sliders that set it — see settings.ts) once the algorithm is finalized
// and these become hardcoded constants again.
// ---------------------------------------------------------------------------
export interface LinkColorTuning {
  /** How many degrees to rotate the hue by, per search attempt, when the
   *  current hue can't satisfy all constraints. Smaller = stays closer to
   *  the original background hue but may fail to find a solution. Larger =
   *  finds a solution faster but may drift toward an unrelated-looking hue. */
  hueStepDegrees: number;
  /** Minimum Delta E (perceptual distance) a candidate link color must have
   *  versus body text AND versus every other link color it must not clash
   *  with. Higher = more visually distinct colors required, but harder to
   *  satisfy (may force a less "ideal" hue/lightness). */
  minDeltaE: number;
  /** Minimum WCAG contrast ratio the candidate link color must have against
   *  the page background. 4.5 is the WCAG AA standard for normal text. */
  minContrast: number;
}

export const DEFAULT_LINK_TUNING: LinkColorTuning = {
  hueStepDegrees: 15,
  minDeltaE: 0.12,
  minContrast: 4.5,
};

/**
 * Inputs the optimizer needs for ONE theme variant (light or dark).
 * Smaller and more focused than `ThemeInputs`: no base, no paired-theme
 * fields, no optimization twin. Use this from the shared rule-color
 * resolver, which is now called per-theme per-rule.
 */
export interface SingleThemeInputs {
  backgroundHex: string;
  uiBackgroundHex?: string;
  textHex: string;
  defaultLinkHex: string;
  navItemHex?: string;
  textMutedHex?: string;
  isLight: boolean;
}

/** Result of one link search: the chosen hex, the loss, and whether the
 *  pathological fallback was used. */
export interface LinkSearchResult {
  hex: string;
  loss: number;
  fallbackUsed: boolean;
}

/** Result of one rule/theme optimization: a tinted background and a
 *  readable special link, both derived from the same rule base hue. */
export interface SingleThemeOutput {
  backgroundHex: string;
  linkHex: string;
  loss: number;
  fallbackUsed: boolean;
}

export class ColorMath {

  /** "#RRGGBB" string -> {r,g,b} 0-255 numbers. */
  public static hexToRgb(hex: string): RGB {
    const clean = hex.trim().replace(/^#/, "");
    const full = clean.length === 3 ? clean.split("").map(c => c + c).join("") : clean;
    const val = parseInt(full, 16);
    return { r: (val >> 16) & 255, g: (val >> 8) & 255, b: val & 255 };
  }

  /** {r,g,b} 0-255 numbers -> "#RRGGBB" string. Clamps out-of-range values
   *  so we never emit an invalid hex code. */
  public static rgbToHex(rgb: RGB): string {
    const clamp = (val: number) => Math.max(0, Math.min(255, Math.round(val)));
    return "#" + ((1 << 24) + (clamp(rgb.r) << 16) + (clamp(rgb.g) << 8) + clamp(rgb.b)).toString(16).slice(1);
  }

  /** Removes gamma curve from one 0-255 color channel, producing "linear
   *  light" (0-1 range) suitable for physically accurate math. */
  public static srgbToLinear(c: number): number {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }

  /** Reverse of srgbToLinear: re-applies the gamma curve so a linear-light
   *  value (0-1) can be displayed as a normal 0-255 channel again. */
  public static linearToSrgb(c: number): number {
    const v = Math.max(0, Math.min(1, c));
    return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  }

  /** RGB -> Oklab. Three steps: (1) remove gamma curve, (2) transform into
   *  LMS cone-response space via a fixed matrix, (3) apply cube-root
   *  compression + a second matrix to land in Oklab's L/a/b axes.
   *  These matrix constants are Björn Ottosson's published Oklab
   *  coefficients — do not "simplify" or round them. */
  public static rgbToOklab(rgb: RGB): OKLab {
    const r = this.srgbToLinear(rgb.r);
    const g = this.srgbToLinear(rgb.g);
    const b = this.srgbToLinear(rgb.b);

    const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
    const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073970367 * b;
    const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

    const l_ = Math.cbrt(l);
    const m_ = Math.cbrt(m);
    const s_ = Math.cbrt(s);

    return {
      L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
      a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
      b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
    };
  }

  /** Oklab -> RGB. Exact inverse of rgbToOklab, using the corresponding
   *  inverse matrices. */
  public static oklabToRgb(lab: OKLab): RGB {
    const l_ = lab.L + 0.3963377774 * lab.a + 0.2158017574 * lab.b;
    const m_ = lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b;
    const s_ = lab.L - 0.0894841775 * lab.a - 1.2914855480 * lab.b;

    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;

    const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const b = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

    return {
      r: Math.round(this.linearToSrgb(r) * 255),
      g: Math.round(this.linearToSrgb(g) * 255),
      b: Math.round(this.linearToSrgb(b) * 255),
    };
  }

  /** Oklab (a,b axes) -> Oklch (Chroma/hue polar form). C is just the
   *  distance from the center of the a/b plane; h is the angle. */
  public static oklabToOklch(lab: OKLab): OKLCh {
    const C = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
    let h = Math.atan2(lab.b, lab.a) * (180 / Math.PI);
    if (h < 0) h += 360;
    return { L: lab.L, C, h };
  }

  /** Oklch -> Oklab. Converts the polar (C, h) pair back to Cartesian
   *  (a, b) using basic trigonometry. */
  public static oklchToOklab(lch: OKLCh): OKLab {
    const rad = lch.h * (Math.PI / 180);
    return { L: lch.L, a: lch.C * Math.cos(rad), b: lch.C * Math.sin(rad) };
  }

  /** "How different do these two colors look to a human?" Straight-line
   *  distance between two Oklab coordinates. Bigger = more different. */
  public static deltaE(lab1: OKLab, lab2: OKLab): number {
    return Math.sqrt(Math.pow(lab1.L - lab2.L, 2) + Math.pow(lab1.a - lab2.a, 2) + Math.pow(lab1.b - lab2.b, 2));
  }

  /** WCAG "relative luminance" — a weighted brightness value used in the
   *  official accessibility contrast formula. Green is weighted heaviest
   *  because human eyes are most sensitive to it. */
  public static getLuminance(rgb: RGB): number {
    return (
      0.2126 * this.srgbToLinear(rgb.r) +
      0.7152 * this.srgbToLinear(rgb.g) +
      0.0722 * this.srgbToLinear(rgb.b)
    );
  }

  /** Official WCAG contrast ratio between two colors. 4.5+ = passes AA for
   *  normal text. 21 = maximum possible (pure black vs pure white). */
  public static getContrast(rgb1: RGB, rgb2: RGB): number {
    const l1 = this.getLuminance(rgb1);
    const l2 = this.getLuminance(rgb2);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  /** Checks whether an Oklch color, once converted back to RGB, would
   *  require an "impossible" channel value (negative light or more than
   *  100% light) — meaning a normal screen literally cannot display it. */
  public static isSrgbGamut(lch: OKLCh): boolean {
    const lab = this.oklchToOklab(lch);
    const l_ = lab.L + 0.3963377774 * lab.a + 0.2158017574 * lab.b;
    const m_ = lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b;
    const s_ = lab.L - 0.0894841775 * lab.a - 1.2914855480 * lab.b;

    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;

    const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const b = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

    const eps = 0.005; // small tolerance for floating-point rounding
    return r >= -eps && r <= 1.0 + eps && g >= -eps && g <= 1.0 + eps && b >= -eps && b <= 1.0 + eps;
  }
}

export class ColorOptimizer {

  /**
   * Computes both background and link colors for one theme variant
   * (light or dark), for ONE rule.
   *
   * @param inputs        theme's default colors (background/text/link) +
   *                       this rule's chosen base/accent color
   * @param existingLinkHexes  link colors already assigned to OTHER rules
   *                       in this same theme — new link must stay visually
   *                       distinct from all of these too (prevents two
   *                       rules from ending up with near-identical links)
   * @param tuning         TEMPORARY tunable thresholds (see LinkColorTuning
   *                       above) — remove this parameter once finalized and
   *                       hardcode the constants again, matching the
   *                       original spec's design.
   */
  public static optimize(
    inputs: ThemeInputs,
    existingLinkHexes: { light: string[]; dark: string[] } = { light: [], dark: [] },
    tuning: LinkColorTuning = DEFAULT_LINK_TUNING
  ): ThemeOutputs {
    const baseLab = ColorMath.rgbToOklab(ColorMath.hexToRgb(inputs.base));
    const baseLch = ColorMath.oklabToOklch(baseLab);

    const bo_lRgb = ColorMath.hexToRgb(inputs.bo_l);
    const bo_dRgb = ColorMath.hexToRgb(inputs.bo_d);

    const to_lLab = ColorMath.rgbToOklab(ColorMath.hexToRgb(inputs.to_l));
    const to_dLab = ColorMath.rgbToOklab(ColorMath.hexToRgb(inputs.to_d));
    const lo_lLab = ColorMath.rgbToOklab(ColorMath.hexToRgb(inputs.lo_l));
    const lo_dLab = ColorMath.rgbToOklab(ColorMath.hexToRgb(inputs.lo_d));

    // Step 1: compute the tinted page background for each theme.
    const bc_l = this.findBackground(baseLch, ColorMath.rgbToOklab(bo_lRgb), true);
    const bc_d = this.findBackground(baseLch, ColorMath.rgbToOklab(bo_dRgb), false);

    const bc_lRgb = ColorMath.hexToRgb(bc_l);
    const bc_dRgb = ColorMath.hexToRgb(bc_d);

    // Step 2: compute the link color for each theme. Links are only
    // shown against the theme's own normal (untinted) background, so
    // contrast is checked only against bo_l / bo_d, not against the page
    // Color Prop tinted background.
    const existingLightLabs = existingLinkHexes.light.map(h => ColorMath.rgbToOklab(ColorMath.hexToRgb(h)));
    const existingDarkLabs = existingLinkHexes.dark.map(h => ColorMath.rgbToOklab(ColorMath.hexToRgb(h)));

    const lc_l = this.findLinkDetailed(baseLch, [bo_lRgb, bc_lRgb], to_lLab, lo_lLab, existingLightLabs, true, tuning).hex;
    const lc_d = this.findLinkDetailed(baseLch, [bo_dRgb, bc_dRgb], to_dLab, lo_dLab, existingDarkLabs, false, tuning).hex;

    return { bc_l, bc_d, lc_l, lc_d };
  }

  /** Finds a subtle tinted background: keeps the hue from baseLch, and
   *  searches lightness/chroma near "very light" (light theme) or "very
   *  dark" (dark theme), while staying perceptibly different (ΔE ≥ 0.03)
   *  from the theme's untouched default background. */
  public static findBackground(baseLch: OKLCh, boLab: OKLab, isLight: boolean): string {
    const BG_DE = 0.03; // "just noticeable difference" threshold for backgrounds

    const targetL = isLight ? 0.96 : boLab.L;
    const targetC = isLight ? 0.015 : 0.04;
    const minL = isLight ? 0.90 : Math.max(0.01, boLab.L - 0.05);
    const maxL = isLight ? 0.99 : Math.min(0.99, boLab.L + 0.05);

    let best: OKLCh | null = null;
    let bestLoss = Infinity;

    const maxC = isLight ? 0.05 : 0.07;
    for (let L = minL; L <= maxL; L += 0.005) {
      for (let C = 0.005; C <= maxC; C += 0.002) {
        const candidate = { L, C, h: baseLch.h };
        if (!ColorMath.isSrgbGamut(candidate)) continue;

        const candidateLab = ColorMath.oklchToOklab(candidate);
        const candidateRgb = ColorMath.oklabToRgb(candidateLab);
        const quantizedLab = ColorMath.rgbToOklab(candidateRgb);
        if (ColorMath.deltaE(quantizedLab, boLab) >= BG_DE) {
          // "Loss" = how far this candidate is from our ideal target.
          // Chroma is weighted 100x more heavily than lightness because
          // small chroma changes matter much more for a subtle background.
          const loss = Math.pow(L - targetL, 2) + Math.pow(C - targetC, 2) * 100;
          if (loss < bestLoss) {
            bestLoss = loss;
            best = candidate;
          }
        }
      }
    }

    if (!best) {
      // Fallback: nudge lightness away from the default background instead
      // of failing outright.
      const fallbackL = isLight ? Math.max(0.90, boLab.L - 0.04) : Math.min(0.99, boLab.L + 0.04);
      best = { L: fallbackL, C: targetC, h: baseLch.h };
    }

    return ColorMath.rgbToHex(ColorMath.oklabToRgb(ColorMath.oklchToOklab(best)));
  }

  private static findLinkDetailed(
    baseLch: OKLCh,
    backgroundRgbList: RGB[],       // CHANGED: was a single background
    textLab: OKLab,
    defaultLinkLab: OKLab,
    existingLinkLabs: OKLab[],
    isLight: boolean,
    tuning: LinkColorTuning,
    navItemLab?: OKLab,
    textMutedLab?: OKLab,
  ): LinkSearchResult {
    const defaultLinkLch = ColorMath.oklabToOklch(defaultLinkLab);
    const hueDiffToDefault = Math.min(
      Math.abs(baseLch.h - defaultLinkLch.h),
      360 - Math.abs(baseLch.h - defaultLinkLch.h)
    );
    const skipDefaultLinkCheck = defaultLinkLch.C > 0.04 && hueDiffToDefault < 30;

    const search = (minTextDeltaE: number): LinkSearchResult | null => {
      let best: OKLCh | null = null;
      let bestLoss = Infinity;

      for (let hueStep = -30; hueStep <= 30; hueStep += tuning.hueStepDegrees) {
        for (const L of candidateLightnesses(isLight)) {
          for (const C of candidateChromas()) {
            const candidate: OKLCh = { L, C, h: (baseLch.h + hueStep + 360) % 360 };
            if (!ColorMath.isSrgbGamut(candidate)) continue;

            const candidateLab = ColorMath.oklchToOklab(candidate);
            const candidateRgb = ColorMath.oklabToRgb(candidateLab);

            const passesAllBackgrounds = backgroundRgbList.every(
              bg => ColorMath.getContrast(candidateRgb, bg) >= tuning.minContrast,
            );
            if (!passesAllBackgrounds) continue;

            const quantizedLab = ColorMath.rgbToOklab(candidateRgb);
            if (ColorMath.deltaE(quantizedLab, textLab) < minTextDeltaE) continue;
            if (navItemLab && ColorMath.deltaE(quantizedLab, navItemLab) < minTextDeltaE) continue;
            if (textMutedLab && ColorMath.deltaE(quantizedLab, textMutedLab) < minTextDeltaE) continue;
            if (!skipDefaultLinkCheck && ColorMath.deltaE(quantizedLab, defaultLinkLab) < tuning.minDeltaE) continue;
            if (existingLinkLabs.some(o => ColorMath.deltaE(quantizedLab, o) < tuning.minDeltaE)) continue;

            const loss = computeLoss(candidate, baseLch, hueStep);
            if (loss < bestLoss) { bestLoss = loss; best = candidate; }
          }
        }
      }

      if (best) {
        return {
          hex: ColorMath.rgbToHex(ColorMath.oklabToRgb(ColorMath.oklchToOklab(best))),
          loss: bestLoss,
          fallbackUsed: false,
        };
      }
      return null;
    };

    if (isLight) {
      // First try strict text delta E check to keep links highly visible/distinct from normal text.
      const strictResult = search(0.20);
      if (strictResult) return strictResult;

      // Relax constraints to standard delta E if the search space was too constrained.
      const relaxedResult = search(tuning.minDeltaE);
      if (relaxedResult) return relaxedResult;
    } else {
      const darkResult = search(tuning.minDeltaE);
      if (darkResult) return darkResult;
    }

    const fallback: OKLCh = { L: isLight ? 0.35 : 0.80, C: 0.15, h: baseLch.h };
    return {
      hex: ColorMath.rgbToHex(ColorMath.oklabToRgb(ColorMath.oklchToOklab(fallback))),
      loss: Infinity,
      fallbackUsed: true,
    };
  }

  private static findLink(
    baseLch: OKLCh,
    boRgb: RGB,
    toLab: OKLab,
    loLab: OKLab,
    existingLinkLabs: OKLab[],
    isLight: boolean,
    tuning: LinkColorTuning
  ): string {
    return this.findLinkDetailed(
      baseLch, [boRgb], toLab, loLab, existingLinkLabs, isLight, tuning
    ).hex;
  }

  public static computeRuleColors(
    mapping: PropertyColorMapping,
    allMappings: PropertyColorMapping[],
    theme: SingleThemeInputs,
    otherLinkHexes: string[],
    tuning: LinkColorTuning,
  ): ResolvedRuleColors {
    const baseLch = ColorMath.oklabToOklch(ColorMath.rgbToOklab(ColorMath.hexToRgb(mapping.baseColor)));

    const backgroundHex = ColorOptimizer.findBackground(
      baseLch, ColorMath.rgbToOklab(ColorMath.hexToRgb(theme.backgroundHex)), theme.isLight,
    );

    const allBackgrounds = collectAllRuleBackgrounds(allMappings, theme.backgroundHex, theme.isLight);
    if (theme.uiBackgroundHex) {
      allBackgrounds.push(ColorMath.hexToRgb(theme.uiBackgroundHex));
    }

    const navItemLab = theme.navItemHex ? ColorMath.rgbToOklab(ColorMath.hexToRgb(theme.navItemHex)) : undefined;
    const textMutedLab = theme.textMutedHex ? ColorMath.rgbToOklab(ColorMath.hexToRgb(theme.textMutedHex)) : undefined;

    const link = ColorOptimizer.findLinkDetailed(
      baseLch,
      allBackgrounds,
      ColorMath.rgbToOklab(ColorMath.hexToRgb(theme.textHex)),
      ColorMath.rgbToOklab(ColorMath.hexToRgb(theme.defaultLinkHex)),
      otherLinkHexes.map(h => ColorMath.rgbToOklab(ColorMath.hexToRgb(h))),
      theme.isLight,
      tuning,
      navItemLab,
      textMutedLab,
    );

    return { backgroundHex, linkHex: link.hex, fallbackUsed: link.fallbackUsed };
  }
}

export function collectAllRuleBackgrounds(
  mappings: PropertyColorMapping[],
  plainBackgroundHex: string,
  isLight: boolean,
): RGB[] {
  const plainBg = ColorMath.hexToRgb(plainBackgroundHex);
  const backgrounds: RGB[] = [plainBg];

  for (const mapping of mappings) {
    if (!mapping.baseColor) continue;
    const baseLch = ColorMath.oklabToOklch(ColorMath.rgbToOklab(ColorMath.hexToRgb(mapping.baseColor)));
    const bgHex = ColorOptimizer.findBackground(baseLch, ColorMath.rgbToOklab(plainBg), isLight);
    backgrounds.push(ColorMath.hexToRgb(bgHex));
  }

  return backgrounds;
}

export interface ResolvedRuleColors {
  backgroundHex: string;
  linkHex: string;
  fallbackUsed: boolean;
}

function candidateLightnesses(isLight: boolean): number[] {
  const minL = isLight ? 0.20 : 0.65;
  const maxL = isLight ? 0.60 : 0.90;
  const result: number[] = [];
  for (let L = minL; L <= maxL + 0.0001; L += 0.01) {
    result.push(L);
  }
  return result;
}

function candidateChromas(): number[] {
  const result: number[] = [];
  for (let C = 0.05; C <= 0.25 + 0.0001; C += 0.01) {
    result.push(C);
  }
  return result;
}

function computeLoss(candidate: OKLCh, baseLch: OKLCh, hueStep: number): number {
  const isLight = candidate.L <= 0.60;
  const targetC = isLight ? 0.20 : 0.18;
  const targetL = isLight ? 0.40 : 0.75;
  const shortestHueDiff = Math.min(hueStep, 360 - hueStep);
  return shortestHueDiff * 1.5 + Math.abs(candidate.C - targetC) * 300 + Math.abs(candidate.L - targetL) * 100;
}
