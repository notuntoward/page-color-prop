import { describe, expect, it, beforeEach, vi } from 'vitest';
import PageColorPropPlugin from '../main.ts';
import { DEFAULT_DARK_AUTO_COLOR, DEFAULT_LIGHT_AUTO_COLOR, type PageColorPropSettings, type PropertyColorMapping } from '../settings';
import { MarkdownView, mockedNotice } from './obsidian.mock';


function mapping(overrides: Partial<PropertyColorMapping> = {}): PropertyColorMapping {
  return {
    property: 'tags',
    value: 'ai-generated',
    colorLight: '#4e66d0',
    colorDark: '#a86be6',
    isAutoLight: false,
    isAutoDark: true,
    matchType: 'contains',
    ...overrides
  };
}

function createPlugin(overrides: Partial<PageColorPropSettings> = {}) {
  const plugin = Object.create(PageColorPropPlugin.prototype) as any;
  plugin.settings = {
    colorMappings: overrides.colorMappings ?? [mapping()],
    notifyOnMultipleMatches: overrides.notifyOnMultipleMatches ?? true
  };
  plugin.isDarkTheme = false;
  plugin.multipleMatchNoticeKeys = new Set<string>();
  plugin.pendingRetryHandles = new Set<number>();
  plugin.app = {
    workspace: {
      getLeavesOfType: vi.fn(() => [])
    },
    metadataCache: {
      getFileCache: vi.fn()
    }
  };
  plugin.loadData = vi.fn();
  plugin.saveData = vi.fn();
  return plugin;
}

interface TestMarkdownView extends MarkdownView {
  containerEl: HTMLElement;
  file?: any;
}

interface TestLeaf {
  view: TestMarkdownView;
}

function createLeaf(file?: any): TestLeaf {
  const view = new MarkdownView() as TestMarkdownView;
  view.file = file;
  view.containerEl = document.createElement('div');
  view.containerEl.setAttribute('data-type', 'markdown');

  return { view };
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.classList.remove('theme-dark');
  document.body.innerHTML = '';
  Object.defineProperty(globalThis, 'CSS', {
    configurable: true,
    value: {
      supports: vi.fn(() => true)
    }
  });
});

describe('PageColorPropPlugin', () => {
  it('loads default settings when saved data is missing or invalid', async () => {
    const plugin = createPlugin();
    plugin.loadData.mockResolvedValue(null);
    plugin.saveSettings = vi.fn();

    await plugin.loadSettings();

    expect(plugin.settings).toEqual({
      colorMappings: [],
      notifyOnMultipleMatches: true
    });
    expect(plugin.saveSettings).not.toHaveBeenCalled();

    plugin.loadData.mockResolvedValue({
      colorMappings: [
        {
          property: 'tags',
          value: 'ai-generated',
          matchType: 'regex'
        }
      ]
    });

    await plugin.loadSettings();

    expect(plugin.settings.colorMappings).toEqual([]);
  });

  it('registers events and applies colors when loaded', async () => {
    const workspace = {
      on: vi.fn((_eventName: string, callback: () => void) => callback()),
      getLeavesOfType: vi.fn(() => [])
    };
    const metadataCache = {
      on: vi.fn((_eventName: string, callback: () => void) => callback())
    };
    const plugin = createPlugin();
    plugin.app = { workspace, metadataCache };
    plugin.addSettingTab = vi.fn();
    plugin.registerEvent = vi.fn();
    plugin.updateThemeState = vi.fn();
    plugin.registerThemeChangeListener = vi.fn();
    plugin.applyColorsToAllLeaves = vi.fn();
    plugin.loadSettings = vi.fn();

    await plugin.onload();

    expect(plugin.loadSettings).toHaveBeenCalledTimes(1);
    expect(plugin.addSettingTab).toHaveBeenCalledTimes(1);
    expect(workspace.on).toHaveBeenCalledTimes(3);
    expect(metadataCache.on).toHaveBeenCalledTimes(1);
    expect(plugin.registerEvent).toHaveBeenCalledTimes(4);
    expect(plugin.updateThemeState).toHaveBeenCalledTimes(1);
    expect(plugin.registerThemeChangeListener).toHaveBeenCalledTimes(1);
    expect(plugin.applyColorsToAllLeaves).toHaveBeenCalledTimes(5);
  });

  it('removes styles and disconnects the theme observer when unloaded', () => {
    const disconnect = vi.fn();
    const plugin = createPlugin();
    plugin.removeAllStyles = vi.fn();
    plugin.themeObserver = { disconnect };

    plugin.onunload();

    expect(plugin.removeAllStyles).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('migrates legacy color mappings', async () => {
    const plugin = createPlugin();
    plugin.loadData.mockResolvedValue({
      colorMappings: [
        {
          property: 'tags',
          value: 'ai-generated',
          color: '#123456',
          matchType: 'contains'
        }
      ],
      notifyOnMultipleMatches: false
    });
    plugin.saveSettings = vi.fn();

    await plugin.loadSettings();

    expect(plugin.settings.colorMappings[0]).toMatchObject({
      property: 'tags',
      value: 'ai-generated',
      colorLight: '#123456',
      colorDark: '#123456',
      isAutoLight: false,
      isAutoDark: false,
      matchType: 'contains'
    });
    expect(plugin.settings.notifyOnMultipleMatches).toBe(false);
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
  });

  it('finds exact, contains, and lowest-priority matches', () => {
    const plugin = createPlugin({
      colorMappings: [
        mapping({ property: 'status', value: 'done', matchType: 'exact' }),
        mapping({ property: 'tags', value: 'ai-generated', matchType: 'contains' }),
        mapping({ property: 'priority', value: 'high', matchType: 'exact' }),
        mapping({ property: 'tags', value: 'research', matchType: 'contains' })
      ]
    });

    const result = plugin.findMatchingColorMappings({
      status: 'done',
      tags: ['ai-generated', 'research'],
      priority: 'high'
    });

    expect(result.matches).toHaveLength(4);
    expect(result.selected?.mapping.value).toBe('research');
  });

  it('matches single-item exact array values', () => {
    const plugin = createPlugin({
      colorMappings: [
        mapping({ property: 'status', value: 'done', matchType: 'exact' })
      ]
    });

    const result = plugin.findMatchingColorMappings({
      status: ['done']
    });

    expect(result.matches).toHaveLength(1);
    expect(result.selected?.mapping.value).toBe('done');
  });

  it('does not match missing, null, multi-value exact, or unmatched properties', () => {
    const plugin = createPlugin({
      colorMappings: [
        mapping({ property: 'status', value: 'done', matchType: 'exact' }),
        mapping({ property: 'tags', value: 'ai-generated', matchType: 'contains' })
      ]
    });

    expect(plugin.findMatchingColorMappings({ status: 'draft' }).selected).toBeNull();
    expect(plugin.findMatchingColorMappings({ status: ['done', 'review'] }).selected).toBeNull();
    expect(plugin.findMatchingColorMappings({ tags: null }).selected).toBeNull();
    expect(plugin.findMatchingColorMappings({ tags: ['research'] }).selected).toBeNull();
  });

  it('matches contains rules against string values', () => {
    const plugin = createPlugin({
      colorMappings: [
        mapping({ property: 'title', value: 'tax', matchType: 'contains' })
      ]
    });

    const result = plugin.findMatchingColorMappings({
      title: 'WA tax note'
    });

    expect(result.matches).toHaveLength(1);
    expect(result.selected?.mapping.property).toBe('title');
  });

  it('selects light or dark auto and manual colors', () => {
    const plugin = createPlugin({
      colorMappings: [
        mapping({ colorLight: '#111111', colorDark: '#222222', isAutoLight: true, isAutoDark: true })
      ]
    });

    expect(plugin.getMappingColor(plugin.settings.colorMappings[0])).toBe(DEFAULT_LIGHT_AUTO_COLOR);

    plugin.isDarkTheme = true;

    expect(plugin.getMappingColor(plugin.settings.colorMappings[0])).toBe(DEFAULT_DARK_AUTO_COLOR);

    plugin.settings.colorMappings = [
      mapping({ colorLight: '#111111', colorDark: '#222222', isAutoLight: false, isAutoDark: false })
    ];
    plugin.isDarkTheme = false;

    expect(plugin.getMappingColor(plugin.settings.colorMappings[0])).toBe('#111111');

    plugin.isDarkTheme = true;

    expect(plugin.getMappingColor(plugin.settings.colorMappings[0])).toBe('#222222');
  });

  it('applies the selected color to markdown leaves and removes stale styles', () => {
    const file = {
      path: 'Politics/Seattle/ai-searches/note.md',
      basename: 'note'
    };
    const leaf = createLeaf(file);
    const staleElement = document.createElement('div');
    staleElement.classList.add('page-color-prop-active');
    document.body.appendChild(staleElement);
    const plugin = createPlugin({
      colorMappings: [
        mapping({ colorLight: '#4e66d0', isAutoLight: false })
      ]
    });
    plugin.app.workspace.getLeavesOfType.mockReturnValue([leaf]);
    plugin.app.metadataCache.getFileCache.mockReturnValue({
      frontmatter: {
        tags: ['ai-generated']
      }
    });

    plugin.applyColorsToAllLeaves();

    expect(plugin.app.workspace.getLeavesOfType).toHaveBeenCalledWith('markdown');
    expect(plugin.app.metadataCache.getFileCache).toHaveBeenCalledWith(file);
    expect(leaf.view.containerEl.classList.contains('page-color-prop-active')).toBe(true);
    expect(leaf.view.containerEl.style.getPropertyValue('--page-color-prop-background')).toBe('#4e66d0');
    expect(staleElement.classList.contains('page-color-prop-active')).toBe(false);
  });

  it('skips leaves that cannot be colored', () => {
    const file = { path: 'note.md', basename: 'note' };
    const nonMarkdownLeaf = { view: {} };
    const leafWithoutFile = createLeaf();
    const leafWithoutMetadata = createLeaf(file);
    const leafWithoutMatch = createLeaf(file);
    const plugin = createPlugin();
    plugin.app.workspace.getLeavesOfType.mockReturnValue([
      nonMarkdownLeaf,
      leafWithoutFile,
      leafWithoutMetadata,
      leafWithoutMatch
    ]);
    plugin.app.metadataCache.getFileCache
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ frontmatter: { tags: ['research'] } });

    // Pass 0 retries so the unready-metadata leaf does not schedule a timer.
    plugin.applyColorsToAllLeaves(0);

    expect(plugin.app.metadataCache.getFileCache).toHaveBeenCalledTimes(2);
    expect(leafWithoutFile.view.containerEl.classList.contains('page-color-prop-active')).toBe(false);
    expect(leafWithoutMetadata.view.containerEl.classList.contains('page-color-prop-active')).toBe(false);
    expect(leafWithoutMatch.view.containerEl.classList.contains('page-color-prop-active')).toBe(false);
  });

  it('retries applying colors when metadata is not yet cached', () => {
    vi.useFakeTimers();
    try {
      const file = { path: 'note.md', basename: 'note' };
      const leaf = createLeaf(file);
      const plugin = createPlugin({
        colorMappings: [mapping({ colorLight: '#4e66d0', isAutoLight: false })]
      });
      plugin.app.workspace.getLeavesOfType.mockReturnValue([leaf]);
      // First call: metadata not ready. After the retry: metadata is ready.
      plugin.app.metadataCache.getFileCache
        .mockReturnValueOnce(null)
        .mockReturnValue({ frontmatter: { tags: ['ai-generated'] } });

      plugin.applyColorsToAllLeaves();

      // Not colored yet - metadata was not ready and a retry is scheduled.
      expect(leaf.view.containerEl.classList.contains('page-color-prop-active')).toBe(false);
      expect(plugin.pendingRetryHandles.size).toBe(1);

      vi.runAllTimers();

      // Retry found the metadata and applied the color.
      expect(leaf.view.containerEl.classList.contains('page-color-prop-active')).toBe(true);
      expect(leaf.view.containerEl.style.getPropertyValue('--page-color-prop-background')).toBe('#4e66d0');
      expect(plugin.pendingRetryHandles.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops retrying after the retry limit is exhausted', () => {
    vi.useFakeTimers();
    try {
      const file = { path: 'note.md', basename: 'note' };
      const leaf = createLeaf(file);
      const plugin = createPlugin();
      plugin.app.workspace.getLeavesOfType.mockReturnValue([leaf]);
      // Metadata never becomes ready.
      plugin.app.metadataCache.getFileCache.mockReturnValue(null);

      plugin.applyColorsToAllLeaves();
      vi.runAllTimers();

      // 1 initial call + 3 retries = 4 lookups, then it gives up.
      expect(plugin.app.metadataCache.getFileCache).toHaveBeenCalledTimes(4);
      expect(plugin.pendingRetryHandles.size).toBe(0);
      expect(leaf.view.containerEl.classList.contains('page-color-prop-active')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('removes stale color when a file no longer has frontmatter', () => {
    const file = { path: 'note.md', basename: 'note' };
    const leaf = createLeaf(file);
    leaf.view.containerEl.classList.add('page-color-prop-active');
    leaf.view.containerEl.style.setProperty('--page-color-prop-background', '#4e66d0');
    const plugin = createPlugin();
    plugin.app.workspace.getLeavesOfType.mockReturnValue([leaf]);
    plugin.app.metadataCache.getFileCache.mockReturnValue({});

    plugin.applyColorsToAllLeaves();

    expect(leaf.view.containerEl.classList.contains('page-color-prop-active')).toBe(false);
    expect(leaf.view.containerEl.style.getPropertyValue('--page-color-prop-background')).toBe('');
  });

  it('does not apply invalid colors', () => {
    const file = { path: 'note.md', basename: 'note' };
    const leaf = createLeaf(file);
    const plugin = createPlugin({
      colorMappings: [
        mapping({ colorLight: 'red;bad', isAutoLight: false })
      ]
    });
    plugin.app.workspace.getLeavesOfType.mockReturnValue([leaf]);
    plugin.app.metadataCache.getFileCache.mockReturnValue({
      frontmatter: {
        tags: ['ai-generated']
      }
    });

    plugin.applyColorsToAllLeaves();

    expect(leaf.view.containerEl.classList.contains('page-color-prop-active')).toBe(false);
    expect(leaf.view.containerEl.style.getPropertyValue('--page-color-prop-background')).toBe('');
  });

  it('notifies once for repeated multiple-match results', () => {
    const file = {
      path: 'Politics/Seattle/ai-searches/note.md',
      basename: 'note'
    };
    const leaf = createLeaf(file);
    const plugin = createPlugin({
      colorMappings: [
        mapping({ property: 'tags', value: 'ai-generated', matchType: 'contains' }),
        mapping({ property: 'tags', value: 'research', matchType: 'contains' })
      ],
      notifyOnMultipleMatches: true
    });
    plugin.app.workspace.getLeavesOfType.mockReturnValue([leaf]);
    plugin.app.metadataCache.getFileCache.mockReturnValue({
      frontmatter: {
        tags: ['ai-generated', 'research']
      }
    });

    plugin.applyColorsToAllLeaves();
    plugin.applyColorsToAllLeaves();

    expect(mockedNotice).toHaveBeenCalledTimes(1);
    expect(mockedNotice).toHaveBeenCalledWith(
      expect.stringContaining('Using lowest rule #2'),
      10000
    );
  });

  it('saves settings, clears notices, and reapplies colors', async () => {
    const plugin = createPlugin();
    plugin.multipleMatchNoticeKeys.add('note.md:0');
    plugin.saveData.mockResolvedValue(undefined);
    plugin.applyColorsToAllLeaves = vi.fn();

    await plugin.saveSettings();

    expect(plugin.saveData).toHaveBeenCalledWith(plugin.settings);
    expect(plugin.multipleMatchNoticeKeys.size).toBe(0);
    expect(plugin.applyColorsToAllLeaves).toHaveBeenCalledTimes(1);
  });

  it('reapplies colors for active leaf, metadata, layout, and file-open events', () => {
    const plugin = createPlugin();
    plugin.applyColorsToAllLeaves = vi.fn();

    plugin.onActiveLeafChange({} as any);
    plugin.onMetadataChanged({ path: 'note.md' } as any);
    plugin.onLayoutChange();
    plugin.onFileOpen();

    expect(plugin.applyColorsToAllLeaves).toHaveBeenCalledTimes(4);
  });

  it('updates theme state from the document body', () => {
    const plugin = createPlugin();

    document.body.classList.add('theme-dark');
    plugin.updateThemeState();

    expect(plugin.isDarkTheme).toBe(true);
  });

  it('reapplies colors when the theme changes between light and dark', () => {
    let callback: MutationCallback = () => undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();

    class MockMutationObserver {
      constructor(mutationCallback: MutationCallback) {
        callback = mutationCallback;
      }

      observe = observe;
      disconnect = disconnect;
    }

    vi.stubGlobal('MutationObserver', MockMutationObserver);

    const plugin = createPlugin();
    plugin.applyColorsToAllLeaves = vi.fn();

    plugin.registerThemeChangeListener();
    document.body.classList.remove('theme-dark');
    plugin.updateThemeState();
    callback([{ type: 'attributes', attributeName: 'class' } as MutationRecord], {} as MutationObserver);

    expect(plugin.applyColorsToAllLeaves).not.toHaveBeenCalled();

    document.body.classList.add('theme-dark');
    callback([{ type: 'attributes', attributeName: 'class' } as MutationRecord], {} as MutationObserver);

    expect(plugin.applyColorsToAllLeaves).toHaveBeenCalledTimes(1);
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('validates colors before applying them', () => {
    const supports = vi.fn((_, value: string) => value !== 'bad-color');
    Object.defineProperty(globalThis, 'CSS', {
      configurable: true,
      value: { supports }
    });
    const plugin = createPlugin();

    expect(plugin.isValidColor('#4e66d0')).toBe(true);
    expect(plugin.isValidColor('rgb(1, 2, 3)')).toBe(true);
    expect(plugin.isValidColor('')).toBe(false);
    expect(plugin.isValidColor('red;')).toBe(false);
    expect(plugin.isValidColor('bad-color')).toBe(false);
  });
});
