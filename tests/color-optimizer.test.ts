import { describe, it, expect } from "vitest";
import { ColorOptimizer, ColorMath, DEFAULT_LINK_TUNING, type ThemeInputs } from "../color-optimizer";
import type { SingleThemeInputs } from "../color-optimizer";

const mockBaseThemes: { name: string; inputs: ThemeInputs }[] = [
  {
    name: "Obsidian Classic Purple",
    inputs: {
      base: "#7a22ff",
      bo_l: "#ffffff",
      bo_d: "#1e1e1e",
      to_l: "#2e2e2e",
      to_d: "#dbdbdb",
      lo_l: "#2463d1",
      lo_d: "#58a6ff",
    },
  },
  {
    name: "Obsidian Forest Emerald",
    inputs: {
      base: "#09825d",
      bo_l: "#fcfcf9",
      bo_d: "#161b17",
      to_l: "#1c211d",
      to_d: "#e1e7e2",
      lo_l: "#10664f",
      lo_d: "#48c7a5",
    },
  },
  {
    name: "Obsidian Deep Crimson (Crash Case)",
    inputs: {
      base: "#d92b2b",
      bo_l: "#fdf8f8",
      bo_d: "#1a1212",
      to_l: "#2b2020",
      to_d: "#eccfcf",
      lo_l: "#b22222",
      lo_d: "#ff6b6b",
    },
  },
];

describe("Color Optimizer Core Tests", () => {
  describe("Hex <-> RGB Conversion Roundtrips", () => {
    it("should accurately maintain color data during hex/rgb conversions", () => {
      const inputHex = "#7a22ff";
      const rgb = ColorMath.hexToRgb(inputHex);
      const outputHex = ColorMath.rgbToHex(rgb);
      expect(outputHex).toBe(inputHex);
    });

    it("expands 3-digit shorthand hex to 6-digit form", () => {
      const rgb = ColorMath.hexToRgb("#abc");
      expect(rgb).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc });
    });
  });

  describe("Gamut Guardrails", () => {
    it("should flag Oklch values that spill outside sRGB space", () => {
      const ultraSaturated = { L: 0.9, C: 0.4, h: 200 };
      expect(ColorMath.isSrgbGamut(ultraSaturated)).toBe(false);
    });

    it("accepts a reasonable in-gamut Oklch color", () => {
      // A pale blue with modest chroma is well within the sRGB cube.
      const inGamut = { L: 0.7, C: 0.08, h: 240 };
      expect(ColorMath.isSrgbGamut(inGamut)).toBe(true);
    });
  });

  describe("Multi-Constraint Solver Assertions", () => {
    mockBaseThemes.forEach(({ name, inputs }) => {
      it(`should successfully solve constraints for theme: ${name}`, () => {
        const output = ColorOptimizer.optimize(inputs);

        const bo_lRgb = ColorMath.hexToRgb(inputs.bo_l);
        const bo_dRgb = ColorMath.hexToRgb(inputs.bo_d);
        const to_lLab = ColorMath.rgbToOklab(ColorMath.hexToRgb(inputs.to_l));
        const to_dLab = ColorMath.rgbToOklab(ColorMath.hexToRgb(inputs.to_d));
        const lo_lLab = ColorMath.rgbToOklab(ColorMath.hexToRgb(inputs.lo_l));
        const lo_dLab = ColorMath.rgbToOklab(ColorMath.hexToRgb(inputs.lo_d));

        const bc_lRgb = ColorMath.hexToRgb(output.bc_l);
        const bc_dRgb = ColorMath.hexToRgb(output.bc_d);
        const bc_lLab = ColorMath.rgbToOklab(bc_lRgb);
        const bc_dLab = ColorMath.rgbToOklab(bc_dRgb);

        const lc_lRgb = ColorMath.hexToRgb(output.lc_l);
        const lc_dRgb = ColorMath.hexToRgb(output.lc_d);
        const lc_lLab = ColorMath.rgbToOklab(lc_lRgb);
        const lc_dLab = ColorMath.rgbToOklab(lc_dRgb);

        // --- BACKGROUND CHECKS ---
        expect(output.bc_l).not.toBe(inputs.bo_l);
        expect(output.bc_d).not.toBe(inputs.bo_d);

        expect(bc_lLab.L).toBeGreaterThanOrEqual(0.88);
        expect(bc_dLab.L).toBeLessThanOrEqual(0.25);

        const bo_lLab = ColorMath.rgbToOklab(bo_lRgb);
        const bo_dLab = ColorMath.rgbToOklab(bo_dRgb);
        expect(ColorMath.deltaE(bc_lLab, bo_lLab)).toBeGreaterThanOrEqual(0.03);
        expect(ColorMath.deltaE(bc_dLab, bo_dLab)).toBeGreaterThanOrEqual(0.03);

        // --- LINK CHECKS ---
        expect(ColorMath.getContrast(lc_lRgb, bo_lRgb)).toBeGreaterThanOrEqual(4.5);
        expect(ColorMath.getContrast(lc_lRgb, bc_lRgb)).toBeGreaterThanOrEqual(4.5);
        expect(ColorMath.getContrast(lc_dRgb, bo_dRgb)).toBeGreaterThanOrEqual(4.5);
        expect(ColorMath.getContrast(lc_dRgb, bc_dRgb)).toBeGreaterThanOrEqual(4.5);

        expect(ColorMath.deltaE(lc_lLab, to_lLab)).toBeGreaterThanOrEqual(0.12);
        expect(ColorMath.deltaE(lc_dLab, to_dLab)).toBeGreaterThanOrEqual(0.12);

        const baseLch = ColorMath.oklabToOklch(ColorMath.rgbToOklab(ColorMath.hexToRgb(inputs.base)));

        const lo_lLch = ColorMath.oklabToOklch(lo_lLab);
        const hueDiffL = Math.min(Math.abs(baseLch.h - lo_lLch.h), 360 - Math.abs(baseLch.h - lo_lLch.h));
        const skipL = lo_lLch.C > 0.04 && hueDiffL < 30;
        if (!skipL) {
          expect(ColorMath.deltaE(lc_lLab, lo_lLab)).toBeGreaterThanOrEqual(0.12);
        }

        const lo_dLch = ColorMath.oklabToOklch(lo_dLab);
        const hueDiffD = Math.min(Math.abs(baseLch.h - lo_dLch.h), 360 - Math.abs(baseLch.h - lo_dLch.h));
        const skipD = lo_dLch.C > 0.04 && hueDiffD < 30;
        if (!skipD) {
          expect(ColorMath.deltaE(lc_dLab, lo_dLab)).toBeGreaterThanOrEqual(0.12);
        }
      });
    });

    it("should successfully trigger the fallback path for severe crash cases without throwing errors", () => {
      const pathologicalInputs: ThemeInputs = {
        base: "#ff0000",
        bo_l: "#ffffff",
        bo_d: "#000000",
        to_l: "#ff0000",
        to_d: "#ff0000",
        lo_l: "#ff0100",
        lo_d: "#ff0100",
      };

      const resolve = () => ColorOptimizer.optimize(pathologicalInputs);
      expect(resolve).not.toThrow();

      const output = resolve();
      expect(output.lc_l).toBeDefined();
      expect(output.lc_d).toBeDefined();
    });
  });

  describe("Multi-rule collision avoidance", () => {
    it("forces a new link color away from EVERY existing rule's link, not just the most recent one", () => {
      const inputs: ThemeInputs = {
        base: "#7a22ff",
        bo_l: "#ffffff",
        bo_d: "#1e1e1e",
        to_l: "#2e2e2e",
        to_d: "#dbdbdb",
        lo_l: "#2463d1",
        lo_d: "#58a6ff",
      };

      // First, compute two baseline link colors with no collision constraint.
      const solo1 = ColorOptimizer.optimize(inputs);
      const solo2 = ColorOptimizer.optimize(inputs);

      // Now ask the optimizer to find a NEW link color that is at least
      // minDeltaE away from BOTH of the previously-chosen link colors.
      const withCollisions = ColorOptimizer.optimize(
        inputs,
        { light: [solo1.lc_l, solo2.lc_l], dark: [solo1.lc_d, solo2.lc_d] },
        DEFAULT_LINK_TUNING
      );

      const candidateLight = ColorMath.rgbToOklab(ColorMath.hexToRgb(withCollisions.lc_l));
      const candidateDark = ColorMath.rgbToOklab(ColorMath.hexToRgb(withCollisions.lc_d));
      const existing1Light = ColorMath.rgbToOklab(ColorMath.hexToRgb(solo1.lc_l));
      const existing2Light = ColorMath.rgbToOklab(ColorMath.hexToRgb(solo2.lc_l));
      const existing1Dark = ColorMath.rgbToOklab(ColorMath.hexToRgb(solo1.lc_d));
      const existing2Dark = ColorMath.rgbToOklab(ColorMath.hexToRgb(solo2.lc_d));

      expect(ColorMath.deltaE(candidateLight, existing1Light)).toBeGreaterThanOrEqual(DEFAULT_LINK_TUNING.minDeltaE);
      expect(ColorMath.deltaE(candidateLight, existing2Light)).toBeGreaterThanOrEqual(DEFAULT_LINK_TUNING.minDeltaE);
      expect(ColorMath.deltaE(candidateDark, existing1Dark)).toBeGreaterThanOrEqual(DEFAULT_LINK_TUNING.minDeltaE);
      expect(ColorMath.deltaE(candidateDark, existing2Dark)).toBeGreaterThanOrEqual(DEFAULT_LINK_TUNING.minDeltaE);
    });
  });
});

describe("Manual Base Color Model", () => {
  const lightTheme: SingleThemeInputs = {
    backgroundHex: "#ffffff",
    textHex: "#242424",
    defaultLinkHex: "#2463d1",
    isLight: true,
  };

  const sameAsDefaultLinkHue = lightTheme.defaultLinkHex;

  function makeMapping(overrides: Partial<import("../settings").PropertyColorMapping> = {}): import("../settings").PropertyColorMapping {
    return {
      id: "rule-1",
      baseColor: "#4f8cc9",
      property: "status",
      value: "done",
      colorLight: "",
      colorDark: "",
      isAutoLight: true,
      isAutoDark: true,
      matchType: "exact",
      linkColorLight: "",
      linkColorDark: "",
      isAutoLinkLight: true,
      isAutoLinkDark: true,
      ...overrides,
    };
  }

  it("uses the user-selected base color hue, not the theme accent", () => {
    const a = makeMapping({ baseColor: "#2050c0" });
    const b = makeMapping({ baseColor: "#c02050", id: "rule-2" });
    const rA = ColorOptimizer.computeRuleColors(a, [a], lightTheme, [], DEFAULT_LINK_TUNING);
    const rB = ColorOptimizer.computeRuleColors(b, [b], lightTheme, [], DEFAULT_LINK_TUNING);
    const hueA = ColorMath.oklabToOklch(ColorMath.rgbToOklab(ColorMath.hexToRgb(rA.backgroundHex))).h;
    const hueB = ColorMath.oklabToOklch(ColorMath.rgbToOklab(ColorMath.hexToRgb(rB.backgroundHex))).h;
    expect(Math.abs(hueA - hueB)).toBeGreaterThan(30);
  });


  it("keeps this rule's link readable on other rules' backgrounds", () => {
    const a = makeMapping({ id: "a", baseColor: "#1f9e89" });
    const b = makeMapping({ id: "b", baseColor: "#a83280" });
    const rA = ColorOptimizer.computeRuleColors(a, [a, b], lightTheme, [], DEFAULT_LINK_TUNING);
    const rB = ColorOptimizer.computeRuleColors(b, [a, b], lightTheme, [], DEFAULT_LINK_TUNING);
    const contrast = ColorMath.getContrast(ColorMath.hexToRgb(rA.linkHex), ColorMath.hexToRgb(rB.backgroundHex));
    expect(contrast).toBeGreaterThanOrEqual(DEFAULT_LINK_TUNING.minContrast);
  });

  it("flags fallback instead of silently returning an unchecked color", () => {
    const pathological = makeMapping({ baseColor: sameAsDefaultLinkHue });
    const result = ColorOptimizer.computeRuleColors(pathological, [pathological], lightTheme, [], DEFAULT_LINK_TUNING);
    expect(result.fallbackUsed === true || ColorMath.getContrast(
      ColorMath.hexToRgb(result.linkHex), ColorMath.hexToRgb(lightTheme.backgroundHex),
    ) >= DEFAULT_LINK_TUNING.minContrast).toBe(true);
  });
});
