# Crate v3 analysis: the site's visual language as recipes

Date: 2026-10-14
Status: analysis (read-only extraction). Input for the v3 product work on `feat/crate_v3`.

Sole visual reference: the new marketing site in the `website` worktree,
`app/web` (Astro). Every value below was read from source, not from screenshots:

- `src/styles/tokens.css`, `src/styles/base.css`
- `src/components/viz/*.astro` (19 visuals) and their controllers in `src/scripts/viz/*.ts`
- `src/components/{PageHeader,Chapter,FeatureList,StatusBadge,ChapterToc,Nav,Footer,InsideCrate,Hero,Explore,GetCrate,InstallCommand}.astro`
- `src/components/architecture/*`, `src/components/listen/*`, `src/components/developers/*`
- `src/scripts/motion/*`, `src/scripts/architecture/{counters,trace}.ts`, `src/lib/counter.ts`
- `e2e/a11y.spec.ts`, `e2e/viz.spec.ts`
- `docs/plans/2026-10-13-website-design.md`

Note: `docs/plans/2026-10-14-crate-v3-design-system.md` cites `components/lab/viz/*.astro`; the
real path is `components/viz/*.astro`.

---

## 1. Tokens

### 1.1 Base colours (`tokens.css`)

| Token | Value | Role |
| --- | --- | --- |
| `--bg` | `#0a0a0f` | canvas, text on accent fills, node fills (knock-out) |
| `--fg` | `#f1f5f9` | primary text, numerals, active labels |
| `--fg-2` | `rgba(241,245,249,.62)` (= `#999ca0` on bg) | secondary text, body copy, idle chips |
| `--fg-3` | `rgba(241,245,249,.5)` (= `#7e8084` on bg) | mono labels, meta, axis text |
| `--line` | `rgba(241,245,249,.1)` (= `#212226` on bg) | the hairline |
| `--cyan` | `#06b6d4` | fills: CTA pill, play button, glows, area gradients, selection bg |
| `--cyan-hi` | `#67e8f9` | strokes, label key words, curves, active chips, focus ring |
| `--amber` | `#fbbf24` | status only: coming soon, needs confirmation, over limit, pending, evicted |

Literal surfaces (not tokenised on the site, should be tokens in the product):

| Value | Role |
| --- | --- |
| `#0d0e14` | raised surface: cards, terminal window, code block, JSON card, probe box, map nodes |
| `#0b1d24` | active node fill in the system map (cyan-tinted surface) |
| `rgba(10,10,15,.92/.6/0)` | nav fade gradient, extends 28px below the bar |
| `rgba(10,10,15,.9)` | mobile scrollytelling card background |
| `rgba(10,10,15,.8)` | radial vignette edge |
| `rgba(9,16,22,.72)` + `backdrop-filter: blur(10px)` | the only glass: CTA pill over WebGL; hover `rgba(9,22,30,.82)` |
| `rgba(13,14,20,.72)` | video play/pause toggle |

Rule: cyan is the only brand colour. Amber appears only as state. No other hues exist anywhere
on the site (no red, no green; "destructive" is shown with a 3-step grey meter, not red).

### 1.2 Alpha ladders (what each step is used for)

Foreground `rgba(241,245,249,a)`:

| a | Use |
| --- | --- |
| .015 / .02 / .025 / .03 | group fills, lane track background, night band, pool track |
| .04 | secondary grid columns (EQ) |
| .05 | orbit rings, idle cells (redis), `--line`-weaker grid |
| .06 | row dividers inside lists, related edges in the genre wheel |
| .07 | canvas grid (mood map) |
| .10 | `--line`: panel top rule, borders, separators, chip borders |
| .12 / .14 | dashed "never" edge, risk meter off segment, inactive tracks |
| .16 / .18 | far links, parent edges, perforation dash, night band top rule, mini-EQ zero line |
| .20 / .22 | EQ zero line (dashed), bliss zero line, beat ticks, dimmed curves |
| .25 / .30 | node rings, terminal chrome dots, relay edge, decorative zone labels |
| .35 | ghost/target curve, packet deltas |
| .40 / .45 | node strokes, marker lines, phone outline |
| .50 / .55 | `--fg-3`, preset node fill, device outlines, TTL-less cache cell |
| .62 / .70 | `--fg-2`, title bar in device mock |

Cyan `#06b6d4` fills (`rgba(6,182,212,a)`): .04 tile hover, .05 crossfade zone, .06 CTA hover ring,
.08 scanning row gradient and screencast radial, .10 halos and highlighted code line, .12 curve glow
and halo, .14 active-dot ring, .16 artwork placeholder, .20–.28 bar/progress fills.

Cyan-hi `#67e8f9` strokes and borders (`rgba(103,232,249,a)`): .28 CTA border, .30 job border,
.32 lit related edge, .38 OK edges, .40 chip hover border, accent tag border, method badge, .45 auto
badge, .50 approved/verdict, .55 CTA hover border and cache cells, .60 downbeat ticks and fsync bar.

Amber `rgba(251,191,36,a)`: .06 badge fill, .35 badge border, .45 confirm/pending border, .50 "no"
verdict, .55 pending edge, .70 dashed legend key and evicted cell, .80 deferred chip border.

### 1.3 Contrast (computed against `#0a0a0f`, and `#0d0e14` cards)

| Colour | on bg | on card | Note |
| --- | --- | --- | --- |
| fg | 18.0:1 | 17.6:1 | |
| fg-2 (.62) | 7.15:1 | 7.10:1 | AAA for body |
| fg-3 (.5) | 4.96:1 | 4.97:1 | AA; the floor for any informative text |
| fg .45 | 4.21:1 | | below AA: never for text |
| fg .30 (queue zone labels) | 2.47:1 | | decorative only, `aria-hidden` |
| cyan-hi | 13.6:1 | 13.3:1 | (v3 spec says ~12:1; real value is 13.6) |
| cyan | 8.1:1 | 7.9:1 | |
| amber | 11.8:1 | 11.5:1 | |
| bg text on cyan-hi (active chip) | 13.6:1 | | |
| bg text on cyan (CTA pill) | 8.1:1 | | |

`e2e/a11y.spec.ts` asserts fg-2 and fg-3 >= 4.5:1 by blending the alpha over `--bg`. Hairlines are
1.24:1 (`--line`) by design: structure, not information.

### 1.4 Type families

| Stack | Faces | Use |
| --- | --- | --- |
| `--display` | Cabinet Grotesk 800/700/500, fallback Poppins, system-ui | headlines, numerals, names, ledes |
| `--sans` | Poppins (from `@shared/fonts`) | body, row titles, inputs |
| `--mono` | JetBrains Mono 400, `ui-monospace`, SF Mono, Menlo | labels, units, axes, codes, chips, readouts |

Mono is always weight 400; `<b>` inside mono labels resets to `font-weight: 400` and gets colour
instead of weight. Display weight carries hierarchy: 800 headlines and hero numerals, 700 sub-heads
and mid numerals, 500 ledes and statements. `-webkit-font-smoothing: antialiased`, `color-scheme: dark`.

### 1.5 Type scale

Display headlines (Cabinet 800, `letter-spacing: -0.045em`, `line-height: .9`, `text-wrap: balance`):

| Context | Size | Max width |
| --- | --- | --- |
| Page header H1 | `clamp(3.2rem, 9vw, 9.5rem)` | 11ch |
| Chapter H2 | `clamp(3rem, 7.5vw, 7.5rem)` | |
| Inside-Crate H2 | `clamp(2.8rem, 7vw, 6.4rem)` | |
| Hero H1 | `clamp(2.6rem, 5.4vw, 6.4rem)` (mobile 11vw) | 16ch |
| Get Crate H2 | `clamp(2.6rem, 6vw, 6rem)` | |
| Ticket artist | `clamp(2.6rem, 5vw, 4.4rem)` | |
| Track title readout | `clamp(2.2rem, 4.2vw, 3.8rem)`, lh 1, nowrap | |
| Genre preset readout | `clamp(2.2rem, 4vw, 3.6rem)`, lh .95, cyan-hi | |

Sub-heads (Cabinet 700, lh 1–1.1):

| Context | Size | Tracking |
| --- | --- | --- |
| Explore rows | `clamp(2rem, 5vw, 4.6rem)` | -0.04em |
| Menu items | `clamp(2.2rem, 11vw, 3.2rem)` | -0.04em |
| Dive step H3 | `clamp(1.8rem, 3vw, 2.8rem)` | -0.035em |
| Story H3 | `clamp(1.7rem, 2.7vw, 2.6rem)`, lh 1.02 | -0.035em |
| Trace step H3 | `clamp(1.6rem, 2.6vw, 2.4rem)` | -0.035em |
| Release "now" | `clamp(1.6rem, 3vw, 2.6rem)`, cyan-hi | -0.035em |
| Tile title | `clamp(1.4rem, 2vw, 1.9rem)` | -0.035em |
| Feature H3 | `clamp(1.25rem, 1.7vw, 1.6rem)` | -0.02em |
| Hero subline `.sub` | `clamp(1.15rem, 1.8vw, 1.9rem)`, cyan-hi | -0.025em |
| Mood labels | `clamp(.95rem, 1.3vw, 1.2rem)` | -0.02em |
| Brand wordmark | 18px, 800 | -0.02em |

Ledes and statements (Cabinet 500):

| Context | Size | lh | Tracking | Colour | Width |
| --- | --- | --- | --- | --- | --- |
| Page lede | `clamp(1.35rem, 2.2vw, 2.1rem)` | 1.2 | -0.02em | fg-2 | 36ch |
| Chapter lede | `clamp(1.35rem, 2.3vw, 2.3rem)` | 1.14 | -0.025em | fg, 2nd paragraph fg-2 | 30ch |
| Statement | `clamp(1.5rem, 2.9vw, 3.1rem)` | 1.12 | -0.025em | fg, `.hl` cyan-hi | 28ch |

Numerals (Cabinet, `font-variant-numeric: tabular-nums` always):

| Tier | Weight | Size | lh | Tracking | Where |
| --- | --- | --- | --- | --- | --- |
| XL hero | 800 | `clamp(3.2rem, 8.4vw, 8.4rem)` | .85 | -0.05em | listening counters |
| XL clock | 800 | `clamp(3.4rem, 9vw, 8.6rem)` | .85 | -0.05em | release clock |
| L | 800 | `clamp(3rem, 6.5vw, 6.5rem)` | .9 | -0.045em | scale figures |
| L | 800 | `clamp(2.8rem, 5.6vw, 5.4rem)` | .85 | -0.05em | health totals |
| M | 800 | `clamp(1.8rem, 3vw, 2.8rem)` | 1 | -0.045em | queue lane counts |
| M | 700 | `clamp(1.6rem, 2.6vw, 2.4rem)` | – | -0.035em | analysis figures (BPM, LUFS) |
| S | 700 | `clamp(1.3rem, 2vw, 1.9rem)` | – | -0.03em | gauge outputs |
| S | 700 | `clamp(1.1rem, 2.1vw, 2rem)` | – | -0.03em | EQ band values |
| S | 700 | `1.7rem` | – | -0.03em | legend values |
| SVG centre | 800 | 40px | – | -0.04em | wheel centre count |

Body (Poppins): `clamp(.98rem, 1.1vw, 1.08rem)`, lh 1.7 (story 1.75), fg-2, max 60–62ch. Small body
13px lh 1.55 (step captions), 14px (tile body, notes), 15px (setlist rows, UUID inputs). Nav links 13px
`.01em`.

Mono micro scale (all weight 400):

| Size | Tracking | Case | Use |
| --- | --- | --- | --- |
| 11.5px | .16em | upper | `.eyebrow`, screencast chapter tabs |
| 11.5px | .14em | upper | chapter TOC, menu toggle, figure labels |
| 11.5px | .04–.08em | as-is | status line, mood readout, footnotes |
| 11px | .14em | upper | `.viz-label` (panel header, dt, captions) |
| 11px | .04–.06em | as-is | chips, routes, flags |
| 10.5px | .14em | upper | status badge, axis titles, centre sub-label |
| 10.5px | .06–.1em | upper/as-is | scan rows, scale ticks, units, map group names |
| 10px | .08–.14em | upper | lane names, packet labels, step chips |
| 9.5px | .06–.12em | upper | legend dt, health badges, method badges, job labels |
| 9px | 0–.04em | | mobile fallbacks only |
| 8.5px | .14em | upper | decorative zone captions (aria-hidden) |
| 12–13px | 0–.04em | as-is | code, JSON (12.5px lh 1.7), terminal (13px lh 1.75), file tree (12px lh 2) |

### 1.6 Letter-spacing and line-height ladders

- Tracking, positive (mono): `.01` nav, `.02`, `.04` data chips, `.06` scale/rows, `.08` units/small
  labels, `.1`, `.12` badges/dt, `.14` caps labels (the default), `.16` eyebrow.
- Tracking, negative (display): `-.02` small display, `-.025` ledes/statement, `-.03` small numerals,
  `-.035` H3/mid numerals, `-.04` rows/menu/SVG centre, `-.045` headlines, `-.05` hero numerals.
- Line-height: `.85` hero numerals, `.9` display, `.95` preset readout, `1` headings/numerals, `1.02–1.2`
  sub-heads/ledes, `1.55` small body, `1.6–1.75` body and code, `2` file tree.

### 1.7 Radii

| Radius | Use |
| --- | --- |
| `999px` | chips, CTA, status badges, tags, packet labels, menu toggle |
| `50%` | dots, nodes, play button |
| `18px` | screencast frame |
| `16px` | mobile scrollytelling card |
| `14px` | cards: ticket, terminal window, code block, JSON card; SVG group rects `rx=14` |
| `12px` | probe/request box |
| `10px` | SVG map nodes `rx=10` |
| `6px` | lane track, fact chips (story) |
| `4px` | method badges, pool track |
| `3px` | heat cells, jobs |
| `2px` | bars, gain bars, gauge tracks |
| `1–1.5px` | risk meter segments, mobile heat cells |

### 1.8 Hairlines, strokes and dashes

- Every border is 1px. The panel structure is: top rule (`border-top: 1px solid var(--line)`),
  row dividers at `.06`, section dividers at `--line`. No boxes around panels; only "objects"
  (ticket, terminal, code, JSON) are boxed cards.
- Tracks and meters: 1px (progress line), 2px (feature bars, gain meters), 3px (cache meter), 4px
  (governor gauges).
- SVG strokes: 1 (orbits, grids), 1.25 (default nodes/edges/outlines), 1.5 (active dots), 1.75 (lit
  edge), 2 (curves, active nodes), 2.25 (active parent edge, EQ curve), plus a 10–14px glow stroke at
  `stroke-opacity: .12` under every primary curve. `vector-effect: non-scaling-stroke` on scaled SVGs.
- Dash patterns: `2 4` zero lines, `3 5` ghost/target curve, `2 6` outer ring/"never" edge, `3 4`
  dimmed curves and client nodes, `4 5` fallback edges and selection regions, `2 5` group boxes,
  CSS `1px dashed rgba(241,245,249,.18)` perforation, `border-style: dashed` for "governed" chips.

### 1.9 Spacing rhythm

- Containers: `max-width: 1320px; margin: 0 auto; padding-inline: clamp(20px, 6vw, 96px)`. Nav:
  `padding: 22px clamp(20px, 4vw, 56px)`.
- Column ratio: 5fr / 7fr everywhere (chapter head, feature rows, story, endpoint list, VizSplit,
  dives); column gap `clamp(24px, 5vw, 80px)` (VizSplit `clamp(28px, 5vw, 88px)`).
- Macro vertical rhythm is in `vh`: page header `22vh` top / `10vh` bottom; chapter `14vh` top
  (`10vh` mobile) / `4vh` bottom; chapter head to body `8vh` (`5vh` mobile); viz band `9vh` below
  (`6vh` mobile), `.gap` adds `12vh` above (`8vh` mobile); inside panels `4–8vh` between blocks.
- Panel micro rhythm (px): top rule then `padding-top: 22px`; header to body 12–28px; rows 7–9px
  vertical (setlist/scan), 14px (lanes), 26–30px (feature/endpoint rows); chip gaps 6–8px; label to
  value 10–14px; card padding 12–18px header, 16–30px body.
- Breakpoints: 760px (mobile: single column, visual first, labels trimmed), 860/900/1000px
  (panel-specific collapses). Coarse pointer gets 44px tap targets.

### 1.10 Texture

- Grain: `body::after` fixed, `z-index: 90`, `opacity: .045`, SVG `feTurbulence`
  (`baseFrequency=.9`, `numOctaves=3`, 200px tile), `pointer-events: none`.
- Vignette: `radial-gradient(ellipse 120% 90% at 50% 45%, transparent 55%, rgba(10,10,15,.8) 100%)`
  (hero only).
- Labels over graphics use a halo instead of a box: `text-shadow: 0 0 10px var(--bg)` (or
  `0 0 8px, 0 0 18px`).
- No glassmorphism (except the CTA), no decorative gradients, no bento grids, no frames, no
  scanlines (design doc).

### 1.11 Typographic conventions

- Real minus `−` (U+2212) for negatives (`formatGain`, LUFS, `T−24 d`), `→` for flows and paths,
  ` · ` (middle dot with spaces) between metadata parts, `…` for truncation, `~` as a raised mono
  cyan glyph for approximate numbers (`.approx`: mono, `.4em`, `vertical-align: .6em`).
- Indices zero-padded: `01`, `02 / 07` (index / total) in mono; key number in cyan-hi.
- Slugs shown lower-case with spaces (`post punk`, `bass boost`): `slug.replace(/[-_]/g, " ")`.
- Units are lower-case mono after the numeral (`LUFS`, `dB`, `min`, `s`, `%`).
- `tabular-nums` on every number that changes.

---

## 2. Panel anatomy (recipes)

### 2.1 Panel shell: "LABEL · meta" header over a top rule

Every live visual is a `<figure>` with the same shell:

```html
<figure class="panel" data-viz="eq" data-reveal aria-label="One-sentence summary with the real numbers">
  <header class="viz-bar" data-enter>
    <p class="viz-label"><b>EQ</b> 10 bands · ±12 dB · 21 presets</p>
    <p class="viz-label">secondary meta / live trail</p>
  </header>
  ...body...
</figure>
```

```css
.panel { margin: 0; padding-top: 22px; border-top: 1px solid var(--line); }
.viz-bar { display: flex; flex-wrap: wrap; align-items: baseline;
           justify-content: space-between; gap: 8px 24px; }
.viz-label { margin: 0; font: 400 11px/1.4 var(--mono); letter-spacing: .14em;
             text-transform: uppercase; color: var(--fg-3); font-variant-numeric: tabular-nums; }
.viz-label > b:first-child { margin-right: 10px; font-weight: 400; color: var(--cyan-hi); }
```

The left label is "key word in cyan + plain-language description"; the right label is technical
meta (versions, digests, limits, "example values"). Free-floating panels (orbit, moods, federation)
drop the top rule but keep the header.

### 2.2 Eyebrow

```css
.eyebrow { font: 400 11.5px var(--mono); letter-spacing: .16em; text-transform: uppercase; color: var(--fg-3); }
.eyebrow b { color: var(--cyan-hi); font-weight: 400; }
```

Pattern: `<b>03</b> / Paths`, `<b>04</b> / 12`. Used above every H1/H2/H3 and step card.

### 2.3 Big numerals with mono captions and units

```html
<dl class="totals">
  <div><dt class="viz-label">Checks</dt><dd>17</dd></div>
</dl>
<dd><span data-figure="loudness">−8.4</span><small>LUFS</small></dd>
```

```css
.totals { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 20px; }
.totals div { display: grid; gap: 10px; }                     /* label above number */
.totals dd { margin: 0; font: 800 clamp(2.8rem,5.6vw,5.4rem)/.85 var(--display);
             letter-spacing: -.05em; font-variant-numeric: tabular-nums; }
dd { display: flex; align-items: baseline; gap: 8px; }
dd small { font: 400 10.5px var(--mono); letter-spacing: .08em; color: var(--fg-3); }
```

Variants: label below the number (`flex-direction: column-reverse`, scale figures); per-figure top
hairline with `padding-top: 12px` (analysis figures); a textual "number" in cyan-hi (top genre,
current preset) uses the same tier at a smaller clamp and `line-height: 1.3`.

### 2.4 Legend strip

```css
.legend { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 12px;
          padding-top: 18px; border-top: 1px solid var(--line); }
.legend dt { font: 400 9.5px var(--mono); letter-spacing: .12em; text-transform: uppercase; color: var(--fg-3); }
.legend dd { margin: 0; font: 700 1.7rem var(--display); letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
```

Swatch legends are inline mono 10px with 10×6px rounded keys (`.k`), or a dashed pill key
(18×9px, `1px dashed rgba(251,191,36,.7)`) inside the header label.

### 2.5 Axes, scales and grids

- Y scale as a list beside the plot: `+12 / +6 / 0 dB / −6 / −12`, mono 10.5px `.06em`, fg-3,
  `justify-content: space-between`, column 52px (34px mobile).
- X labels under the plot in a grid with the same column count as the data (`repeat(10, 1fr)`):
  value in display 700 above, band in mono 10.5px `.12em` fg-3 below.
- Grid lines: rows at `--line`, columns at `.04`, zero line `.22` dashed `2 4`.
- Hour axis: only every 6th label printed (`00 06 12 18`), others empty strings to keep the grid.
- Axis titles: mono 10.5px `.14em` upper fg-3 with an arrow (`valence →`); vertical title via
  `transform-origin: left top; transform: rotate(-90deg) translateX(-100%)`.
- Annotated regions: a band with `border-top: 1px solid rgba(241,245,249,.18)` and
  `background: rgba(241,245,249,.025)` labelled in `.viz-label` (`night 22–05 · 31%`).

### 2.6 Readouts

A readout is one mono line that narrates the current state: `Peak Saturday 23:00 · 412 min`,
`scanning 07/17`, `Deferring governed work · load 1.02>0.85 · retry in 300 s`.

- `aria-live="polite"` on readouts that change (EQ trail, scan status, walk, probe, governor status).
- Reserve space: `min-height: 1.4em`/`3.2em`, `min-width: 12ch` on scrambled words, `visibility`
  (not `display`) toggles for streamed lines, so nothing shifts.
- Hover updates the readout; `pointerleave` restores the summary.

### 2.7 Chips

Interactive (toggle) chip, used for presets, example tracks, genres:

```css
.chip { min-height: 32px; padding: 0 12px; border: 1px solid var(--line); border-radius: 999px;
        background: transparent; color: var(--fg-2); font: 400 11px var(--mono); letter-spacing: .04em;
        cursor: pointer;
        transition: color .3s var(--ease-snap), border-color .3s var(--ease-snap),
                    background-color .3s var(--ease-snap), transform .45s var(--spring-snappy); }
.chip:hover { color: var(--fg); border-color: rgba(103,232,249,.4); }
.chip:active { transform: scale(.95); }
.chip[aria-pressed="true"] { color: var(--bg); border-color: var(--cyan-hi); background: var(--cyan-hi); }
```

Group: `role="group" aria-label="…"`, `display: flex; flex-wrap: wrap; gap: 8px`. Mobile: one
scrolling row (`flex-wrap: nowrap; overflow-x: auto; margin: 0 -20px; padding: 0 20px 6px;
scrollbar-width: none`).

Static variants:

| Variant | Recipe |
| --- | --- |
| Tag | `padding: 3px 9px; border: 1px solid var(--line); radius 999; mono 10–10.5px; fg-2/fg-3` |
| Accent tag (scopes, done steps) | border `rgba(103,232,249,.4)`, text cyan-hi |
| Fact chip (story) | `padding: 5px 10px; radius 6px; border --line; mono 11px .04em; cyan-hi` |
| Method badge | `padding: 1px 6–7px; radius 4px; mono 9.5–10.5px .06em; border cyan-hi .4–.45; cyan-hi`; `POST` filled cyan-hi with bg text; `HEAD` neutral |
| Process chip (queue) | 20px tall pill, mono 10px, border cyan-hi .4, progress fill `linear-gradient(90deg, rgba(6,182,212,.28) var(--p), rgba(10,10,15,.92) var(--p))`; governed = dashed; deferred = amber border and text; done = `--line` border, fg-3 |
| Verdict pill | `padding: 3px 9–10px; mono 10–10.5px .1–.12em upper`; ok = cyan-hi border .5; no = amber border .5 |

### 2.8 Status: dots, badges, state colours

- Status dot: 5–7px circle, `background: currentColor` (on) or `border: 1px solid currentColor;
  background: transparent` (off/missing). On = cyan-hi, off = fg-3, warn = amber.
- Status line: `display: flex; gap: 10px; mono 11.5px .04em fg-2` with a 7px `::before` dot; blocked
  state switches both text and dot to amber.
- `StatusBadge` (coming soon): pill, `padding: 5px 11px; border: 1px solid rgba(251,191,36,.35);
  background: rgba(251,191,36,.06); color: var(--amber); mono 10.5px .14em upper; gap 8px`, 5px
  round dot `currentColor`. The "optional LLM" variant is neutral: `--line` border, transparent,
  fg-2 text, a 5px square cyan-hi marker.
- Row result states (health): `fixed` cyan-hi, `waiting` amber, `found` fg, `clean` fg-3,
  `pending` transparent (keeps width).
- Small auto/confirm badges: `padding: 2px 8px; mono 9.5px .12em upper`; auto = cyan-hi border .45,
  confirm = amber border .45.
- Risk meter (no red): three 4×10px segments, `gap: 2px; radius 1px`, off `rgba(241,245,249,.14)`,
  on fg-2; level 1/2/3 lights 1/2/3 segments, followed by the mono word.
- Setlist ownership: `in library` = cyan-hi text + filled 6px dot; `missing` = fg-3 title, fg-3 text,
  ring dot.

### 2.9 Meters and limits

```css
.track { position: relative; height: 4px; border-radius: 2px; background: var(--line); }
.track b { position: absolute; inset: 0; border-radius: 2px; background: var(--cyan-hi);
           transform-origin: left; transform: scaleX(var(--v)); }
.track s { position: absolute; top: -4px; bottom: -4px; left: calc(var(--limit) * 100%);
           width: 1px; background: var(--fg); }               /* limit tick */
li.is-over output, li.is-over .track b { color: var(--amber); background: var(--amber); }
```

Row meter: `grid-template-columns: auto minmax(0,1fr) 5ch` (label, 2px track, right-aligned mono
value). Feature bars: `16ch | track | 5ch`. Values are written to `--v` as 0..1, never width.

### 2.10 Hairline lists and active row

- Row: `display: grid; padding: 9px 0; border-bottom: 1px solid rgba(241,245,249,.06)`, list has a
  `--line` top border. Index column `2.4ch`/`3ch` mono fg-3; title in sans 14–15px fg; meta columns
  in fixed `ch` widths (`11ch 16ch 9ch 12ch`) so columns align without a table.
- Active/scanning row: 2px cyan-hi bar at `left: -12px` animated with `scaleY(0→1)` (.25s ease-snap)
  plus `background: linear-gradient(90deg, rgba(6,182,212,.08), transparent 70%)`.
- Hit row (allowlist): `border-left: 2px solid var(--cyan-hi)` + gradient `rgba(6,182,212,.1) →
  transparent 75%`.
- Responsive: drop columns (`display: none`) and rewrite `grid-template-columns` at 1000/760px.

### 2.11 Bipolar bars in pure CSS (mini EQ, bliss vector)

```css
.bars { display: grid; grid-template-columns: repeat(10, minmax(0,1fr)); gap: 6px; height: 96px;
        background: linear-gradient(transparent calc(50% - .5px), rgba(241,245,249,.18) calc(50% - .5px),
                    rgba(241,245,249,.18) calc(50% + .5px), transparent calc(50% + .5px)); }
.bars li { position: relative; }
.bars li::after { content: ""; position: absolute; left: 25%; right: 25%; top: 50%; height: 50%;
                  border-radius: 2px; background: linear-gradient(var(--cyan-hi), rgba(6,182,212,.25));
                  transform-origin: top; transform: scaleY(calc(var(--g) / -12)); }
```

One custom property per bar (`--g` in dB, `--v` in -0.5..0.5 for bliss with `scaleY(var(--v) * -2)`)
drives the whole thing; animation writes only that property.

### 2.12 Cards: ticket, terminal, code

- Card: `border: 1px solid var(--line); border-radius: 14px; background: #0d0e14; overflow: hidden`.
  Card header row: `padding: 12px 18px; border-bottom: 1px solid var(--line)` with `.viz-label`
  left and right.
- Ticket perforation: head block of fixed height `--cut` (198px; 176px mobile) with
  `border-bottom: 1px dashed rgba(241,245,249,.18)`, and side notches cut by a mask:

  ```css
  .ticket { --notch: 14px; --cut: 198px;
    mask: radial-gradient(circle var(--notch) at 0 var(--cut), #0000 98%, #000) 0 0 / 51% 100% no-repeat,
          radial-gradient(circle var(--notch) at 100% var(--cut), #0000 98%, #000) 100% 0 / 51% 100% no-repeat; }
  ```

  Footer: 40px cyan play disc (CSS triangle in `--bg`) + "**6 of 9** playable from your library".
- Terminal window: chrome row with three 9px ring dots (`border: 1px solid rgba(241,245,249,.25)`)
  and the host in `.viz-label`; screen mono 13px lh 1.75 fg-3, `$` prompt cyan-hi, command fg, status
  line cyan-hi, caret `.6em × 1.1em` cyan-hi blinking `1s steps(1)`. `min-height: 470px` reserves
  the full response height.
- JSON/code tokens: keys, numbers, literals fg; strings cyan-hi; comments fg-3 italic; punctuation
  fg-3. Indent by `padding-left: calc(var(--depth) * 2ch)`. Highlighted line:
  `linear-gradient(90deg, rgba(6,182,212,.1), transparent 80%)`.

### 2.13 SVG graph styling (genre wheel, orbit, federation, system map)

- Nodes: `fill: var(--bg)` (knock-out) with `stroke: rgba(241,245,249,.45); stroke-width: 1.25`;
  r 5.5 for family nodes, 3.5 for children. A node that owns data (genre with its own EQ preset)
  is filled `rgba(241,245,249,.55)` without stroke.
- States by class, transitions .3s ease-snap, radius change `r` .4s spring-snappy:
  `is-path` stroke cyan-hi 2; `is-from` (source of the inherited value) filled cyan-hi; `is-start`
  r 6; `is-on` edges cyan-hi 2.25 (parent) or cyan-hi .32 (related); `is-active` stroke cyan-hi;
  `is-done` filled cyan-hi (near) or fg-2 (far); `is-past` cyan-hi .45 stroke.
- Edges: parent = cubic curves through mid radius (`C` with control points at `(r1+r2)/2` on each
  angle), related = quadratic pulled to centre (`Q` control at 18% of the midpoint offset).
- Rings: concentric orbit circles at `.05` (wheel radii 132/212/256 in a 760 viewBox) or `--line`
  with dashed outer ring `2 6` (orbit).
- Labels in SVG: mono 10px `.04em` fg-3, radial rotation, flipped past 180° so text is never upside
  down; family labels 11.5px `.1em` upper fg-2. Mobile hides child labels, family labels 16px.
- Labels over SVG in HTML: absolutely positioned at `left/top` percentages of the viewBox
  (`(x / 600) * 100%`), side-aware transforms (`translate(16px,-50%)` right, `translate(calc(-100% -
  16px), -50%)` left, above for centre), halo text-shadow, `pointer-events: none`.
- Centre readout: display 800 40px + mono 10.5px `.14em` upper sub-label.

### 2.14 Step rails

- Horizontal steps (`fed-steps`, `sidecar-flow`): grid of N columns, each with a 1px `--line`
  `::before` and a cyan-hi `::after` that scales `scaleX(0→1)` (or `scaleX(var(--p))` for live
  progress), `.6s ease-out`; inactive steps at `opacity: .4`.
- Timeline rail (`release`): `::before` line + `::after` progress `scaleX(var(--p))`; 13px dots
  (`border .4`, done = filled cyan-hi, active = `scale(1.35)` + `box-shadow: 0 0 0 6px
  rgba(6,182,212,.14)`); sub-step chips per stage. Under 900px the rail turns vertical (`scaleY`,
  dots at `left: -28px`).
- Sequence diagram (`outbox`): N lane columns labelled in cyan-hi mono, each row a track with a
  `repeating-linear-gradient` of lane centre lines, an arrow `scaleX` whose `transform-origin` is
  set by direction (`calc(50% - var(--dir) * 50%)`), hollow "from" dot and filled "to" dot, code
  text typed in.

### 2.15 Tiles (home "Inside Crate")

Four tiles in a row separated by vertical hairlines (`li + li { border-left: 1px solid var(--line)
}`), list top rule, each tile `padding: 22px clamp(14px,1.8vw,26px) 26px` (first tile flush left),
mini visual 120px tall, display 700 title, 14px body with `→`. Hover `background:
rgba(6,182,212,.04)`; focus ring inset (`outline-offset: -2px`). Collapses 4 → 2 → 1 with the border
moved from left to top.

---

## 3. Visual catalogue

| Visual | Page | Rendering | Live behaviour | Product counterpart |
| --- | --- | --- | --- | --- |
| GenreWheel | /admin Genres | SSR SVG 760 viewBox, radial layout from data | auto walk through genres without own EQ (dwell 3.4 s), click chip or hover node to inspect (9 s hold); highlights inheritance path; mini EQ springs to the inherited preset; preset name scrambles | Admin taxonomy (real graph, real EQ inheritance), Listen genre rooms/paths |
| EqViz | /listen Play | SVG built per size (ResizeObserver) | springs between presets (dwell 2.8 s), ghost target curve, progress hairline, Smart EQ chain highlights the source | Listen EQ panel, Admin genre EQ editor (already started in v3) |
| MixViz | /listen Play | SVG per size | playhead sweep 8.5 s reveals lit waveforms via clip rect, equal-power curves, −3 dB crossing, A/B gain meters | Smart Mix transition preview (branch `smart-mix-phase-1`) |
| MoodMap | /listen Discover | Canvas 2D + HTML labels | points fly in (backOut), auto-cycles moods (2.6 s), pointer picks nearest mood, dashed region of the filter thresholds | Listen moods, Insights |
| Heatmap | /listen Yours | HTML grid of 168 cells | diagonal wave entrance, hover readout, peak outlined, night band, count-up counters, scrambled top genre | Listen stats |
| Federation | /listen Together | SVG 600 | 6-phase script (9.2 s): descriptor, signed, approved, grant, relay, done; packets travel edges | Admin federation, peer pairing |
| Devices | /listen Everywhere | inline SVG | outlines draw, progress bars run only while visible | Listen devices/sessions |
| Setlist (ticket) | /listen Live | HTML card | rows slide in | Listen Radar ticket (done in v3) |
| HealthScan | /admin Health | HTML hairline list | sequential scan 0.3 s/row, found → fixed/waiting, status counts | Admin health (17 checks, real SSE progress) |
| AlbumSidecar | /admin Imports | HTML tree + JSON card | JSON types at 16 lines/s, auto-scroll that yields to the user, write then rehydrate progress | Admin album detail, portable metadata |
| ReleaseTimeline | /admin Acquisition | HTML rail | 5 stages, countdown clock `T−24 d`, sub-step chips | Admin acquisition/new releases |
| EnrichmentOrbit | /admin Enrichment | SVG 600 + HTML labels | thread-pool lanes (3 workers) drive link draw, packets and node state, core halo pulse | Admin enrichment per artist |
| TrackReadout | /admin Analysis | HTML | springs between example tracks (4.6 s), staggered stiffness per value, 20-bar bliss vector | Admin/Listen track analysis |
| QueueLanes + GovernorGauges | /admin Operations | HTML | chips spawn, queue, run, finish per queue; governed chips wait while gauges are over limit | Admin tasks/workers, governor |
| OutboxSequence, RedisPair, UuidDerivation | /architecture | HTML | typed sequences, cache fill/evict, AOF log | reference only |
| ApiTerminal, TokenAllowlist | /developers | HTML | typed curl + streamed JSON, probe typed then verdict | Admin API tokens |
| SystemMap + Trace | /architecture | SSR SVG, two layouts (wide/tall) | scroll-scrubbed route drawing with a travelling dot | Admin stack view |
| InsideCrate tiles | / | SVG + HTML minis | EQ morph, route draw, hour sweep, scan sweep | dashboard tiles |

Data note for the genre wheel: the site data has 61 genres, 14 families, 40 with their own EQ preset,
and `RELATION_TYPES` lists four (`parent`, `related`, `influenced_by`, `fusion_of`), matching the
backend (`app/crate/llm/prompts/genre_taxonomy_node_proposal.py`). The website design doc says
"five relation types"; the visual and the backend say four. The pure functions
`buildTaxonomy`, `resolveEq` (BFS to nearest ancestor preset, returns `path` and `from`),
`radialLayout` (weight-proportional sectors, rings by depth) and `genreRoute` (Dijkstra with
parent/child 1, related 2.5) live in `src/scripts/viz/taxonomy-math.ts` with tests and port directly.

---

## 4. Motion

### 4.1 Easing tokens

| Token | Value | Used for |
| --- | --- | --- |
| `--spring-snappy` | `linear(0, .009, .035 2.1%, .141 4.4%, .723 12.9%, .938 16.7%, 1.017 19.4%, 1.067 22.5%, 1.089 26%, 1.079 30.3%, 1.049 36%, 1.024 42.6%, 1.011 50.3%, 1.004 59.2%, 1.001 69.3%, 1)` (~9% overshoot) | entrances, words, chips press, node radius, row slides |
| `--spring-smooth` | `linear(0, .004, .016 2.3%, .063 4.7%, .141 7.2%, .25 9.9%, .601 16.5%, .815 21%, .929 25.2%, .987 29%, 1.025 33.5%, 1.042 38%, 1.04 43.5%, 1.027 50%, 1.013 57.5%, 1.005 67%, 1.001 79%, 1)` (~4% overshoot) | state crossfades (trace steps) |
| `--ease-out` | `cubic-bezier(.16,1,.3,1)` | hairline/path drawing, nav entry, halos |
| `--ease-snap` | `cubic-bezier(.22,1,.36,1)` | colour/border/opacity state changes, hovers |
| `--ease-in-out` | `cubic-bezier(.65,0,.35,1)` | (declared) |
| `--ease-dramatic` | `cubic-bezier(.77,0,.175,1)` | (declared) |

No CSS keyword easings anywhere (`linear` only for opacity fades and constant progress).

### 4.2 Durations

| Duration | What |
| --- | --- |
| .08s | press (`:active` on CTA) |
| .25s | scanning bar, opacity toggles of packets |
| .3s | colour/border/background state (`ease-snap`) |
| .35–.45s | edges, row opacity, check mark draw, chip press spring |
| .5–.55s | hover transforms (CTA scale, labels) |
| .6s | nav entry, step underline draw, edge draw |
| .7s | `enter-up`, feature rows, heat cells, menu items |
| .75s | word reveal |
| .9s | hairline draw, halo pulse, label clip reveal, edge-club draw |
| 1.4s | device outline draw |
| 1.6s | count-up |

### 4.3 Entrances

- Reveal trigger: one `IntersectionObserver` (`threshold: .2, rootMargin: "0px 0px -8% 0px"`) adds
  `.is-in` once to `[data-reveal]`, then unobserves.
- Gate: initial hidden states are scoped to `:where(html.js)`; without JS everything is visible in
  its final state (`e2e/no-js.spec.ts`).
- `[data-enter]`: `enter-up .7s var(--spring-snappy) both`, delay `var(--d)`; from `opacity: 0;
  transform: translateY(22px); filter: blur(8px)`.
- Word split (`splitWords`): each word wrapped in `.w-wrap` (overflow hidden, `aria-hidden`) with
  `.w` from `translateY(112%)` to 0, `.75s var(--spring-snappy)`, delay `calc(var(--d) + var(--i) *
  var(--step, 45ms))`; the element keeps the full text in `aria-label`. Steps: page H1 `--d:120ms;
  --step:55ms`, chapter H2 `60ms/50ms`, story H3 `60ms/28ms`, statement `14ms`, hero H1 `90ms/55ms`,
  hero sub `300ms/40ms`.
- Stagger ladder: lists 70ms per item (features, scale figures, endpoints), 90ms (explore rows,
  tiles, mood labels), 140ms (devices), 55ms (setlist rows), 45ms (file tree), 60ms (nav links),
  50ms (menu). Typical base delays 80–420ms; total entrance under ~800ms.
- Other entrances: heat cells `scale(.2)→1` with delay `200ms + (col + row * 2.5) * 22ms` (diagonal
  wave); mood labels `clip-path: inset(0 100% 0 0)` → open, `.9s ease-out`, `700ms + i*90ms`; rows
  `translateX(-10px)` → 0; screencast frame scrubbed from `scale(.86) translateY(60px) opacity 0`.

### 4.4 Drawing lines and paths

- Hairline draw: `::before` 1px line, `transform: scaleX(0)` → `scaleX(1)`, `transform-origin: left`,
  `.9s var(--ease-out)`, staggered with the row.
- Path draw: give the SVG element `pathLength="1"`, `stroke-dasharray: 1; stroke-dashoffset: 1` →
  `0`. Works for lines, curves, polylines, check marks. Reverse direction with a negative offset.
- Progress via custom property: `stroke-dashoffset: var(--route)` written per frame as `1 - p`.
- Playhead reveal: duplicate the "lit" geometry inside a `clipPath` whose rect `width` follows the
  playhead; the dim copy stays underneath (MixViz).
- Moving marker along a path: `path.getPointAtLength(t * path.getTotalLength())` (Trace dot).

### 4.5 Scramble / decode text (`scripts/motion/scramble.ts`)

- Glyphs `ABCDEFGHJKLMNPRSTUVWXYZ0123456789#/<>_` (no I/O/Q), spaces preserved.
- Settles left to right: `settled = floor(len * progress)`, the rest re-randomised every frame.
- Default 520ms; used at 320ms (copy pill), 360ms (mood name), 380ms (stage name), 420ms (preset
  names), 480ms (track title), 1100ms (top genre on first view at threshold .6).
- One running scramble per element (`WeakMap` cancel); reduced motion writes the final text at once.
- Reserve width on the target (`min-width: 12ch`) so the random glyphs do not reflow.

### 4.6 Count-up (`lib/counter.ts`, `scripts/architecture/counters.ts`)

`countAt(target, p) = target * (1 - (1 - p)^3)` (ease-out cubic), 1600ms, starts when the element
is 60% visible, formatted `toLocaleString("en-US")`, compact mode `12.3K` for approximate figures.
SSR prints the final value; JS resets to 0 only when motion is allowed; cleanup writes the final value.

### 4.7 Physics springs for data (`stepSpring` in `eq-math.ts`)

```ts
force = (target - value) * stiffness - velocity * damping;
velocity += force * dt; value += velocity * dt;   // semi-implicit Euler, dt clamped to 50 ms
```

Defaults 170/18; EQ 120/14; genre mini-EQ 140/15; analysis readout `90 + (i % 7) * 8` / 13 (each
value gets a different stiffness so the panel settles in a ripple, not in lockstep). Targets change
on data change; the loop never restarts the animation, it re-targets. On first visibility values
start from 60% (figures) or 0 (bars) so the first view animates in.

### 4.8 Exponential smoothing

`x += (target - x) * (1 - exp(-dt * k))` with k = 7 (queue chips, mood weights, region alpha) or 8
(auto-scroll). Frame-rate independent; used for positions and opacities that follow a moving target.

### 4.9 Auto-cycle, manual hold, progress line

Pattern shared by EQ, genre wheel, analysis readout, moods:

- `DWELL` per item (2.8 s EQ, 3.4 s wheel, 4.6 s analysis, 2.6 s moods) advances to the next item.
- Any user input (chip click, node hover, pointer over the plane) selects that item and sets
  `manualUntil = clock + MANUAL_HOLD` (9–10 s); auto-advance resumes after the hold.
- A 1px progress hairline shows `elapsed / DWELL` or the remaining hold; the trail label shows
  `previous → current → next` (or `manual`).

### 4.10 Scripted loops (phase tables)

Visuals that tell a process use a clock modulo a cycle and a phase table, with `onFirstVisible`
resetting the clock so the story always starts from the beginning when first seen:

- Federation: `[0 descriptor, 1.4 signed, 2.5 approved, 3.7 grant, 4.9 relay, 7.7 done]`, period
  9.2 s; packets moved with ease-in-out cubic; the phase is exposed as `data-phase` and CSS does
  the rest (`.fed[data-phase="approved"] .edge-club-lit { stroke-dashoffset: 0 }`).
- Health: 0.3 s per row, 0.7 s settle, 4.2 s hold. Release: stage durations `[3, 1.4, 2.6, 3, 1.8]`
  + 2.6 s hold. Governor: 11 s period with a gaussian load spike.
- Typing rates: 38 chars/s (terminal command), 14 lines/s (response), 16 lines/s (JSON sidecar),
  60 chars/s (sequence steps), 70 chars/s (probe path); caret only while typing.
- Every DOM write is skipped when the formatted value has not changed (`shown[i] !== text`).

### 4.11 Scroll-linked

- Sticky containers, never GSAP pin; `html, body { overflow-x: clip }` (never `hidden`, it breaks
  sticky).
- GSAP ScrollTrigger scrub for: trace route drawing (`start: "top top", end: "bottom bottom"`),
  deep-dive phases (`start: "top 62%", end: "bottom 62%"`, phase eased toward target by 12% per
  frame), screencast frame scale-in.
- Lenis smooth scroll (`lerp: .1`) only with a fine pointer and no reduced motion; ticker lag
  smoothing disabled while active and restored after.

### 4.12 Micro-interactions

- Underline link: `::after` 1px cyan-hi, `scaleX(0)` with `transform-origin: right`, hover
  `scaleX(1)` with origin `left`, `.45s ease-snap`.
- CTA: hover `scale(.975)` (spring), border to cyan-hi .55, `box-shadow: inset 0 2px 10px
  rgba(0,0,0,.35), 0 0 0 6px rgba(6,182,212,.06)`; active `scale(.95)` in .08s.
- Chip press `scale(.95)`; brand hover `scale(1.04)`; explore row label `translateX(12px)` and arrow
  from `translateX(-10px); opacity: 0`.
- Halo pulse on completion: scale .6–.7 → 1.6–2.4 with opacity 1 → 0, `.9–1s ease-out` (retriggered
  by toggling the class).

### 4.13 Reduced motion contract

- CSS: entrances become a .3s linear opacity fade with no delay; words are not transformed; chip
  and CTA transforms removed; staggered CSS animations disabled (`animation: none; opacity: 1`).
- JS: every view checks `reducedMotion()` first and either returns early (SSR markup already shows
  the final state) or renders the final state synchronously (EQ springs set to target, progress
  `scaleX(1)`, mix frozen at the −3 dB midpoint showing `0.71`, federation at `done`, trace routes
  fully drawn, all dive steps active). Interaction still works; only the interpolation is gone.
- No Lenis, no WebGL hero (static logo image instead), no scrub choreography.

### 4.14 Lifecycle

- `mountOnPage(selector, init)`: init on `astro:page-load` when the selector exists, cleanup on
  `astro:before-swap`.
- Each `init` returns a cleanup that disconnects observers, aborts listeners (`AbortController`),
  cancels rAF and restores the final static state (e.g. health rows to their final result, sidecar
  highlight removed, terminal command fully written).

---

## 5. Layout recipes

### 5.1 Page skeleton

`PageHeader` (eyebrow, display H1 max 11ch, lede max 36ch, chapter TOC of mono `01 Title` links) →
`Chapter`s (`<section aria-labelledby>`, head grid 5fr/7fr: eyebrow + H2 + optional status badge on
the left, lede on the right, `align-items: end`, `scroll-margin-top: 40px`) → chapter body: viz
bands, VizSplits and `FeatureList`s (rows 5fr/7fr: display H3 + inline status badge | body with
optional `→` link, hairline drawn per row).

### 5.2 VizSplit (sticky split)

```css
.viz-split { display: grid; grid-template-columns: minmax(0,5fr) minmax(0,7fr);
             gap: 48px clamp(28px,5vw,88px); }
.visual-left { grid-template-columns: minmax(0,7fr) minmax(0,5fr); }
.visual-left .viz-split-visual { order: -1; }
.sticky .viz-split-text { align-self: start; padding: 6vh 0; }
.sticky .viz-split-pin { position: sticky; top: max(12vh, 96px); }
.viz-split-text .features li { grid-template-columns: 1fr; gap: 10px; }   /* rows stack inside */
@media (max-width: 760px) { /* one column, visual first, not sticky */ }
```

Text column scrolls past a pinned visual. `sticky={false}` when the visual is taller than the text
(setlist ticket).

### 5.3 Full-width band

`.viz-band { margin: 0 0 9vh }`, `.viz-band.gap { margin-top: 12vh }` inside the 1320px chapter
container; the panel spans the full container width and the related `FeatureList` follows it.
Used when the visual is wide or dense (EQ, mix, heatmap, health, sidecar, release, wheel, queues).

### 5.4 Scrollytelling

- Trace: outer height `steps * 70svh + 100svh`, sticky stage `100svh` with the map flexing to fill
  and step cards stacked absolutely, crossfading (`opacity` .45s ease-snap, `translateY(14px)` .6s
  spring-smooth). Applied only when JS adds `.is-live`; otherwise a static grid of steps.
- Deep dive: two columns, visual sticky `100dvh` (min 560px) in the 7fr column, steps `min-height:
  72vh` each in the 5fr column; inactive step cards at `opacity: .32`. Mobile: visual `54svh` on top,
  cards `80svh` apart rendered as bordered cards (`radius 16px`, `rgba(10,10,15,.9)`).

### 5.5 Responsive rules

- 1000px: two-column panels (wheel + side panel, readouts) collapse to one; tile grid 4 → 2.
- 900/860px: rails go vertical, sidecar stacks, gauges 5 → 2 columns.
- 760px: everything single column, visual before text, secondary labels hidden (child genre labels,
  orbit sub-labels, scan descriptions), chip rows scroll horizontally, font sizes step down to
  9–10px mono, menu becomes a full-screen dialog.

---

## 6. Accessibility

- Each `<figure>` carries an `aria-label` that states the content as a sentence with the real numbers
  ("17 health checks. 4 fix on their own, 13 ask for confirmation first."). Decorative SVG, canvas
  and duplicated labels are `aria-hidden="true"` (an e2e test fails if any canvas is exposed).
- Interactive parts are real `<button>`s with `aria-pressed`, grouped with `role="group"` and a label;
  readouts are `aria-live="polite"`; hovering a node selects the same state a button would.
- Focus ring: `outline: 2px solid var(--cyan-hi); outline-offset: 3px` (4px on the CTA, `-2px` on
  edge-to-edge tiles); tested for nav links and the CTA.
- Skip link first in tab order; mobile menu is `role="dialog" aria-modal="true"` with focus trap,
  Escape to close and focus restore.
- Touch: 44px minimum targets (`min-height: 44px` on menu buttons and feature links; `.u-link::before`
  expands the hit area to 44px on coarse pointers; tested).
- Split text keeps an `aria-label` with the full sentence; the word spans are hidden.
- Contrast: informative text never below fg-3 (4.96:1). Colour is never the only signal: states also
  change text (`fixed`/`waiting`), shape (filled vs ring dot, dashed vs solid chip) or a meter count.
- Gaps on the site: no `forced-colors` or `prefers-contrast` handling, decorative zone captions at
  2.47:1; the product should add a `forced-colors` pass for chips, dots and meters.

---

## 7. Performance techniques

- One lazy chunk per visual: `scripts/viz/index.ts` maps `data-viz` names to dynamic imports, an
  IntersectionObserver with `rootMargin: "60% 0px"` loads a chunk shortly before it scrolls in and
  marks the root `data-viz-ready`. The page budget (`< 120 KB` gzip JS, `check-budget.mjs 122880`)
  counts only statically imported scripts, so visuals cost nothing until needed.
- `visibleLoop(element, frame)`: rAF runs only while the element intersects (`rootMargin: 10% 0px`,
  `0px` for heavy canvases on mobile) and the document is visible; `dt` is clamped to 50 ms; first
  visibility can reset the story clock.
- CSS-only loops are gated by a `.is-playing` class toggled by an observer (`[data-playing]`), so
  infinite CSS animations stop off-screen.
- Per-frame writes go to `transform`, `opacity` or a custom property consumed by `transform`
  (`--v`, `--g`, `--p`, `--fill`); text nodes are rewritten only when the formatted string changes;
  class toggles are cached per element.
- SSR computes all layout from data (wheel coordinates, edge paths, heat levels, JSON lines); the
  client only animates. `ResizeObserver` rebuilds width-dependent SVG (EQ, mix), rounded to integer
  pixels to avoid rebuild loops.
- Renderer choice: HTML/CSS grid for regular cells and bars (168-cell heatmap, gauges); SVG for up to
  a few hundred marks that need crisp text and CSS state (61-node wheel, EQ, mix, federation,
  orbit); Canvas 2D for ~1K soft points with additive blending (moods: 190 points + 620 dust desktop,
  90 + 260 mobile, pre-rendered radial sprites, `globalCompositeOperation: "lighter"`, DPR capped
  at 2); WebGL2 only for 12K–40K points (hero, bliss dives), lazily created, context loss handled,
  skipped on reduced motion with a static fallback.
- Listeners via `AbortController`; observers disconnected on cleanup; WebGL resources released.

---

## 8. Translating to the product

The product is React 19 + Tailwind 4 with `@crate/ui`; the site is static Astro. The recipes carry
over with these adaptations:

1. Tokens. The v3 token commit already mirrors colours, fonts, `--ease-snap`, `--ease-out-expo`,
   `--ease-dramatic`, `--ease-spring-snappy`, `--ease-spring-smooth`, `text-label` 11px, tracking
   ladder, `--radius-panel` 14px and the `#0d0e14` card. Still missing as tokens: the cyan alpha
   ladders (.04–.28 fills, .28–.6 borders), the amber .06/.35/.45 status pair, the active-node
   surface `#0b1d24`, the eyebrow (11.5px / .16em) and the numeral tiers (XL 800 / .85 / -.05em up
   to ~8.4rem).
2. Primitive drift to fix: `StatNumber` is 700 / `leading-none` / `-.04em` with a max of `text-5xl`;
   the site's big numerals are 800 / .85 / -.05em up to `clamp(…, 8.4rem)` and mid numerals 700 /
   -.03em. `HairlineRow` uses 10px vertical padding (site 9px, fine). `CratePill` is 6px in Listen
   by policy while the site chip is a 999px pill (open decision in the v3 spec).
3. Panel shell as a shared primitive (top rule + `viz-bar` with two `MonoLabel`s), plus `Chip`,
   `Meter` (track + limit tick + over state), `Legend`, `Readout` (aria-live, reserved width),
   `StatusBadge` (amber coming-soon and neutral optional-LLM). They are used by both apps, so they
   qualify for `@crate/ui`. Single-app visuals (genre wheel if only Admin uses it) stay in the app.
4. Animation hooks (one each, refs not state): `useVisibleLoop(ref, frame)` with `frame` held in a
   ref so effect deps are `[ref]` only; `useReveal` (one shared IntersectionObserver); `useScramble`;
   `useCountUp`. Never `setState` per frame; write to element style/custom properties through refs.
   This also satisfies the SSE rule: stream updates change spring targets in a ref, the loop
   interpolates, and no per-frame value enters an effect dependency array.
5. Data-driven, not demo loops. The site replays scripted stories because it has no live data. In the
   product the same visuals must render the real current state on first paint (from the warmed
   snapshot or read plane), animate only real transitions (springs re-targeted when data changes,
   path draws when a new edge appears, count-up only on first view), and drive "process" visuals
   (health scan, queues, enrichment, imports) from real task progress events. Auto-cycling is a
   marketing device; in the product it should be limited to idle/empty states or removed.
6. Charts. Repo rule: charts use Nivo. The site's instrument visuals (wheel, EQ curve, crossfade,
   orbit, rails) are bespoke SVG, not chart types. Proposed split: Nivo, themed with these tokens
   (hairline grids, mono axis labels, cyan-hi series, `#0d0e14` tooltips), for standard charts in
   Stats/Insights (heatmap, bars, lines); hand-built SVG for instruments. Needs Diego's confirmation.
7. Admin vs Listen conventions: Admin keeps `lucide-react` icons and `sonner`; Listen keeps
   `@crate/ui/icons` and `notify`. The site uses no icon set; its "icons" are typographic (`→`, `·`,
   CSS dots and triangles), which avoids the split for most of these recipes.
8. Spacing: the site's macro rhythm is in `vh` for long scrolling pages. App screens are dense and
   live in a shell; keep the micro rhythm (22px top rule padding, 9px rows, 8px chip gaps, 12–28px
   header gaps) and translate macro `vh` gaps to fixed steps.
9. Fonts on native (Capacitor) and the Listen pill-radius policy are already open questions in the
   v3 spec.

## 9. Open questions

- Nivo vs bespoke SVG: is the "charts use Nivo" rule limited to standard chart types, so instrument
  visuals (genre wheel, EQ curve, crossfade, orbit) can be hand-built SVG?
- Auto-cycling in the product: keep for idle states, or show only real state with user-driven
  selection?
- Relation types: the website design doc says five, the visual and backend have four
  (`parent`, `related`, `influenced_by`, `fusion_of`). Which copy is right for the product?
- Should `StatNumber` gain an XL tier (800, lh .85, -.05em) and switch the large tiers to weight 800
  to match the site?
- `forced-colors` support for chips, dots and meters (absent on the site).
