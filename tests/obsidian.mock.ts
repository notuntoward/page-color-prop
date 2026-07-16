import { vi } from 'vitest';

export const mockedNotice = vi.fn();

export class Notice {
  constructor(...args: any[]) {
    mockedNotice(...args);
  }
}

export class MarkdownView {}
export class Plugin {
  registerEvent = vi.fn();
  registerMarkdownPostProcessor = vi.fn();
  registerEditorExtension = vi.fn();
  addSettingTab = vi.fn();
  loadData = vi.fn();
  saveData = vi.fn();
}
export class TFile {}
export class WorkspaceLeaf {}
export class App {}
export class PluginSettingTab {}
export class Setting {}
export class Modal {}

export const debounce = vi.fn((callback: () => void) => callback);

export const getLinkpath = (s: string) => s;
