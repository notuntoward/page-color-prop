import { describe, it, expect, beforeEach, vi } from 'vitest';
import { findMatchingColorMappings, computeAutoLinkHex, readThemeCssVar } from '../link-color-service';
import { LinkDecorator } from '../link-decorator';
import type { PropertyColorMapping } from '../settings';

class MinimalPlugin {
	settings!: import('../settings').PageColorPropSettings;
	isDarkTheme: boolean = false;
	app: any = {
		metadataCache: { getFileCache: () => null, getFirstLinkpathDest: () => null },
		workspace: { getLeavesOfType: () => [], getActiveViewOfType: () => null }
	};
}

function mapping(overrides: Partial<PropertyColorMapping> = {}): PropertyColorMapping {
  return {
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
      to_l: '#2e2e2e', to_d: '#dbdbdb',
      lo_l: '#2463d1', lo_d: '#58a6ff'
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
        getActiveViewOfType: vi.fn(() => null)
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

  it('getResolvedLinkColor returns the manual link color when not in auto mode', () => {
    const plugin = makePlugin([
      mapping({ linkColorLight: '#ff00ff', isAutoLinkLight: false })
    ]);
    const decorator = new LinkDecorator(plugin);
    const color = decorator.getResolvedLinkColor(plugin.settings.colorMappings[0]);
    expect(color).toBe('#ff00ff');
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
