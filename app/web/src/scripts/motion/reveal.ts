export function initReveals(root: ParentNode = document): () => void {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-in");
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0, rootMargin: "0px 0px -8% 0px" },
  );
  root
    .querySelectorAll("[data-reveal]")
    .forEach((element) => observer.observe(element));
  return () => observer.disconnect();
}
