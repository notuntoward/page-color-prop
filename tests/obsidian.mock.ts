import { vi } from 'vitest';

export const mockedNotice = vi.fn();

export class Notice {
  constructor(...args: any[]) {
    mockedNotice(...args);
  }
}

export class MarkdownView {}
export class Plugin {}
export class TFile {}
export class WorkspaceLeaf {}
export class App {}
export class PluginSettingTab {}
export class Setting {}
export class Modal {}

export const debounce = vi.fn((callback: () => void) => callback);
