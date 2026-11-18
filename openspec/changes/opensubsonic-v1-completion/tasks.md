# Tasks

## 0. Especificación

- [ ] 0.1 Escribir las delta specs de comportamiento de esta línea (capacidades del proposal) antes de aplicar tareas nuevas

## 1. Cuts A–R

- [x] 1.1 Cut A — Fijar el contrato oficial ([plan](../../../docs/plans/2026-09-15-opensubsonic-v1-implementation-plan.md#cut-a--pin-the-official-contract)) · aca6d7bb6
- [x] 1.2 Cut B — Extraer el kernel del protocolo ([plan](../../../docs/plans/2026-09-15-opensubsonic-v1-implementation-plan.md#cut-b--extract-the-protocol-kernel)) · 913a3c941
- [x] 1.3 Cut C — Autenticación segura ([plan](../../../docs/plans/2026-09-15-opensubsonic-v1-implementation-plan.md#cut-c--secure-opensubsonic-authentication)) · dd3e953e6, migración 097
- [x] 1.4 Cut D — Serializadores estrictos compartidos ([plan](../../../docs/plans/2026-09-15-opensubsonic-v1-implementation-plan.md#cut-d--introduce-strict-shared-serializers)) · e6b28c005
- [x] 1.5 Cut E — Artwork completo y resoluble ([plan](../../../docs/plans/2026-09-15-opensubsonic-v1-implementation-plan.md#cut-e--make-artwork-complete-and-resolvable)) · 585b38a5c, 61c2886e7
- [x] 1.6 Cut F — Navegación, géneros y listas de álbumes ([plan](../../../docs/plans/2026-09-15-opensubsonic-v1-implementation-plan.md#cut-f--complete-browsing-genres-and-album-lists)) · 1d0346981
- [x] 1.7 Cut G — Búsqueda y metadatos ([plan](../../../docs/plans/2026-09-15-opensubsonic-v1-implementation-plan.md#cut-g--complete-search-and-metadata)) · 202afec06
- [x] 1.8 Cut H — Playlists reales ([plan](../../../docs/plans/2026-09-15-opensubsonic-v1-implementation-plan.md#cut-h--wire-real-playlists)) · f533964c0
- [x] 1.9 Cut I — Stars y ratings por usuario ([plan](../../../docs/plans/2026-09-15-opensubsonic-v1-implementation-plan.md#cut-i--unify-per-user-stars-and-ratings)) · 098_user_media_preferences.py, subsonic/services/preferences.py, 9c77bc2f7
- [x] 1.10 Cut J — Scrobbling y now-playing ([plan](../../../docs/plans/2026-09-15-opensubsonic-v1-implementation-plan.md#cut-j--harden-scrobbling-and-now-playing)) · 5011f7ca5
- [x] 1.11 Cut K — Persistir colas de reproducción ([plan](../../../docs/plans/2026-09-15-opensubsonic-v1-implementation-plan.md#cut-k--persist-play-queues)) · 8fcf0ce4e
- [x] 1.12 Cut L — Letras y descubrimiento ([plan](../../../docs/plans/2026-09-15-opensubsonic-v1-implementation-plan.md#cut-l--add-lyrics-and-discovery)) · c04b99044
- [x] 1.13 Cut M — Stream, descarga y transcodificación ([plan](../../../docs/plans/2026-09-15-opensubsonic-v1-implementation-plan.md#cut-m--harden-stream-download-and-transcoding)) · f8a3c358b
- [x] 1.14 Cut N — Operaciones de sistema y escaneo ([plan](../../../docs/plans/2026-09-15-opensubsonic-v1-implementation-plan.md#cut-n--add-truthful-system-and-scan-operations)) · 9f75e2a00
- [x] 1.15 Cut O — Paridad con Form POST ([plan](../../../docs/plans/2026-09-15-opensubsonic-v1-implementation-plan.md#cut-o--complete-form-post-parity)) · c53a6c2d4
- [x] 1.16 Cut P — Gestión de credenciales en Listen ([plan](../../../docs/plans/2026-09-15-opensubsonic-v1-implementation-plan.md#cut-p--add-listen-credential-management)) · 6397a7d6f
- [x] 1.17 Cut Q — Observabilidad, presupuestos y docs ([plan](../../../docs/plans/2026-09-15-opensubsonic-v1-implementation-plan.md#cut-q--add-observability-budgets-and-operator-docs)) · 9925bc195
- [x] 1.18 Cut R — Gates de conformidad e interoperabilidad ([plan](../../../docs/plans/2026-09-15-opensubsonic-v1-implementation-plan.md#cut-r--add-conformance-and-interoperability-gates)) · 32eeb7b6d, 01a215023

## 2. Cut S — rollout y retirada

- [x] 2.1 Cut S (1-8) — Activar v1 en producción con rollback ([plan](../../../docs/plans/2026-09-15-opensubsonic-v1-implementation-plan.md#cut-s--post-merge-production-rollout-and-legacy-retirement)) · v1 por defecto en docker-compose.yaml desde e6596a666 (2026-09-17)
- [ ] 2.2 Cut S (9-10) — Retirar routing legacy y columna de token en claro ([plan](../../../docs/plans/2026-09-15-opensubsonic-v1-implementation-plan.md#cut-s--post-merge-production-rollout-and-legacy-retirement))
