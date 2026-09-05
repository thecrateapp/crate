import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { preloadArtwork } from "@/lib/artwork-manager";
import { artworkFromUrl } from "@/lib/artwork-source";

import type { HomeDiscoveryHeroSurfaces, HomeHeroArtist } from "./home-model";
import {
  dedupeHeroArtists,
  heroBackgroundSrc,
  heroSelectionKey,
  homeHeroArtworkLogicalKey,
  legacyHeroBackgroundSrc,
  requestBackgroundWork,
} from "./home-hero-utils";
import {
  DesktopFeaturedArtist,
  DesktopHeroNavigation,
  MobileFeaturedArtist,
} from "./HomeCanonicalHero";
import {
  LegacyDesktopFeaturedArtist,
  LegacyDesktopHeroNavigation,
  LegacyMobileFeaturedArtist,
} from "./HomeLegacyHero";

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
          logicalKey: homeHeroArtworkLogicalKey(src),
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
