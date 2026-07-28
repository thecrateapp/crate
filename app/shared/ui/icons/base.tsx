import type { IconProps as SolarIconProps } from "@solar-icons/react-perf";
import {
  forwardRef,
  type ForwardRefExoticComponent,
  type RefAttributes,
  type SVGProps,
} from "react";

export interface CrateIconProps
  extends Omit<SVGProps<SVGSVGElement>, "ref" | "width" | "height"> {
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

export function createIcon(Icon: SolarIcon, displayName: string): CrateIcon {
  const WrappedIcon = forwardRef<SVGSVGElement, CrateIconProps>(
    (
      {
        size = CRATE_ICON_SIZE.md,
        width,
        height,
        absoluteStrokeWidth: _absoluteStrokeWidth,
        ...props
      },
      ref,
    ) => {
      const dimensions: Pick<SVGProps<SVGSVGElement>, "width" | "height"> = {};

      if (width !== undefined) dimensions.width = width;
      if (height !== undefined) dimensions.height = height;

      return <Icon ref={ref} size={size} {...dimensions} {...props} />;
    },
  );

  WrappedIcon.displayName = displayName;
  return WrappedIcon;
}
