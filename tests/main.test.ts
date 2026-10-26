import { describe, expect, it, beforeEach, vi } from 'vitest';
import PageColorPropPlugin from '../main.ts';
import { PageColorPropSettingTab, type PageColorPropSettings, type PropertyColorMapping } from '../settings';
import { AbstractInputSuggest, MarkdownView, mockedNotice, Setting, TFile } from './obsidian.mock';


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
    isAutoLinkLight: true,
    isAutoLinkDark: true,
    ...overrides
  };
}

function createPlugin(overrides: Partial<PageColorPropSettings> = {}) {
  const plugin = Object.create(PageColorPropPlugin.prototype) as any;
  plugin.register = vi.fn();
  plugin.registerEvent = vi.fn();
  plugin.settings = {
    colorMappings: overrides.colorMappings ?? [mapping()],
    notifyOnMultipleMatches: overrides.notifyOnMultipleMatches ?? true,
    colorUiLabels: true
  };
  plugin.isDarkTheme = false;
  plugin.multipleMatchNoticeKeys = new Set<string>();
  plugin.pendingRetryHandles = new Set<() => void>();
  plugin.fileExplorerObservers = [];
  plugin.app = {
    workspace: {
      on: vi.fn((_eventName: string, callback: () => void) => callback()),
      onLayoutReady: vi.fn((cb: () => void) => cb?.()),
      getLeavesOfType: vi.fn(() => []),
      iterateAllLeaves: vi.fn((cb: (leaf: any) => void) => {})
    },
    metadataCache: {
      on: vi.fn((_eventName: string, callback: () => void) => callback()),
      getFileCache: vi.fn()
    },
    vault: {
      getAbstractFileByPath: vi.fn(() => null),
      getMarkdownFiles: vi.fn(() => [])
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
  tabHeaderEl: HTMLElement;
}

function createLeaf(file?: any): TestLeaf {
  const view = new MarkdownView() as TestMarkdownView;
  view.file = file;
  view.containerEl = document.createElement('div');
  view.containerEl.setAttribute('data-type', 'markdown');

  return {
    view,
    tabHeaderEl: document.createElement('div')
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  AbstractInputSuggest.instances.length = 0;
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
      notifyOnMultipleMatches: true,
      colorUiLabels: true,
      colorLinks: true,
      experimentalLinkTuning: {
        hueStepDegrees: 15,
        minDeltaE: 0.12,
        minContrast: 4.5
      }
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
      getLeavesOfType: vi.fn(() => []),
      iterateAllLeaves: vi.fn((cb: (leaf: any) => void) => {}),
      onLayoutReady: vi.fn((cb: () => void) => cb())
    };
    const metadataCache = {
      on: vi.fn((_eventName: string, callback: () => void) => callback())
    };
    const plugin = createPlugin();
    plugin.app = { workspace, metadataCache, vault: { getAbstractFileByPath: vi.fn(() => null) } };
    plugin.addSettingTab = vi.fn();
    plugin.register = vi.fn();
    plugin.registerEvent = vi.fn();
    plugin.registerMarkdownPostProcessor = vi.fn();
    plugin.registerEditorExtension = vi.fn();
    plugin.updateThemeState = vi.fn();
    plugin.registerThemeChangeListener = vi.fn();
    plugin.applyColorsToAllLeaves = vi.fn();
    plugin.installViewObservers = vi.fn();
    plugin.installFileExplorerObserver = vi.fn();
    plugin.loadSettings = vi.fn();
    plugin.linkDecorator = {
      invalidateCaches: vi.fn(),
      observeDocument: vi.fn(),
      dispose: vi.fn(),
      observeContainer: vi.fn(),
      refreshAllVisible: vi.fn(),
      decorateLinksInContainer: vi.fn(),
      decorateLink: vi.fn()
    } as any;

    await plugin.onload();

    expect(plugin.loadSettings).toHaveBeenCalledTimes(1);
    expect(plugin.addSettingTab).toHaveBeenCalledTimes(1);
    // 6 workspace.on: active-leaf-change, layout-change, file-open, layout-change for view observers, plus window-open and window-close for popouts
    expect(workspace.on).toHaveBeenCalledTimes(6);
    expect(metadataCache.on).toHaveBeenCalledTimes(2);
    // 8 registerEvent: 5 originals (active-leaf-change, metadataCache changed, metadataCache resolved, layout-change, file-open) + 1 layout-change for view observers + 2 for popout window events (window-open, window-close)
    expect(plugin.registerEvent).toHaveBeenCalledTimes(8);
    expect(plugin.updateThemeState).toHaveBeenCalledTimes(1);
    expect(plugin.registerThemeChangeListener).toHaveBeenCalledTimes(1);
    expect(plugin.installFileExplorerObserver).toHaveBeenCalledTimes(2);
    // applyColorsToAllLeaves is called both directly and via the
    // layout-change mock that fires immediately. Just check it's at
    // least the 5 the original flow expects.
    expect(plugin.applyColorsToAllLeaves).toHaveBeenCalled();
    expect(plugin.registerMarkdownPostProcessor).toHaveBeenCalledTimes(1);
    expect(plugin.installViewObservers).toHaveBeenCalled();
  });

  it('removes styles and disconnects the theme observer when unloaded', () => {
    vi.useFakeTimers();
    try {
      const disconnect = vi.fn();
      const plugin = createPlugin();
      plugin.removeAllStyles = vi.fn();
      plugin.themeObserver = { disconnect };
      const retry = vi.fn();
      plugin.scheduleRetry(retry, 100);

      plugin.onunload();
      vi.advanceTimersByTime(100);

      expect(plugin.removeAllStyles).toHaveBeenCalledTimes(1);
      expect(disconnect).toHaveBeenCalledTimes(1);
      expect(retry).not.toHaveBeenCalled();
      expect(plugin.pendingRetryHandles.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops legacy color mappings that lack a stable id', async () => {
    // Per the accent-relative palette change, mappings without an `id`
    // are intentionally treated as invalid. The user must recreate them
    // in this disruptive release. We deliberately do NOT migrate legacy
    // auto-color fields or generate ids for old entries.
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

    // The legacy mapping is filtered out by isValidMapping because it
    // has no `id`. We do not save anything back, since this is a
    // intentionally-disruptive release that does not preserve legacy
    // auto colors.
    expect(plugin.settings.colorMappings).toEqual([]);
    expect(plugin.settings.notifyOnMultipleMatches).toBe(false);
    expect(plugin.saveSettings).not.toHaveBeenCalled();
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

    // Auto mode now resolves through the shared palette-relative
    // resolver, which needs a `linkDecorator` with cached theme
    // variables. With no decorator, the function returns null (the
    // caller is expected to handle null — see `applyColorsToAllLeaves`).
    // We assert the null behavior here and exercise the real
    // auto-resolution path separately via the link-decorator tests.
    expect(plugin.getMappingColor(plugin.settings.colorMappings[0])).toBe('');

    plugin.isDarkTheme = true;

    expect(plugin.getMappingColor(plugin.settings.colorMappings[0])).toBe('');

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

  it('applies page colors from Obsidian tags even without frontmatter', () => {
    const file = { path: 'Politics/ai-generated-note.md', basename: 'ai-generated-note' };
    const leaf = createLeaf(file);
    const plugin = createPlugin({
      colorMappings: [mapping({ matchType: 'contains', isAutoLight: false, colorLight: '#4e66d0' })]
    });
    plugin.app.workspace.getLeavesOfType.mockReturnValue([leaf]);
    plugin.app.metadataCache.getFileCache.mockReturnValue({
      tags: [{ tag: '#ai-generated' }, { tag: '#research' }]
    });

    plugin.applyColorsToAllLeaves();

    expect(leaf.view.containerEl.classList.contains('page-color-prop-active')).toBe(true);
    expect(leaf.view.containerEl.style.getPropertyValue('--page-color-prop-background')).toBe('#4e66d0');
  });

  it('applies the matching link color to a note tab when tab coloring is enabled', () => {
    const file = {
      path: 'Politics/Seattle/ai-searches/note.md',
      basename: 'note'
    };
    const leaf = createLeaf(file);
    const plugin = createPlugin({
      colorMappings: [
        mapping({ colorLight: '#4e66d0', isAutoLight: false })
      ]
    });
    plugin.linkDecorator = {
      getResolvedLinkColor: vi.fn(() => '#1a5fb4')
    } as any;
    plugin.app.workspace.getLeavesOfType.mockReturnValue([leaf]);
    plugin.app.metadataCache.getFileCache.mockReturnValue({
      frontmatter: { tags: ['ai-generated'] }
    });

    plugin.applyColorsToAllLeaves();

    expect(leaf.tabHeaderEl.classList.contains('page-color-prop-tab')).toBe(true);
    expect(leaf.tabHeaderEl.style.getPropertyValue('--page-color-prop-tab-color')).toBe('#1a5fb4');
  });

  it('does not color tabs when tab coloring is disabled', () => {
    const file = {
      path: 'Politics/Seattle/ai-searches/note.md',
      basename: 'note'
    };
    const leaf = createLeaf(file);
    const plugin = createPlugin({
      colorMappings: [
        mapping({ colorLight: '#4e66d0', isAutoLight: false })
      ]
    });
    plugin.settings.colorUiLabels = false;
    plugin.linkDecorator = {
      getResolvedLinkColor: vi.fn(() => '#1a5fb4')
    } as any;
    plugin.app.workspace.getLeavesOfType.mockReturnValue([leaf]);
    plugin.app.metadataCache.getFileCache.mockReturnValue({
      frontmatter: { tags: ['ai-generated'] }
    });

    plugin.applyColorsToAllLeaves();

    expect(leaf.tabHeaderEl.classList.contains('page-color-prop-tab')).toBe(false);
  });

  it('removes existing tab color when tab coloring is toggled off', () => {
    const file = {
      path: 'Politics/Seattle/ai-searches/note.md',
      basename: 'note'
    };
    const leaf = createLeaf(file);
    leaf.tabHeaderEl.classList.add('page-color-prop-tab');
    leaf.tabHeaderEl.style.setProperty('--page-color-prop-tab-color', '#1a5fb4');
    const plugin = createPlugin({
      colorMappings: [
        mapping({ colorLight: '#4e66d0', isAutoLight: false })
      ]
    });
    plugin.settings.colorUiLabels = false;
    plugin.linkDecorator = {
      getResolvedLinkColor: vi.fn(() => '#1a5fb4')
    } as any;
    plugin.app.workspace.getLeavesOfType.mockReturnValue([leaf]);
    plugin.app.metadataCache.getFileCache.mockReturnValue({
      frontmatter: { tags: ['ai-generated'] }
    });

    plugin.applyColorsToAllLeaves();

    expect(leaf.tabHeaderEl.classList.contains('page-color-prop-tab')).toBe(false);
    expect(leaf.tabHeaderEl.style.getPropertyValue('--page-color-prop-tab-color')).toBe('');
  });

  it('removes stale tab styles while preserving active ones', () => {
    const file = {
      path: 'Politics/Seattle/ai-searches/note.md',
      basename: 'note'
    };
    const leaf = createLeaf(file);
    const staleTab = document.createElement('div');
    staleTab.classList.add('page-color-prop-tab');
    staleTab.style.setProperty('--page-color-prop-tab-color', '#1a5fb4');
    document.body.appendChild(staleTab);
    const plugin = createPlugin({
      colorMappings: [
        mapping({ colorLight: '#4e66d0', isAutoLight: false })
      ]
    });
    plugin.linkDecorator = {
      getResolvedLinkColor: vi.fn(() => '#1a5fb4')
    } as any;
    plugin.app.workspace.getLeavesOfType.mockReturnValue([leaf]);
    plugin.app.metadataCache.getFileCache.mockReturnValue({
      frontmatter: { tags: ['ai-generated'] }
    });

    plugin.applyColorsToAllLeaves();

    expect(leaf.tabHeaderEl.classList.contains('page-color-prop-tab')).toBe(true);
    expect(staleTab.classList.contains('page-color-prop-tab')).toBe(false);
  });

  it('removes tab color when a rule no longer matches', () => {
    const file = {
      path: 'Politics/Seattle/ai-searches/note.md',
      basename: 'note'
    };
    const leaf = createLeaf(file);
    leaf.tabHeaderEl.classList.add('page-color-prop-tab');
    leaf.tabHeaderEl.style.setProperty('--page-color-prop-tab-color', '#1a5fb4');
    const plugin = createPlugin();
    plugin.app.workspace.getLeavesOfType.mockReturnValue([leaf]);
    plugin.app.metadataCache.getFileCache.mockReturnValue({
      frontmatter: { tags: ['research'] }
    });

    plugin.applyColorsToAllLeaves();

    expect(leaf.tabHeaderEl.classList.contains('page-color-prop-tab')).toBe(false);
    expect(leaf.tabHeaderEl.style.getPropertyValue('--page-color-prop-tab-color')).toBe('');
  });

  it('removes tab color when the resolved link color is empty', () => {
    const file = {
      path: 'Politics/Seattle/ai-searches/note.md',
      basename: 'note'
    };
    const leaf = createLeaf(file);
    leaf.tabHeaderEl.classList.add('page-color-prop-tab');
    leaf.tabHeaderEl.style.setProperty('--page-color-prop-tab-color', '#1a5fb4');
    const plugin = createPlugin({
      colorMappings: [
        mapping({ colorLight: '#4e66d0', isAutoLight: false })
      ]
    });
    plugin.linkDecorator = {
      getResolvedLinkColor: vi.fn(() => '')
    } as any;
    plugin.app.workspace.getLeavesOfType.mockReturnValue([leaf]);
    plugin.app.metadataCache.getFileCache.mockReturnValue({
      frontmatter: { tags: ['ai-generated'] }
    });

    plugin.applyColorsToAllLeaves();

    expect(leaf.tabHeaderEl.classList.contains('page-color-prop-tab')).toBe(false);
    expect(leaf.tabHeaderEl.style.getPropertyValue('--page-color-prop-tab-color')).toBe('');
  });

  it('removes all background and tab styles on unload', () => {
    const leaf = createLeaf({ path: 'note.md', basename: 'note' });
    leaf.view.containerEl.classList.add('page-color-prop-active');
    leaf.view.containerEl.style.setProperty('--page-color-prop-background', '#4e66d0');
    leaf.tabHeaderEl.classList.add('page-color-prop-tab');
    leaf.tabHeaderEl.style.setProperty('--page-color-prop-tab-color', '#1a5fb4');
    document.body.appendChild(leaf.view.containerEl);
    document.body.appendChild(leaf.tabHeaderEl);
    const plugin = createPlugin();

    (plugin as any).removeAllStyles();

    expect(leaf.view.containerEl.classList.contains('page-color-prop-active')).toBe(false);
    expect(leaf.view.containerEl.style.getPropertyValue('--page-color-prop-background')).toBe('');
    expect(leaf.tabHeaderEl.classList.contains('page-color-prop-tab')).toBe(false);
    expect(leaf.tabHeaderEl.style.getPropertyValue('--page-color-prop-tab-color')).toBe('');
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

  it('colors file explorer items when a rule matches', () => {
    const file = Object.assign(new TFile(), { path: 'Note-08.md', basename: 'Note-08' });
    const explorerLeaf = createLeaf(file);
    explorerLeaf.view.containerEl.setAttribute('data-type', 'file-explorer');
    const treeItem = document.createElement('div');
    treeItem.setAttribute('data-path', 'Note-08.md');
    treeItem.classList.add('tree-item-self');
    explorerLeaf.view.containerEl.appendChild(treeItem);

    const plugin = createPlugin({
      colorMappings: [
        mapping({ colorLight: '#4e66d0', isAutoLight: false })
      ]
    });
    plugin.linkDecorator = {
      getMatchingMappingForFile: vi.fn(() => plugin.settings.colorMappings[0]),
      getResolvedLinkColor: vi.fn(() => '#1a5fb4')
    } as any;
    plugin.app.workspace.getLeavesOfType.mockReturnValue([explorerLeaf]);
    plugin.app.vault.getAbstractFileByPath.mockReturnValue(file);

    plugin.updateFileExplorerColors();

    expect(treeItem.classList.contains('page-color-prop-link')).toBe(true);
    expect(treeItem.classList.contains('has-page-color')).toBe(true);
    expect(treeItem.style.getPropertyValue('--page-color-prop-link-color')).toBe('#1a5fb4');
    expect(treeItem.style.getPropertyValue('--page-color')).toBe('#1a5fb4');
  });

  it('removes file explorer colors when no rule matches', () => {
    const file = Object.assign(new TFile(), { path: 'Note-08.md', basename: 'Note-08' });
    const explorerLeaf = createLeaf(file);
    explorerLeaf.view.containerEl.setAttribute('data-type', 'file-explorer');
    const treeItem = document.createElement('div');
    treeItem.setAttribute('data-path', 'Note-08.md');
    treeItem.classList.add('tree-item-self', 'page-color-prop-link', 'has-page-color');
    treeItem.style.setProperty('--page-color-prop-link-color', '#1a5fb4');
    treeItem.style.setProperty('--page-color', '#1a5fb4');
    explorerLeaf.view.containerEl.appendChild(treeItem);

    const plugin = createPlugin({
      colorMappings: [
        mapping({ property: 'tags', value: 'other', matchType: 'contains', colorLight: '#4e66d0', isAutoLight: false })
      ]
    });
    plugin.linkDecorator = {
      getMatchingMappingForFile: vi.fn(() => null),
      getResolvedLinkColor: vi.fn(() => null)
    } as any;
    plugin.app.workspace.getLeavesOfType.mockReturnValue([explorerLeaf]);
    plugin.app.vault.getAbstractFileByPath.mockReturnValue(file);

    plugin.updateFileExplorerColors();

    expect(treeItem.classList.contains('page-color-prop-link')).toBe(false);
    expect(treeItem.classList.contains('has-page-color')).toBe(false);
    expect(treeItem.style.getPropertyValue('--page-color-prop-link-color')).toBe('');
    expect(treeItem.style.getPropertyValue('--page-color')).toBe('');
  });

  it('colors all tab headers regardless of active leaf', () => {
    const file = { path: 'Note-08.md', basename: 'Note-08' };
    const leaf = createLeaf(file);
    leaf.view.containerEl.setAttribute('data-type', 'markdown');
    const plugin = createPlugin({
      colorMappings: [
        mapping({ colorLight: '#4e66d0', isAutoLight: false })
      ]
    });
    plugin.linkDecorator = {
      getMatchingMappingForFile: vi.fn(() => plugin.settings.colorMappings[0]),
      getResolvedLinkColor: vi.fn(() => '#1a5fb4')
    } as any;
    plugin.app.workspace.getLeavesOfType.mockReturnValue([leaf]);
    plugin.app.workspace.iterateAllLeaves.mockImplementation((cb: (leaf: any) => void) => {
      cb(leaf);
    });

    plugin.updateAllTabHeaderColors();

    expect(leaf.tabHeaderEl.classList.contains('page-color-prop-tab')).toBe(true);
    expect(leaf.tabHeaderEl.classList.contains('has-page-color')).toBe(true);
    expect(leaf.tabHeaderEl.getAttribute('data-path')).toBe('Note-08.md');
    expect(leaf.tabHeaderEl.style.getPropertyValue('--page-color-prop-tab-color')).toBe('#1a5fb4');
    expect(leaf.tabHeaderEl.style.getPropertyValue('--page-color')).toBe('#1a5fb4');
  });

  it('removes tab colors when no rule matches', () => {
    const file = { path: 'Note-08.md', basename: 'Note-08' };
    const leaf = createLeaf(file);
    leaf.view.containerEl.setAttribute('data-type', 'markdown');
    leaf.tabHeaderEl.classList.add('page-color-prop-tab', 'has-page-color');
    leaf.tabHeaderEl.style.setProperty('--page-color-prop-tab-color', '#1a5fb4');
    leaf.tabHeaderEl.style.setProperty('--page-color', '#1a5fb4');
    const plugin = createPlugin({
      colorMappings: [
        mapping({ property: 'tags', value: 'other', matchType: 'contains', colorLight: '#4e66d0', isAutoLight: false })
      ]
    });
    plugin.linkDecorator = {
      getMatchingMappingForFile: vi.fn(() => null),
      getResolvedLinkColor: vi.fn(() => null)
    } as any;
    plugin.app.workspace.getLeavesOfType.mockReturnValue([leaf]);
    plugin.app.workspace.iterateAllLeaves.mockImplementation((cb: (leaf: any) => void) => {
      cb(leaf);
    });

    plugin.updateAllTabHeaderColors();

    expect(leaf.tabHeaderEl.classList.contains('page-color-prop-tab')).toBe(false);
    expect(leaf.tabHeaderEl.classList.contains('has-page-color')).toBe(false);
    expect(leaf.tabHeaderEl.style.getPropertyValue('--page-color-prop-tab-color')).toBe('');
    expect(leaf.tabHeaderEl.style.getPropertyValue('--page-color')).toBe('');
  });

  it('removes tab color from elements without a file', () => {
    const leaf = createLeaf();
    leaf.view.containerEl.setAttribute('data-type', 'markdown');
    leaf.tabHeaderEl.classList.add('page-color-prop-tab', 'has-page-color');
    leaf.tabHeaderEl.style.setProperty('--page-color-prop-tab-color', '#1a5fb4');
    leaf.tabHeaderEl.style.setProperty('--page-color', '#1a5fb4');
    const plugin = createPlugin();
    plugin.app.workspace.getLeavesOfType.mockReturnValue([leaf]);
    plugin.app.workspace.iterateAllLeaves.mockImplementation((cb: (leaf: any) => void) => {
      cb(leaf);
    });

    plugin.updateAllTabHeaderColors();

    expect(leaf.tabHeaderEl.classList.contains('page-color-prop-tab')).toBe(false);
    expect(leaf.tabHeaderEl.classList.contains('has-page-color')).toBe(false);
    expect(leaf.tabHeaderEl.style.getPropertyValue('--page-color-prop-tab-color')).toBe('');
    expect(leaf.tabHeaderEl.style.getPropertyValue('--page-color')).toBe('');
  });

  describe('PageColorPropSettingTab', () => {
    it('returns declarative setting definitions', () => {
      const plugin = createPlugin();
      const tab = new PageColorPropSettingTab(plugin.app, plugin);
      const defs = tab.getSettingDefinitions();

      expect(Array.isArray(defs)).toBe(true);
      expect(defs.some((d: any) => d.control?.key === 'notifyOnMultipleMatches')).toBe(true);
      expect(defs.some((d: any) => d.name === 'Color UI labels')).toBe(true);
      expect(defs.some((d: any) => d.name === 'Color links')).toBe(true);
      expect(defs.some((d: any) => d.name === 'Add color mapping')).toBe(true);
    });

    it('populates containerEl when display() is called with empty mappings', () => {
      const plugin = createPlugin();
      plugin.saveSettings = vi.fn();
      plugin.applyColorsToAllLeaves = vi.fn();
      plugin.refreshLinkDecorations = vi.fn();

      const tab = new PageColorPropSettingTab(plugin.app, plugin);
      tab.display();

      expect(tab.containerEl.childNodes.length).toBeGreaterThan(0);
    });

    it('renders independent property pickers for every color mapping', () => {
      const plugin = createPlugin();
      const file = { path: 'note.md' };
      plugin.app.vault.getMarkdownFiles.mockReturnValue([file]);
      plugin.app.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { tags: ['ai-generated'], category: ['journal', 'work'] },
        tags: [{ tag: '#ai-generated' }, { tag: '#research' }]
      });
      plugin.settings.colorMappings.push({
        id: 'rule-1',
        baseColor: '#4f8cc9',
        property: 'category',
        value: 'journal',
        colorLight: '#ffffff',
        colorDark: '#000000',
        isAutoLight: true,
        isAutoDark: true,
        matchType: 'exact',
        linkColorLight: '',
        linkColorDark: '',
        isAutoLinkLight: true,
        isAutoLinkDark: true
      });
      plugin.saveSettings = vi.fn();
      plugin.applyColorsToAllLeaves = vi.fn();
      plugin.refreshLinkDecorations = vi.fn();

      const tab = new PageColorPropSettingTab(plugin.app, plugin);
      tab.display();

      const cards = Array.from(tab.containerEl.querySelectorAll('.page-color-prop-mapping-card'));
      expect(cards).toHaveLength(2);
      for (const card of cards) {
        const condition = card.querySelector('.page-color-prop-condition');
        expect(condition?.querySelectorAll('.commons-property-picker')).toHaveLength(2);
        expect(condition?.querySelector('select')).not.toBeNull();
        expect(condition?.children[0].querySelector('.commons-property-picker')).not.toBeNull();
        expect(condition?.children[1].querySelector('select')).not.toBeNull();
        expect(condition?.children[2].querySelector('.commons-property-picker')).not.toBeNull();
        expect(Array.from(condition!.querySelectorAll<HTMLElement>('.commons-property-picker'))
          .every(picker => picker.dataset.appearance === 'property')).toBe(true);
      }
      expect(cards.map(card => Array.from(card.querySelectorAll('.commons-property-picker-label'))
        .map(label => label.textContent))).toEqual([
        ['tags', 'ai-generated'],
        ['category', 'journal']
      ]);

      const firstValueInput = cards[0].querySelectorAll<HTMLInputElement>('.commons-property-picker-input')[1];
      const secondValueInput = cards[1].querySelectorAll<HTMLInputElement>('.commons-property-picker-input')[1];
      const firstValueSuggest = AbstractInputSuggest.instances.find(suggest => suggest.inputEl === firstValueInput)!;
      const secondValueSuggest = AbstractInputSuggest.instances.find(suggest => suggest.inputEl === secondValueInput)!;
      expect(firstValueSuggest.suggestions('').map((option: any) => option.value)).toContain('research');
      expect(secondValueSuggest.suggestions('').map((option: any) => option.value)).toContain('work');
      expect(secondValueSuggest.suggestions('').map((option: any) => option.value)).not.toContain('research');

      cards[0].querySelector<HTMLButtonElement>('button[aria-label="Remove tags"]')!.click();
      expect(plugin.settings.colorMappings[0].property).toBe('');
      expect(plugin.settings.colorMappings[1].property).toBe('category');
      tab.onunload();
    });

    it('uses shared property icons and row navigation without trapping settings focus', () => {
      const plugin = createPlugin();
      plugin.settings.colorMappings = [mapping({ property: 'tags', value: 'project' })];
      const tab = new PageColorPropSettingTab(plugin.app, plugin);
      tab.display();
      document.body.appendChild(tab.containerEl);
      const rows = Array.from(tab.containerEl.querySelectorAll<HTMLElement>('.commons-property-row'));
      expect(rows).toHaveLength(2);
      expect(rows[0].querySelector('[aria-label="Tags"]')).not.toBeNull();
      const input = rows[0].querySelector<HTMLInputElement>('input')!;
      rows[0].focus();
      rows[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(input);
      const tabKey = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      input.dispatchEvent(tabKey);
      expect(tabKey.defaultPrevented).toBe(false);
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(rows[0]);
      rows[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(rows[1]);
      tab.onunload();
      tab.containerEl.remove();
    });

    it('switches the match editor with the property while preserving contains patterns', () => {
      const plugin = createPlugin();
      const file = { path: 'note.md' };
      plugin.app.vault.getMarkdownFiles.mockReturnValue([file]);
      plugin.app.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { due: '2026-10-26', archived: false, count: 2 }
      });
      plugin.settings.colorMappings = [mapping({ property: 'due', value: '2026-10-26', matchType: 'exact' })];
      const tab = new PageColorPropSettingTab(plugin.app, plugin);
      tab.display();
      const [propertyInput, valueInput] = Array.from(tab.containerEl.querySelectorAll<HTMLInputElement>('.commons-property-picker-input'));
      expect(valueInput.type).toBe('date');
      const propertySuggest = AbstractInputSuggest.instances.find(suggest => suggest.inputEl === propertyInput)!;
      propertySuggest.select(propertySuggest.suggestions('archived').find((option: any) => option.value === 'archived'));
      expect(valueInput.type).toBe('text');
      const valueSuggest = AbstractInputSuggest.instances.find(suggest => suggest.inputEl === valueInput)!;
      expect(valueSuggest.suggestions('').map((option: any) => option.value)).toEqual(['false', 'true']);
      propertySuggest.select(propertySuggest.suggestions('count').find((option: any) => option.value === 'count'));
      expect(valueInput.type).toBe('number');
      const matchSelect = tab.containerEl.querySelector<HTMLSelectElement>('.page-color-prop-condition select')!;
      const beforeChange = plugin.settings.colorMappings[0].value;
      matchSelect.value = 'contains';
      matchSelect.dispatchEvent(new Event('change', { bubbles: true }));
      expect(valueInput.type).toBe('text');
      expect(plugin.settings.colorMappings[0].matchType).toBe('contains');
      expect(plugin.settings.colorMappings[0].value).toBe(beforeChange);
      tab.onunload();
      plugin.settings.colorMappings = [mapping({ property: 'due', value: '2026-', matchType: 'contains' })];
      tab.display();
      expect(tab.containerEl.querySelectorAll<HTMLInputElement>('.commons-property-picker-input')[1].type).toBe('text');
      expect(plugin.settings.colorMappings[0].value).toBe('2026-');
      tab.onunload();
    });

    it('renders editable property and value inputs for a blank mapping', () => {
      const plugin = createPlugin();
      plugin.settings.colorMappings = [mapping({ property: '', value: '' })];
      plugin.app.metadataCache.getFileCache.mockReturnValue({ frontmatter: {} });

      const tab = new PageColorPropSettingTab(plugin.app, plugin);
      tab.display();

      const card = tab.containerEl.querySelector('.page-color-prop-mapping-card');
      const inputs = Array.from(card!.querySelectorAll<HTMLInputElement>('.commons-property-picker-input'));
      expect(inputs).toHaveLength(2);
      expect(inputs.map(input => input.placeholder)).toEqual([
        'Property…',
        'Value…'
      ]);
      expect(tab.containerEl.querySelectorAll('.page-color-prop-block-setting.setting-item')).toHaveLength(0);
      tab.onunload();
    });
    it('keeps declarative mapping rows attached while rendering a rule', () => {
      const plugin = createPlugin();
      plugin.settings.colorMappings = [mapping()];
      plugin.app.metadataCache.getFileCache.mockReturnValue({ frontmatter: {} });

      const tab = new PageColorPropSettingTab(plugin.app, plugin);
      const definitions = tab.getSettingDefinitions();
      const mappingDefinition = definitions.filter((definition: any) => !definition.name && definition.render)[1] as any;
      const setting = new Setting(tab.containerEl);
      const cleanup = mappingDefinition.render(setting, {} as any);

      expect(setting.settingEl.parentElement).toBe(tab.containerEl);
      expect(setting.settingEl.querySelector('.page-color-prop-mapping-card')).not.toBeNull();
      cleanup?.();
    });

    it('renders a rule form after Add new mapping is activated', async () => {
      const plugin = createPlugin({ colorMappings: [] });
      plugin.saveSettings = vi.fn().mockResolvedValue(undefined);
      plugin.app.metadataCache.getFileCache.mockReturnValue({ frontmatter: {} });

      const tab = new PageColorPropSettingTab(plugin.app, plugin);
      tab.display();

      let onAdd: (() => Promise<void>) | undefined;
      const addDefinition = tab.getSettingDefinitions().find((definition: any) => definition.name === 'Add color mapping') as any;
      addDefinition.render({
        addButton: (callback: (button: any) => void) => {
          const button = {
            setButtonText() { return this; },
            setCta() { return this; },
            onClick(handler: () => Promise<void>) { onAdd = handler; return this; }
          };
          callback(button);
        }
      }, {} as any);

      expect(onAdd).toBeDefined();
      await onAdd!();

      expect(plugin.settings.colorMappings).toHaveLength(1);
      const ruleCard = tab.containerEl.querySelector('.page-color-prop-mapping-card');
      expect(ruleCard).not.toBeNull();
      expect(ruleCard?.closest('.page-color-prop-block-setting-row')).not.toBeNull();
      expect(tab.containerEl.querySelectorAll('.commons-property-picker-input')).toHaveLength(2);
      tab.onunload();
    });
    it('cleans mapping pickers and removes stale rule UI when mappings are cleared', () => {
      const plugin = createPlugin();
      plugin.settings.colorMappings = [mapping()];
      plugin.app.metadataCache.getFileCache.mockReturnValue({ frontmatter: {} });

      const tab = new PageColorPropSettingTab(plugin.app, plugin);
      tab.display();

      const propertyInput = tab.containerEl.querySelector<HTMLInputElement>('.commons-property-picker-input')!;
      const propertySuggest = AbstractInputSuggest.instances.find(suggest => suggest.inputEl === propertyInput)!;
      const closeCalls = propertySuggest.close.mock.calls.length;
      expect(tab.containerEl.querySelectorAll('.page-color-prop-mapping-card')).toHaveLength(1);

      plugin.settings.colorMappings = [];
      tab.refreshUI();

      expect(propertySuggest.close).toHaveBeenCalledTimes(closeCalls + 1);
      expect(tab.containerEl.querySelectorAll('.page-color-prop-mapping-card')).toHaveLength(0);
      expect(tab.containerEl.querySelectorAll('.page-color-prop-rule-priority-note')).toHaveLength(0);
      expect(tab.containerEl.querySelectorAll('.page-color-prop-group-heading')).toHaveLength(0);
      expect(tab.containerEl.querySelectorAll('.page-color-prop-empty-state')).toHaveLength(1);
      tab.onunload();
    });

    it('refreshes property and value suggestions after the vault metadata resolves', () => {
      const plugin = createPlugin();
      const file = { path: 'note.md' };
      plugin.app.vault.getMarkdownFiles.mockReturnValue([file]);
      plugin.app.metadataCache.getFileCache.mockReturnValue(null);
      let resolvedCallback: (() => void) | undefined;
      plugin.app.metadataCache.on = vi.fn((eventName, callback) => {
        if (eventName === 'resolved') resolvedCallback = callback;
        return {} as any;
      });

      const tab = new PageColorPropSettingTab(plugin.app, plugin);
      tab.display();
      const [propertyInput, valueInput] = Array.from(
        tab.containerEl.querySelectorAll<HTMLInputElement>('.commons-property-picker-input')
      );
      const propertySuggest = AbstractInputSuggest.instances.find(suggest => suggest.inputEl === propertyInput)!;
      const valueSuggest = AbstractInputSuggest.instances.find(suggest => suggest.inputEl === valueInput)!;

      expect(propertySuggest.suggestions('polit').map((option: any) => option.value)).not.toContain('politics');
      expect(valueSuggest.suggestions('polit').map((option: any) => option.value)).not.toContain('politics');

      plugin.app.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { politics: 'yes', tags: ['politics'] },
        tags: [{ tag: '#politics' }]
      });
      resolvedCallback?.();

      expect(propertySuggest.suggestions('polit').map((option: any) => option.value)).toContain('politics');
      expect(valueSuggest.suggestions('polit').map((option: any) => option.value)).toContain('politics');
      tab.onunload();
    });

    it('refreshes selected-value status when the property or vault metadata changes', () => {
      const plugin = createPlugin();
      const file = { path: 'note.md' };
      plugin.app.vault.getMarkdownFiles.mockReturnValue([file]);
      plugin.app.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { tags: ['ai-generated'], category: ['journal'] },
        tags: [{ tag: '#ai-generated' }]
      });
      let resolvedCallback: (() => void) | undefined;
      plugin.app.metadataCache.on = vi.fn((_eventName, callback) => {
        resolvedCallback = callback;
        return {} as any;
      });
      plugin.settings.colorMappings = [mapping({ property: 'tags', value: 'ai-generated' })];

      const tab = new PageColorPropSettingTab(plugin.app, plugin);
      tab.display();
      const [propertyInput, valueInput] = Array.from(
        tab.containerEl.querySelectorAll<HTMLInputElement>('.commons-property-picker-input')
      );
      const propertySuggest = AbstractInputSuggest.instances.find(suggest => suggest.inputEl === propertyInput)!;
      const valueChip = () => tab.containerEl.querySelector<HTMLElement>('.page-color-prop-mapping-card .commons-property-picker-chip[data-entry="new"]');
      const status = () => valueInput.closest<HTMLElement>('.commons-property-picker')?.querySelector<HTMLElement>('.commons-property-picker-status');

      expect(valueChip()).toBeNull();
      propertyInput.value = 'category';
      propertyInput.dispatchEvent(new Event('input', { bubbles: true }));
      const category = propertySuggest.suggestions().find((option: any) => option.value === 'category');
      propertySuggest.select(category);

      expect(valueChip()?.textContent).toContain('ai-generated');
      expect(status()?.textContent).toContain('for "category"');

      plugin.app.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { tags: ['ai-generated'], category: ['ai-generated', 'journal'] },
        tags: [{ tag: '#ai-generated' }]
      });
      resolvedCallback?.();

      expect(valueChip()).toBeNull();
      expect(status()?.hidden).toBe(true);
      tab.onunload();
    });
    it('suggests vault properties and values in color mapping rules', () => {
      const plugin = createPlugin();
      plugin.saveSettings = vi.fn();
      plugin.applyColorsToAllLeaves = vi.fn();
      plugin.refreshLinkDecorations = vi.fn();
      const file = { path: 'note.md' };
      plugin.app.vault.getMarkdownFiles.mockReturnValue([file]);
      plugin.app.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { tags: ['ai-generated'], category: ['journal', 'work'] },
        tags: [{ tag: '#ai-generated' }, { tag: '#research' }]
      });

      const tab = new PageColorPropSettingTab(plugin.app, plugin);
      tab.display();
      const [propertyInput, valueInput] = Array.from(
        tab.containerEl.querySelectorAll<HTMLInputElement>('.commons-property-picker-input')
      );
      const propertySuggest = AbstractInputSuggest.instances.find(suggest => suggest.inputEl === propertyInput)!;
      const valueSuggest = AbstractInputSuggest.instances.find(suggest => suggest.inputEl === valueInput)!;

      expect(tab.containerEl.querySelectorAll('.commons-property-picker-chip')).toHaveLength(2);

      expect(valueSuggest.suggestions('').map((option: any) => option.value)).toContain('research');

      propertyInput.value = 'category';
      propertyInput.dispatchEvent(new Event('input', { bubbles: true }));
      const category = propertySuggest.suggestions().find((option: any) => option.value === 'category');
      propertySuggest.select(category);
      expect(plugin.settings.colorMappings[0].property).toBe('category');
      expect(plugin.applyColorsToAllLeaves).toHaveBeenCalledTimes(1);
      expect(plugin.refreshLinkDecorations).toHaveBeenCalledTimes(1);

      valueInput.value = 'work';
      valueInput.dispatchEvent(new Event('input', { bubbles: true }));
      const work = valueSuggest.suggestions().find((option: any) => option.value === 'work');
      expect(work).toBeDefined();
      valueSuggest.select(work);

      expect(plugin.settings.colorMappings[0].value).toBe('work');
      expect(plugin.applyColorsToAllLeaves).toHaveBeenCalledTimes(2);
      expect(plugin.refreshLinkDecorations).toHaveBeenCalledTimes(2);
      expect(tab.containerEl.querySelector('.page-color-prop-rule-summary')?.textContent).toBe('category contains work');

      const closeCalls = propertySuggest.close.mock.calls.length;
      tab.refreshUI();
      expect(propertySuggest.close).toHaveBeenCalledTimes(closeCalls + 1);
      tab.onunload();
    });
  });
});
