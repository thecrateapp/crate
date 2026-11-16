import type { SiteNavLink } from "@crate-web/components/nav/SiteNav.astro";

// The bar's anchors, in page order, the same shape as cratemusic.app's bar.
export const NAV_LINKS: SiteNavLink[] = [
  { href: "#screenshots", label: "Screenshots" },
  { href: "#tour", label: "Tour" },
  { href: "#crate-ui", label: "Crate UI" },
  { href: "#what-is-crate", label: "What is Crate" },
  { href: "#install", label: "Install", accent: true },
  {
    href: "https://github.com/thecrateapp/crate-for-ryoku",
    label: "GitHub",
  },
];
