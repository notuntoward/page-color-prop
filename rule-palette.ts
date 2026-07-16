// ============================================================================
// rule-palette.ts
// ============================================================================
// PURPOSE: Pure helpers that decide which color family a Page Color Prop
// rule belongs to, relative to the theme accent.
//
// No Obsidian dependencies. No DOM access. Fully unit-testable.
//
// WHY THIS EXISTS
//   The theme accent is now used as a *palette anchor*, not as the direct
//   base color for every rule. Many Obsidian themes set their default link
//   color to the accent itself, so if we picked the accent as the rule's
//   base hue, the optimizer would be asked to find a link color that is
//   distinct from the accent — which is the very color it just started
//   from. That forces large hue rotations and ugly output.
//
//   Instead, we:
//     1. Compute a small set of curated hue offsets around the accent.
//     2. Assign each rule a stable, deterministic offset by hashing its id.
//     3. Derive a "base" Oklch color from (accent + offset) to seed the
//        optimizer. The optimizer then decides the final display color
//        after satisfying contrast / Delta E / gamut constraints.
//
//   Because the assignment depends only on the set of rule ids (and is
//   stable across list reordering), a rule keeps its visual identity
//   even when the user moves it up or down in the settings.
// ============================================================================

import type { OKLCh } from './color-optimizer';

/** FNV-1a 32-bit hash. Deterministic, no crypto dependency. */
export function stableHash(text: string): number {
  let hash = 2166136261;

  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

/**
 * Curated hue offsets (in degrees) applied to the theme accent to
 * produce each rule's preferred base hue. Read from the comment in the
 * spec: blue -> teal/cyan (60), violet (-60), green (120), magenta (-120),
 * orange (180). The order here is also the slot order used by
 * `assignRuleHueOffsets` when more rules than slots need to be placed.
 */
export const RULE_HUE_OFFSETS = [
  60,    // blue -> teal/cyan
  -60,   // blue -> indigo/violet
  120,   // blue -> green
  -120,  // blue -> magenta/red
  180,   // blue -> orange
] as const;

/**
 * Assigns a unique palette slot to each rule id, in one deterministic
 * pass. Sorting ids before assignment means the result depends on the
 * SET of rule ids, not their display order — so reordering rules in the
 * settings UI does not recolor them.
 *
 * Up to five rules receive unique preferred offsets. If there are more,
 * a sixth rule will reuse the first available slot; the optimizer's
 * existing Delta E collision check remains the safety mechanism in that
 * case.
 */
export function assignRuleHueOffsets(
  ruleIds: string[],
): Map<string, number> {
  const result = new Map<string, number>();
  const usedSlots = new Set<number>();

  const sortedIds = [...ruleIds].sort();

  for (const ruleId of sortedIds) {
    const preferredSlot = stableHash(ruleId) % RULE_HUE_OFFSETS.length;

    let selectedSlot = preferredSlot;

    for (let step = 0; step < RULE_HUE_OFFSETS.length; step++) {
      const candidateSlot =
        (preferredSlot + step) % RULE_HUE_OFFSETS.length;

      if (!usedSlots.has(candidateSlot)) {
        selectedSlot = candidateSlot;
        break;
      }
    }

    usedSlots.add(selectedSlot);
    result.set(ruleId, RULE_HUE_OFFSETS[selectedSlot]);
  }

  return result;
}

/**
 * Returns a candidate-ordering of hue offsets to try for a rule.
 * The rule's preferred palette offset comes first; the remaining curated
 * offsets follow in slot order. If the curated palette cannot satisfy
 * all hard constraints, the caller falls back to a wider set of small
 * offsets (the "fallback" pool).
 */
export function orderedRuleHueOffsets(
  preferredOffset: number,
): number[] {
  const paletteOffsets = [
    preferredOffset,
    ...RULE_HUE_OFFSETS.filter(offset => offset !== preferredOffset),
  ];

  const fallbackOffsets = [30, -30, 90, -90, 150, -150];

  return [...paletteOffsets, ...fallbackOffsets];
}

/**
 * Derives the rule's base LCh color from the theme accent and the
 * rule's preferred hue offset. The result is a *family identity* for
 * the rule, not necessarily the displayed color — the optimizer will
 * choose final lightness/chroma after checking constraints.
 *
 * Seed chroma is clamped into a narrow band (0.08 .. 0.14) so a
 * near-gray theme accent does not create a near-gray category, and a
 * highly-saturated theme accent does not create an overly intense
 * category seed.
 */
export function deriveBaseLch(
  accentLch: OKLCh,
  hueOffset: number,
): OKLCh {
  return {
    L: accentLch.L,
    C: Math.max(0.08, Math.min(0.14, accentLch.C * 0.85)),
    h: (accentLch.h + hueOffset + 360) % 360,
  };
}
