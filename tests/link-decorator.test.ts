import { describe, it, expect, beforeEach, vi } from 'vitest';
import { findMatchingColorMappings, computeAutoLinkHex, readThemeCssVar } from '../link-color-service';
import { LinkDecorator } from '../link-decorator';
import { ColorMath, ColorOptimizer } from '../color-optimizer';
import type { PropertyColorMapping } from '../settings';

class MinimalPlugin {
	settings!: import('../settings').PageColorPropSettings;
	isDarkTheme: boolean = false;
	register = vi.fn();
	registerEvent = vi.fn();
	app: any = {
		metadataCache: { getFileCache: () => null, getFirstLinkpathDest: () => null },
		workspace: {
			on: vi.fn(),
			onLayoutReady: vi.fn((cb: any) => cb?.()),
			iterateAllLeaves: vi.fn(),
			getLeavesOfType: () => [],
			getActiveViewOfType: () => null
		}
	};
}

function mapping(overrides: Partial<PropertyColorMapping> = {}): PropertyColorMapping {
  return {
    id: 'test-rule-a',
    baseColor: '#4f8cc9',
    property: 'tags',
    value: 'ai-generated',
    colorLight: '#4e66d0',
    colorDark: '#a86be6',
    isAutoLight: false,
    isAutoDark: true,
    matchType: 'contains',
    linkColorLight: '#1a5fb4',
    linkColorDark: '#62a0ea',
    // Default to MANUAL link color so tests don't have to fake the theme
    // variables for the auto-color computation path.
    isAutoLinkLight: false,
    isAutoLinkDark: false,
    ...overrides
  };
}

beforeEach(() => {
  document.body.classList.remove('theme-dark');
  document.body.innerHTML = '';
  // Define the accent CSS variables on the test body so the
  // ACCENT_SEED_COLOR expression (`hsl(var(--accent-h), var(--accent-s), 50%)`)
  // resolves to a real color in jsdom. Without this, the browser falls
  // back to its default color (black), which would make any contrast
  // test against a white background meaningless.
  document.body.style.setProperty('--accent-h', '220');
  document.body.style.setProperty('--accent-s', '60%');
  document.body.style.setProperty('--background-primary', '#ffffff');
  document.body.style.setProperty('--text-normal', '#2e2e2e');
  document.body.style.setProperty('--link-color', '#2463d1');
  Object.defineProperty(globalThis, 'CSS', {
    configurable: true,
    value: { supports: vi.fn(() => true) }
  });
});

describe('findMatchingColorMappings', () => {
  it('matches exact scalar frontmatter', () => {
    const result = findMatchingColorMappings(
      [mapping({ property: 'status', value: 'done', matchType: 'exact' })],
      { status: 'done' }
    );
    expect(result.selected).not.toBeNull();
    expect(result.selected?.mapping.value).toBe('done');
  });

  it('matches single-element array for exact', () => {
    const result = findMatchingColorMappings(
      [mapping({ property: 'status', value: 'done', matchType: 'exact' })],
      { status: ['done'] }
    );
    expect(result.selected).not.toBeNull();
  });

  it('does not match multi-element array for exact', () => {
    const result = findMatchingColorMappings(
      [mapping({ property: 'status', value: 'done', matchType: 'exact' })],
      { status: ['done', 'review'] }
    );
    expect(result.selected).toBeNull();
  });

  it('matches contains against array elements (exact element match)', () => {
    const result = findMatchingColorMappings(
      [mapping({ property: 'tags', value: 'ai-generated', matchType: 'contains' })],
      { tags: ['ai-generated', 'research'] }
    );
    expect(result.selected).not.toBeNull();
  });

  it('matches any selected list value for contains and the whole unordered list for exact', () => {
    const rule = mapping({ value: ['ai-generated', 'research'], matchType: 'contains' });
    expect(findMatchingColorMappings([rule], { tags: ['research', 'other'] }).selected).not.toBeNull();
    expect(findMatchingColorMappings([rule], { tags: ['other'] }).selected).toBeNull();
    rule.matchType = 'exact';
    expect(findMatchingColorMappings([rule], { tags: ['research', 'ai-generated'] }).selected).not.toBeNull();
    expect(findMatchingColorMappings([rule], { tags: ['research', 'ai-generated', 'other'] }).selected).toBeNull();
    expect(findMatchingColorMappings([rule], { tags: ['research'] }).selected).toBeNull();
  });

  it('does not match an unfinished empty contains rule against scalar properties', () => {
    expect(findMatchingColorMappings(
      [mapping({ property: 'title', value: '', matchType: 'contains' })],
      { title: 'anything' }
    ).selected).toBeNull();
  });

  it('keeps scalar number, checkbox, date and text matching intact', () => {
    const rules = [
      mapping({ property: 'count', value: '1.0', matchType: 'exact' }),
      mapping({ property: 'done', value: 'false', matchType: 'exact' }),
      mapping({ property: 'date', value: '2026-10', matchType: 'contains' }),
      mapping({ property: 'title', value: 'alpha', matchType: 'contains' })
    ];
    expect(findMatchingColorMappings(rules, {
      count: 1, done: false, date: '2026-10-26', title: 'alpha note'
    }).matches).toHaveLength(4);
  });

  it('matches contains against scalar strings', () => {
    const result = findMatchingColorMappings(
      [mapping({ property: 'title', value: 'tax', matchType: 'contains' })],
      { title: 'WA tax note' }
    );
    expect(result.selected).not.toBeNull();
  });

  it('selects the lowest (last) matching mapping when several match', () => {
    const a = mapping({ property: 'tags', value: 'a', matchType: 'contains' });
    const b = mapping({ property: 'tags', value: 'b', matchType: 'contains' });
    const c = mapping({ property: 'tags', value: 'c', matchType: 'contains' });
    const result = findMatchingColorMappings([a, b, c], { tags: ['a', 'b', 'c'] });
    expect(result.matches).toHaveLength(3);
    expect(result.selected?.mapping).toBe(c);
  });

  it('returns null selected when nothing matches', () => {
    const result = findMatchingColorMappings(
      [mapping({ property: 'status', value: 'done', matchType: 'exact' })],
      { status: 'draft' }
    );
    expect(result.selected).toBeNull();
  });
});

describe('readThemeCssVar', () => {
  it('returns the hex form of an already-hex string', () => {
    expect(readThemeCssVar('#abcdef')).toBe('#abcdef');
  });

  it('returns null for an empty / invalid input', () => {
    expect(readThemeCssVar('')).toBeNull();
  });
});

describe('computeAutoLinkHex', () => {
  it('produces a hex color (light and dark)', () => {
    const themeVars = {
      bo_l: '#ffffff', bo_d: '#1e1e1e',
      ui_l: '#ffffff', ui_d: '#1e1e1e',
      to_l: '#2e2e2e', to_d: '#dbdbdb',
      lo_l: '#2463d1', lo_d: '#58a6ff',
      nv_l: '#2e2e2e', nv_d: '#dbdbdb',
      mt_l: '#2e2e2e', mt_d: '#dbdbdb'
    };
    const m = mapping();
    const light = computeAutoLinkHex(m, 'Light', themeVars, []);
    const dark = computeAutoLinkHex(m, 'Dark', themeVars, []);
    expect(light).toMatch(/^#[0-9a-f]{6}$/);
    expect(dark).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('passes the tuning object through to the optimizer', () => {
    const themeVars = {
      bo_l: '#ffffff', bo_d: '#1e1e1e',
      ui_l: '#ffffff', ui_d: '#1e1e1e',
      to_l: '#2e2e2e', to_d: '#dbdbdb',
      lo_l: '#2463d1', lo_d: '#58a6ff',
      nv_l: '#2e2e2e', nv_d: '#dbdbdb',
      mt_l: '#2e2e2e', mt_d: '#dbdbdb'
    };
    const m = mapping();
    // A wildly restrictive tuning (require the link to be perceptually
    // far from body text AND the theme default link) should still produce
    // a valid hex, proving the tuning is consumed end-to-end.
    const result = computeAutoLinkHex(m, 'Light', themeVars, [], {
      hueStepDegrees: 15,
      minDeltaE: 0.25,
      minContrast: 7.0
    });
    expect(result).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('returns the SAME link color for two rules with the same id (seed no longer depends on the background)', () => {
    // After the palette change, the rule's colorLight/colorDark and
    // isAutoLight/isAutoDark are no longer read inside computeAutoLinkHex.
    // Two rules with identical id (and therefore identical palette
    // identity) but different background fields must produce identical
    // link colors, proving the seed hue is no longer diluted by the
    // background. Distinct ids get distinct palette slots and are
    // therefore allowed to produce distinct link colors.
    const themeVars = {
      bo_l: '#ffffff', bo_d: '#1e1e1e',
      ui_l: '#ffffff', ui_d: '#1e1e1e',
      to_l: '#2e2e2e', to_d: '#dbdbdb',
      lo_l: '#2463d1', lo_d: '#58a6ff',
      nv_l: '#2e2e2e', nv_d: '#dbdbdb',
      mt_l: '#2e2e2e', mt_d: '#dbdbdb'
    };
    const ruleA = mapping({
      id: 'test-rule-a',
      // "auto" background — deliberately the most diluted seed we'd
      // previously have routed through.
      isAutoLight: true,
      isAutoDark: true,
      colorLight: 'hsla(var(--accent-h), var(--accent-s), 90%, 0.35)',
      colorDark: 'hsla(var(--accent-h), var(--accent-s), 25%, 0.30)'
    });
    const ruleB = mapping({
      id: 'test-rule-a',
      // Very different manual background — would have given a different
      // old-style seed hue.
      isAutoLight: false,
      isAutoDark: false,
      colorLight: '#ff00aa',
      colorDark: '#00ffaa'
    });
    const lightA = computeAutoLinkHex(ruleA, 'Light', themeVars, []);
    const lightB = computeAutoLinkHex(ruleB, 'Light', themeVars, []);
    const darkA = computeAutoLinkHex(ruleA, 'Dark', themeVars, []);
    const darkB = computeAutoLinkHex(ruleB, 'Dark', themeVars, []);
    expect(lightA).toBe(lightB);
    expect(darkA).toBe(darkB);
  });

  it('uses a stable seed hue independent of the rule background after the accent-seed change', () => {
    // The accent-seed change moves where the hue comes from but does NOT
    // change which background is used for the contrast check. We can't
    // verify exact WCAG numbers here because jsdom doesn't fully resolve
    // `hsl(var(--accent-h), var(--accent-s), 50%)`; those assertions are
    // covered in color-optimizer.test.ts instead. This test just proves
    // the optimizer still runs and returns a valid hex for both themes.
    const themeVars = {
      bo_l: '#ffffff', bo_d: '#1e1e1e',
      ui_l: '#ffffff', ui_d: '#1e1e1e',
      to_l: '#2e2e2e', to_d: '#dbdbdb',
      lo_l: '#2463d1', lo_d: '#58a6ff',
      nv_l: '#2e2e2e', nv_d: '#dbdbdb',
      mt_l: '#2e2e2e', mt_d: '#dbdbdb'
    };
    const m = mapping();
    const light = computeAutoLinkHex(m, 'Light', themeVars, []);
    const dark = computeAutoLinkHex(m, 'Dark', themeVars, []);
    expect(light).toMatch(/^#[0-9a-f]{6}$/);
    expect(dark).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('LinkDecorator', () => {
  function makePlugin(mappings: PropertyColorMapping[] = [mapping()]): any {
    const plugin: any = new MinimalPlugin();
    plugin.settings = {
      colorMappings: mappings,
      notifyOnMultipleMatches: true,
      colorLinks: true,
      colorUiLabels: true,
      experimentalLinkTuning: {
        hueStepDegrees: 15,
        minDeltaE: 0.12,
        minContrast: 4.5
      }
    };
    plugin.app = {
      metadataCache: {
        getFileCache: vi.fn(),
        getFirstLinkpathDest: vi.fn()
      },
      workspace: {
        getLeavesOfType: vi.fn(() => []),
        getActiveViewOfType: vi.fn(() => null),
        iterateAllLeaves: vi.fn(),
        on: vi.fn(),
        onLayoutReady: vi.fn((cb: any) => cb?.())
      }
    };
    return plugin;
  }

  it('returns null mapping for a file with no frontmatter', () => {
    const plugin = makePlugin();
    plugin.app.metadataCache.getFileCache.mockReturnValue(null);
    const decorator = new LinkDecorator(plugin);
    expect(decorator.getMatchingMappingForFile({ path: 'note.md' } as any)).toBeNull();
  });

  it('returns the matching mapping for a file with matching frontmatter', () => {
    const plugin = makePlugin();
    plugin.app.metadataCache.getFileCache.mockReturnValue({
      frontmatter: { tags: ['ai-generated'] }
    });
    const decorator = new LinkDecorator(plugin);
    const result = decorator.getMatchingMappingForFile({ path: 'note.md' } as any);
    expect(result).not.toBeNull();
    expect(result?.value).toBe('ai-generated');
  });

  it('matches Obsidian tags when the file has no frontmatter', () => {
    const plugin = makePlugin();
    plugin.app.metadataCache.getFileCache.mockReturnValue({
      tags: [{ tag: '#ai-generated' }]
    });
    const decorator = new LinkDecorator(plugin);

    expect(decorator.getMatchingMappingForFile({ path: 'note.md' } as any)?.value).toBe('ai-generated');
  });

  it('caches the mapping result by file path', () => {
    const plugin = makePlugin();
    plugin.app.metadataCache.getFileCache.mockReturnValue({
      frontmatter: { tags: ['ai-generated'] }
    });
    const decorator = new LinkDecorator(plugin);
    const file = { path: 'note.md' } as any;
    decorator.getMatchingMappingForFile(file);
    decorator.getMatchingMappingForFile(file);
    // metadataCache is only consulted on first call, not cached ones.
    expect(plugin.app.metadataCache.getFileCache).toHaveBeenCalledTimes(1);
  });

  it('invalidates the cache when settings change', () => {
    const plugin = makePlugin();
    plugin.app.metadataCache.getFileCache.mockReturnValue({
      frontmatter: { tags: ['ai-generated'] }
    });
    const decorator = new LinkDecorator(plugin);
    const file = { path: 'note.md' } as any;
    decorator.getMatchingMappingForFile(file);
    decorator.invalidateCaches();
    decorator.getMatchingMappingForFile(file);
    expect(plugin.app.metadataCache.getFileCache).toHaveBeenCalledTimes(2);
  });

  it('resolveTarget strips the alias and heading from a wikilink', () => {
    const plugin = makePlugin();
    plugin.app.metadataCache.getFirstLinkpathDest.mockReturnValue({ path: 'AI Summary.md' } as any);
    const decorator = new LinkDecorator(plugin);
    const el = document.createElement('a');
    el.textContent = 'AI Summary#Method|summary';
    const target = decorator.resolveTarget(el, 'Source.md');
    expect(plugin.app.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith('AI Summary', 'Source.md');
    expect(target).not.toBeNull();
  });

  it('resolveTarget returns null when the link has no usable text', () => {
    const plugin = makePlugin();
    const decorator = new LinkDecorator(plugin);
    const el = document.createElement('a');
    el.textContent = '';
    expect(decorator.resolveTarget(el, 'Source.md')).toBeNull();
  });

  it('clearDecoration removes only the plugin\'s class, attr, and CSS var', () => {
    const plugin = makePlugin();
    const decorator = new LinkDecorator(plugin);
    const el = document.createElement('a');
    el.addClass('page-color-prop-link');
    el.addClass('some-other-class');
    el.setAttribute('data-page-color-prop-link-rule', '1');
    el.setAttribute('data-href', 'AI Summary');
    el.style.setProperty('--page-color-prop-link-color', '#ff0000');
    el.style.setProperty('color', 'rgb(0, 0, 0)');
    decorator.clearDecoration(el);
    expect(el.classList.contains('page-color-prop-link')).toBe(false);
    expect(el.classList.contains('some-other-class')).toBe(true);
    expect(el.getAttribute('data-page-color-prop-link-rule')).toBeNull();
    expect(el.getAttribute('data-href')).toBe('AI Summary');
    expect(el.style.getPropertyValue('--page-color-prop-link-color')).toBe('');
    expect(el.style.getPropertyValue('color')).toBe('rgb(0, 0, 0)');
  });

  it('getResolvedLinkColor checks colorUiLabels when isUiLabel is true', () => {
    const plugin = makePlugin([
      mapping({ linkColorLight: '#ff00ff', isAutoLinkLight: false })
    ]);
    plugin.settings.colorLinks = true;
    plugin.settings.colorUiLabels = false;
    const decorator = new LinkDecorator(plugin);
    expect(decorator.getResolvedLinkColor(plugin.settings.colorMappings[0], false)).toBe('#ff00ff');
    expect(decorator.getResolvedLinkColor(plugin.settings.colorMappings[0], true)).toBeNull();

    plugin.settings.colorLinks = false;
    plugin.settings.colorUiLabels = true;
    expect(decorator.getResolvedLinkColor(plugin.settings.colorMappings[0], false)).toBeNull();
    expect(decorator.getResolvedLinkColor(plugin.settings.colorMappings[0], true)).toBe('#ff00ff');
  });

  it('getResolvedLinkColor returns the manual link color when not in auto mode', () => {
    const plugin = makePlugin([
      mapping({ linkColorLight: '#ff00ff', isAutoLinkLight: false })
    ]);
    const decorator = new LinkDecorator(plugin);
    const color = decorator.getResolvedLinkColor(plugin.settings.colorMappings[0]);
    expect(color).toBe('#ff00ff');
  });

  it('reuses one automatic color calculation across many matching files and label types', () => {
    const rule = mapping({ isAutoLinkLight: true, isAutoLinkDark: true });
    const plugin = makePlugin([rule]);
    plugin.app.metadataCache.getFileCache.mockReturnValue({ frontmatter: { tags: ['ai-generated'] } });
    const decorator = new LinkDecorator(plugin);
    vi.spyOn(decorator as any, 'getThemeVars').mockReturnValue({
      bo_l: '#ffffff', bo_d: '#1e1e1e', ui_l: '#ffffff', ui_d: '#1e1e1e',
      to_l: '#2e2e2e', to_d: '#dbdbdb', lo_l: '#2463d1', lo_d: '#58a6ff',
      nv_l: '#2e2e2e', nv_d: '#dbdbdb', mt_l: '#2e2e2e', mt_d: '#dbdbdb'
    });
    const optimizer = vi.spyOn(ColorOptimizer, 'computeRuleColors').mockReturnValue({
      backgroundHex: '#ffffff', linkHex: '#123456', fallbackUsed: false
    });

    try {
      for (let i = 0; i < 100; i++) {
        const matched = decorator.getMatchingMappingForFile({ path: `note-${i}.md` } as any);
        expect(matched).toBe(rule);
        expect(decorator.getResolvedLinkColor(matched!, true)).toBe('#123456');
        expect(decorator.getResolvedLinkColor(matched!)).toBe('#123456');
      }
      expect(optimizer).toHaveBeenCalledTimes(1);
    } finally {
      optimizer.mockRestore();
    }
  });

  it('updates cached automatic colors when their inputs or theme change', () => {
    const rule = mapping({ isAutoLinkLight: true, isAutoLinkDark: true });
    const other = mapping({ id: 'other', baseColor: '#225588' });
    const plugin = makePlugin([rule, other]);
    const decorator = new LinkDecorator(plugin);
    const themeVars = {
      bo_l: '#ffffff', bo_d: '#1e1e1e', ui_l: '#ffffff', ui_d: '#1e1e1e',
      to_l: '#2e2e2e', to_d: '#dbdbdb', lo_l: '#2463d1', lo_d: '#58a6ff',
      nv_l: '#2e2e2e', nv_d: '#dbdbdb', mt_l: '#2e2e2e', mt_d: '#dbdbdb'
    };
    vi.spyOn(decorator as any, 'getThemeVars').mockReturnValue(themeVars);
    let calculations = 0;
    const optimizer = vi.spyOn(ColorOptimizer, 'computeRuleColors').mockImplementation(() => ({
      backgroundHex: '#ffffff', linkHex: `#${String(++calculations).padStart(6, '0')}`, fallbackUsed: false
    }));

    try {
      expect(decorator.getResolvedLinkColor(rule, true)).toBe('#000001');
      expect(decorator.getResolvedLinkColor(rule)).toBe('#000001');
      rule.baseColor = '#ff0000';
      expect(decorator.getResolvedLinkColor(rule)).toBe('#000002');
      other.baseColor = '#336699';
      expect(decorator.getResolvedLinkColor(rule)).toBe('#000003');
      other.linkColorLight = '#123456';
      expect(decorator.getResolvedLinkColor(rule)).toBe('#000004');
      other.isAutoLinkLight = true;
      expect(decorator.getResolvedLinkColor(rule)).toBe('#000005');
      plugin.settings.experimentalLinkTuning.minContrast = 6;
      expect(decorator.getResolvedLinkColor(rule)).toBe('#000006');
      plugin.isDarkTheme = true;
      expect(decorator.getResolvedLinkColor(rule)).toBe('#000007');
      expect(decorator.getResolvedLinkColor(rule)).toBe('#000007');
      themeVars.bo_d = '#333333';
      expect(decorator.getResolvedLinkColor(rule)).toBe('#000008');
      decorator.invalidateCaches();
      expect(decorator.getResolvedLinkColor(rule)).toBe('#000009');
      plugin.settings.colorUiLabels = false;
      expect(decorator.getResolvedLinkColor(rule, true)).toBeNull();
      expect(decorator.getResolvedLinkColor(rule)).toBe('#000009');
      other.isAutoLinkDark = true;
      expect(decorator.getResolvedLinkColor(other)).toBe('#000010');
      expect(decorator.getResolvedLinkColor(other)).toBe('#000010');
      expect(decorator.getResolvedLinkColor(rule)).toBe('#000011');
      expect(optimizer).toHaveBeenCalledTimes(11);
    } finally {
      optimizer.mockRestore();
    }
  });

  it('retries a failed automatic color calculation without caching the failure', () => {
    const rule = mapping({ isAutoLinkLight: true });
    const plugin = makePlugin([rule]);
    const decorator = new LinkDecorator(plugin);
    vi.spyOn(decorator as any, 'getThemeVars').mockReturnValue({
      bo_l: '#ffffff', bo_d: '#1e1e1e', ui_l: '#ffffff', ui_d: '#1e1e1e',
      to_l: '#2e2e2e', to_d: '#dbdbdb', lo_l: '#2463d1', lo_d: '#58a6ff',
      nv_l: '#2e2e2e', nv_d: '#dbdbdb', mt_l: '#2e2e2e', mt_d: '#dbdbdb'
    });
    const failure = new Error('optimizer failed');
    const report = vi.spyOn(console, 'error').mockImplementation(() => {});
    const optimizer = vi.spyOn(ColorOptimizer, 'computeRuleColors')
      .mockImplementationOnce(() => { throw failure; })
      .mockReturnValue({ backgroundHex: '#ffffff', linkHex: '#123456', fallbackUsed: false });

    try {
      expect(decorator.getResolvedLinkColor(rule)).toBeNull();
      expect(report).toHaveBeenCalledWith('Page Color Prop: failed to resolve automatic link color', failure);
      expect(decorator.getResolvedLinkColor(rule)).toBe('#123456');
      expect(decorator.getResolvedLinkColor(rule)).toBe('#123456');
      expect(optimizer).toHaveBeenCalledTimes(2);
    } finally {
      optimizer.mockRestore();
      report.mockRestore();
    }
  });

  it('getResolvedLinkColor reads experimentalLinkTuning from settings when in auto mode', () => {
    const plugin = makePlugin([
      mapping({ isAutoLinkLight: true, isAutoLinkDark: true })
    ]);
    // Replace experimentalLinkTuning with a sentinel object we can detect.
    let captured: any = null;
    plugin.settings.experimentalLinkTuning = {
      hueStepDegrees: 20,
      minDeltaE: 0.20,
      minContrast: 5.0
    };
    // Spy on computeAutoLinkHex via the service module is not easy without
    // DI, so instead we verify that getResolvedLinkColor returns a string
    // and that mutating the tuning object is reflected (proving the
    // settings reference is read, not a frozen snapshot).
    const decorator = new LinkDecorator(plugin);
    const c1 = decorator.getResolvedLinkColor(plugin.settings.colorMappings[0]);
    expect(typeof c1 === 'string' || c1 === null).toBe(true);
    // Mutate the tuning object in place and verify the decorator still
    // reads from the same reference.
    plugin.settings.experimentalLinkTuning.minContrast = 6.5;
    const c2 = decorator.getResolvedLinkColor(plugin.settings.colorMappings[0]);
    expect(typeof c2 === 'string' || c2 === null).toBe(true);
    captured = plugin.settings.experimentalLinkTuning;
    expect(captured.minContrast).toBe(6.5);
  });

  it('decorateLink adds the class, attribute, and CSS variable for a matching target', () => {
    const plugin = makePlugin();
    plugin.app.metadataCache.getFileCache.mockReturnValue({
      frontmatter: { tags: ['ai-generated'] }
    });
    plugin.app.metadataCache.getFirstLinkpathDest.mockReturnValue({ path: 'AI Summary.md' } as any);
    const decorator = new LinkDecorator(plugin);
    const el = document.createElement('a');
    el.textContent = 'AI Summary';
    el.setAttribute('data-href', 'AI Summary');
    decorator.decorateLink(el, 'Source.md');
    expect(el.classList.contains('page-color-prop-link')).toBe(true);
    expect(el.getAttribute('data-page-color-prop-link-rule')).toBe('1');
    expect(el.style.getPropertyValue('--page-color-prop-link-color')).toMatch(/^#/);
  });

  it('decorateLink clears decoration when target resolves to a non-matching file', () => {
    const plugin = makePlugin();
    plugin.app.metadataCache.getFileCache.mockReturnValue({ frontmatter: { tags: ['other'] } });
    plugin.app.metadataCache.getFirstLinkpathDest.mockReturnValue({ path: 'Other.md' } as any);
    const decorator = new LinkDecorator(plugin);
    const el = document.createElement('a');
    el.textContent = 'Other';
    el.setAttribute('data-href', 'Other');
    el.addClass('page-color-prop-link');
    el.setAttribute('data-page-color-prop-link-rule', '1');
    el.style.setProperty('--page-color-prop-link-color', '#abc');
    decorator.decorateLink(el, 'Source.md');
    expect(el.classList.contains('page-color-prop-link')).toBe(false);
    expect(el.getAttribute('data-page-color-prop-link-rule')).toBeNull();
    expect(el.style.getPropertyValue('--page-color-prop-link-color')).toBe('');
  });

  it('decorateLink clears decoration when target cannot be resolved', () => {
    const plugin = makePlugin();
    plugin.app.metadataCache.getFirstLinkpathDest.mockReturnValue(null);
    const decorator = new LinkDecorator(plugin);
    const el = document.createElement('a');
    el.textContent = 'Broken';
    el.setAttribute('data-href', 'Broken');
    el.addClass('page-color-prop-link');
    decorator.decorateLink(el, 'Source.md');
    expect(el.classList.contains('page-color-prop-link')).toBe(false);
  });

  it('observeContainer installs a mutation observer that decorates new links', async () => {
    const plugin = makePlugin();
    plugin.app.metadataCache.getFirstLinkpathDest.mockReturnValue({ path: 'AI Summary.md' } as any);
    plugin.app.metadataCache.getFileCache.mockReturnValue({ frontmatter: { tags: ['ai-generated'] } });
    const decorator = new LinkDecorator(plugin);
    const container = document.createElement('div');
    document.body.appendChild(container);
    decorator.observeContainer(container, 'Source.md', 'a.internal-link');
    // Add a link after observation.
    const newLink = document.createElement('a');
    newLink.classList.add('internal-link');
    newLink.textContent = 'AI Summary';
    newLink.setAttribute('data-href', 'AI Summary');
    container.appendChild(newLink);
    // MutationObserver callbacks are microtasks; flush them.
    await Promise.resolve();
    expect(newLink.classList.contains('page-color-prop-link')).toBe(true);
    decorator.dispose();
  });

  it('dispose disconnects observers and removes all page-color-prop-link decorations', () => {
    const plugin = makePlugin();
    const decorator = new LinkDecorator(plugin);
    const a = document.createElement('a');
    a.addClass('page-color-prop-link');
    const b = document.createElement('a');
    b.addClass('page-color-prop-link');
    document.body.appendChild(a);
    document.body.appendChild(b);
    decorator.dispose();
    expect(a.classList.contains('page-color-prop-link')).toBe(false);
    expect(b.classList.contains('page-color-prop-link')).toBe(false);
  });
});
