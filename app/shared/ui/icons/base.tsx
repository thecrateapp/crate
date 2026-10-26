import type { IconProps as SolarIconProps } from "@solar-icons/react/lib/types";
import {
  forwardRef,
  type ForwardRefExoticComponent,
  type RefAttributes,
  type SVGProps,
} from "react";

export interface CrateIconProps extends Omit<
  SVGProps<SVGSVGElement>,
  "ref" | "width" | "height"
> {
  size?: number | string;
  width?: number | string;
  height?: number | string;
  absoluteStrokeWidth?: boolean;
}

export type CrateIcon = ForwardRefExoticComponent<
  CrateIconProps & RefAttributes<SVGSVGElement>
>;

export type LucideIcon = CrateIcon;

export const CRATE_ICON_SIZE = {
  nano: 10,
  micro: 12,
  xs: 14,
  sm: 16,
  md: 18,
  lg: 20,
  nav: 21,
  navMobile: 22,
  xl: 24,
} as const;

export type CrateIconSize = keyof typeof CRATE_ICON_SIZE;

type SolarIcon = ForwardRefExoticComponent<
  Omit<SolarIconProps, "ref"> & RefAttributes<SVGSVGElement>
>;

function cssLength(value: number | string) {
  return typeof value === "number" ? `${value}px` : value;
}

export function createIcon(Icon: SolarIcon, displayName: string): CrateIcon {
  const WrappedIcon = forwardRef<SVGSVGElement, CrateIconProps>(
    (
      {
        size = CRATE_ICON_SIZE.md,
        width,
        height,
        absoluteStrokeWidth: _absoluteStrokeWidth,
        style,
        ...props
      },
      ref,
    ) => (
      <Icon
        ref={ref}
        {...props}
        style={{
          fontSize: cssLength(size),
          ...(width !== undefined ? { width: cssLength(width) } : {}),
          ...(height !== undefined ? { height: cssLength(height) } : {}),
          ...style,
        }}
      />
    ),
  );

  WrappedIcon.displayName = displayName;
  return WrappedIcon;
}
