import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import {
  ARTIST_HERO_DESKTOP_SIZE,
  ARTIST_HERO_MOBILE_SIZE,
  ArtistHeroFrame,
  type ArtistHeroArtworkBounds,
} from "@crate/ui/domain/ArtistHeroFrame";
import { ArtistHeroPresentation } from "@crate/ui/domain/ArtistHeroPresentation";
import { FollowHeartButton } from "@crate/ui/primitives/FollowHeartButton";
import {
  Play,
  Sparkles,
  Radio,
  Disc3,
  UserRound,
  ChevronUp,
  ChevronDown,
} from "@crate/ui/icons";

import {
  ItemActionMenu,
  ItemActionMenuButton,
  type ContextMenuHeader,
  type ItemActionMenuEntry,
  useItemActionMenu,
} from "@/components/actions/ItemActionMenu";
import { GenrePill } from "@crate/ui/domain/genres/GenrePill";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { useAlbumActionEntries } from "@/components/actions/album-actions";
import { useArtistActionEntries } from "@/components/actions/artist-actions";
import { usePlaylistActionEntries } from "@/components/actions/playlist-actions";
import { AlbumCard } from "@/components/cards/AlbumCard";
import { ArtistCard } from "@/components/cards/ArtistCard";
import { CrateImage } from "@/components/artwork/CrateImage";
import {
  canonicalArtworkTransportIdentity,
  preloadArtwork,
} from "@/lib/artwork-manager";
import { artworkFromUrl } from "@/lib/artwork-source";
import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";
import { CoreTracksArtwork } from "@/components/home/CoreTracksArtwork";
import { MixArtwork } from "@/components/home/MixArtwork";
import {
  SectionHeader,
  SectionRail,
  useSectionRail,
} from "@/components/home/HomeSections";
import { EditorialPlaylistArtwork } from "@/components/playlists/EditorialPlaylistArtwork";
import { PlaylistArtwork } from "@/components/playlists/PlaylistArtwork";
import {
  albumCoverApiUrl,
  albumPagePath,
  artistHeroApiUrl,
  artistPagePath,
  artistPhotoApiUrl,
} from "@/lib/library-routes";
import { resolveMaybeApiAssetUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

import type {
  HomeDiscoveryPayload,
  HomeDiscoveryHeroSurfaces,
  HomeGeneratedPlaylistSummary,
  HomeHeroArtist,
  HomeListeningHistoryCard,
  HomeRadioStation,
  HomeRecentItem,
  HomeSectionId,
  HomeSuggestedAlbum,
} from "./home-model";

const HERO_BACKGROUND_VERSION = "home-just-landed-v1";

function chunkItems<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function dedupeHeroArtists(heroes: HomeHeroArtist[]): HomeHeroArtist[] {
  const seen = new Set<string>();
  return heroes.filter((hero) => {
    const name = hero.name?.trim().replace(/\s+/g, " ").toLowerCase();
    const key = name || hero.entity_uid || String(hero.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function heroSelectionKey(hero: HomeHeroArtist): string {
  return hero.entity_uid || String(hero.id);
}

function mixArtistSummary(item: HomeGeneratedPlaylistSummary): string {
  const names = (item.artwork_artists || [])
    .map((artist) => artist.artist_name?.trim())
    .filter(Boolean) as string[];

  if (!names.length) return item.description;
  const [first = "", second = "", third = ""] = names;
  if (names.length === 1) return first;
  if (names.length === 2) return `${first}, ${second}`;
  if (names.length === 3) return `${first}, ${second}, ${third}`;
  return `${first}, ${second}, ${third} and more`;
}

const HISTORY_TONES = [
  "from-cyan-400/30 via-teal-950/65 to-black",
  "from-amber-300/30 via-stone-950/70 to-black",
  "from-indigo-400/30 via-slate-950/70 to-black",
  "from-rose-300/30 via-red-950/60 to-black",
  "from-lime-300/35 via-emerald-950/55 to-black",
  "from-fuchsia-300/30 via-purple-950/65 to-black",
];

function historyLabel(item: HomeListeningHistoryCard): string {
  if (item.kind === "all_time") return "MY MOST LISTENED";
  return item.period_label;
}

function historyKicker(item: HomeListeningHistoryCard): string {
  if (item.kind === "all_time") return "Crate History";
  const date = new Date(`${item.period_start}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "Listening History";
  return String(date.getFullYear());
}

function historyDisplayTitle(item: HomeListeningHistoryCard): string {
  if (item.kind === "all_time") return item.title;
  if (item.title !== "My Most Listened") return item.title;
  const date = new Date(`${item.period_start}T12:00:00`);
  if (Number.isNaN(date.getTime())) return item.title;
  return date.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function formatHistoryMinutes(minutes: number): string {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const rest = Math.round(minutes % 60);
    return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
  }
  return `${Math.round(minutes)}m`;
}

function recentArtwork(item: HomeRecentItem): string | null {
  if (item.type === "playlist") {
    return null;
  }
  if (item.type === "artist") {
    return (
      artistPhotoApiUrl(
        {
          artistId: item.artist_id,
          artistEntityUid: item.artist_entity_uid,
          globalArtistUid: item.global_artist_uid,
          artistSlug: item.artist_slug,
          artistName: item.artist_name,
        },
        { size: 192 },
      ) || null
    );
  }
  return (
    albumCoverApiUrl(
      {
        albumId: item.album_id,
        albumEntityUid: item.album_entity_uid,
        globalAlbumUid: item.global_album_uid,
        artistEntityUid: item.artist_entity_uid,
        albumSlug: item.album_slug,
        artistName: item.artist_name,
        albumName: item.album_name,
      },
      { size: 192 },
    ) || null
  );
}

function recentTitle(item: HomeRecentItem): string {
  if (item.type === "playlist") return item.playlist_name;
  if (item.type === "artist") return item.artist_name;
  return item.album_name;
}

function recentSubtitle(item: HomeRecentItem): string | undefined {
  if (item.type === "playlist") {
    return item.playlist_description || item.subtitle;
  }
  if (item.type === "artist") return item.subtitle;
  return item.artist_name;
}

function radioArtwork(station: HomeRadioStation): string | null {
  if (station.type === "album") {
    return (
      albumCoverApiUrl(
        {
          albumId: station.album_id,
          globalAlbumUid: station.global_album_uid,
          albumEntityUid: station.album_entity_uid,
          artistEntityUid: station.artist_entity_uid,
          albumSlug: station.album_slug,
          artistName: station.artist_name,
          albumName: station.album_name,
        },
        { size: 256 },
      ) || null
    );
  }
  return (
    artistPhotoApiUrl(
      {
        artistId: station.artist_id,
        globalArtistUid: station.global_artist_uid,
        artistEntityUid: station.artist_entity_uid,
        artistSlug: station.artist_slug,
        artistName: station.artist_name,
      },
      { size: 256 },
    ) || null
  );
}

function radioSeedTypeLabel(
  station: HomeRadioStation,
  labels: {
    track: string;
    album: string;
    genre: string;
    artist: string;
  },
): string {
  const seedType = station.seed_type ?? station.type;
  if (seedType === "track") return labels.track;
  if (seedType === "album") return labels.album;
  if (seedType === "genre") return labels.genre;
  return labels.artist;
}

function radioSeedLabel(station: HomeRadioStation): string {
  return (
    station.seed_label ||
    station.track_title ||
    station.album_name ||
    station.artist_name ||
    station.genre_name ||
    station.title.replace(/\s+Radio$/i, "")
  );
}

function radioSeedSubtitle(station: HomeRadioStation): string | null {
  return (
    station.seed_subtitle ||
    (station.type === "album" ? station.artist_name : null) ||
    (station.type === "track" ? station.artist_name : null) ||
    null
  );
}

function heroBackgroundSrc(
  hero: HomeHeroArtist,
  composition: "desktop" | "mobile",
): string | undefined {
  const canonical = hero.hero_compositions?.[composition];
  const backgroundUrl = artistHeroApiUrl(
    {
      artistId: hero.id,
      artistEntityUid: hero.entity_uid,
      artistSlug: hero.slug,
      artistName: hero.name,
    },
    composition,
    {
      size:
        canonical?.width ??
        (composition === "desktop"
          ? ARTIST_HERO_DESKTOP_SIZE.width
          : ARTIST_HERO_MOBILE_SIZE.width),
      version:
        canonical?.render_revision ||
        hero.artwork_revision ||
        HERO_BACKGROUND_VERSION,
    },
  );
  return backgroundUrl || undefined;
}

function heroArtworkBounds(
  hero: HomeHeroArtist,
  composition: "desktop" | "mobile",
): ArtistHeroArtworkBounds | undefined {
  return (
    hero.hero_compositions?.[composition]?.bounds ||
    (composition === "desktop"
      ? hero.desktop_artwork_bounds
      : hero.mobile_artwork_bounds)
  );
}

function requestBackgroundWork(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const idleWindow = window as Window & {
    requestIdleCallback?: (
      cb: () => void,
      options?: { timeout: number },
    ) => number;
    cancelIdleCallback?: (handle: number) => void;
  };

  if (idleWindow.requestIdleCallback) {
    const handle = idleWindow.requestIdleCallback(callback, { timeout: 1500 });
    return () => idleWindow.cancelIdleCallback?.(handle);
  }

  const handle = window.setTimeout(callback, 600);
  return () => window.clearTimeout(handle);
}

function useHeroBackgroundPreloader(
  heroes: HomeHeroArtist[],
  activeIndex: number,
  composition: "desktop" | "mobile",
): void {
  const sources = useMemo(
    () =>
      heroes
        .map((hero) => heroBackgroundSrc(hero, composition))
        .filter((src): src is string => Boolean(src)),
    [composition, heroes],
  );
  const readyRef = useRef<Set<string>>(new Set());
  const inFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const allowed = new Set(sources);
    readyRef.current = new Set(
      [...readyRef.current].filter((src) => allowed.has(src)),
    );
    inFlightRef.current = new Set(
      [...inFlightRef.current].filter((src) => allowed.has(src)),
    );
  }, [sources]);

  useEffect(() => {
    if (!sources.length || typeof window === "undefined") return;

    let cancelled = false;
    const controller = new AbortController();
    const started = new Set<string>();
    const timeouts: number[] = [];

    const markReady = (src: string) => {
      readyRef.current.add(src);
    };

    const loadSource = (src: string | undefined, priority: "high" | "low") => {
      if (!src || readyRef.current.has(src) || inFlightRef.current.has(src))
        return;
      inFlightRef.current.add(src);
      started.add(src);
      void preloadArtwork(
        artworkFromUrl(src, {
          logicalKey: `home-hero:${canonicalArtworkTransportIdentity(src)}`,
        }),
        { fetchPriority: priority, signal: controller.signal },
      )
        .then(() => {
          if (!cancelled) markReady(src);
        })
        .catch(() => undefined)
        .finally(() => {
          inFlightRef.current.delete(src);
        });
    };

    const current =
      sources[Math.max(0, Math.min(activeIndex, sources.length - 1))];
    const next =
      sources.length > 1
        ? sources[(activeIndex + 1) % sources.length]
        : undefined;
    const immediate = new Set(
      [current, next].filter((src): src is string => Boolean(src)),
    );

    immediate.forEach((src) => loadSource(src, "high"));

    const cancelBackgroundWork = requestBackgroundWork(() => {
      sources
        .filter((src) => !immediate.has(src))
        .forEach((src, index) => {
          const timeout = window.setTimeout(() => {
            if (!cancelled) loadSource(src, "low");
          }, index * 220);
          timeouts.push(timeout);
        });
    });

    return () => {
      cancelled = true;
      controller.abort();
      cancelBackgroundWork();
      timeouts.forEach((timeout) => window.clearTimeout(timeout));
      started.forEach((src) => inFlightRef.current.delete(src));
    };
  }, [activeIndex, sources]);
}

export function HomeTasteHero({
  heroes,
  heroSurfaces,
  isFollowing,
  onOpenArtist,
  onPlay,
  onToggleFollow,
  desktopIntro,
}: {
  heroes: HomeHeroArtist[];
  heroSurfaces?: HomeDiscoveryHeroSurfaces | null;
  isFollowing: (id?: number) => boolean;
  onOpenArtist: (artist: HomeHeroArtist) => void;
  onPlay: (artist: HomeHeroArtist) => void;
  onToggleFollow: (artist: HomeHeroArtist) => void;
  desktopIntro?: ReactNode;
}) {
  const isDesktop = useIsDesktop();
  const composition = isDesktop ? "desktop" : "mobile";
  const surface = heroSurfaces?.[composition];
  const surfaceArtists = heroSurfaces ? surface?.artists ?? [] : heroes;
  const surfaceHeroes = useMemo(
    () => dedupeHeroArtists(surfaceArtists),
    [surfaceArtists],
  );
  const count = surfaceHeroes.length;
  const [idx, setIdx] = useState(() =>
    isDesktop && count > 1 ? Math.floor(Math.random() * count) : 0,
  );
  const [mobileHeroKey, setMobileHeroKey] = useState<string | null>(() => {
    if (isDesktop || !count) return null;
    return heroSelectionKey(
      surfaceHeroes[Math.floor(Math.random() * count)] || surfaceHeroes[0]!,
    );
  });
  const desktopActiveIndex = Math.min(idx, Math.max(count - 1, 0));
  const mobileHero = surfaceHeroes.find(
    (hero) => heroSelectionKey(hero) === mobileHeroKey,
  );
  const mobileActiveIndex = mobileHero
    ? Math.max(0, surfaceHeroes.indexOf(mobileHero))
    : 0;
  const activeIndex = isDesktop ? desktopActiveIndex : mobileActiveIndex;
  const desktopInitialIndexSet = useRef(isDesktop && count > 1);
  useHeroBackgroundPreloader(surfaceHeroes, activeIndex, composition);

  useEffect(() => {
    setIdx((current) =>
      Math.min(current, Math.max(surfaceHeroes.length - 1, 0)),
    );
  }, [surfaceHeroes.length]);

  useEffect(() => {
    if (!isDesktop || count <= 1 || desktopInitialIndexSet.current) return;
    desktopInitialIndexSet.current = true;
    setIdx(Math.floor(Math.random() * count));
  }, [count, isDesktop]);

  useEffect(() => {
    if (isDesktop || !count) return;
    setMobileHeroKey((current) => {
      if (
        current &&
        surfaceHeroes.some((hero) => heroSelectionKey(hero) === current)
      ) {
        return current;
      }
      return heroSelectionKey(
        surfaceHeroes[Math.floor(Math.random() * count)] || surfaceHeroes[0]!,
      );
    });
  }, [count, isDesktop, surfaceHeroes]);

  if (!count) return null;

  if (!isDesktop) {
    if (!mobileHero) return null;
    const hero = mobileHero;
    return (
      <MobileFeaturedArtist
        hero={hero}
        backgroundSrc={heroBackgroundSrc(hero, "mobile")}
        following={isFollowing(hero.id)}
        onOpenArtist={() => onOpenArtist(hero)}
        onPlay={() => onPlay(hero)}
        onToggleFollow={() => onToggleFollow(hero)}
      />
    );
  }

  const go = (offset: number) => {
    setIdx((current) => (current + offset + count) % count);
  };

  return (
    <div
      data-testid="desktop-editorial-hero"
      className="relative mx-auto aspect-[1480/600] min-h-[clamp(480px,38dvh,600px)] w-full max-w-[1480px] overflow-hidden bg-app-surface"
    >
      {surfaceHeroes.map((hero, index) => {
        const source = heroBackgroundSrc(hero, "desktop");
        const isPrepared =
          index === desktopActiveIndex ||
          index === (desktopActiveIndex + 1) % count ||
          index === (desktopActiveIndex - 1 + count) % count;
        return (
          <DesktopFeaturedArtist
            key={hero.entity_uid || hero.id}
            hero={hero}
            active={index === desktopActiveIndex}
            backgroundSrc={isPrepared ? source : undefined}
            following={isFollowing(hero.id)}
            onOpenArtist={() => onOpenArtist(hero)}
            onPlay={() => onPlay(hero)}
            onToggleFollow={() => onToggleFollow(hero)}
          />
        );
      })}

      {count > 1 ? (
        <DesktopHeroNavigation
          heroes={surfaceHeroes}
          activeIndex={desktopActiveIndex}
          onPrevious={() => go(-1)}
          onNext={() => go(1)}
          onSelect={setIdx}
        />
      ) : null}

      {desktopIntro ? (
        <div
          data-testid="desktop-hero-intro"
          className="pointer-events-none absolute inset-x-0 top-0 z-20"
        >
          <div className="mx-auto w-full max-w-[1480px] px-6 pt-[92px]">
            {desktopIntro}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function HeroBackdrop({
  hero,
  backgroundSrc,
  composition,
  artworkBounds,
}: {
  hero: HomeHeroArtist;
  backgroundSrc?: string;
  composition: "desktop" | "mobile";
  artworkBounds?: ArtistHeroArtworkBounds;
}) {
  // A persisted hero already contains the worker's treatment. Applying a
  // second browser filter here would make Admin and Home render different
  // pixels, especially for derived compositions.
  const grayscale =
    !hero.artwork_revision && hero.artwork_provenance !== "specific";
  const usesExtendedCanvas =
    artworkBounds &&
    (artworkBounds.left !== 0 ||
      artworkBounds.top !== 0 ||
      artworkBounds.right !== 1 ||
      artworkBounds.bottom !== 1);

  if (!backgroundSrc) return null;

  return (
    <CrateImage
      data-testid={`${composition}-hero-artwork`}
      src={backgroundSrc}
      retryPolicy="eventual"
      alt=""
      aria-hidden="true"
      decoding="async"
      className={cn(
        "absolute inset-0 h-full w-full transition-opacity duration-500",
        usesExtendedCanvas ? "object-fill" : "object-cover object-center",
        grayscale ? "grayscale" : "",
      )}
    />
  );
}

function HeroGenres({ hero }: { hero: HomeHeroArtist }) {
  const genres =
    hero.genres?.map((name) => ({ name })).filter((item) => item.name) ?? [];

  if (genres.length === 0) return null;

  return (
    <div className="mt-4 flex min-w-0 max-w-full flex-wrap gap-1.5 overflow-hidden">
      {genres.slice(0, 2).map((genre) => (
        <GenrePill
          key={genre.name}
          item={genre}
          className="max-w-[42vw] border-white/10 bg-black/30 text-white/80 backdrop-blur-sm sm:max-w-none"
        />
      ))}
    </div>
  );
}

function HeroActions({
  hero,
  following,
  onPlay,
  onToggleFollow,
}: {
  hero: HomeHeroArtist;
  following: boolean;
  onPlay: () => void;
  onToggleFollow: () => void;
}) {
  const { t } = useTranslation();

  const playLabel = t("home.hero.playArtist", { name: hero.name });
  const followLabel = t(
    following ? "actions.artist.unfollowNamed" : "actions.artist.followNamed",
    { name: hero.name },
  );

  return (
    <div className="mt-6 flex items-center gap-2.5">
      <button
        type="button"
        aria-label={playLabel}
        className={cn(
          "inline-flex h-11 items-center justify-center gap-2 rounded-md bg-primary font-semibold text-primary-foreground shadow-[0_10px_28px_rgba(6,182,212,0.2)] transition-colors hover:bg-primary/90",
          "px-5",
        )}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onPlay();
        }}
      >
        <Play size={17} fill="currentColor" />
        <span>{t("home.hero.playCta")}</span>
      </button>
      <FollowHeartButton
        aria-label={followLabel}
        className={cn(
          "inline-flex h-11 w-11 items-center justify-center rounded-md border-0 bg-transparent text-white/80 transition-colors hover:bg-transparent hover:text-white",
        )}
        following={following}
        heartTestId="hero-follow-heart"
        particlesTestId="hero-follow-particles"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onToggleFollow();
        }}
      />
    </div>
  );
}

function MobileFeaturedArtist({
  hero,
  backgroundSrc,
  following,
  onOpenArtist,
  onPlay,
  onToggleFollow,
}: {
  hero: HomeHeroArtist;
  backgroundSrc?: string;
  following: boolean;
  onOpenArtist: () => void;
  onPlay: () => void;
  onToggleFollow: () => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="relative h-[55dvh] min-h-[430px] max-h-[620px] w-full overflow-hidden bg-app-surface">
      <ArtistHeroFrame
        composition="mobile"
        artworkBounds={heroArtworkBounds(hero, "mobile")}
        className="absolute inset-0 h-full"
        artwork={
          <HeroBackdrop
            hero={hero}
            backgroundSrc={backgroundSrc}
            composition="mobile"
            artworkBounds={heroArtworkBounds(hero, "mobile")}
          />
        }
      >
        <button
          type="button"
          aria-label={t("home.hero.openArtist", { name: hero.name })}
          className="absolute inset-0 z-10 cursor-pointer"
          onClick={onOpenArtist}
        />
        <ArtistHeroPresentation
          composition="mobile"
          kicker={t("home.hero.featuredArtist")}
          artistName={hero.name}
          genres={<HeroGenres hero={hero} />}
          actions={
            <HeroActions
              hero={hero}
              following={following}
              onPlay={onPlay}
              onToggleFollow={onToggleFollow}
            />
          }
          actionsClassName="pointer-events-auto"
        />
      </ArtistHeroFrame>
    </section>
  );
}

function DesktopFeaturedArtist({
  hero,
  active,
  backgroundSrc,
  following,
  onOpenArtist,
  onPlay,
  onToggleFollow,
}: {
  hero: HomeHeroArtist;
  active: boolean;
  backgroundSrc?: string;
  following: boolean;
  onOpenArtist: () => void;
  onPlay: () => void;
  onToggleFollow: () => void;
}) {
  const { t } = useTranslation();
  return (
    <section
      aria-hidden={!active}
      className={cn(
        "absolute inset-0 transition-opacity duration-500 ease-out motion-reduce:transition-opacity",
        active ? "z-10 opacity-100" : "pointer-events-none z-0 opacity-0",
      )}
    >
      <ArtistHeroFrame
        composition="desktop"
        artworkBounds={heroArtworkBounds(hero, "desktop")}
        className="h-full"
        artwork={
          <HeroBackdrop
            hero={hero}
            backgroundSrc={backgroundSrc}
            composition="desktop"
            artworkBounds={heroArtworkBounds(hero, "desktop")}
          />
        }
      >
        <button
          type="button"
          aria-label={t("home.hero.openArtist", { name: hero.name })}
          tabIndex={active ? 0 : -1}
          className="absolute inset-0 z-10 cursor-pointer"
          onClick={onOpenArtist}
        />
        <ArtistHeroPresentation
          composition="desktop"
          kicker={t("home.hero.featuredArtist")}
          artistName={hero.name}
          genres={<HeroGenres hero={hero} />}
          actions={
            <HeroActions
              hero={hero}
              following={following}
              onPlay={onPlay}
              onToggleFollow={onToggleFollow}
            />
          }
          actionsClassName="pointer-events-auto"
          copyClassName={cn(
            "transition-opacity duration-500 ease-out motion-reduce:transition-none",
            active ? "opacity-100" : "opacity-0",
          )}
        />
      </ArtistHeroFrame>
    </section>
  );
}

function DesktopHeroNavigation({
  heroes,
  activeIndex,
  onPrevious,
  onNext,
  onSelect,
}: {
  heroes: HomeHeroArtist[];
  activeIndex: number;
  onPrevious: () => void;
  onNext: () => void;
  onSelect: (index: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="absolute right-6 top-[200px] z-30 flex h-[190px] w-8 flex-col items-center">
      <div className="flex flex-1 flex-col items-center justify-center gap-1">
        {heroes.map((hero, index) => (
          <button
            key={hero.entity_uid || hero.id}
            type="button"
            aria-label={t("home.hero.showArtist", { name: hero.name })}
            aria-current={index === activeIndex ? "true" : undefined}
            className="group flex h-6 w-8 items-center justify-center rounded-full bg-transparent"
            onClick={() => onSelect(index)}
          >
            <span
              className={cn(
                "block w-1 rounded-full transition-[height,background-color] duration-300",
                index === activeIndex
                  ? "h-6 bg-primary"
                  : "h-1.5 bg-white/35 group-hover:bg-white/60",
              )}
            />
          </button>
        ))}
      </div>
      <div className="flex flex-col items-center gap-0.5">
        <button
          type="button"
          aria-label={t("home.hero.previousArtist")}
          className="flex h-8 w-8 items-center justify-center border-0 bg-transparent p-0 text-white/55 shadow-none transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          onClick={onPrevious}
        >
          <ChevronUp size={20} />
        </button>
        <button
          type="button"
          aria-label={t("home.hero.nextArtist")}
          className="flex h-8 w-8 items-center justify-center border-0 bg-transparent p-0 text-white/55 shadow-none transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          onClick={onNext}
        >
          <ChevronDown size={20} />
        </button>
      </div>
    </div>
  );
}

export function RecentEntityRow({
  item,
  onClick,
}: {
  item: HomeRecentItem;
  onClick: () => void;
}) {
  if (item.type === "album") {
    return <RecentAlbumEntityRow item={item} onClick={onClick} />;
  }
  if (item.type === "artist") {
    return <RecentArtistEntityRow item={item} onClick={onClick} />;
  }
  return <RecentPlaylistEntityRow item={item} onClick={onClick} />;
}

function RecentAlbumEntityRow({
  item,
  onClick,
}: {
  item: Extract<HomeRecentItem, { type: "album" }>;
  onClick: () => void;
}) {
  const artworkUrl = recentArtwork(item);
  const actions = useAlbumActionEntries({
    artist: item.artist_name,
    artistSlug: item.artist_slug,
    artistEntityUid: item.artist_entity_uid,
    album: item.album_name,
    albumId: item.album_id,
    albumEntityUid: item.album_entity_uid,
    globalAlbumUid: item.global_album_uid,
    albumSlug: item.album_slug,
    cover: artworkUrl ?? undefined,
  });

  return (
    <RecentEntityRowFrame
      item={item}
      actions={actions}
      header={{
        type: "media",
        title: item.album_name,
        subtitle: item.artist_name,
        imageUrl: artworkUrl,
        imageAlt: item.album_name,
        imageShape: "square",
        fallbackIcon: Disc3,
      }}
      onClick={onClick}
    />
  );
}

function RecentArtistEntityRow({
  item,
  onClick,
}: {
  item: Extract<HomeRecentItem, { type: "artist" }>;
  onClick: () => void;
}) {
  const artworkUrl = recentArtwork(item);
  const actions = useArtistActionEntries({
    artistId: item.artist_id,
    artistEntityUid: item.artist_entity_uid,
    globalArtistUid: item.global_artist_uid,
    artistSlug: item.artist_slug,
    imageUrl: artworkUrl,
    name: item.artist_name,
  });

  return (
    <RecentEntityRowFrame
      item={item}
      actions={actions}
      header={{
        type: "media",
        title: item.artist_name,
        subtitle: item.subtitle,
        imageUrl: artworkUrl,
        imageAlt: item.artist_name,
        imageShape: "circle",
        fallbackIcon: UserRound,
      }}
      onClick={onClick}
    />
  );
}

function RecentPlaylistEntityRow({
  item,
  onClick,
}: {
  item: Extract<HomeRecentItem, { type: "playlist" }>;
  onClick: () => void;
}) {
  const actions = usePlaylistActionEntries({
    playlistId: item.playlist_id,
    name: item.playlist_name,
    isSmart: item.playlist_scope === "system",
    href: openRecentItemPath(item),
  });

  return (
    <RecentEntityRowFrame
      item={item}
      actions={actions}
      header={{
        type: "media",
        title: item.playlist_name,
        subtitle: item.playlist_description || item.subtitle,
        imageUrl: resolveMaybeApiAssetUrl(item.playlist_cover_data_url),
        imageAlt: item.playlist_name,
        imageShape: "square",
        fallbackIcon: Sparkles,
      }}
      onClick={onClick}
    />
  );
}

function RecentEntityRowFrame({
  item,
  actions,
  header,
  onClick,
}: {
  item: HomeRecentItem;
  actions: ItemActionMenuEntry[];
  header: ContextMenuHeader;
  onClick: () => void;
}) {
  const artworkUrl = recentArtwork(item);
  const title = recentTitle(item);
  const subtitle = recentSubtitle(item);
  const actionMenu = useItemActionMenu(actions);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    actionMenu.handleKeyboardTrigger(event);
    if (event.defaultPrevented) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onClick();
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      onContextMenu={actionMenu.handleContextMenu}
      className="group flex min-w-0 items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-3 text-left transition-colors hover:bg-white/[0.06]"
      {...actionMenu.longPressHandlers}
    >
      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-white/5">
        {item.type === "playlist" ? (
          <PlaylistArtwork
            name={item.playlist_name}
            coverDataUrl={item.playlist_cover_data_url}
            tracks={item.playlist_tracks}
            className="h-full w-full rounded-xl"
          />
        ) : artworkUrl ? (
          <CrateImage
            src={artworkUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-white/5">
            {item.type === "artist" ? (
              <UserRound size={18} className="text-white/30" />
            ) : (
              <Disc3 size={18} className="text-white/30" />
            )}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-foreground">
          {title}
        </div>
        {subtitle ? (
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {subtitle}
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <ItemActionMenuButton
          buttonRef={actionMenu.triggerRef}
          hasActions={actionMenu.hasActions}
          onClick={actionMenu.openFromTrigger}
          className="h-9 w-9 opacity-75 transition-opacity hover:opacity-100 md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
        />
      </div>

      <ItemActionMenu
        actions={actions}
        header={header}
        open={actionMenu.open}
        position={actionMenu.position}
        menuRef={actionMenu.menuRef}
        onClose={actionMenu.close}
      />
    </div>
  );
}

export function RecentlyPlayedSection({
  items,
  onOpenItem,
  onViewAll,
}: {
  items: HomeDiscoveryPayload["recently_played"];
  onOpenItem: (item: HomeRecentItem) => void;
  onViewAll: (sectionId: HomeSectionId) => void;
}) {
  const { t } = useTranslation();
  const isDesktop = useIsDesktop();
  const visibleItems = isDesktop ? items : items.slice(0, 4);
  const pages = chunkItems(visibleItems, 9);
  const rail = useSectionRail(pages.length);
  if (!items.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.sections.recentlyPlayed.title")}
        subtitle={t("home.sections.recentlyPlayed.subtitle")}
        actionLabel={t("common.viewAll")}
        onAction={() => onViewAll("recently-played")}
        railControls={rail}
      />
      <SectionRail railRef={rail.railRef} className="gap-0">
        {pages.map((pageItems, pageIndex) => (
          <div
            key={`recent-page-${pageIndex}`}
            className="min-w-full snap-start"
          >
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {pageItems.map((item, index) => (
                <RecentEntityRow
                  key={`${item.type}-${pageIndex}-${index}`}
                  item={item}
                  onClick={() => onOpenItem(item)}
                />
              ))}
            </div>
          </div>
        ))}
      </SectionRail>
    </section>
  );
}

export function CustomMixesSection({
  mixes,
  onOpenMix,
  onPlayMix,
  onShuffleMix,
  onStartRadio,
  onViewAll,
}: {
  mixes: HomeGeneratedPlaylistSummary[];
  onOpenMix: (mix: HomeGeneratedPlaylistSummary) => void;
  onPlayMix: (mix: HomeGeneratedPlaylistSummary) => void;
  onShuffleMix: (mix: HomeGeneratedPlaylistSummary) => void;
  onStartRadio: (mix: HomeGeneratedPlaylistSummary) => void;
  onViewAll: (sectionId: HomeSectionId) => void;
}) {
  const { t } = useTranslation();
  const rail = useSectionRail(mixes.length);
  if (!mixes.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.sections.customMixes.title")}
        subtitle={t("home.sections.customMixes.subtitle")}
        actionLabel={t("common.viewAll")}
        onAction={() => onViewAll("custom-mixes")}
        railControls={rail}
      />
      <SectionRail railRef={rail.railRef} fit="square-card">
        {mixes.map((mix) => (
          <CustomMixCard
            key={mix.id}
            item={mix}
            onOpenMix={onOpenMix}
            onPlayMix={onPlayMix}
            onShuffleMix={onShuffleMix}
            onStartRadio={onStartRadio}
          />
        ))}
      </SectionRail>
    </section>
  );
}

export function CustomMixCard({
  item,
  onOpenMix,
  onPlayMix,
  onShuffleMix,
  onStartRadio,
  layout = "rail",
}: {
  item: HomeGeneratedPlaylistSummary;
  onOpenMix: (mix: HomeGeneratedPlaylistSummary) => void;
  onPlayMix: (mix: HomeGeneratedPlaylistSummary) => void;
  onShuffleMix: (mix: HomeGeneratedPlaylistSummary) => void;
  onStartRadio: (mix: HomeGeneratedPlaylistSummary) => void;
  layout?: "rail" | "grid";
}) {
  const { t } = useTranslation();
  const href = `/home/playlist/${encodeURIComponent(item.id)}`;
  const actions = usePlaylistActionEntries({
    name: item.name,
    href,
    onPlay: () => onPlayMix(item),
    onShuffle: () => onShuffleMix(item),
    onStartRadio: () => onStartRadio(item),
  });
  const actionMenu = useItemActionMenu(actions);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpenMix(item)}
      onKeyDown={(event) => {
        actionMenu.handleKeyboardTrigger(event);
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenMix(item);
        }
      }}
      onContextMenu={actionMenu.handleContextMenu}
      {...actionMenu.longPressHandlers}
      className={cn(
        "group cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:rounded-xl",
        layout === "grid" ? "w-full min-w-0" : "w-full min-w-0 snap-start",
      )}
    >
      <div className="relative mb-2 overflow-hidden rounded-xl bg-white/5">
        <MixArtwork
          item={item}
          className="aspect-square rounded-xl transition-transform group-hover:scale-[1.02]"
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/40">
          <button
            className="flex h-10 w-10 translate-y-2 items-center justify-center rounded-full bg-primary opacity-0 shadow-lg transition-all group-hover:translate-y-0 group-hover:opacity-100"
            onClick={(event) => {
              event.stopPropagation();
              onPlayMix(item);
            }}
          >
            <Play
              size={18}
              fill="#0a0a0f"
              className="ml-0.5 text-primary-foreground"
            />
          </button>
        </div>
      </div>
      <div className="truncate text-sm font-semibold text-foreground">
        {item.name}
      </div>
      <div className="mt-1 line-clamp-2 min-h-[2.5rem] text-xs leading-5 text-muted-foreground">
        {mixArtistSummary(item)}
      </div>
      <div className="mt-2 text-[11px] uppercase tracking-[0.18em] text-white/40">
        {t("common.trackCount", { count: item.track_count })}
      </div>
      <ItemActionMenu
        actions={actions}
        header={{
          type: "media",
          title: item.name,
          subtitle: mixArtistSummary(item),
          detail: t("common.trackCount", { count: item.track_count }),
          imageShape: "square",
          fallbackIcon: Sparkles,
        }}
        open={actionMenu.open}
        position={actionMenu.position}
        menuRef={actionMenu.menuRef}
        onClose={actionMenu.close}
      />
    </div>
  );
}

export function ListeningHistorySection({
  items,
  onOpenHistory,
}: {
  items: HomeListeningHistoryCard[];
  onOpenHistory: (item?: HomeListeningHistoryCard) => void;
}) {
  const { t } = useTranslation();
  if (!items.length) return null;
  const featured = items.slice(0, 4);

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.sections.listeningDna.title")}
        subtitle={t("home.sections.listeningDna.subtitle")}
        actionLabel={t("home.sections.listeningDna.action")}
        onAction={() => onOpenHistory()}
      />
      <div className="flex flex-wrap gap-5">
        {featured.map((item, index) => (
          <ListeningHistoryCard
            key={item.id}
            item={item}
            index={index}
            onOpen={onOpenHistory}
          />
        ))}
      </div>
    </section>
  );
}

function ListeningHistoryCard({
  item,
  index,
  onOpen,
}: {
  item: HomeListeningHistoryCard;
  index: number;
  onOpen: (item: HomeListeningHistoryCard) => void;
}) {
  const { t } = useTranslation();
  const artists =
    item.subtitle || t("home.sections.listeningDna.defaultSubtitle");

  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="group w-[min(42vw,13rem)] shrink-0 touch-manipulation text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background lg:w-56"
    >
      <EditorialPlaylistArtwork
        title={historyLabel(item)}
        kicker={historyKicker(item)}
        tracks={item.artwork_tracks}
        variant="history"
        className={cn(
          "aspect-[1.12] rounded-xl bg-gradient-to-br shadow-xl shadow-black/20 transition duration-300 group-hover:border-primary/30 group-hover:brightness-110",
          HISTORY_TONES[index % HISTORY_TONES.length],
        )}
        textClassName={cn(
          item.kind === "all_time"
            ? "[&_div:first-child]:text-[clamp(1.2rem,13cqw,2.45rem)]"
            : "[&_div:first-child]:text-[clamp(2rem,20cqw,3.35rem)]",
        )}
      />
      <div className="mt-2.5 flex min-h-[5.4rem] flex-col">
        <div className="truncate text-sm font-black tracking-[-0.035em] text-foreground">
          {historyDisplayTitle(item)}
        </div>
        <p className="mt-1 line-clamp-2 min-h-10 text-xs leading-5 text-muted-foreground">
          {artists}
        </p>
        <div className="mt-auto text-[10px] font-bold uppercase tracking-[0.14em] text-white/35">
          {t("common.playCount", { count: item.play_count })} ·{" "}
          {formatHistoryMinutes(item.minutes_listened)}
        </div>
      </div>
    </button>
  );
}

export function SuggestedAlbumsSection({
  albums,
  onViewAll,
}: {
  albums: HomeSuggestedAlbum[];
  onViewAll: (sectionId: HomeSectionId) => void;
}) {
  const { t } = useTranslation();
  const rail = useSectionRail(albums.length);
  if (!albums.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.sections.suggestedAlbums.title")}
        subtitle={t("home.sections.suggestedAlbums.subtitle")}
        actionLabel={t("common.viewAll")}
        onAction={() => onViewAll("suggested-albums")}
        railControls={rail}
      />
      <SectionRail railRef={rail.railRef} fit="square-card">
        {albums.map((album) => (
          <AlbumCard
            key={`${
              album.global_album_uid ??
              album.album_id ??
              `${album.artist_name}-${album.album_name}`
            }`}
            artist={album.artist_name}
            album={album.album_name}
            albumId={album.album_id}
            albumEntityUid={album.album_entity_uid}
            globalAlbumUid={album.global_album_uid}
            artistEntityUid={album.artist_entity_uid}
            albumSlug={album.album_slug}
            year={album.year}
            cover={album.cover_url ?? undefined}
            layout="grid"
          />
        ))}
      </SectionRail>
    </section>
  );
}

export function RecommendedTracksSection({
  tracks,
  onViewAll,
}: {
  tracks: TrackRowData[];
  onViewAll: (sectionId: HomeSectionId) => void;
}) {
  const { t } = useTranslation();
  const pages = chunkItems(tracks, 9);
  const rail = useSectionRail(pages.length);
  if (!tracks.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.sections.recommendedTracks.title")}
        subtitle={t("home.sections.recommendedTracks.subtitle")}
        actionLabel={t("common.viewAll")}
        onAction={() => onViewAll("recommended-tracks")}
        railControls={rail}
      />
      <SectionRail railRef={rail.railRef}>
        {pages.map((pageTracks, pageIndex) => (
          <div
            key={`recommended-page-${pageIndex}`}
            className="min-w-full snap-start"
          >
            <div className="grid gap-2 xl:grid-cols-3">
              {pageTracks.map((track, index) => (
                <TrackRow
                  key={`${
                    track.library_track_id ?? track.path ?? track.title
                  }-${pageIndex}-${index}`}
                  track={track}
                  showArtist
                  showAlbum
                  showCoverThumb
                  queueTracks={pageTracks}
                />
              ))}
            </div>
          </div>
        ))}
      </SectionRail>
    </section>
  );
}

export function RadioStationCard({
  station,
  onPlay,
  layout = "rail",
}: {
  station: HomeRadioStation;
  onPlay: () => void;
  layout?: "rail" | "grid";
}) {
  const { t } = useTranslation();
  const artworkUrl = radioArtwork(station);
  const seedTypeLabel = radioSeedTypeLabel(station, {
    track: t("home.radio.track"),
    album: t("home.radio.album"),
    genre: t("home.radio.genre"),
    artist: t("home.radio.artist"),
  });
  const seedLabel = radioSeedLabel(station);
  const seedSubtitle = radioSeedSubtitle(station);

  return (
    <button
      onClick={onPlay}
      className={cn(
        "group relative overflow-hidden rounded-[12px] border border-white/10 bg-white/[0.04] text-left",
        layout === "grid" ? "w-full min-w-0" : "w-full min-w-0 snap-start",
      )}
    >
      {artworkUrl ? (
        <CrateImage
          src={artworkUrl}
          alt=""
          className="aspect-square h-full w-full object-cover object-center transition-transform duration-300 group-hover:scale-[1.04]"
        />
      ) : (
        <div className="aspect-square" />
      )}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_30%,rgba(6,8,12,0.92)_100%)]" />
      <div className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-black/35 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary shadow-[0_0_18px_rgba(6,182,212,0.16)] backdrop-blur-md">
        <Radio size={12} className="inline-block" /> {seedTypeLabel}
      </div>
      <div className="absolute inset-x-0 bottom-0 p-4">
        <div className="truncate text-sm font-semibold text-white">
          {seedLabel}
        </div>
        {seedSubtitle ? (
          <div className="mt-1 line-clamp-2 text-xs leading-5 text-white/60">
            {seedSubtitle}
          </div>
        ) : null}
      </div>
    </button>
  );
}

export function RadioStationsSection({
  stations,
  onPlayStation,
  onViewAll,
}: {
  stations: HomeRadioStation[];
  onPlayStation: (station: HomeRadioStation) => void;
  onViewAll: (sectionId: HomeSectionId) => void;
}) {
  const { t } = useTranslation();
  const rail = useSectionRail(stations.length);
  if (!stations.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.sections.radioStations.title")}
        subtitle={t("home.sections.radioStations.subtitle")}
        actionLabel={t("common.viewAll")}
        onAction={() => onViewAll("radio-stations")}
        railControls={rail}
      />
      <SectionRail railRef={rail.railRef} fit="square-card">
        {stations.map((station) => (
          <RadioStationCard
            key={`${station.type}-${
              station.seed_value ??
              station.global_artist_uid ??
              station.global_album_uid ??
              station.artist_id ??
              station.album_id ??
              station.title
            }`}
            station={station}
            onPlay={() => onPlayStation(station)}
          />
        ))}
      </SectionRail>
    </section>
  );
}

export function FavoriteArtistsSection({
  artists,
  onViewAll,
}: {
  artists: HomeDiscoveryPayload["favorite_artists"];
  onViewAll: (sectionId: HomeSectionId) => void;
}) {
  const { t } = useTranslation();
  const rail = useSectionRail(artists.length);
  if (!artists.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.sections.favoriteArtists.title")}
        subtitle={t("home.sections.favoriteArtists.subtitle")}
        actionLabel={t("common.viewAll")}
        onAction={() => onViewAll("favorite-artists")}
        railControls={rail}
      />
      <SectionRail railRef={rail.railRef} fit="square-card">
        {artists.map((artist) => (
          <ArtistCard
            key={
              artist.global_artist_uid ?? artist.artist_id ?? artist.artist_name
            }
            name={artist.artist_name}
            artistId={artist.artist_id}
            globalArtistUid={artist.global_artist_uid}
            artistEntityUid={artist.artist_entity_uid}
            artistSlug={artist.artist_slug}
            subtitle={t("common.playCount", { count: artist.play_count })}
            layout="grid"
            fillGrid
          />
        ))}
      </SectionRail>
    </section>
  );
}

export function CoreTracksPlaylistCard({
  item,
  onOpenPlaylist,
  onPlayPlaylist,
  onShufflePlaylist,
  onStartRadio,
  layout = "rail",
}: {
  item: HomeGeneratedPlaylistSummary;
  onOpenPlaylist: (item: HomeGeneratedPlaylistSummary) => void;
  onPlayPlaylist: (item: HomeGeneratedPlaylistSummary) => void;
  onShufflePlaylist: (item: HomeGeneratedPlaylistSummary) => void;
  onStartRadio: (item: HomeGeneratedPlaylistSummary) => void;
  layout?: "rail" | "grid";
}) {
  const { t } = useTranslation();
  const href = `/home/playlist/${encodeURIComponent(item.id)}`;
  const actions = usePlaylistActionEntries({
    name: item.name,
    href,
    onPlay: () => onPlayPlaylist(item),
    onShuffle: () => onShufflePlaylist(item),
    onStartRadio: () => onStartRadio(item),
  });
  const actionMenu = useItemActionMenu(actions);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpenPlaylist(item)}
      onKeyDown={(event) => {
        actionMenu.handleKeyboardTrigger(event);
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenPlaylist(item);
        }
      }}
      onContextMenu={actionMenu.handleContextMenu}
      {...actionMenu.longPressHandlers}
      className={cn(
        "group cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:rounded-xl",
        layout === "grid" ? "w-full min-w-0" : "w-full min-w-0 snap-start",
      )}
    >
      <div className="relative mb-2 overflow-hidden rounded-xl bg-white/5">
        <CoreTracksArtwork
          item={item}
          className="aspect-square rounded-xl transition-transform group-hover:scale-[1.02]"
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/40">
          <button
            className="flex h-10 w-10 translate-y-2 items-center justify-center rounded-full bg-primary opacity-0 shadow-lg transition-all group-hover:translate-y-0 group-hover:opacity-100"
            onClick={(event) => {
              event.stopPropagation();
              onPlayPlaylist(item);
            }}
          >
            <Play
              size={18}
              fill="#0a0a0f"
              className="ml-0.5 text-primary-foreground"
            />
          </button>
        </div>
      </div>
      <ItemActionMenu
        actions={actions}
        header={{
          type: "media",
          title: item.name,
          subtitle: t("common.trackCount", { count: item.track_count }),
          imageShape: "square",
          fallbackIcon: Sparkles,
        }}
        open={actionMenu.open}
        position={actionMenu.position}
        menuRef={actionMenu.menuRef}
        onClose={actionMenu.close}
      />
    </div>
  );
}

export function EssentialsSection({
  items,
  onOpenPlaylist,
  onPlayPlaylist,
  onShufflePlaylist,
  onStartRadio,
  onViewAll,
}: {
  items: HomeGeneratedPlaylistSummary[];
  onOpenPlaylist: (item: HomeGeneratedPlaylistSummary) => void;
  onPlayPlaylist: (item: HomeGeneratedPlaylistSummary) => void;
  onShufflePlaylist: (item: HomeGeneratedPlaylistSummary) => void;
  onStartRadio: (item: HomeGeneratedPlaylistSummary) => void;
  onViewAll: (sectionId: HomeSectionId) => void;
}) {
  const { t } = useTranslation();
  const rail = useSectionRail(items.length);
  if (!items.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.sections.artistSets.title")}
        subtitle={t("home.sections.artistSets.subtitle")}
        actionLabel={t("common.viewAll")}
        onAction={() => onViewAll("core-tracks")}
        railControls={rail}
      />
      <SectionRail railRef={rail.railRef} fit="square-card">
        {items.map((item) => (
          <CoreTracksPlaylistCard
            key={item.id}
            item={item}
            onOpenPlaylist={onOpenPlaylist}
            onPlayPlaylist={onPlayPlaylist}
            onShufflePlaylist={onShufflePlaylist}
            onStartRadio={onStartRadio}
          />
        ))}
      </SectionRail>
    </section>
  );
}

export function openRecentItemPath(item: HomeRecentItem): string {
  if (item.type === "playlist") {
    return item.playlist_scope === "system"
      ? `/curation/playlist/${item.playlist_id}`
      : `/playlist/${item.playlist_id}`;
  }
  if (item.type === "artist") {
    return artistPagePath({
      artistId: item.artist_id,
      artistEntityUid: item.artist_entity_uid,
      globalArtistUid: item.global_artist_uid,
      artistSlug: item.artist_slug,
      artistName: item.artist_name,
    });
  }
  return albumPagePath({
    albumId: item.album_id,
    albumEntityUid: item.album_entity_uid,
    globalAlbumUid: item.global_album_uid,
    artistEntityUid: item.artist_entity_uid,
    albumSlug: item.album_slug,
    artistName: item.artist_name,
    albumName: item.album_name,
  });
}
