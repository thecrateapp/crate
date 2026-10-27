import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { GalleryShot } from "../film/gallery";
import { BG, Desktop, Phone, Shot } from "./Film";
import type { Frame } from "./frames";

export type GalleryProps = {
  gallery: GalleryShot[];
  takes: Record<string, Frame[]>;
};

// One frame per gallery entry: the film's duo framing, facing the camera so the UI reads.
export function Gallery({ gallery, takes }: GalleryProps) {
  const entry = gallery[Math.min(useCurrentFrame(), gallery.length - 1)];
  const { width, height } = useVideoConfig();
  const vertical = height > width;
  const appTakes = Object.fromEntries(
    Object.entries(takes)
      .filter(([key]) => key.startsWith(`${entry.app}/`))
      .map(([key, frames]) => [key.slice(entry.app.length + 1), frames]),
  );
  const source = (device: "desktop" | "mobile") => ({
    take: entry[device].take,
    device,
    from: entry[device].at,
  });

  return (
    <AbsoluteFill
      style={{ background: BG, alignItems: "center", justifyContent: "center" }}
    >
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(60% 50% at 30% 20%, rgba(6,182,212,0.16), transparent 70%), radial-gradient(50% 40% at 80% 90%, rgba(103,232,249,0.08), transparent 70%)",
        }}
      />
      {vertical ? (
        <div style={{ position: "relative", width: 980, height: 1200 }}>
          <Desktop
            width={980}
            style={{ position: "absolute", left: 0, top: 0 }}
          >
            <Shot
              film={entry.app}
              source={source("desktop")}
              takes={appTakes}
              local={0}
            />
          </Desktop>
          <Phone
            height={820}
            style={{ position: "absolute", right: 30, bottom: 0 }}
          >
            <Shot
              film={entry.app}
              source={source("mobile")}
              takes={appTakes}
              local={0}
            />
          </Phone>
        </div>
      ) : (
        <div style={{ position: "relative", width: 1680, height: 900 }}>
          <Desktop
            width={1380}
            style={{ position: "absolute", left: 0, top: 30 }}
          >
            <Shot
              film={entry.app}
              source={source("desktop")}
              takes={appTakes}
              local={0}
            />
          </Desktop>
          <Phone
            height={820}
            style={{ position: "absolute", right: 0, top: 40 }}
          >
            <Shot
              film={entry.app}
              source={source("mobile")}
              takes={appTakes}
              local={0}
            />
          </Phone>
        </div>
      )}
    </AbsoluteFill>
  );
}
