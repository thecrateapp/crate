import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  CRATE_LOADER_DEFAULT_PHRASES,
  CrateLoader as SharedCrateLoader,
  type CrateLoaderVariant,
} from "@crate/ui/domain/brand/CrateLoader";

export const CRATE_LOADING_PHRASES = CRATE_LOADER_DEFAULT_PHRASES;

const CRATE_LOADING_PHRASE_KEYS = [
  "loader.phrases.feedingYourSoul",
  "loader.phrases.loadingCrate",
  "loader.phrases.warmingTheAmps",
  "loader.phrases.spinningUpTheCollection",
  "loader.phrases.cueingTheNextObsession",
  "loader.phrases.tuningTheRoom",
  "loader.phrases.checkingTheLinerNotes",
  "loader.phrases.dustingOffTheCrates",
  "loader.phrases.findingSomethingLoud",
  "loader.phrases.syncingTheSignal",
] as const;

interface CrateLoaderProps {
  className?: string;
  label?: string;
  variant?: CrateLoaderVariant;
}

export function CrateLoader({
  className,
  label,
  variant = "page",
}: CrateLoaderProps) {
  const { t } = useTranslation();
  const phrases = useMemo(
    () => CRATE_LOADING_PHRASE_KEYS.map((key) => t(key)),
    [t],
  );

  return (
    <SharedCrateLoader
      className={className}
      label={label ?? t("loader.defaultLabel")}
      variant={variant}
      phrases={phrases}
    />
  );
}
