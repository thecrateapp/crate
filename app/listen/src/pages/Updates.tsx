import { useTranslation } from "react-i18next";

import { ExternalLink, Loader2, Rss } from "@crate/ui/icons";

import { useApi } from "@/hooks/use-api";
import type { ArtistUpdateItem } from "@/components/artist/ArtistUpdatesModal";

export function Updates() {
  const { t, i18n } = useTranslation();
  const { data, loading, error, refetch } =
    useApi<ArtistUpdateItem[]>("/api/me/updates");
  const items = data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-primary">
          <Rss size={18} />
          <span className="text-xs font-semibold uppercase tracking-[0.18em]">
            {t("updates.kicker")}
          </span>
        </div>
        <h1 className="mt-2 text-3xl font-bold text-foreground">
          {t("updates.title")}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          {t("updates.intro")}
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24" role="status">
          <Loader2 size={24} className="animate-spin text-primary" />
          <span className="sr-only">{t("updates.loading")}</span>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-white/8 bg-white/[0.025] py-16 text-center">
          <p className="text-sm text-white/60">{t("updates.error")}</p>
          <button
            type="button"
            onClick={refetch}
            className="mt-3 rounded-lg border border-white/10 px-4 py-2 text-sm text-foreground transition-colors hover:bg-white/5"
          >
            {t("common.retry")}
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-white/8 bg-white/[0.025] py-16 text-center">
          <Rss size={24} className="mx-auto mb-3 text-white/25" />
          <p className="text-sm text-white/60">{t("updates.empty")}</p>
        </div>
      ) : (
        <div className="max-w-3xl space-y-3">
          {items.map((item, index) => (
            <article
              key={`${item.canonical_url ?? item.title ?? "update"}-${index}`}
              className="rounded-xl border border-white/8 bg-white/[0.025] p-4 transition-colors hover:border-white/15 hover:bg-white/[0.04] sm:p-5"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-white/42">
                <span className="font-medium text-primary/85">
                  {item.source_detail || item.source || t("updates.source")}
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
              <h2 className="mt-2 text-lg font-semibold leading-7 text-foreground">
                {item.title || t("updates.untitled")}
              </h2>
              {item.artist ? (
                <p className="mt-1 text-xs font-medium text-white/45">
                  {item.artist}
                </p>
              ) : null}
              {item.editorial_summary || item.excerpt ? (
                <p className="mt-3 text-sm leading-6 text-white/65">
                  {item.editorial_summary || item.excerpt}
                </p>
              ) : null}
              {item.canonical_url ? (
                <a
                  href={item.canonical_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-primary transition-colors hover:text-primary/80"
                >
                  {t("updates.openSource")}
                  <ExternalLink size={12} />
                </a>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function formatPublishedDate(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}
