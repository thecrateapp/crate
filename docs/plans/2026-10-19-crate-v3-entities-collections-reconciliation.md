# 1AW — Entities, tracks and collections

2026-10-19 · authorized after approved/published1AV a2b374f3. Use the approved mockup and later
Diego rulings. Stop1AW before commit/push. Three persistent services stay active5186/6006/5174.

## Contract and scope

Six existing shared families: EntityCard, EntityRow, EntityPrimaryAction, TrackList, MediaGrid,
MediaRail. Complete their English catalogue/contracts and one shared small review scene. The
Listen track-row presentation stays local; extract its real frame for reuse in both controller
and review rather than copying markup. Preserve ring/aura/progress leaf and all row handlers.

- Entity titles remain approved Poppins/native-body14/500; metadata keeps its mono role.
  HairlineRow retains its separately approved12/18 desktop/mobile. No universal row size.
- Distinguish current/active from selected. Native links/buttons/static roles, menu siblings,
  external link safety, disabled gates and lazy menu preparation remain.
- Optional full-text mode belongs to entity components. Move ArtistCard's existing finite
  compact/tile/editorial profile widths into EntityCard; preserve actual width formula and
  fill-grid behavior, not a new appearance or size scale.
- MediaGrid/Rail/TrackList retain loaded/reserved geometry, responsive density, rail fits,
  stable keys, injected virtualizer and80threshold. Native ARIA/ref forwarding is additive.
- AlbumTrackList adopts TrackList while preserving disc order, selection, IDs and callbacks;
  PlaylistTrackList retains entry identities/virtualization. LibraryAlbumsTab retains skeleton
  geometry, sorting and cached data; initial read error must not become an empty collection.
- Track quality/explicit tags adopt existing InfoBadge24/12 without per-caller size repairs;
  preserve legacy Admin table tags and metadata breakpoints. Row hover never fills backgrounds.

## Execution

1. Complete six pending entries before source edits. Write failing contracts for selected/current,
   native frame attributes, URL actions, bounds/fits and collection ARIA/zero. Watch RED then GREEN.
2. Update shared contracts and real Listen consumers; no dummy Admin imports. Existing Entity/
   collection shared components have no direct Admin consumers in the inspected source. Check
   affected shared-token/legacy Admin-table consumers and bundle instead of claiming dual adoption.
3. Test actual local row/frame and Album/Playlist/Library behavior. Keep controllers/data/engines
   out of shared. No wholesale page restyle, auth change or future instruments.
4. Same scene in Storybook and review-1aw-collections.html: six families plus actual local track
   presentation, Hairline reference,0/1/many, long/unbroken text, menu/link/play/selection states,
   small/coarse layouts and unchanged ring progression. No new historical-mockup section.
5. Scoped unit/policy/consumer/browser tests only, maxWorkers1/workers1. Types/lint/build/budgets
   for affected apps and tools. One fresh source review, regressions for confirmed important issues.

No production mutations, full suites/CI, baseline regeneration, SmartMix, release or commit1AW.
Live Listen still contains unmigrated pages; native/AT/live/canonical phase QA remains pending.

Diego amendment: standalone track/album/artist covers have a48px minimum in every density;
white18px glyph (24px visual slot) and active ring40px remain smaller than the artwork. Person avatars and
internal collage tiles retain their separate roles. Legacy raw frames must adopt this minimum.
