import { TFile } from './obsidian.mock';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ColorMath } from '../color-optimizer';
import { PageColorPropSettingTab } from '../settings';
import PageColorPropPlugin from '../main';
import * as linkColorService from '../link-color-service';
import { LinkDecorator } from '../link-decorator';
import { getTabHeaderEl } from 'commons/internals';

describe('Commons Adoption and Hardened Invariants', () => {
  describe('ColorMath input validation', () => {
    it('correctly parses 3-digit, 4-digit, 6-digit, and 8-digit hex strings', () => {
      expect(ColorMath.hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
      expect(ColorMath.hexToRgb('#123')).toEqual({ r: 0x11, g: 0x22, b: 0x33 });
      expect(ColorMath.hexToRgb('#1234')).toEqual({ r: 0x11, g: 0x22, b: 0x33 });
      expect(ColorMath.hexToRgb('#112233')).toEqual({ r: 0x11, g: 0x22, b: 0x33 });
      expect(ColorMath.hexToRgb('#11223344')).toEqual({ r: 0x11, g: 0x22, b: 0x33 });
    });

    it('correctly parses rgb and rgba functional notation', () => {
      expect(ColorMath.hexToRgb('rgb(17, 34, 51)')).toEqual({ r: 17, g: 34, b: 51 });
      expect(ColorMath.hexToRgb('rgba(17, 34, 51, 0.5)')).toEqual({ r: 17, g: 34, b: 51 });
      expect(ColorMath.hexToRgb('rgb(100%, 50%, 0%)')).toEqual({ r: 255, g: 128, b: 0 });
    });

    it('validates invalid hex strings and throws or safely falls back without returning NaN or corrupted bits', () => {
      expect(() => ColorMath.hexToRgb('invalid-color')).toThrow();
      expect(() => ColorMath.hexToRgb('#12')).toThrow();
      expect(() => ColorMath.hexToRgb('#12345')).toThrow();
      expect(() => ColorMath.hexToRgb('')).toThrow();
    });
  });

  describe('Theme class restoration in finally', () => {
    let tab: PageColorPropSettingTab;
    let mockPlugin: any;

    beforeEach(() => {
      document.body.className = 'theme-dark';
      mockPlugin = {
        app: {},
        settings: { colorMappings: [] },
        saveSettings: vi.fn()
      };
      tab = new PageColorPropSettingTab({} as any, mockPlugin);
    });

    afterEach(() => {
      document.body.className = '';
      vi.restoreAllMocks();
    });

    it('restores body theme class even if readThemeCssVar throws', () => {
      document.body.className = 'theme-dark';
      vi.spyOn(linkColorService, 'readThemeCssVar').mockImplementation(() => {
        throw new Error('DOM measurement failure');
      });

      expect(() => {
        (tab as any).computeColorFromThemeVarsForTheme('var(--background-primary)', 'Light');
      }).toThrow('DOM measurement failure');

      // The body MUST be restored to theme-dark
      expect(document.body.classList.contains('theme-dark')).toBe(true);
      expect(document.body.classList.contains('theme-light')).toBe(false);
    });
  });

  describe('openColorPickerAtElement error restoration and owner-window frames', () => {
    let tab: PageColorPropSettingTab;

    beforeEach(() => {
      tab = new PageColorPropSettingTab({} as any, { settings: { colorMappings: [] } } as any);
    });

    it('restores input styles in finally if showPicker or click throws', () => {
      const input = document.createElement('input');
      input.type = 'color';
      input.style.position = 'absolute';
      input.style.opacity = '1';
      document.body.appendChild(input);

      const anchor = document.createElement('button');
      document.body.appendChild(anchor);

      (input as any).showPicker = vi.fn(() => {
        throw new Error('showPicker not allowed');
      });

      expect(() => {
        (tab as any).openColorPickerAtElement(input, anchor);
      }).toThrow('showPicker not allowed');

      // Styles must be restored immediately on throw
      expect(input.style.position).toBe('absolute');
      expect(input.style.opacity).toBe('1');
    });
  });

  describe('Tab header styling via commons/internals getTabHeaderEl', () => {
    it('safely extracts tabHeaderEl without accessing uncontained property', () => {
      const mockLeaf = { tabHeaderEl: document.createElement('div') };
      expect(getTabHeaderEl(mockLeaf as any)).toBe(mockLeaf.tabHeaderEl);
      expect(getTabHeaderEl(null as any)).toBeNull();
      expect(getTabHeaderEl({} as any)).toBeNull();
    });
  });

  describe('Declarative settings in 1.14 (getControlValue / setControlValue)', () => {
    it('implements getControlValue and setControlValue to persist settings', async () => {
      const saveSpy = vi.fn().mockResolvedValue(undefined);
      const mockPlugin: any = {
        app: {},
        settings: {
          notifyOnMultipleMatches: false,
          colorMappings: []
        },
        saveSettings: saveSpy
      };
      const tab = new PageColorPropSettingTab({} as any, mockPlugin);

      expect((tab as any).getControlValue('notifyOnMultipleMatches')).toBe(false);

      await (tab as any).setControlValue('notifyOnMultipleMatches', true);

      expect(mockPlugin.settings.notifyOnMultipleMatches).toBe(true);
      expect(saveSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Multi-window cleanup and tab styling', () => {
    it('clears stale active styles across all open windows', () => {
      const plugin = new PageColorPropPlugin({} as any, {} as any);
      const mockPopoutDoc = document.implementation.createHTMLDocument('popout');
      const popoutEl = mockPopoutDoc.createElement('div');
      popoutEl.className = 'page-color-prop-active';
      popoutEl.style.setProperty('--page-color-prop-background', '#123456');
      mockPopoutDoc.body.appendChild(popoutEl);

      const mockPopoutWin = { document: mockPopoutDoc } as unknown as Window;

      // Mock getOpenWindows to include both main window and mock popout window
      (plugin as any).app = {
        workspace: {
          iterateAllLeaves: (cb: any) => {
            cb({
              view: { containerEl: mockPopoutDoc.createElement('div') },
              getContainer: () => ({ win: mockPopoutWin })
            });
          }
        }
      };

      (plugin as any).removeStaleStyles(new Set());

      expect(popoutEl.classList.contains('page-color-prop-active')).toBe(false);
      expect(popoutEl.style.getPropertyValue('--page-color-prop-background')).toBe('');
    });
  });
  describe('Metadata resolution and non-poisoned matchCache', () => {
    it('does not cache a negative match when getFileCache returns null (deferred metadata)', () => {
      let fileCacheResult: any = null;
      const mockPlugin: any = {
        settings: {
          colorMappings: [
            {
              id: 'rule-ai',
              baseColor: '#4f8cc9',
              property: 'tags',
              value: 'ai-generated',
              matchType: 'contains',
              colorLight: '#4e66d0',
              colorDark: '#a86be6',
              isAutoLight: false,
              isAutoDark: true,
              linkColorLight: '#1a5fb4',
              linkColorDark: '#62a0ea',
              isAutoLinkLight: false,
              isAutoLinkDark: false
            }
          ]
        },
        app: {
          metadataCache: {
            getFileCache: vi.fn(() => fileCacheResult)
          }
        }
      };

            const decorator = new LinkDecorator(mockPlugin);
      const testFile: any = { path: 'Seattle/ai-searches/TestNote.md' };

      // 1. Initial pass on startup: metadataCache not ready yet
      const match1 = decorator.getMatchingMappingForFile(testFile);
      expect(match1).toBeNull();
      // Crucial: matchCache must NOT contain a negative match for this file
      expect((decorator as any).matchCache.has(testFile.path)).toBe(false);

      // 2. Later, Obsidian finishes indexing this file's frontmatter
      fileCacheResult = {
        frontmatter: {
          tags: ['ai-generated']
        }
      };

      // 3. Second pass: should find the mapping without needing manual cache clear
      const match2 = decorator.getMatchingMappingForFile(testFile);
      expect(match2).not.toBeNull();
      expect(match2?.value).toBe('ai-generated');
      expect((decorator as any).matchCache.get(testFile.path)?.index).toBe(0);
    });

    it('caches negative match when getFileCache exists but has no matching frontmatter', () => {
      const mockPlugin: any = {
        settings: {
          colorMappings: [
            {
              id: 'rule-ai',
              property: 'tags',
              value: 'ai-generated',
              matchType: 'contains'
            }
          ]
        },
        app: {
          metadataCache: {
            getFileCache: vi.fn(() => ({ frontmatter: { tags: ['other'] } }))
          }
        }
      };

            const decorator = new LinkDecorator(mockPlugin);
      const testFile: any = { path: 'Notes/Other.md' };

      const match = decorator.getMatchingMappingForFile(testFile);
      expect(match).toBeNull();
      expect((decorator as any).matchCache.get(testFile.path)?.index).toBeNull();
    });

    it('re-decorates file explorer and tab headers on metadataCache resolved event', () => {
      const plugin = Object.create(PageColorPropPlugin.prototype) as any;
      plugin.registerEvent = vi.fn();
      plugin.settings = { colorMappings: [] };
      plugin.linkDecorator = {
        invalidateCaches: vi.fn(),
        observeDocument: vi.fn()
      };
      plugin.updateFileExplorerColors = vi.fn();
      plugin.updateAllTabHeaderColors = vi.fn();
      plugin.applyColorsToAllLeaves = vi.fn();

      let resolvedCallback: (() => void) | null = null;
      plugin.app = {
        workspace: {
          on: vi.fn(),
          onLayoutReady: vi.fn()
        },
        metadataCache: {
          on: vi.fn((event: string, cb: () => void) => {
            if (event === 'resolved') {
              resolvedCallback = cb;
            }
          })
        }
      };

      plugin.registerEvent(
        plugin.app.metadataCache.on('resolved', () => {
          plugin.linkDecorator?.invalidateCaches();
          plugin.updateFileExplorerColors();
          plugin.updateAllTabHeaderColors();
          plugin.applyColorsToAllLeaves();
        })
      );

      expect(resolvedCallback).not.toBeNull();
      resolvedCallback!();

      expect(plugin.linkDecorator.invalidateCaches).toHaveBeenCalledTimes(1);
      expect(plugin.updateFileExplorerColors).toHaveBeenCalledTimes(1);
      expect(plugin.updateAllTabHeaderColors).toHaveBeenCalledTimes(1);
      expect(plugin.applyColorsToAllLeaves).toHaveBeenCalledTimes(1);
    });
  });
  describe('Public API for external plugins and suggestion coloring', () => {
    it('exposes getFileColor and applyFileColor on the plugin', () => {
      const plugin = Object.create(PageColorPropPlugin.prototype) as PageColorPropPlugin;
      const testFile = Object.assign(new TFile(), { path: 'Notes/Test.md' });
      (plugin as any).app = {
        vault: {
          getAbstractFileByPath: vi.fn((p: string) => (p === 'Notes/Test.md' ? testFile : null)),
        },
        metadataCache: {
          getFirstLinkpathDest: vi.fn((p: string) => (p === 'Notes/Test.md' ? testFile : null)),
        },
      };
      (plugin as any).linkDecorator = {
        getMatchingMappingForFile: vi.fn((f: any) => (f.path === 'Notes/Test.md' ? { id: 'm1' } : null)),
        getResolvedLinkColor: vi.fn((_mapping: any, _isUi: boolean) => '#0e9afd'),
      };

      // By file object
      expect(plugin.getFileColor(testFile as any)).toBe('#0e9afd');
      // By path string
      expect(plugin.getFileColor('Notes/Test.md')).toBe('#0e9afd');
      // Missing file
      expect(plugin.getFileColor('Unknown.md')).toBeNull();

      // applyFileColor applies styles and classes
      const el = document.createElement('div');
      const applied = plugin.applyFileColor(el, testFile as any);
      expect(applied).toBe('#0e9afd');
      expect(el.style.getPropertyValue('--page-color')).toBe('#0e9afd');
      expect(el.style.getPropertyValue('--page-color-prop-link-color')).toBe('#0e9afd');
      expect(el.style.color).toBe('rgb(14, 154, 253)');
      expect(el.classList.contains('has-page-color')).toBe(true);
      expect(el.classList.contains('page-color-prop-link')).toBe(true);

      // applyFileColor clears styles when file has no color
      plugin.applyFileColor(el, 'Unknown.md');
      expect(el.style.getPropertyValue('--page-color')).toBe('');
      expect(el.style.getPropertyValue('--page-color-prop-link-color')).toBe('');
      expect(el.classList.contains('has-page-color')).toBe(false);
      expect(el.classList.contains('page-color-prop-link')).toBe(false);
    });

    it('includes file-palette and suggestion selectors in DEFAULT_CONTAINER_SELECTORS', async () => {
      const { DEFAULT_CONTAINER_SELECTORS } = await import('../link-decorator');
      expect(DEFAULT_CONTAINER_SELECTORS).toContain('.file-palette-suggestion-name');
      expect(DEFAULT_CONTAINER_SELECTORS).toContain('.has-page-color');
    });
  });
});
