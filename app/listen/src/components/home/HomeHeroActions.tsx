import { useTranslation } from "react-i18next";
import { CRATE_ICON_SIZE, Play } from "@crate/ui/icons";
import { Button } from "@crate/ui/shadcn/button";
import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import { FollowHeartButton } from "@crate/ui/primitives/FollowHeartButton";

export function HeroActions({
  hero,
  following,
  onPlay,
  onToggleFollow,
}: {
  hero: { name: string };
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
      <Button
        aria-label={playLabel}
        size="lg"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onPlay();
        }}
      >
        <Play size={CRATE_ICON_SIZE.md} fill="currentColor" />
        <span>{t("home.hero.playCta")}</span>
      </Button>
      <ActionButton
        asChild
        label={followLabel}
        tooltip={t(following ? "common.unfollow" : "common.follow")}
      >
        <FollowHeartButton
          following={following}
          heartTestId="hero-follow-heart"
          particlesTestId="hero-follow-particles"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onToggleFollow();
          }}
        />
      </ActionButton>
    </div>
  );
}
