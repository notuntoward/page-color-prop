import { vi } from 'vitest';

export const mockedNotice = vi.fn();

export class Notice {
  constructor(...args: any[]) {
    mockedNotice(...args);
  }
}

export class TFile {}
export class FileView {}
export class MarkdownView extends FileView {}
export class Plugin {
  registerEvent = vi.fn();
  registerMarkdownPostProcessor = vi.fn();
  registerEditorExtension = vi.fn();
  addSettingTab = vi.fn();
  loadData = vi.fn();
  saveData = vi.fn();
}
export class WorkspaceLeaf {}
export class App {}
export class PluginSettingTab {
  containerEl: any;
  constructor(public app: any, public plugin: any) {
    this.containerEl = augmentMockEl(document.createElement('div'));
  }
  update() {
    if (this.containerEl && typeof (this as any).getSettingDefinitions === 'function') {
      this.containerEl.empty();
      const defs = (this as any).getSettingDefinitions();
      for (const def of defs) {
        const setting = new Setting(this.containerEl);
        if (def.name) setting.setName(def.name);
        if (def.desc) setting.setDesc(def.desc);
        if (def.control) {
          if (def.control.type === 'toggle') {
            setting.addToggle((t: any) => {
              t.setValue(this.plugin?.settings?.[def.control.key]);
            });
          }
        }
        if (def.render) {
          def.render(setting);
        }
      }
    }
  }
  display() {
    this.update();
  }
}
function augmentMockEl(el: any): any {
  el.createEl = vi.fn((t: string, opts?: any) => {
    const child = augmentMockEl(document.createElement(t));
    if (opts?.text) child.textContent = opts.text;
    if (opts?.cls) child.className = opts.cls;
    if (opts?.type) child.type = opts.type;
    el.appendChild(child);
    return child;
  });
  el.createDiv = vi.fn((arg?: any) => {
    const child = augmentMockEl(document.createElement('div'));
    if (typeof arg === 'string') child.className = arg;
    else if (arg?.text) child.textContent = arg.text;
    else if (arg?.cls) child.className = arg.cls;
    el.appendChild(child);
    return child;
  });
  el.createSpan = vi.fn((arg?: any) => {
    const child = augmentMockEl(document.createElement('span'));
    if (typeof arg === 'string') child.className = arg;
    else if (arg?.text) child.textContent = arg.text;
    else if (arg?.cls) child.className = arg.cls;
    el.appendChild(child);
    return child;
  });
  el.empty = vi.fn(() => { el.innerHTML = ''; });
  el.setText = vi.fn((t: string) => { el.textContent = t; });
  el.appendText = vi.fn((t: string) => { el.textContent = (el.textContent || '') + t; });
  el.addClass = vi.fn((c: string) => el.classList.add(c));
  el.removeClass = vi.fn((c: string) => el.classList.remove(c));
  el.setAttr = vi.fn();
  el.onClickEvent = vi.fn();
  return el;
}

export class Setting {
  settingEl = augmentMockEl(document.createElement('div'));
  controlEl = augmentMockEl(document.createElement('div'));
  infoEl = augmentMockEl(document.createElement('div'));
  nameEl = augmentMockEl(document.createElement('div'));
  descEl = augmentMockEl(document.createElement('div'));
  constructor(public containerEl?: any) {
    this.settingEl.appendChild(this.infoEl);
    this.settingEl.appendChild(this.controlEl);
    this.infoEl.appendChild(this.nameEl);
    this.infoEl.appendChild(this.descEl);
    if (containerEl && typeof containerEl.appendChild === 'function') {
      containerEl.appendChild(this.settingEl);
    }
  }
  setName(name: string) { return this; }
  setDesc(desc: string) { return this; }
  addToggle(cb: (toggle: any) => void) {
    const toggle = {
      setValue: vi.fn().mockReturnThis(),
      onChange: vi.fn().mockReturnThis()
    };
    cb(toggle);
    return this;
  }
  addText(cb: (text: any) => void) {
    const text = {
      setValue: vi.fn().mockReturnThis(),
      onChange: vi.fn().mockReturnThis(),
      inputEl: document.createElement('input')
    };
    cb(text);
    return this;
  }
  addDropdown(cb: (dropdown: any) => void) {
    const dropdown = {
      addOption: vi.fn().mockReturnThis(),
      setValue: vi.fn().mockReturnThis(),
      onChange: vi.fn().mockReturnThis()
    };
    cb(dropdown);
    return this;
  }
  addColorPicker(cb: (picker: any) => void) {
    const picker = {
      setValue: vi.fn().mockReturnThis(),
      onChange: vi.fn().mockReturnThis()
    };
    cb(picker);
    return this;
  }
  addButton(cb: (btn: any) => void) {
    const btn = {
      setButtonText: vi.fn().mockReturnThis(),
      setCta: vi.fn().mockReturnThis(),
      setWarning: vi.fn().mockReturnThis(),
      setIcon: vi.fn().mockReturnThis(),
      setTooltip: vi.fn().mockReturnThis(),
      onClick: vi.fn().mockReturnThis()
    };
    cb(btn);
    return this;
  }
}
export class Modal {}

export const setIcon = vi.fn();

export const debounce = vi.fn((callback: () => void) => callback);

export const getLinkpath = (s: string) => s;
