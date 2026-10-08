export const PRODUCT_TERMS = {
  crate: "Crate",
  crateDna: "Crate DNA",
  cratePulse: "Crate Pulse",
  crossfade: "Crossfade",
  discoveryRadio: "Discovery Radio",
  replay: "Replay",
  crateDigging: "Crate Digging",
} as const;

export const EXACT_PRODUCT_TERM_KEYS = [
  ["app.name", PRODUCT_TERMS.crate],
  ["home.sections.listeningDna.title", PRODUCT_TERMS.crateDna],
  ["stats.hero.badge", PRODUCT_TERMS.crateDna],
  ["stats.hero.globalTitle", PRODUCT_TERMS.cratePulse],
  ["stats.scope.cratePulse", PRODUCT_TERMS.cratePulse],
  ["settings.playback.crossfade", PRODUCT_TERMS.crossfade],
  ["radio.discovery", PRODUCT_TERMS.discoveryRadio],
  ["share.kind.digging", PRODUCT_TERMS.crateDigging],
  ["stats.digging.band.title", PRODUCT_TERMS.crateDigging],
  ["stats.scope.yourDna", PRODUCT_TERMS.crateDna],
  ["stats.signal.playReplay", PRODUCT_TERMS.replay],
] as const;

export const CONTAINED_PRODUCT_TERM_KEYS = [
  ["home.sections.listeningDna.action", PRODUCT_TERMS.crateDna],
  ["userProfile.actions.viewListeningDna", PRODUCT_TERMS.crateDna],
  ["stats.digging.label", PRODUCT_TERMS.crateDigging],
] as const;
