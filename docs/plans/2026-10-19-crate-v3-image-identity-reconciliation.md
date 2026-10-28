# 1AV — Image and identity reconciliation

2026-10-19 · authorized after 1AU and the Listen-first plan. Base: published `5593d68d`.
Scope: MediaCover, Avatar, EntityAvatar, PlaylistArtwork, CrateLogo and BandcampLogo; first real
Listen consumers AlbumCardArtwork, UserAvatar and PlaylistArtwork. Stop before commit/push.

## Reference and contracts

The approved mockup and Diego's later confirmations remain the visual authority. Preserve
existing cover square/rounded/circle roles, avatar sizes24/32/40/56/80, rings and badge positions,
technical media initials, playlist collage/gradient/mark and both brand assets. Do not invent a
new image size system or change the native font exception. Geometry belongs to the image/frame;
outer available dimensions remain composition. No row/card rewrite belongs to1AV.

## Steps and evidence

1. Watch regressions fail for MediaCover's image adapter/native attributes and independent URL
   fallback identity; then add the adapter and adopt its frame in AlbumCardArtwork while retaining
   ArtworkSurface/CrateImage, logical source, srcSet/sizes, loading and credential retry behavior.
2. Cover Avatar/EntityAvatar source replacement, decorative/named semantics, ring/badge and native
   ref/attributes. UserAvatar retains its hook and authenticated image transport, not a raw img.
3. Cover playlist collage/placeholder accessible identity and native image failure. Preserve
   canonical URLs and custom managed rendering in Listen; Admin fallback-glyph opt-out stays.
4. Complete six English catalogue entries/stories/docs and a single ImagesReview scene in
   Storybook and review-1av-images.html. Include all six families, image/absent/error/replacement,
   sizes/shapes, playlist1/2/3/4 and duplicate sources, labels8px and equivalent controls.
5. Run only affected unit/policy/consumer tests, serial Vitest maxWorkers1 and Playwright workers1;
   computed geometry/fonts/a11y/overflow plus actual image consumers. Check shared/Listen/Admin/
   Desktop/Storybook types, scoped lint, catalogue, changed runtime builds/budgets. One fresh
   source review at the checkpoint, repair confirmed important defects with regressions.

## Boundaries

No backend/auth/engine/storage redesign, production-data mutations, new dependency, full suite/CI,
canonical baseline regeneration, Smart Mix, release or broad Admin adoption. Live Listen uses
API_URL=https://api.lespedants.org on5174; Diego logs in, no agent credential use or data edits.
Both existing previews5186/6006 stay active. The live app is an adoption view, not proof that all
its still-legacy surfaces have migrated. Native/live/AT qualification remains separately tracked.

## Local result and final evidence

1AU published5593d68d;1AV remains uncommitted for Diego. Six English entries completed, preserving
functional categories. Catalogue39documented/93entries/120sources,54pending. Review:
http://127.0.0.1:5186/review-1av-images.html and Storybook Reviews/1AV/Images. Same real scene; no
main-mockup addition. Brand-mark sample uses the existing actual asset. Prior1AU entries now
show their approved visual-review status, with broader adoption/native qualification still open.

-173focused unit/policy cases GREEN:92shared(9files),56Listen(10files),25Admin(3files), maxWorkers1.
-9browser cases GREEN, workers1: preview/Storybook ×390/1200 ×fine/coarse plus six live English
contracts. Shapes/sizes,14px technical fallback, collage2px geometry, marker, native fallback,
source change, decorative/named assets, unique SVG IDs,8px captions and40/44px controls covered.
-5typechecks GREEN: shared, Listen, Admin, Desktop, Storybook; scoped lint GREEN.
-Admin/Listen/preview/Storybook builds GREEN. Existing large-chunk warnings remain; actual eager
budget checks pass: Admin527169/532480Bgzip,9assets,margin5311B; Listen200105/307200B,23assets.
-No runtime dependency, fullsuite/CI, canonicalPNG/manifest change, backend mutation or native/AT
certification. Existing33canonical images remain1M; Linux comparison and native QA are pending.

Fresh source review: no confirmed production P1/P2. Missing playlist mark in the shared scene
was independently reproduced by the scoped browser assertion(count0), then corrected to use
showCrateMark and the actual logo asset; final9cases pass. Classified as required coverage fix
(it blocked the checkpoint browser checks), rather than optional visual polish. No re-review.

Decisions and limits: preserve existing sizes/assets (a future conflict needs measured review,
not a silent new variant); managed renderer owns loading/recovery while native fallback owns
URL failure (wrong separation could drop ready artwork, covered by real consumer and existing
credential-recovery tests); square rounded-lg is6px from actual tokens, correcting an8px test/
doc assumption. No runtime geometry was changed for that premise. Broader row/card adoption
and native managed-retry redesign stay in their owning phases; same-URL native automatic
retries are not added without a demonstrated need (a repaired unchanged URL can require remount
or a revisioned URL). No deferred actionable minor remains from this review.

### Live Listen and login steering

5174 is a separate persistent service using Node22 and API_URL=https://api.lespedants.org; the
original5186/6006services stay active. The initial proxy could not retain production cookies on
HTTP loopback. Dev-only loopback adaptation removes Domain and for HTTP adjusts Secure/
SameSite=None to host-only SameSite=Lax, preserving HttpOnly/path/expiry. HTTPS retains Secure;
non-loopback is unchanged.6regressions GREEN plus a real Vite-proxy smoke with a synthetic local
upstream. Diego confirmed successful login. No real credential/cookie was inspected by the agent
or passed to tools, and no real data mutation was executed. Live Listen still contains unmigrated
views; opening it is not a declaration that all Listen is V3.

## Diego approval — 2026-10-19

1AV approved; commit/push authorized. Continue1AW with entities, tracks and collections using
the approved mockup, real consumers and updated Storybook. Keep all three servers active;
stop1AW for review before its commit. Earlier local stops and pending-review text are historical.
