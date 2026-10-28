# Listen hero background framing — investigation before 1AY

2026-10-19. Diego reported the Placebo artist background appearing too high and cutting off
the top of the photograph. Investigate this before continuing Shell/search/collection.
1AX was approved and published as `5bc683d8`. **Diego rejected the top-anchored result after
viewing it live on Gurriers and requested rollback. All production code, tests, stories and
catalogue changes from that experiment have been restored byte-for-byte to1AX.** The evidence
below is historical investigation, not an accepted framing recipe. Do not reapply it in1AY.

## Reproduction and measured causes

During the experiment the actual-consumer fixture at `/tests/hero-layout-contract.html` accepted
`?kind=artist&framing` or `?kind=genre&framing`. It mounts ArtistHeroSection/GenreHero with a
local 1280×960 SVG, whose top and vertical landmarks are known. This requires no production
credentials, backend change or downloaded artist photograph. Those experimental fixture changes
were removed on rollback. The header overlays the hero,
as it does in Listen. Measurements below are image geometry, not claims about the natural
dimensions of the particular Placebo source.

1. Both live image recipes use `object-fit: cover` within a much wider, 400px-high desktop
   hero. Cover preserves aspect ratio but enlarges the image until the frame is full; excess
   height is cropped. This is independent of the previously corrected heading alignment.
2. ArtistHeroSection includes both `object-center` (from artistHeroArtworkFitClassName) and
   `object-[right_20%]`. Actual computed browser style is **50% 50%**, not the intended 20%
   vertical position. Utility generation order determines the winner; class-string order does
   not. Genre uses the same centered cover result without that duplicate declaration.
3. ArtistContent still moves the full hero up16px/mobile and24px/desktop. GenreHero does so by
   16/24/32px. Shell already omits top padding for overlay-header routes, so these offsets
   place the decorative image above the viewport.
4. The2% scale is centered too: it removes an additional4px at the top of a400px hero. Moving
   object-position alone leaves that small crop and the negative margin in place.
5. The inspected backend image-variant path uses proportional `thumbnail`, without a cover
   crop. This establishes the frontend crop with the test image; it does not guarantee that
   every stored original photograph is itself uncropped.

### Browser geometry

Single-worker Playwright, actual Listen consumers,6 cases. The desktop image element widths
in this fixture are1190/1790px because its visible vertical scrollbar occupies10px.

| Consumer / viewport | Hero top | Image crop above its box | Source top above viewport |
| ------------------- | -------: | -----------------------: | ------------------------: |
| Artist390px         |    −16px |                      0px |                    20.2px |
| Artist1200px        |    −24px |                 246.25px |                  279.18px |
| Artist1800px        |    −24px |                 471.25px |                  508.68px |
| Genre390px          |    −16px |                      0px |                    20.2px |
| Genre1200px         |    −32px |                 246.25px |                  287.18px |
| Genre1800px         |    −32px |                 471.25px |                  516.68px |

The source-top figure includes centered scale and hero offset. A controlled browser experiment
with top anchoring for the image and scale, plus removal of the redundant negative top margin,
puts the source top at0px in all six cases. This is a diagnostic style experiment, not a
production CSS override or completed visual approval. At mobile widths cover still crops the
horizontal sides; preserving the upper image does not imply showing the whole image.

Screenshots and JSON geometry are in `.artifacts/review/hero-framing-*`. They are local
diagnostics, not new canonical captures or baselines.

## Proposed correction and visual choice

Recommended: keep the full-bleed, aspect-preserving cover treatment, explicitly anchor the
image and its slight scale at the top, and remove redundant vertical full-bleed compensation.
Preserve horizontal full bleed, current minimum heights, gradients, identity and actions.
Keep a single explicit framing contract in PageHero instead of conflicting utility classes.
Managed CrateImage/ArtworkSurface transport, responsive sources, tickets and retry remain.

Alternative: show the complete photograph with a contain/height-fit treatment and integrate
unused horizontal space into the canvas. This changes composition more substantially. Neither
choice can reconstruct content already missing from an original source file. Editorial focal
points would need an explicit data contract; do not invent face detection or per-artist fixes.

Diego initially selected top anchoring, then rejected the live result as worse and explicitly
requested rollback. That later instruction supersedes the earlier choice. The approved mockup
plus subsequent amendments remains the source of truth. The previous centered framing, scale,
and offsets are restored. Any new alternative needs a visual comparison before live adoption;
the synthetic geometry test alone did not establish acceptable photographic composition.

## Related scope

Album and playlist also use PageHero cover backgrounds and negative top wrappers, so the
layout offset must be checked there when correcting Shell integration. Album has native
safe-area/overlap rules; it is not safe to remove every negative margin by pattern alone.
Playlist can inject a nested artwork renderer, which must receive any framing contract at
the real image rather than only its wrapper. Admin artist uses a separate legacy hero; its
later adoption remains outside the current Listen scope.

Before closing a fix: browser assertions for source-top geometry at mobile/desktop widths,
existing heading-clearance tests, local/global artwork lifecycle consumer tests, shared
PageHero story/contract updates, and affected Album/Playlist regressions. Run only scoped
checks, serial Vitest/Playwright. Keep5186,6006,5174 active; stop at1AY before commit.

## Subsequent live trial — desktop artist background +100px

Diego then explicitly asked to load the existing Placebo tab and try moving its current
background down about100px. This is a smaller adjustment of the current centered crop,
not the rejected top anchoring. ArtistHeroSection's desktop managed image now uses
`objectPosition: "center calc(50% + 100px)"` as a local uncommitted trial. No change to the
mobile image, genre, shared PageHero, hero offsets/heights, scrims, title or actions.
The artist component applies it to desktop artist pages; it is not an approved global
hero recipe or a change to source images.

Verified in the actual logged-in Placebo tab through CUA: desktop image400px box, natural
800×800 source, object-fit cover, scale1.02, image bounding top−28px/height408px unchanged;
computed object-position changed from50%50% to50%calc(50%+100px). The scale makes the visible
raster shift about102px. The h1 bounding box remained exactly x412/y163.75/w672/h40.
The mobile image remains50%50%. Six focused ArtistHeroSection tests passed. Screenshot:
`.artifacts/review/placebo-background-plus-100.jpg`. Leave for Diego's live comparison;
no commit/push or further framing changes without his steering.

Diego requested another100px down in the same live trial. Current desktop artist offset is
**+200px total** (`center calc(50% + 200px)`). Verified in the actual Placebo tab; image and h1
bounding boxes remain unchanged. Current screenshot:
`.artifacts/review/placebo-background-plus-200.jpg`. This supersedes the +100px trial value;
no other production source changed and no commit/push was made.

Latest steering supersedes the +200px trial: Diego tried shortening the bottom fade by200px,
rejected it, and clarified **background +100px total with the original gradient intact**.
All shared ArtistHeroFrame/API/test/catalogue/story changes from the fade experiment were
restored to1AX and the two experiment-only catalogue files removed. The only current production
change is the desktop artist image's `objectPosition: "center calc(50% + 100px)"`.
No hero/frame/heading positions, heights, gradients or mobile composition have changed.
