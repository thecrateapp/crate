export const PRODUCT_TERMS = {
  crate: "Crate",
  crateDna: "Crate DNA",
  cratePulse: "Crate Pulse",
  crossfade: "Crossfade",
  discoveryRadio: "Discovery Radio",
  replay: "Replay",
  wrapped: "Wrapped",
} as const;

export const EXACT_PRODUCT_TERM_KEYS = [
  ["app.name", PRODUCT_TERMS.crate],
  ["home.sections.listeningDna.title", PRODUCT_TERMS.crateDna],
  ["stats.hero.badge", PRODUCT_TERMS.crateDna],
  ["stats.hero.globalTitle", PRODUCT_TERMS.cratePulse],
  ["stats.scope.cratePulse", PRODUCT_TERMS.cratePulse],
  ["settings.playback.crossfade", PRODUCT_TERMS.crossfade],
  ["radio.discovery", PRODUCT_TERMS.discoveryRadio],
  ["share.kind.wrapped", PRODUCT_TERMS.wrapped],
  ["stats.signal.playReplay", PRODUCT_TERMS.replay],
] as const;

export const CONTAINED_PRODUCT_TERM_KEYS = [
  ["home.sections.listeningDna.action", PRODUCT_TERMS.crateDna],
  ["stats.scope.yourDna", PRODUCT_TERMS.crateDna],
  ["userProfile.actions.viewListeningDna", PRODUCT_TERMS.crateDna],
  ["stats.wrapped.open", PRODUCT_TERMS.wrapped],
] as const;
