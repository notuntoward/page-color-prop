import { vi } from 'vitest';

Object.defineProperty(globalThis, 'CSS', {
  configurable: true,
  value: {
    supports: vi.fn(() => true)
  }
});

Object.defineProperty(globalThis, 'activeDocument', {
  configurable: true,
  value: document
});

Object.defineProperty(globalThis, 'activeWindow', {
  configurable: true,
  value: window
});

Element.prototype.addClass = function addClass(className: string) {
  this.classList.add(className);
  return this;
};

Element.prototype.removeClass = function removeClass(className: string) {
  this.classList.remove(className);
  return this;
};

Element.prototype.hasClass = function hasClass(className: string) {
  return this.classList.contains(className);
};

HTMLElement.prototype.setCssProps = function setCssProps(properties: Record<string, string>) {
  for (const [property, value] of Object.entries(properties)) {
    this.style.setProperty(property, value);
  }
};

Element.prototype.instanceOf = function instanceOf<T>(constructor: new (...args: any[]) => T): this is T {
  return this instanceof constructor;
};
