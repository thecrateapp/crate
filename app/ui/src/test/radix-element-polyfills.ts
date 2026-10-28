// jsdom has no layout/PointerEvent capture; real-browser checks cover the widget geometry.
export function installRadixElementPolyfills() {
  const installed: string[] = [];
  const methods = {
    hasPointerCapture: () => false,
    setPointerCapture: () => undefined,
    releasePointerCapture: () => undefined,
    scrollIntoView: () => undefined,
  };
  for (const [name, value] of Object.entries(methods)) {
    if (name in HTMLElement.prototype) continue;
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      writable: true,
      value,
    });
    installed.push(name);
  }
  return () => {
    for (const name of installed)
      Reflect.deleteProperty(HTMLElement.prototype, name);
  };
}
