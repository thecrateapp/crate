const scrollLocks = new WeakMap<
  Document,
  { count: number; restore: () => void }
>();

export function acquireBodyScrollLock(doc: Document) {
  let lock = scrollLocks.get(doc);
  if (!lock) {
    const elements = [doc.body, doc.documentElement];
    const previous = elements.map(
      ({ style }) => [style.overflow, style.overscrollBehavior] as const,
    );
    lock = {
      count: 0,
      restore: () =>
        elements.forEach(({ style }, index) => {
          [style.overflow, style.overscrollBehavior] = previous[index]!;
        }),
    };
    scrollLocks.set(doc, lock);
    elements.forEach(({ style }) => {
      style.overflow = "hidden";
      style.overscrollBehavior = "none";
    });
  }
  lock.count++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--lock.count === 0) {
      lock.restore();
      scrollLocks.delete(doc);
    }
  };
}
