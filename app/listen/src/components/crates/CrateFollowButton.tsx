import { useTranslation } from "react-i18next";
import { CRATE_ICON_SIZE } from "@crate/ui/icons";
import { FollowHeartButton } from "@crate/ui/primitives/FollowHeartButton";

interface CrateFollowButtonProps {
  followed: boolean;
  pending?: boolean;
  onToggle: () => void | Promise<void>;
  className?: string;
}

export function CrateFollowButton({
  followed,
  pending = false,
  onToggle,
  className,
}: CrateFollowButtonProps) {
  const { t } = useTranslation();
  const label = followed ? t("common.following") : t("common.follow");
  return (
    <FollowHeartButton
      className={className}
      following={followed}
      iconSize={CRATE_ICON_SIZE.md}
      aria-label={label}
      title={label}
      disabled={pending}
      onClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        void onToggle();
      }}
    />
  );
}
