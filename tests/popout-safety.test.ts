import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import PageColorPropPlugin from '../main';
import { readThemeCssVar } from '../link-color-service';

const sourceFiles = [
  '../main.ts',
  '../settings.ts',
  '../link-color-service.ts',
  '../link-decorator.ts',
  '../live-preview-links.ts',
  '../color-optimizer.ts',
];

describe('pop-out window safety', () => {
  it('does not use bare DOM globals in production source', () => {
    for (const file of sourceFiles) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, '');
      expect(code, file).not.toMatch(/(?<![.\w$])(?:window|document|navigator)\s*(?:\.|\[)/);
    }
  });

  it('resolves theme variables in the document passed by a pop-out editor', () => {
    const popoutDocument = document.implementation.createHTMLDocument();
    const getComputedStyle = vi.fn((_element: Element) => ({ color: 'rgb(10, 20, 30)' }) as CSSStyleDeclaration);
    Object.defineProperty(popoutDocument, 'defaultView', {
      configurable: true,
      value: { getComputedStyle },
    });

    expect(readThemeCssVar('var(--accent)', popoutDocument)).toBe('#0a141e');
    expect(getComputedStyle).toHaveBeenCalledOnce();
    expect(getComputedStyle.mock.calls[0][0].ownerDocument).toBe(popoutDocument);
    expect(popoutDocument.body.querySelector('div')).toBeNull();
  });

  it('cancels retry timers through the active pop-out window', () => {
    vi.useFakeTimers();
    try {
      const popoutDocument = document.implementation.createHTMLDocument();
      const setTimeout = vi.fn((callback: TimerHandler, delay?: number) =>
        window.setTimeout(callback, delay),
      );
      const clearTimeout = vi.fn((id: number) => window.clearTimeout(id));
      vi.stubGlobal('activeDocument', popoutDocument);
      vi.stubGlobal('activeWindow', { setTimeout, clearTimeout });

      const plugin = Object.create(PageColorPropPlugin.prototype) as any;
      plugin.pendingRetryHandles = new Set<() => void>();
      const retry = vi.fn();

      plugin.scheduleRetry(retry, 100);
      plugin.clearPendingRetries();
      vi.advanceTimersByTime(100);

      expect(setTimeout).toHaveBeenCalledOnce();
      expect(clearTimeout).toHaveBeenCalledWith(setTimeout.mock.results[0].value);
      expect(retry).not.toHaveBeenCalled();
      expect(plugin.pendingRetryHandles.size).toBe(0);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});
