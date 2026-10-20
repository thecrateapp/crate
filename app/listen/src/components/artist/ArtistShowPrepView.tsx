import { useTranslation } from "react-i18next";
import { Calendar, CRATE_ICON_SIZE, Play } from "@crate/ui/icons";
import { Card, CardContent } from "@crate/ui/shadcn/card";
import { Button } from "@crate/ui/shadcn/button";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { SectionHeader } from "@crate/ui/domain/lists/SectionHeader";

export function ArtistShowPrepView({
  title,
  context,
  hasSetlist,
  onPlay,
  onDetails,
}: {
  title: string;
  context: string;
  hasSetlist: boolean;
  onPlay: () => void;
  onDetails: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardContent className="grid gap-4">
        <InfoBadge icon={Calendar}>{t("artist.sections.showPrep")}</InfoBadge>
        <SectionHeader as="h3" title={title} />
        <MonoLabel>{context}</MonoLabel>
        <p className="text-sm leading-6 text-text-muted">
          {t(
            hasSetlist
              ? "artist.sections.attendingWithSetlist"
              : "artist.sections.attendingWithoutSetlist",
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          {hasSetlist ? (
            <Button onClick={onPlay}>
              <Play size={CRATE_ICON_SIZE.xs} fill="currentColor" />
              {t("artist.sections.playProbableSetlist")}
            </Button>
          ) : null}
          <Button variant="outline" onClick={onDetails}>
            {t("artist.sections.viewShowDetails")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
