import { useTranslation } from "react-i18next";

import { ExternalLink, Loader2, Rss } from "@crate/ui/icons";
import {
  AppModal,
  ModalBody,
  ModalCloseButton,
  ModalHeader,
} from "@crate/ui/primitives/AppModal";

import { useApi } from "@/hooks/use-api";

export interface ArtistUpdateItem {
  type: string;
  source?: string | null;
  source_detail?: string | null;
  canonical_url?: string | null;
  published_at?: string | null;
  artist?: string | null;
  title?: string | null;
  excerpt?: string | null;
  editorial_summary?: string | null;
  image_url?: string | null;
}

interface ArtistUpdatesModalProps {
  open: boolean;
  artistName: string;
  artistId?: number;
  onClose: () => void;
}

export function ArtistUpdatesModal({
  open,
  artistName,
  artistId,
  onClose,
}: ArtistUpdatesModalProps) {
  const { t, i18n } = useTranslation();
  const url = open && artistId ? `/api/artists/${artistId}/updates` : null;
  const { data, loading, error, refetch } = useApi<ArtistUpdateItem[]>(url);
  const items = data ?? [];

  return (
    <AppModal
      open={open}
      onClose={onClose}
      maxWidthClassName="sm:max-w-2xl"
      overlayClassName="bg-black/58"
      panelClassName="listen-glass-panel flex min-h-0 w-full max-w-2xl flex-col overflow-hidden border-0 sm:max-h-[92vh]"
      mobileSafeArea
    >
      <ModalHeader className="border-b border-white/5 bg-transparent backdrop-blur-none">
        <div className="flex items-start justify-between gap-4 px-5 py-5 sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            <Rss size={20} className="mt-1 shrink-0 text-primary" />
            <div className="min-w-0">
              <h2 className="truncate text-xl font-bold text-foreground sm:text-2xl">
                {t("artist.updates.title")}
              </h2>
              <p className="mt-1 truncate text-sm text-muted-foreground">
                {artistName}
              </p>
            </div>
          </div>
          <ModalCloseButton
            onClick={onClose}
            className="shrink-0 text-white/62 transition-[color,filter,transform] hover:-translate-y-px hover:text-primary hover:drop-shadow-[0_0_10px_rgba(34,211,238,0.34)]"
          />
        </div>
      </ModalHeader>

      <ModalBody className="flex-1 space-y-3 overflow-y-auto px-5 py-5 sm:px-6">
        {loading ? (
          <div className="flex items-center justify-center py-16" role="status">
            <Loader2 size={24} className="animate-spin text-primary" />
            <span className="sr-only">{t("artist.updates.loading")}</span>
          </div>
        ) : error ? (
          <div className="space-y-3 py-12 text-center">
            <p className="text-sm text-white/60">{t("artist.updates.error")}</p>
            <button
              type="button"
              onClick={refetch}
              className="rounded-lg border border-white/10 px-4 py-2 text-sm text-foreground transition-colors hover:bg-white/5"
            >
              {t("common.retry")}
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="py-12 text-center">
            <Rss size={24} className="mx-auto mb-3 text-white/25" />
            <p className="text-sm text-white/60">{t("artist.updates.empty")}</p>
          </div>
        ) : (
          items.map((item, index) => (
            <article
              key={`${item.canonical_url ?? item.title ?? "update"}-${index}`}
              className="rounded-xl border border-white/8 bg-white/[0.025] p-4 transition-colors hover:border-white/15 hover:bg-white/[0.04]"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-white/42">
                <span className="font-medium text-primary/85">
                  {item.source_detail ||
                    item.source ||
                    t("artist.updates.source")}
                </span>
                {item.published_at ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <time dateTime={item.published_at}>
                      {formatPublishedDate(item.published_at, i18n.language)}
                    </time>
                  </>
                ) : null}
              </div>
              <h3 className="mt-2 text-base font-semibold leading-6 text-foreground">
                {item.title || t("artist.updates.untitled")}
              </h3>
              {item.editorial_summary || item.excerpt ? (
                <p className="mt-2 text-sm leading-6 text-white/65">
                  {item.editorial_summary || item.excerpt}
                </p>
              ) : null}
              {item.canonical_url ? (
                <a
                  href={item.canonical_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary transition-colors hover:text-primary/80"
                >
                  {t("artist.updates.openSource")}
                  <ExternalLink size={12} />
                </a>
              ) : null}
            </article>
          ))
        )}
      </ModalBody>
    </AppModal>
  );
}

function formatPublishedDate(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}
