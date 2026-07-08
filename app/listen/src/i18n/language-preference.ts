import type { ListenLocale } from "@/i18n/locales";
import { toSupportedListenLocale } from "@/i18n/locales";

const LISTEN_LOCALE_STORAGE_KEY = "crate-listen-locale";

export function getLocalListenLocalePreference(): ListenLocale | null {
  try {
    return toSupportedListenLocale(
      localStorage.getItem(LISTEN_LOCALE_STORAGE_KEY),
    );
  } catch {
    return null;
  }
}

export function setLocalListenLocalePreference(locale: ListenLocale): void {
  try {
    localStorage.setItem(LISTEN_LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage can fail in private or restricted webviews.
  }
}

export function clearLocalListenLocalePreference(): void {
  try {
    localStorage.removeItem(LISTEN_LOCALE_STORAGE_KEY);
  } catch {
    // Storage can fail in private or restricted webviews.
  }
}
