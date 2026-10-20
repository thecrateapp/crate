import { useTranslation } from "react-i18next";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { StarRating } from "./InfoTabPrimitives";
export function InfoTabHeroRating({ rating }: { rating: number | null }) {
  const { t } = useTranslation();
  if (rating == null || !Number.isFinite(rating) || rating <= 0) return null;
  return (
    <div className="grid content-start gap-2">
      <MonoLabel>{t("player.info.rating")}</MonoLabel>
      <span className="sr-only">{rating} / 5</span>
      <StarRating rating={Math.round(rating)} />
    </div>
  );
}
