---
title: Product KPIs
summary: How Crate computes instance-wide product figures, what each one means and how they are kept private.
section: operations
audience: [operator]
status: canonical
order: 124
verified: 2026-11-02
sources:
  [
    app/crate/db/jobs/product_kpis.py,
    app/crate/db/schema_sections/product_kpis_v142.py,
    app/crate/worker_handlers/product_kpis.py,
    app/crate/api/admin_metrics.py,
    app/ui/src/pages/Product.tsx,
    app/ui/src/components/product/product-kpi-model.ts,
  ]
---

# Product KPIs

Admin's **Product** page (Insights section, requires `ops.health.view`) shows how
the instance is used: accounts and reach, listening, library growth, acquisition,
engagement, federation and delivered audio. Each figure is compared with the
previous window of the same length (7, 30, 90 or 365 days).

## How they are computed

A worker task, `compute_product_kpis`, runs every hour on the maintenance queue
and recomputes yesterday and today into the `product_kpi_daily` table: one row
per KPI, day and dimension set. The first run on an empty table backfills up to
a year from the listening history, in month-sized transactions. The page and its
API (`GET /api/admin/kpis`) only read that table; no request aggregates source
tables.

The job reads the listening projections (`user_daily_listening`,
`instance_track_daily`, `user_listening_sessions`) and small tables. Platform,
source and origin breakdowns read the day's play events through a BRIN index on
`created_at`. Finished tasks are deleted after seven days and stream metrics are
kept for eight, so acquisition and stream figures are captured hourly before their
sources prune them; their history starts when the job is first deployed.

## Days

- **Listening** figures use each listener's local day, like Crate Pulse and the
  instance listening rollups.
- **Signups, engagement, acquisition, federation and streams** use UTC days.
- **Snapshots** (active accounts, active devices, library size, catalogue played,
  active peers) describe the instance when they were computed and are only written
  for the current day. Past days keep the value captured on that day.

## What each figure means

| Group       | Figures                                                                                                                                                                                                                                                                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Users       | Accounts (not deleted at the end of the day); active accounts (signed in, seen in a session or listened within `CRATE_USER_INACTIVE_AFTER_DAYS`, 30 by default); daily, weekly and monthly listeners (played at least one track in the day, 7 or 30 days); signups; invites accepted; week 1 and week 4 retention; active devices by platform |
| Listening   | Plays, completed plays, skips, hours listened, sessions and their average length, distinct tracks and artists played per day, plays by platform, source and origin (local, remote or imported)                                                                                                                                                |
| Library     | Artists, albums, tracks and size; new artists; share of tracks played in the last 30 days                                                                                                                                                                                                                                                     |
| Acquisition | Finished and failed downloads and imports per source (Soulseek, Tidal, Bandcamp, uploads, import queue, federation) and average minutes to complete                                                                                                                                                                                           |
| Engagement  | Likes, follows, saved albums, playlists and crates created, scrobbles sent and failed                                                                                                                                                                                                                                                         |
| Federation  | Active approved peers, remote streams by direction, GiB imported from peers, streams, GiB delivered, transcodes completed and failed                                                                                                                                                                                                          |

Retention is rolling: week 1 retention on a day is the share of accounts created
13 to 19 days earlier that listened in their second week; week 4 uses accounts
created 34 to 40 days earlier and their fifth week.

## Privacy and missing data

Only aggregates are stored; no user, track or artist appears as a dimension.
Free-text dimension values collapse to `other` and empty ones to `unknown`. A
breakdown segment backed by fewer than three listeners is hidden by the API, the
same floor Crate Pulse uses. A source with no data writes no row, so the page
shows "No data in this window" rather than a zero; a window without a previous
one shows no comparison.
