export function createScrollspy(rail: HTMLElement): () => void {
  const links = [...rail.querySelectorAll<HTMLAnchorElement>("a[href^='#']")];
  const sections = links
    .map((link) =>
      document.getElementById(decodeURIComponent(link.hash.slice(1))),
    )
    .filter((section): section is HTMLElement => section !== null);
  const inBand = new Set<Element>();

  function mark(id: string | null) {
    links.forEach((link) =>
      link.toggleAttribute("data-current", link.hash === `#${id}`),
    );
  }

  const spy = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) =>
        entry.isIntersecting
          ? inBand.add(entry.target)
          : inBand.delete(entry.target),
      );
      const current = sections.find((section) => inBand.has(section));
      if (current) mark(current.id);
    },
    { rootMargin: "-45% 0px -50% 0px" },
  );
  sections.forEach((section) => spy.observe(section));

  const reveal = new IntersectionObserver(
    (entries) => {
      const started = entries.some((entry) => entry.isIntersecting);
      rail.toggleAttribute("data-visible", started);
      if (!started) mark(null);
    },
    { rootMargin: "100000px 0px -50% 0px" },
  );
  if (sections[0]) reveal.observe(sections[0]);

  return () => {
    spy.disconnect();
    reveal.disconnect();
  };
}
