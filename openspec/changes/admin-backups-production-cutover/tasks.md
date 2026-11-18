# Tasks

## 1. Fases BK

- [x] 1.1 BK0 — Protección provisional (retención, -Z6, volumen, sidecar restic) ([plan](../../../docs/plans/2026-11-10-admin-backups-plan.md#bk0--interim-protection-in-progress-separate-agent)) · 940df67a7; ops/postgres-backups-volume y ops/postgres-backups-offsite mergeadas
- [x] 1.2 BK1 — Motor: dump y retención local ([plan](../../../docs/plans/2026-11-10-admin-backups-plan.md#bk1--engine-dump-and-local-retention)) · feat/admin-backups mergeada vía #430
- [x] 1.3 BK2 — Destinos y secretos (local/b2/s3/sftp/gdrive/dropbox) ([plan](../../../docs/plans/2026-11-10-admin-backups-plan.md#bk2--destinations-and-secrets)) · feat/admin-backups-bk2 mergeada vía #430
- [x] 1.4 BK3 — Políticas, off-site, verificación y drills ([plan](../../../docs/plans/2026-11-10-admin-backups-plan.md#bk3--policies-off-site-verification-and-drills)) · feat/admin-backups-bk3 vía #430; fix 03101c12e (#436)
- [x] 1.5 BK4 — API de Admin de backups ([plan](../../../docs/plans/2026-11-10-admin-backups-plan.md#bk4--admin-api)) · feat/admin-backups-bk4 vía #430; 59c440262
- [x] 1.6 BK5 — UI de Admin de backups ([plan](../../../docs/plans/2026-11-10-admin-backups-plan.md#bk5--admin-ui)) · feat/admin-backups-bk5 vía #430; c0848f67c
- [x] 1.7 BK6.1 — Alertas, métricas y panel Grafana ([plan](../../../docs/plans/2026-11-10-admin-backups-plan.md#bk6--alerts-metrics-and-the-migration-of-production)) · #434: 2481e4754, d504f5c64
- [ ] 1.8 BK6.2 — Migrar producción: ciclo en paralelo y retirar sidecars (BG2) ([plan](../../../docs/plans/2026-11-10-admin-backups-plan.md#bk6--alerts-metrics-and-the-migration-of-production)) · Importador hecho (326002c41), pero crate-backup-offsite y crate-postgres-backup siguen en docker-compose.yaml
- [x] 1.9 BK6.3 — Documentación de operador y runbook de restauración ([plan](../../../docs/plans/2026-11-10-admin-backups-plan.md#bk6--alerts-metrics-and-the-migration-of-production)) · d75fc88b9; docs/technical/admin-backups.md
