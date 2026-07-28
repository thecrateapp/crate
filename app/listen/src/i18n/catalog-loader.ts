import type { ListenLocale } from "@/i18n/locales";

export type ListenCatalog = Record<string, string>;

const catalogLoaders: Record<
  ListenLocale,
  () => Promise<{ default: ListenCatalog }>
> = {
  en: () => import("@/i18n/catalogs/en.json"),
  es: () => import("@/i18n/catalogs/es.json"),
  fr: () => import("@/i18n/catalogs/fr.json"),
  de: () => import("@/i18n/catalogs/de.json"),
  it: () => import("@/i18n/catalogs/it.json"),
  ca: () => import("@/i18n/catalogs/ca.json"),
  eu: () => import("@/i18n/catalogs/eu.json"),
};

const catalogPromises = new Map<ListenLocale, Promise<ListenCatalog>>();

export function loadListenCatalog(
  locale: ListenLocale,
): Promise<ListenCatalog> {
  const current = catalogPromises.get(locale);
  if (current) return current;

  const pending = catalogLoaders[locale]().then((module) => module.default);
  catalogPromises.set(locale, pending);
  return pending;
}
