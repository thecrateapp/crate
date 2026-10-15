import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { Vec3 } from "../field/math";
import { createField, type Field } from "../field/renderer";
import {
  cloudPositions,
  clusterCenters,
  loadLibraryCloud,
  sampleImage,
} from "../field/sources";
import { finePointer, isMobile, reducedMotion } from "../motion/env";
import { splitWords } from "../motion/split-words";

gsap.registerPlugin(ScrollTrigger);

export function initHero(): () => void {
  const canvas = document.querySelector<HTMLCanvasElement>("#field");
  const copy = document.querySelector<HTMLElement>(".hero-copy");
  const staticMark = document.querySelector<HTMLElement>(".mark-static");
  const solidMark = document.querySelector<HTMLElement>(".mark-solid");
  const cue = document.querySelector<HTMLElement>(".scroll-cue");
  if (!canvas || !copy) return () => {};

  copy.querySelectorAll<HTMLElement>("[data-split]").forEach((element) => {
    if (!element.querySelector(".w")) splitWords(element);
  });

  const ctx = gsap.context(() => {});
  const listeners = new AbortController();
  const entry = setTimeout(
    () => requestAnimationFrame(() => copy.classList.add("is-in")),
    650,
  );
  let disposed = false;
  if (cue) {
    const toggleCue = () => cue.classList.toggle("is-hidden", scrollY > 24);
    toggleCue();
    addEventListener("scroll", toggleCue, {
      passive: true,
      signal: listeners.signal,
    });
  }
  let frame = 0;
  let field: Field | null = null;

  const showStatic = () => {
    if (!staticMark) return;
    gsap.killTweensOf(staticMark);
    gsap.set(staticMark, { opacity: 1 });
  };

  start().catch(showStatic);

  async function start() {
    if (reducedMotion()) return;
    const mobile = isMobile();
    const count = mobile ? 12000 : 40000;
    const { positions: cloud } = cloudPositions(count, clusterCenters(16, 1.1));
    const markWidth = mobile ? 1.15 : 1.25;
    const mark = await sampleImage("/icons/logo.svg", count, {
      width: markWidth,
      depth: 0.03,
    });
    if (disposed || !canvas || !copy) return;
    const lift = mobile ? 0.55 : 0.62;
    for (let i = 0; i < count; i++) mark[i * 3 + 1] += lift;
    const center: Vec3 = [0, lift, 0];
    let settledAt = -1;
    let scrolled = false;

    field = createField(canvas, {
      positions: cloud,
      targets: mark,
      pointScale: 6.4,
      mobileScale: 5,
      isMobile: mobile,
      onContextLost() {
        canvas.style.visibility = "hidden";
        showStatic();
      },
      onContextRestored() {
        canvas.style.visibility = "";
        if (staticMark) gsap.to(staticMark, { opacity: 0, duration: 0.6 });
      },
    });
    if (!field) {
      showStatic();
      return;
    }
    const active = field;

    loadLibraryCloud(count).then((real) => {
      if (real && !disposed) active.setPositions(real);
    });

    const state = {
      morph: 0,
      dive: 0,
      yaw: 0,
      pitch: 0,
      targetYaw: 0,
      targetPitch: 0,
      visible: true,
    };

    function render(time: number) {
      const t = time / 1000;
      state.yaw += (state.targetYaw - state.yaw) * 0.05;
      state.pitch += (state.targetPitch - state.pitch) * 0.05;
      const orbit =
        state.yaw + state.dive * 1.1 + Math.sin(t * 0.25) * 0.04 * state.morph;
      const distance = 3.3 - state.dive * 2.5;
      const eye: Vec3 = [
        Math.sin(orbit) * distance,
        0.15 + state.pitch,
        Math.cos(orbit) * distance,
      ];
      if (state.morph < 0.98) settledAt = -1;
      else if (settledAt < 0) settledAt = t;
      const settled = settledAt < 0 ? -1 : t - settledAt;
      const solid =
        settled < 0 ? 0 : Math.min(1, Math.max(0, (settled - 0.25) / 0.9));
      active.render({
        eye,
        time: t,
        morph: state.morph,
        warp: true,
        center,
        settled,
        fade: solid,
      });
      if (solidMark) placeSolid(eye, orbit, distance, solid);
    }

    function placeSolid(
      eye: Vec3,
      orbit: number,
      distance: number,
      solid: number,
    ) {
      if (!solidMark) return;
      const left = active.project([center[0] - markWidth / 2, center[1], 0]);
      const right = active.project([center[0] + markWidth / 2, center[1], 0]);
      const middle = active.project(center);
      const width = right.x - left.x;
      const height = (width * 1120) / 1052;
      const lens = innerHeight / 2 / Math.tan(0.85 / 2);
      const tilt = Math.atan2(eye[1] - center[1], distance);
      solidMark.style.opacity = `${solid}`;
      solidMark.style.visibility = solid > 0 ? "visible" : "hidden";
      solidMark.style.width = `${width}px`;
      solidMark.style.transform = `translate(${middle.x - width / 2}px, ${
        middle.y - height / 2
      }px) perspective(${lens}px) rotateY(${-orbit}rad) rotateX(${-tilt}rad)`;
    }

    if (finePointer()) {
      addEventListener(
        "pointermove",
        (event) => {
          const x = (event.clientX / innerWidth) * 2 - 1;
          const y = 1 - (event.clientY / innerHeight) * 2;
          state.targetYaw = x * 0.18;
          state.targetPitch = -y * 0.1;
        },
        { signal: listeners.signal },
      );
    }

    const loop = (time: number) => {
      if (state.visible && !document.hidden) render(time);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    const mix = {
      intro: 0,
      hero: 0,
      statement: 0,
      screen: 0,
    };
    const apply = () => {
      const opacity = mix.intro * (1 - 0.84 * mix.statement) * (1 - mix.screen);
      gsap.set(canvas, { opacity });
      state.visible = opacity > 0.001;
    };

    ctx.add(() => {
      gsap.to(mix, {
        intro: 1,
        duration: 0.8,
        ease: "power2.out",
        onUpdate: apply,
      });
      gsap.to(state, {
        morph: 1,
        duration: 2.6,
        delay: 0.15,
        ease: "power3.inOut",
      });

      ScrollTrigger.create({
        trigger: ".hero-pin",
        start: "top top",
        end: "bottom bottom",
        scrub: true,
        onUpdate: ({ progress }) => {
          if (progress > 0 && !scrolled) {
            scrolled = true;
            gsap.killTweensOf(state, "morph");
          }
          if (scrolled) state.morph = 1 - Math.min(1, progress / 0.45);
          mix.hero = progress;
          state.dive = Math.max(0, (progress - 0.3) / 0.7);
          const fade = Math.min(1, progress / 0.35);
          gsap.set(copy, { opacity: 1 - fade, y: fade * 40 });
          apply();
        },
      });

      for (const [trigger, key, end] of [
        [".statement", "statement", "top 45%"],
        [".screencast", "screen", "top 30%"],
      ] as const) {
        if (!document.querySelector(trigger)) continue;
        ScrollTrigger.create({
          trigger,
          start: "top bottom",
          end,
          scrub: true,
          onUpdate: ({ progress }) => {
            mix[key] = progress;
            apply();
          },
        });
      }
    });
  }

  return () => {
    disposed = true;
    clearTimeout(entry);
    cancelAnimationFrame(frame);
    listeners.abort();
    ctx.revert();
    field?.dispose();
    field = null;
  };
}
