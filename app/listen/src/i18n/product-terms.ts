export const PRODUCT_TERMS = {
  crateDna: "Crate DNA",
  cratePulse: "Crate Pulse",
  crossfade: "Crossfade",
} as const;

export const EXACT_PRODUCT_TERM_KEYS = [
  ["home.sections.listeningDna.title", PRODUCT_TERMS.crateDna],
  ["stats.hero.badge", PRODUCT_TERMS.crateDna],
  ["stats.hero.globalTitle", PRODUCT_TERMS.cratePulse],
  ["stats.scope.cratePulse", PRODUCT_TERMS.cratePulse],
  ["settings.playback.crossfade", PRODUCT_TERMS.crossfade],
] as const;

export const CONTAINED_PRODUCT_TERM_KEYS = [
  ["home.sections.listeningDna.action", PRODUCT_TERMS.crateDna],
  ["stats.scope.yourDna", PRODUCT_TERMS.crateDna],
  ["userProfile.actions.viewListeningDna", PRODUCT_TERMS.crateDna],
] as const;
