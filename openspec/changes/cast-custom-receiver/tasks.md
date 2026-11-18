# Tasks

## 0. Especificación

- [ ] 0.1 Escribir las delta specs de comportamiento de esta línea (capacidades del proposal) antes de aplicar tareas nuevas

## 1. Cuts 0–10

- [x] 1.1 Cut 0 — Estabilizar el transporte Cast ([plan](../../../docs/plans/2026-09-14-crate-cast-receiver-implementation-plan.md#cut-0--stabilise-the-existing-cast-transport-baseline)) · 111acf3d5 fix: authorize artwork for Cast receivers
- [x] 1.2 Cut 1 — Protocolo Cast compartido versionado ([plan](../../../docs/plans/2026-09-14-crate-cast-receiver-implementation-plan.md#cut-1--versioned-shared-cast-protocol)) · 90a615033; app/shared/cast
- [x] 1.3 Cut 2 — Persistencia del lease de sesión ([plan](../../../docs/plans/2026-09-14-crate-cast-receiver-implementation-plan.md#cut-2--scoped-playback-session-lease-persistence)) · 9980cbb3b, dfe056487 (migraciones 094/095)
- [x] 1.4 Cut 3 — API de sesión y recursos del receiver ([plan](../../../docs/plans/2026-09-14-crate-cast-receiver-implementation-plan.md#cut-3--playback-session-api-and-receiver-resources)) · 62ccefe13; app/crate/api/cast.py
- [x] 1.5 Cut 4 — Runtime del receiver y adaptador CAF ([plan](../../../docs/plans/2026-09-14-crate-cast-receiver-implementation-plan.md#cut-4--receiver-runtime-and-caf-adapter)) · 62ccefe13; caf-adapter.ts, receiver-store.ts
- [x] 1.6 Cut 5 — Interfaz Now Playing para TV ([plan](../../../docs/plans/2026-09-14-crate-cast-receiver-implementation-plan.md#cut-5--tv-safe-now-playing-interface)) · NowPlaying.tsx, appearance.ts
- [x] 1.7 Cut 6 — Autoridad de cola en el sender web ([plan](../../../docs/plans/2026-09-14-crate-cast-receiver-implementation-plan.md#cut-6--web-sender-queue-authority-and-recovery)) · 75cf968fd feat: hand cast queue authority to receiver
- [x] 1.8 Cut 7 — Paridad Capacitor Android/iOS ([plan](../../../docs/plans/2026-09-14-crate-cast-receiver-implementation-plan.md#cut-7--capacitor-android-and-ios-parity)) · 74906bd3b feat: add native Cast queue parity
- [x] 1.9 Cut 8 — Imagen, Sentry y flags de rollout ([plan](../../../docs/plans/2026-09-14-crate-cast-receiver-implementation-plan.md#cut-8--receiver-hosting-sentry-and-rollout-controls)) · c6ade128e feat: ship observable cast receiver; 1f8cf5e7c
- [x] 1.10 Cut 9 — Pipeline de artefactos de espectro ([plan](../../../docs/plans/2026-09-14-crate-cast-receiver-implementation-plan.md#cut-9--governed-spectrum-artefact-pipeline)) · b5fc1d396 feat: generate cast spectrum artefacts
- [x] 1.11 Cut 10 — Espectro sincronizado en el receiver ([plan](../../../docs/plans/2026-09-14-crate-cast-receiver-implementation-plan.md#cut-10--time-synchronised-receiver-spectrum)) · f5d8308e0 feat: render synced cast spectrum

## 2. Release y activación

- [ ] 2.1 11.1 — Gate automático de release ([plan](../../../docs/plans/2026-09-14-crate-cast-receiver-implementation-plan.md#task-111-automated-release-gate)) · Casillas de la checklist de release sin marcar en cast-release-checklist.md
- [ ] 2.2 11.2 — Aceptación en Chromecast/Google TV ([plan](../../../docs/plans/2026-09-14-crate-cast-receiver-implementation-plan.md#task-112-hardware-acceptance)) · Matriz de hardware sin marcar en cast-release-checklist.md
- [ ] 2.3 11.3 — Registro de app IDs y activación ([plan](../../../docs/plans/2026-09-14-crate-cast-receiver-implementation-plan.md#task-113-registration-and-rollout)) · CAST_CUSTOM_RECEIVER_ENABLED y CRATE_CAST_CUSTOM_RECEIVER_ENABLED a false por defecto; docs/operators/cast-receiver.md mantiene el receiver desactivado hasta el registro
