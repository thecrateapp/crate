# Tasks

## 0. Especificación

- [ ] 0.1 Escribir las delta specs de comportamiento de esta línea (capacidades del proposal) antes de aplicar tareas nuevas

## 1. Base y backend VDJ (C/P)

- [x] 1.1 C00 — Congelar baseline operativo ([plan](../../../docs/technical/smart-mix-implementation-plan.md#c00-freeze-the-operational-baseline-and-preserve-changes)) · Baseline 2026-10-08 registrado en cabecera y §8
- [x] 1.2 P01 — Fijar contratos, migraciones y manifiesto ([plan](../../../docs/technical/smart-mix-implementation-plan.md#p01-pin-integrated-contracts-migration-lineage-and-evidence-manifest)) · 572f06b9
- [x] 1.3 P02 — PATs de mínimo privilegio y UI de conexión ([plan](../../../docs/technical/smart-mix-implementation-plan.md#p02-complete-least-privilege-pats-and-the-connection-ui)) · 770ced11, 0ecf37f9, 55296480, 7d5fa812, 20c9289a, 13a86be4, 53b1e858
- [x] 1.4 P03 — Routing y kill switches coherentes ([plan](../../../docs/technical/smart-mix-implementation-plan.md#p03-make-routing-and-effective-kill-switches-consistent)) · 20c9289a, f3204e51
- [x] 1.5 P04 — Carpetas VDJ de un nivel y búsqueda DJ ([plan](../../../docs/technical/smart-mix-implementation-plan.md#p04-one-level-vdj-folders-and-dj-search-with-filter-syntax)) · 1f774d15 (migración 113)
- [x] 1.6 P05 — Entrega de media, ranges y revocación ([plan](../../../docs/technical/smart-mix-implementation-plan.md#p05-prove-media-delivery-ranges-and-revocation)) · 162c1c9f; ticket de 12 h 0ecfe5c2
- [ ] 1.7 P06 — Backend de cues, radio, now-playing y telemetría (backlog) `backlog` ([plan](../../../docs/technical/smart-mix-implementation-plan.md#p06-complete-the-backend-for-cues-radio-now-playing-and-idempotent-telemetry))

## 2. Core Smart Mix (SM)

- [x] 2.1 SM01 — Procedencia y persistencia de medidas ([plan](../../../docs/technical/smart-mix-implementation-plan.md#sm01-implement-provenance-and-persistence-under-the-p01-contracts)) · 580f4ad8 (migración 111)
- [x] 2.2 SM02 — Loudness/true peak multicanal y DSP acotado ([plan](../../../docs/technical/smart-mix-implementation-plan.md#sm02-measure-multichannel-loudnesstrue-peak-and-bound-the-dsp)) · 63b43a6b, 00bd7749
- [x] 2.3 SM03 — Límites de transición, fase y cues ([plan](../../../docs/technical/smart-mix-implementation-plan.md#sm03-fix-transition-limits-phase-and-effective-cues)) · f47ee91e, 7841daed
- [x] 2.4 SM04 — Publicar perfiles correctos y promociones ([plan](../../../docs/technical/smart-mix-implementation-plan.md#sm04-publish-correct-profiles-for-the-source-and-allow-promotions)) · 787a619a
- [x] 2.5 SM05 — Backfill por generación y control operativo ([plan](../../../docs/technical/smart-mix-implementation-plan.md#sm05-backfill-by-generation-operational-control-and-source-invalidation)) · 0a45449a, 51faf79e, 5f2ebf58
- [ ] 2.6 SM06 — Planes versionados, caché y readplane (falta la parte federada) `F1` ([plan](../../../docs/technical/smart-mix-implementation-plan.md#sm06-deliver-versioned-plans-and-candidates-with-a-coherent-cache-and-readplane)) — **en curso** · Parte de R1: d440c95b, f7387031, 5b1e0f15, 417fe2ab; la federación está en backlog
- [ ] 2.7 SM07 — Benchmarks reproducibles y gates del core `F1` ([plan](../../../docs/technical/smart-mix-implementation-plan.md#sm07-reproducible-benchmarks-audio-matrix-and-core-gates)) — **en curso** · Benchmarks del lab (46f0d5a22, 4ae544b33); falta la validación musical del grid y los artefactos de los gates

## 3. Android nativo (A)

- [x] 3.1 A01 — Planificación fuera del arranque y offline real ([plan](../../../docs/technical/smart-mix-implementation-plan.md#a01-take-planning-out-of-startup-and-make-offline-real)) · 53d28608, beebff6a
- [x] 3.2 A02 — Preparar en el cue y ejecutar entre pistas ([plan](../../../docs/technical/smart-mix-implementation-plan.md#a02-prepare-at-the-cue-and-execute-only-within-both-tracks)) · c0cf2bb2
- [x] 3.3 A03 — Envolvente PCM, ganancia y clipping ([plan](../../../docs/technical/smart-mix-implementation-plan.md#a03-full-envelope-in-pcm-gain-and-clipping)) · e08714d4
- [x] 3.4 A04 — Ciclo de vida, sesión, cola y contabilidad ([plan](../../../docs/technical/smart-mix-implementation-plan.md#a04-close-lifecycle-session-queue-and-audible-accounting)) · 04cdc2e9, 1dd0986b
- [x] 3.5 A05 — Settings, negociación y opt-out persistente ([plan](../../../docs/technical/smart-mix-implementation-plan.md#a05-settings-negotiation-and-persistent-opt-out)) · 000d5b90, 787af8db
- [ ] 3.6 A06 — Lab reproducible y gate físico adaptativo `F1` ([plan](../../../docs/technical/smart-mix-implementation-plan.md#a06-reproducible-lab-and-physical-adaptive-gate)) — **en curso** · Captura del bus interno y matriz de ciclo de vida (6ea24b713, 9b6e143b2, 96d1afb6b); falta la captura externa, que bloquea el cierre de R1
- [ ] 3.7 A07 — Tempo/fase con gate físico `F1` ([plan](../../../docs/technical/smart-mix-implementation-plan.md#a07-tempophase-with-a-physical-gate-and-bounded-contingency)) — **en curso** · Bus PCM 0de50a8b…8b9411cf, 8/8 enganches; faltan la captura externa, llamadas, RSS/batería y repetir A02–A06 sobre el bus
- [ ] 3.8 A08 — Bass handoff y preferencias finales `F1` ([plan](../../../docs/technical/smart-mix-implementation-plan.md#a08-bass-handoff-and-acceptance-of-the-final-preferences)) — **en curso** · c4238c76, 7fe2fc0b, 55b97fb7; falta el gate de captura externa
- [x] 3.9 A09 — Continuación nativa: token y planes en background ([plan](../../../docs/technical/smart-mix-implementation-plan.md#a09-native-continuation-token-and-plans-in-the-background)) · Migración 115; prueba en Xiaomi 13 del 2026-10-18
- [x] 3.10 A10 — Continuación nativa: refill de radio/infinito ([plan](../../../docs/technical/smart-mix-implementation-plan.md#a10-native-continuation-radioinfinite-refill-and-reconciliation)) · A10a–c, migración 116

## 4. VirtualDJ (VH/V)

- [x] 4.1 VH01 — Gate de host VirtualDJ ([plan](../../../docs/technical/smart-mix-implementation-plan.md#vh01-host-gate-check-in-virtualdj-what-the-sdk-does-not-document)) · 7eeb0b5e, verificado el 2026-10-31
- [x] 4.2 V01 — Core como frontera de producción fiable ([plan](../../../docs/technical/smart-mix-implementation-plan.md#v01-core-as-a-reliable-production-boundary)) · 6899f736, f9f22430, 56f104de, 226739f3, 844ac11f, ede6ea79, 6d9cf984
- [ ] 4.3 V02 — Conexión de usuario en un binario `F1` ([plan](../../../docs/technical/smart-mix-implementation-plan.md#v02-user-connection-in-a-single-binary)) — **en curso** · a5487882, 38894f16; falta que desactivar B/Automix en el servidor mantenga A
- [ ] 4.4 V03 — Sustituir el spike y completar la navegación `F1` ([plan](../../../docs/technical/smart-mix-implementation-plan.md#v03-replace-the-spike-and-complete-browsing)) — **en curso** · Gate de host del 2026-11-01; falta el unload del plugin en el host
- [x] 4.5 V04 — Media probada en decks reales ([plan](../../../docs/technical/smart-mix-implementation-plan.md#v04-media-proven-on-real-decks)) · Verificado el 2026-11-01
- [x] 4.6 V05 — Asistente con el ranking de Crate ([plan](../../../docs/technical/smart-mix-implementation-plan.md#v05-assistant-with-crates-ranking)) · Verificado el 2026-11-01/02
- [ ] 4.7 V06 — Crate Automix y play events `F1` ([plan](../../../docs/technical/smart-mix-implementation-plan.md#v06-crate-automix-and-play-events)) — **en curso** · Gate corto del 2026-11-02 (feat/vdj-automix-feeder, feat/vdj-play-events mergeadas); falta la sesión de ≥1 h con flag apagado y corte de red
- [ ] 4.8 V07 — Radio y presencia (backlog) `backlog` ([plan](../../../docs/technical/smart-mix-implementation-plan.md#v07-radio-and-presence-backlog))
- [ ] 4.9 V08 — Caché cifrada y prefetch (backlog) `backlog` ([plan](../../../docs/technical/smart-mix-implementation-plan.md#v08-encrypted-audio-cache-and-prefetch-backlog))
- [ ] 4.10 V09 — Filtros DJ, medición y CI continua `F1` ([plan](../../../docs/technical/smart-mix-implementation-plan.md#v09-dj-filters-measurement-and-continuous-verification)) — **en curso** · Workflow vdj-plugin.yml; faltan la sintaxis de filtros y la medición
- [ ] 4.11 V10 — Paquetes y cierre de gates de host `F1` ([plan](../../../docs/technical/smart-mix-implementation-plan.md#v10-packages-and-closing-the-host-gates)) — **en curso** · PRs #331/#333, tag crate-vdj-v1.0.0; faltan el gate R2 en prod, los hosts Intel/Windows, notarización, Authenticode y SBOM

## 5. iOS R5 (I)

- [ ] 5.1 I01 — Plugin Swift CrateNativePlayback `F3` ([plan](../../../docs/technical/smart-mix-implementation-plan.md#5b-ios-i01-to-i06-r5))
- [ ] 5.2 I02 — Alimentación de decks en iOS (caché/tickets) `F3` ([plan](../../../docs/technical/smart-mix-implementation-plan.md#5b-ios-i01-to-i06-r5))
- [ ] 5.3 I03 — Mezcla iOS (envolvente, trigger, estados) `F3` ([plan](../../../docs/technical/smart-mix-implementation-plan.md#5b-ios-i01-to-i06-r5))
- [ ] 5.4 I04 — Ciclo de vida iOS (interrupciones, rutas) `F3` ([plan](../../../docs/technical/smart-mix-implementation-plan.md#5b-ios-i01-to-i06-r5))
- [ ] 5.5 I05 — Tests XCTest y harness iOS `F3` ([plan](../../../docs/technical/smart-mix-implementation-plan.md#5b-ios-i01-to-i06-r5))
- [ ] 5.6 I06 — Gate en dispositivo iPhone `F3` ([plan](../../../docs/technical/smart-mix-implementation-plan.md#5b-ios-i01-to-i06-r5))

## 6. Aceptación conjunta (X)

- [ ] 6.1 X01 — Contratos integrados, privacidad y QoE `F4` ([plan](../../../docs/technical/smart-mix-implementation-plan.md#x01-integrated-contracts-privacy-and-qoe))
- [ ] 6.2 X02 — CI conductual y topologías reales `F4` ([plan](../../../docs/technical/smart-mix-implementation-plan.md#x02-behavioural-ci-and-real-topologies))
- [ ] 6.3 X03 — Matriz física/host y ensayo de rollback `F4` ([plan](../../../docs/technical/smart-mix-implementation-plan.md#x03-physicalhost-matrix-and-rollback-rehearsal))
- [ ] 6.4 X04 — Rollout progresivo y cierre único `F4` ([plan](../../../docs/technical/smart-mix-implementation-plan.md#x04-progressive-rollout-and-single-closure))
