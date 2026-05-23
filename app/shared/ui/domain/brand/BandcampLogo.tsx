import type { SVGProps } from "react";

interface BandcampLogoProps extends SVGProps<SVGSVGElement> {
  size?: number | string;
}

export function BandcampLogo({ size, style, ...props }: BandcampLogoProps) {
  return (
    <svg
      role="img"
      aria-label="Bandcamp"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      style={style}
      {...props}
    >
      <path fill="currentColor" d="M0 18.75l7.437-13.5H24l-7.438 13.5H0z" />
    </svg>
  );
}
