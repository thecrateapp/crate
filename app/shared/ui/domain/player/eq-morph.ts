import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

import { isMotionBlocked } from "../../lib/motion-gate";

export interface SpringConfig {
  stiffness: number;
  damping: number;
}

export interface SpringState {
  value: number;
  velocity: number;
  target: number;
}

export const EQ_SPRING: SpringConfig = { stiffness: 120, damping: 14 };
export const SPRING_EPSILON = 0.01;
export const MAX_FRAME_DT = 0.05;
export const FIRST_FRAME_DT = 1 / 60;

export function frameDt(now: number, previous: number | null): number {
  if (previous === null) return FIRST_FRAME_DT;
  return Math.min(Math.max((now - previous) / 1000, 0), MAX_FRAME_DT);
}

export function stepSpring(
  spring: SpringState,
  dt: number,
  config: SpringConfig = EQ_SPRING,
): void {
  const step = Math.min(dt, MAX_FRAME_DT);
  const force =
    (spring.target - spring.value) * config.stiffness -
    spring.velocity * config.damping;
  spring.velocity += force * step;
  spring.value += spring.velocity * step;
}

export function springsSettled(
  springs: readonly SpringState[],
  epsilon = SPRING_EPSILON,
): boolean {
  return springs.every(
    (spring) =>
      Math.abs(spring.target - spring.value) < epsilon &&
      Math.abs(spring.velocity) < epsilon,
  );
}

export function createSpringSet(values: readonly number[]): SpringState[] {
  return values.map((value) => ({ value, velocity: 0, target: value }));
}

function snapSpring(spring: SpringState): void {
  spring.value = spring.target;
  spring.velocity = 0;
}

export interface EqMorph {
  values: () => readonly number[];
  setBand: (index: number, gain: number) => void;
}

export function useEqMorph({
  targets,
  animate,
  draggedBandRef,
  render,
  isBlocked = isMotionBlocked,
  config = EQ_SPRING,
}: {
  targets: readonly number[];
  animate: boolean;
  draggedBandRef: RefObject<number | null>;
  render: (values: readonly number[]) => void;
  isBlocked?: () => boolean;
  config?: SpringConfig;
}): EqMorph {
  const springsRef = useRef<SpringState[] | null>(null);
  const frameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const renderRef = useRef(render);
  const blockedRef = useRef(isBlocked);
  const configRef = useRef(config);
  const targetsRef = useRef(targets);

  useLayoutEffect(() => {
    renderRef.current = render;
    blockedRef.current = isBlocked;
    configRef.current = config;
    targetsRef.current = targets;
  });

  const morphRef = useRef<EqMorph | null>(null);
  morphRef.current ??= {
    values: () => (springsRef.current ?? []).map((spring) => spring.value),
    setBand: (index, gain) => {
      const spring = springsRef.current?.[index];
      if (!spring) return;
      spring.target = gain;
      snapSpring(spring);
      renderRef.current(morphRef.current!.values());
    },
  };

  const targetsKey = targets.join(",");

  useLayoutEffect(() => {
    const targets = targetsRef.current;
    const springs = springsRef.current;
    const stop = () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      lastTimeRef.current = null;
    };

    if (!springs || springs.length !== targets.length) {
      springsRef.current = createSpringSet(targets);
      stop();
      renderRef.current(morphRef.current!.values());
      return;
    }

    springs.forEach((spring, index) => {
      spring.target = targets[index] ?? 0;
      if (index === draggedBandRef.current) snapSpring(spring);
    });

    if (!animate || blockedRef.current() || springsSettled(springs)) {
      springs.forEach(snapSpring);
      stop();
      renderRef.current(morphRef.current!.values());
      return;
    }

    if (frameRef.current !== null) return;

    const tick = (now: number) => {
      const active = springsRef.current!;
      if (blockedRef.current()) {
        active.forEach(snapSpring);
        stop();
        renderRef.current(morphRef.current!.values());
        return;
      }
      const dt = frameDt(now, lastTimeRef.current);
      lastTimeRef.current = now;
      active.forEach((spring, index) => {
        if (index === draggedBandRef.current) snapSpring(spring);
        else stepSpring(spring, dt, configRef.current);
      });
      if (springsSettled(active)) {
        active.forEach(snapSpring);
        stop();
      } else {
        frameRef.current = requestAnimationFrame(tick);
      }
      renderRef.current(morphRef.current!.values());
    };
    frameRef.current = requestAnimationFrame(tick);
  }, [targetsKey, animate, draggedBandRef]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    },
    [],
  );

  return morphRef.current;
}
