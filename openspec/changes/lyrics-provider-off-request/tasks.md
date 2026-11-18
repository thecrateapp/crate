# Tasks

## 0. Especificación

- [ ] 0.1 Escribir las delta specs de comportamiento de esta línea (capacidades del proposal) antes de aplicar tareas nuevas

## 1. F0 — LRCLIB fuera del request

- [ ] 1.1 `GET /api/lyrics` sin red: hit fresco, stale-while-revalidate, negativo fresco y miss con cabeceras `X-Crate-Lyrics-State`/`-Key` ([plan](../../../docs/plans/2026-11-18-lyrics-karaoke-and-credits-plan.md#f0--lrclib-fuera-del-request))
- [ ] 1.2 Tarea `fetch_lyrics` en el pool `fast` con dedup y handler en `worker_handlers/enrichment.py` ([plan](../../../docs/plans/2026-11-18-lyrics-karaoke-and-credits-plan.md#f0--lrclib-fuera-del-request))
- [ ] 1.3 Transporte LRCLIB con `requests.Session`, timeout y `wait_for_provider_slot("lrclib")` ([plan](../../../docs/plans/2026-11-18-lyrics-karaoke-and-credits-plan.md#f0--lrclib-fuera-del-request))
- [ ] 1.4 Listen: estado «buscando», invalidación por `lyrics:<token>` y un único refetch ([plan](../../../docs/plans/2026-11-18-lyrics-karaoke-and-credits-plan.md#f0--lrclib-fuera-del-request))
- [ ] 1.5 Tests RED→GREEN de `test_lyrics_request_offload.py` y Listen; actualizar `test_api_lyrics_stores_not_found_miss` ([plan](../../../docs/plans/2026-11-18-lyrics-karaoke-and-credits-plan.md#f0--lrclib-fuera-del-request))
- [ ] 1.6 Documentar el cambio de comportamiento en `docs/technical/05-enrichment-acquisition-and-integrations.md` ([plan](../../../docs/plans/2026-11-18-lyrics-karaoke-and-credits-plan.md#f0--lrclib-fuera-del-request))
