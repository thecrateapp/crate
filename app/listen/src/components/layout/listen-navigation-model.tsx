import { BandcampLogo } from "@crate/ui/domain/brand/BandcampLogo";
import {
  Activity,
  CrateBox,
  CRATE_ICON_SIZE,
  Disc,
  Heart,
  Home,
  ListMusic,
  Music,
  Radar,
  Search,
  Upload,
  Users,
} from "@crate/ui/icons";
import { COLLECTION_SECTIONS } from "./CollectionTabs";
import type { ListenNavItem } from "./ListenNavigation";

export function listenNavigationItems(
  t: (key: string) => string,
  mobile: boolean,
): ListenNavItem[] {
  return (
    mobile
      ? [
          { to: "/", icon: Home, key: "nav.home" },
          { to: "/explore", icon: Search, key: "nav.explore" },
          { to: "/upcoming", icon: Radar, key: "nav.radar" },
        ]
      : [
          { to: "/", icon: Music, key: "nav.music" },
          { to: "/explore", icon: Search, key: "nav.explore" },
          { to: "/upcoming", icon: Radar, key: "nav.radar" },
          { to: "/stats", icon: Activity, key: "nav.stats" },
        ]
  ).map(({ to, icon: Icon, key }) => ({
    to,
    label: t(key),
    icon: <Icon size={CRATE_ICON_SIZE.navMobile} />,
  }));
}

export function collectionNavigationItems(
  t: (key: string) => string,
  mobile: boolean,
  location: { pathname: string; search: string },
): ListenNavItem[] {
  const requested = location.pathname.startsWith("/collection/")
    ? location.pathname.split("/")[2]
    : new URLSearchParams(location.search).get("tab") || "playlists";
  const selected =
    COLLECTION_SECTIONS.find((section) => section === requested) ?? "playlists";
  const inCollection =
    location.pathname === "/library" ||
    location.pathname.startsWith("/collection");
  return [
    { section: "artists", icon: Users, key: "nav.collection.artists" },
    { section: "crates", icon: CrateBox, key: "nav.collection.crates" },
    { section: "playlists", icon: ListMusic, key: "nav.collection.playlists" },
    { section: "albums", icon: Disc, key: "nav.collection.albums" },
    { section: "liked", icon: Heart, key: "nav.collection.likedTracks" },
    { section: "bandcamp", icon: BandcampLogo, key: "nav.collection.bandcamp" },
    {
      section: "contributions",
      icon: Upload,
      key: "nav.collection.contributions",
    },
  ].map(({ section, icon: Icon, key }) => ({
    to: mobile
      ? `/collection/${section}`
      : section === "bandcamp"
        ? "/bandcamp"
        : `/library?tab=${section}`,
    label: t(key),
    icon: <Icon size={CRATE_ICON_SIZE.xl} />,
    active:
      (inCollection && selected === section) ||
      (section === "bandcamp" && location.pathname === "/bandcamp"),
  }));
}
