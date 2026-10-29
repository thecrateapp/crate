# Seeded candidate ownership and availability

The seeded candidate query keeps the exact album-owner join `a.artist = ca.name`.
`context_artists` includes every library artist matching each selected lowercase key,
including its case variants. The foreign key from `library_albums.artist` to
`library_artists.name` requires an exact owner row, so that row participates whenever
its lowercase artist key is selected. The final artist join preserves that exact
owner identity.

A production check on 2026-10-29 ran inside an explicit read-only transaction with a
10-second statement timeout. The owner foreign key was validated; there were no
orphan album owners and no albums recoverable only through a lowercase match.
The [aggregate result](album-owner-check.json) contains no library records or inventory
counts. The relevant relational check was:

```sql
WITH missing_exact AS (
    SELECT a.artist
    FROM library_albums a
    WHERE NOT EXISTS (
        SELECT 1 FROM library_artists ar WHERE ar.name = a.artist
    )
)
SELECT count(*)
FROM missing_exact a
WHERE EXISTS (
    SELECT 1 FROM library_artists ar
    WHERE lower(ar.name) = lower(a.artist)
);
```

Four PostgreSQL controls exercise `Citizen`, `CITIZEN` and `cItIzEn` as valid rows.
They compare legacy and optimized results for seed, similar-artist and genre
sources, including metadata, the per-source caps, global limit, one-SELECT retrieval
and the exact owner's entity UID. The case variants do not duplicate candidate
tracks. These checks are in
[`test_radio_retrieval_artist_case.py`](../../../../app/tests/test_radio_retrieval_artist_case.py).
No production join change is needed for this finding. A missing referenced owner is
an integrity repair case, represented separately by the existing orphan-album repair
checks.

## Eligible local tracks

Seeded retrieval applies the shared playback filters before the per-artist caps.
Tracks in quarantined albums and tracks or albums under hidden path components are
excluded. An artist, album or track album label equal to `.crate-trash` is excluded
case-insensitively. These checks use catalog metadata; they do not write to or scan
the music filesystem during a recommendation request.

Filtering before the caps lets an eligible lower-ranked track occupy the slot of an
ineligible higher-ranked one. It also keeps expansion and normal retrieval aligned
with the same playback policy.
