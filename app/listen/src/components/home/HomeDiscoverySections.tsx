import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
} from "@crate/ui/icons";

import { GenrePill } from "@crate/ui/domain/genres/GenrePill";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { CrateImage } from "@/components/artwork/CrateImage";
import {
  canonicalArtworkTransportIdentity,
  preloadArtwork,
} from "@/lib/artwork-manager";
import { artworkFromUrl } from "@/lib/artwork-source";
import { artistBackgroundApiUrl, artistHeroApiUrl } from "@/lib/library-routes";
import { cn } from "@/lib/utils";

import type { HomeDiscoveryHeroSurfaces, HomeHeroArtist } from "./home-model";

export {
  ListeningHistorySection,
  RecentEntityRow,
  RecentlyPlayedSection,
  openRecentItemPath,
} from "./HomeRecentSections";
export {
  CoreTracksPlaylistCard,
  CustomMixCard,
  CustomMixesSection,
  EssentialsSection,
  FavoriteArtistsSection,
  RadioStationCard,
  RadioStationsSection,
  RecommendedTracksSection,
  SuggestedAlbumsSection,
  UpcomingAlbumsSection,
} from "./HomeDiscoveryRails";

const HERO_BACKGROUND_VERSION = "home-just-landed-v1";

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

function legacyHeroBackgroundSrc(
  hero: HomeHeroArtist,
  composition: "desktop" | "mobile",
): string | undefined {
  const backgroundUrl = artistBackgroundApiUrl(
    {
      artistId: hero.id,
      artistEntityUid: hero.entity_uid,
      artistSlug: hero.slug,
      artistName: hero.name,
    },
    {
      size:
        composition === "desktop"
          ? ARTIST_HERO_DESKTOP_SIZE.width
          : ARTIST_HERO_MOBILE_SIZE.width,
      version: HERO_BACKGROUND_VERSION,
    },
  );
  return backgroundUrl || undefined;
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
  mode: "canonical" | "legacy",
): void {
  const sources = useMemo(
    () =>
      heroes.flatMap((hero) => {
        const source =
          mode === "canonical"
            ? heroBackgroundSrc(hero, composition)
            : legacyHeroBackgroundSrc(hero, composition);
        return source ? [source] : [];
      }),
    [composition, heroes, mode],
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
      let backgroundIndex = 0;
      sources.forEach((src) => {
        if (immediate.has(src)) return;
        const timeout = window.setTimeout(() => {
          if (!cancelled) loadSource(src, "low");
        }, backgroundIndex++ * 220);
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

interface HomeTasteHeroProps {
  heroes: HomeHeroArtist[];
  heroSurfaces?: HomeDiscoveryHeroSurfaces | null;
  isFollowing: (id?: number) => boolean;
  onOpenArtist: (artist: HomeHeroArtist) => void;
  onPlay: (artist: HomeHeroArtist) => void;
  onToggleFollow: (artist: HomeHeroArtist) => void;
  desktopIntro?: ReactNode;
}

function useHeroSurface(
  heroes: HomeHeroArtist[],
  heroSurfaces?: HomeDiscoveryHeroSurfaces | null,
) {
  const isDesktop = useIsDesktop();
  const composition: "desktop" | "mobile" = isDesktop ? "desktop" : "mobile";
  const surface = heroSurfaces?.[composition];
  const mode = surface?.mode ?? "canonical";
  const surfaceArtists = surface?.artists ?? heroes;
  const surfaceHeroes = useMemo(
    () => dedupeHeroArtists(surfaceArtists),
    [surfaceArtists],
  );
  return { composition, isDesktop, mode, surfaceHeroes };
}

function useDesktopHeroSelection(count: number, isDesktop: boolean) {
  const [idx, setIdx] = useState(() =>
    isDesktop && count > 1 ? Math.floor(Math.random() * count) : 0,
  );
  const initialIndexSet = useRef(isDesktop && count > 1);

  useEffect(() => {
    setIdx((current) => Math.min(current, Math.max(count - 1, 0)));
  }, [count]);

  useEffect(() => {
    if (!isDesktop || count <= 1 || initialIndexSet.current) return;
    initialIndexSet.current = true;
    setIdx(Math.floor(Math.random() * count));
  }, [count, isDesktop]);

  return {
    activeIndex: Math.min(idx, Math.max(count - 1, 0)),
    setIndex: setIdx,
  };
}

function useMobileHeroSelection(
  surfaceHeroes: HomeHeroArtist[],
  count: number,
  isDesktop: boolean,
) {
  const [mobileHeroKey, setMobileHeroKey] = useState<string | null>(() => {
    if (isDesktop || !count) return null;
    return heroSelectionKey(
      surfaceHeroes[Math.floor(Math.random() * count)] || surfaceHeroes[0]!,
    );
  });

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

  return surfaceHeroes.find((hero) => heroSelectionKey(hero) === mobileHeroKey);
}

function MobileTasteHero({
  hero,
  mode,
  isFollowing,
  onOpenArtist,
  onPlay,
  onToggleFollow,
}: {
  hero: HomeHeroArtist;
  mode: "canonical" | "legacy";
  isFollowing: (id?: number) => boolean;
  onOpenArtist: (artist: HomeHeroArtist) => void;
  onPlay: (artist: HomeHeroArtist) => void;
  onToggleFollow: (artist: HomeHeroArtist) => void;
}) {
  const props = {
    hero,
    backgroundSrc:
      mode === "canonical"
        ? heroBackgroundSrc(hero, "mobile")
        : legacyHeroBackgroundSrc(hero, "mobile"),
    following: isFollowing(hero.id),
    onOpenArtist: () => onOpenArtist(hero),
    onPlay: () => onPlay(hero),
    onToggleFollow: () => onToggleFollow(hero),
  };

  return mode === "legacy" ? (
    <LegacyMobileFeaturedArtist {...props} />
  ) : (
    <MobileFeaturedArtist {...props} />
  );
}

function DesktopTasteHero({
  heroes,
  activeIndex,
  mode,
  isFollowing,
  onOpenArtist,
  onPlay,
  onToggleFollow,
  onPrevious,
  onNext,
  onSelect,
  desktopIntro,
}: {
  heroes: HomeHeroArtist[];
  activeIndex: number;
  mode: "canonical" | "legacy";
  isFollowing: (id?: number) => boolean;
  onOpenArtist: (artist: HomeHeroArtist) => void;
  onPlay: (artist: HomeHeroArtist) => void;
  onToggleFollow: (artist: HomeHeroArtist) => void;
  onPrevious: () => void;
  onNext: () => void;
  onSelect: (index: number) => void;
  desktopIntro?: ReactNode;
}) {
  const count = heroes.length;

  return (
    <div
      data-testid="desktop-editorial-hero"
      className="relative mx-auto aspect-[1480/600] min-h-[clamp(480px,38dvh,600px)] w-full max-w-[1480px] overflow-hidden bg-surface-canvas"
    >
      {heroes.map((hero, index) => {
        const source =
          mode === "canonical"
            ? heroBackgroundSrc(hero, "desktop")
            : legacyHeroBackgroundSrc(hero, "desktop");
        const isPrepared =
          index === activeIndex ||
          index === (activeIndex + 1) % count ||
          index === (activeIndex - 1 + count) % count;
        const heroProps = {
          key: hero.entity_uid || hero.id,
          hero,
          active: index === activeIndex,
          backgroundSrc: isPrepared ? source : undefined,
          following: isFollowing(hero.id),
          onOpenArtist: () => onOpenArtist(hero),
          onPlay: () => onPlay(hero),
          onToggleFollow: () => onToggleFollow(hero),
        };
        return mode === "canonical" ? (
          <DesktopFeaturedArtist {...heroProps} />
        ) : (
          <LegacyDesktopFeaturedArtist {...heroProps} />
        );
      })}

      {count > 1 ? (
        mode === "canonical" ? (
          <DesktopHeroNavigation
            heroes={heroes}
            activeIndex={activeIndex}
            onPrevious={onPrevious}
            onNext={onNext}
            onSelect={onSelect}
          />
        ) : (
          <LegacyDesktopHeroNavigation
            heroes={heroes}
            activeIndex={activeIndex}
            onPrevious={onPrevious}
            onNext={onNext}
            onSelect={onSelect}
          />
        )
      ) : null}

      {mode === "canonical" && desktopIntro ? (
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

export function HomeTasteHero({
  heroes,
  heroSurfaces,
  isFollowing,
  onOpenArtist,
  onPlay,
  onToggleFollow,
  desktopIntro,
}: HomeTasteHeroProps) {
  const { composition, isDesktop, mode, surfaceHeroes } = useHeroSurface(
    heroes,
    heroSurfaces,
  );
  const count = surfaceHeroes.length;
  const desktopSelection = useDesktopHeroSelection(count, isDesktop);
  const mobileHero = useMobileHeroSelection(surfaceHeroes, count, isDesktop);
  const activeIndex = isDesktop
    ? desktopSelection.activeIndex
    : Math.max(0, mobileHero ? surfaceHeroes.indexOf(mobileHero) : 0);
  useHeroBackgroundPreloader(surfaceHeroes, activeIndex, composition, mode);

  if (!count) return null;
  if (!isDesktop) {
    const hero = mobileHero || surfaceHeroes[0];
    return hero ? (
      <MobileTasteHero
        hero={hero}
        mode={mode}
        isFollowing={isFollowing}
        onOpenArtist={onOpenArtist}
        onPlay={onPlay}
        onToggleFollow={onToggleFollow}
      />
    ) : null;
  }

  return (
    <DesktopTasteHero
      heroes={surfaceHeroes}
      activeIndex={desktopSelection.activeIndex}
      mode={mode}
      isFollowing={isFollowing}
      onOpenArtist={onOpenArtist}
      onPlay={onPlay}
      onToggleFollow={onToggleFollow}
      onPrevious={() =>
        desktopSelection.setIndex((current) => (current - 1 + count) % count)
      }
      onNext={() =>
        desktopSelection.setIndex((current) => (current + 1) % count)
      }
      onSelect={desktopSelection.setIndex}
      desktopIntro={desktopIntro}
    />
  );
}

function LegacyMobileFeaturedArtist({
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
    <section
      data-testid="mobile-legacy-hero"
      className="home-legacy-hero relative h-[55dvh] min-h-[430px] max-h-[620px] w-full overflow-hidden rounded-none border-y border-border-quiet"
    >
      <LegacyHeroArtwork backgroundSrc={backgroundSrc} composition="mobile" />
      <button
        type="button"
        aria-label={t("home.hero.openArtist", { name: hero.name })}
        className="absolute inset-0 z-10 cursor-pointer"
        onClick={onOpenArtist}
      />
      <div className="pointer-events-none relative z-20 flex h-full flex-col justify-end px-6 py-8">
        <LegacyHeroCopy
          hero={hero}
          following={following}
          onPlay={onPlay}
          onToggleFollow={onToggleFollow}
        />
      </div>
    </section>
  );
}

function LegacyDesktopFeaturedArtist({
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
      data-testid="desktop-legacy-hero"
      aria-hidden={!active}
      className={cn(
        "home-legacy-hero absolute inset-0 overflow-hidden rounded-[12px] border border-border-quiet transition-opacity duration-500 ease-out",
        active ? "z-10 opacity-100" : "pointer-events-none z-0 opacity-0",
      )}
    >
      <LegacyHeroArtwork backgroundSrc={backgroundSrc} composition="desktop" />
      <button
        type="button"
        aria-label={t("home.hero.openArtist", { name: hero.name })}
        tabIndex={active ? 0 : -1}
        className="absolute inset-0 z-10 cursor-pointer"
        onClick={onOpenArtist}
      />
      <div className="pointer-events-none relative z-20 flex h-full flex-col justify-end px-10 py-10">
        <div className="max-w-[44%]">
          <LegacyHeroCopy
            hero={hero}
            following={following}
            onPlay={onPlay}
            onToggleFollow={onToggleFollow}
          />
        </div>
      </div>
    </section>
  );
}

function LegacyHeroArtwork({
  backgroundSrc,
  composition,
}: {
  backgroundSrc?: string;
  composition: "desktop" | "mobile";
}) {
  return (
    <>
      {backgroundSrc ? (
        <CrateImage
          data-testid={`${composition}-legacy-hero-artwork`}
          src={backgroundSrc}
          retryPolicy="eventual"
          alt=""
          aria-hidden="true"
          decoding="async"
          className="pointer-events-none absolute inset-0 h-full w-full object-cover object-top"
        />
      ) : null}
      <div className="home-hero-scrim-horizontal pointer-events-none absolute inset-0" />
      <div className="home-hero-scrim-vertical pointer-events-none absolute inset-0" />
    </>
  );
}

function LegacyHeroCopy({
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
  return (
    <div className="pointer-events-auto">
      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-accent-action">
        {t("home.library.justLanded.title")}
      </p>
      <h1 className="home-hero-title mt-2 truncate text-4xl font-black tracking-tight sm:text-5xl lg:text-6xl">
        {hero.name}
      </h1>
      <HeroGenres hero={hero} />
      <HeroActions
        hero={hero}
        following={following}
        onPlay={onPlay}
        onToggleFollow={onToggleFollow}
      />
    </div>
  );
}

function LegacyDesktopHeroNavigation({
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
    <div className="absolute inset-x-0 bottom-5 z-30 flex items-center justify-center gap-3">
      <button
        type="button"
        aria-label={t("home.hero.previousArtist")}
        className="home-hero-nav-control flex h-9 w-9 items-center justify-center rounded-full backdrop-blur-sm"
        onClick={onPrevious}
      >
        <ChevronLeft size={18} />
      </button>
      <div className="flex items-center gap-1.5">
        {heroes.map((hero, index) => (
          <button
            key={hero.entity_uid || hero.id}
            type="button"
            aria-label={t("home.hero.showArtist", { name: hero.name })}
            aria-current={index === activeIndex ? "true" : undefined}
            className="flex h-6 items-center bg-transparent px-1"
            onClick={() => onSelect(index)}
          >
            <span
              className={cn(
                "block h-1.5 rounded-full transition-all duration-300",
                index === activeIndex
                  ? "home-hero-pagination-active w-6"
                  : "home-hero-pagination-inactive w-1.5",
              )}
            />
          </button>
        ))}
      </div>
      <button
        type="button"
        aria-label={t("home.hero.nextArtist")}
        className="home-hero-nav-control flex h-9 w-9 items-center justify-center rounded-full backdrop-blur-sm"
        onClick={onNext}
      >
        <ChevronRight size={18} />
      </button>
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
  const genres = hero.genres?.flatMap((name) => (name ? [{ name }] : [])) ?? [];

  if (genres.length === 0) return null;

  return (
    <div className="mt-4 flex min-w-0 max-w-full flex-wrap gap-1.5 overflow-hidden">
      {genres.slice(0, 2).map((genre) => (
        <GenrePill
          key={genre.name}
          item={genre}
          className="home-hero-genre max-w-[42vw] backdrop-blur-sm sm:max-w-none"
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
          "home-discovery-play-button inline-flex h-11 items-center justify-center gap-2 rounded-md font-semibold text-accent-action-foreground transition-colors hover:bg-accent-action/90",
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
          "home-hero-follow inline-flex h-11 w-11 items-center justify-center rounded-md border-0 bg-transparent transition-colors hover:bg-transparent",
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
    <section className="relative h-[55dvh] min-h-[430px] max-h-[620px] w-full overflow-hidden bg-surface-canvas">
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
                  ? "home-hero-pagination-active h-6"
                  : "home-hero-pagination-inactive h-1.5",
              )}
            />
          </button>
        ))}
      </div>
      <div className="flex flex-col items-center gap-0.5">
        <button
          type="button"
          aria-label={t("home.hero.previousArtist")}
          className="home-hero-nav-control-plain flex h-8 w-8 items-center justify-center border-0 bg-transparent p-0 shadow-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-action"
          onClick={onPrevious}
        >
          <ChevronUp size={20} />
        </button>
        <button
          type="button"
          aria-label={t("home.hero.nextArtist")}
          className="home-hero-nav-control-plain flex h-8 w-8 items-center justify-center border-0 bg-transparent p-0 shadow-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-action"
          onClick={onNext}
        >
          <ChevronDown size={20} />
        </button>
      </div>
    </div>
  );
}
