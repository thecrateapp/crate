import { useTranslation } from "react-i18next";

import { StarRating } from "./InfoTabPrimitives";

export function InfoTabHeroRating({
  rating,
  mobile = false,
}: {
  rating: number | null;
  mobile?: boolean;
}) {
  const { t } = useTranslation();
  if (rating == null || rating <= 0) return null;

  return mobile ? (
    <div className="info-tab-rating-card relative mt-3 rounded-lg px-3 py-2 sm:hidden">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-eyebrow text-text-subtle">
          {t("player.info.rating")}
        </p>
        <StarRating rating={Math.round(rating)} />
      </div>
    </div>
  ) : (
    <div className="info-tab-rating-card hidden shrink-0 rounded-lg px-3 py-2 sm:block">
      <p className="text-xs font-semibold uppercase tracking-eyebrow text-text-subtle">
        {t("player.info.rating")}
      </p>
      <div className="mt-2">
        <StarRating rating={Math.round(rating)} />
      </div>
    </div>
  );
}
