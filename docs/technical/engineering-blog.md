# Engineering blog

The blog at `cratemusic.app/blog` explains how Crate is built. Each post takes one engineering problem Crate ran
into and shows how it was solved, with the real code. It lives in the website (`app/web`) and is published by
merging a pull request.

## Where things are

| Path                                 | What it is                                             |
| ------------------------------------ | ------------------------------------------------------ |
| `app/web/src/content/blog/<slug>.md` | One post. The file name is the URL slug                |
| `app/web/public/blog/<slug>/`        | Diagrams and other assets for that post                |
| `app/web/src/data/blog-calendar.ts`  | The calendar: one entry per post, planned or published |
| `app/web/src/pages/blog/`            | Index, post page and `rss.xml`                         |
| `app/web/src/lib/blog.ts`            | Sorting, drafts, reading time, source links            |

## Local preview

Astro dev, build, sync/check and Vitest use separate Vite dependency caches. Astro's temporary
content-sync server also gets its own cache, including during a dev restart. Keep these paths
separate: overwriting the live dev cache changes dependency hashes and can make GSAP and Lenis
requests fail with `504 Outdated Optimize Dep` while the page still serves its HTML and CSS.

Page controllers mount at DOM readiness as well as through Astro's navigation events, once per
page, and clean up before a swap. Blog header content stays readable if those scripts fail.
`e2e/blog-header.spec.ts` covers a lost initial Astro event, navigation, mobile layouts and blocked
motion scripts; checking only that a heading is present does not detect this failure.

## Calendar

The blog launches with every written post on one date, `LAUNCH_DATE` in `app/web/src/data/blog-calendar.ts`:
the 34 chapters of the series and the technical articles. A post's `date` records when it went public, so
the launch posts share it. The series' chronology lives in each chapter's opening line ("Part 17.
Connecting separate Listen players in May and June 2026.") and in the Signal Track, never in backdated
publication dates. After the launch, new articles take Tuesday slots.

Every calendar entry has a slug, a title, the problem the post solves, a date, a status (`planned`,
`drafting`, `review`, `published`) and the repository paths it is based on. `blog-calendar.test.ts` checks
that published entries share the launch date (a Tuesday), that every written post is published, that
proposed entries fall on later Tuesdays in order, that every source path exists, that every post is in the
calendar and that published entries match their post's date.

Releases can add posts. When a Crate or Crate Decks release contains something worth explaining from an
engineering point of view, add an entry for it. It can take the next Tuesday slot and push the rest back a week.
Release notes stay in `docs/releases/`; a release post explains one engineering change in depth, not the whole
release.

## What a post looks like

Write posts in English for an engineer who doesn't know Crate. Let the engineering problem determine the
length and structure. There is no word limit or fixed number of sections. Give a decision enough room
to explain how it works, why it was made and how it behaved in use.

Ground the article in a concrete problem from Crate's development. Use plain words and specific evidence,
with real code excerpts and diagrams where they help the reader follow the mechanism. Name the files the
code comes from; never invent an API. Describe the constraints and costs of the design, including failures,
unmeasured claims and work that remains open. A historical account should distinguish what existed at the
time from what Crate does now.

## Voice

The revised opening three chapters are the voice reference for future posts (approved 8 November 2026).
Use this voice across the blog, including standalone articles, while keeping the structure that suits each topic.

Write as a Crate engineer explaining the work to another engineer. Start with what the application did,
why that caused trouble and how we changed it. Use "we" for implementation choices we can establish from
the code. Let the code, workers, database and browser be the subjects when explaining how they behave.
Varying the subject is more natural than beginning every paragraph with "we".

The repository research supports the article; readers need the engineering story. Keep commit hashes,
line ranges and source verification in the code headers and links. Use dates or versions when they help
locate a design or explain a dependency. An exact commit time rarely helps explain a database lock.
Avoid narrating the research with phrases such as "recorded development", "the repository records",
"its stated purpose" or "the snapshot establishes".

For example, replace "At 01:24, a commit introduced a gate whose stated purpose was to prevent SQLite
locks" with "We first kept library sync and analytics from running together. If one was already running,
the worker put the other back into the pending queue." Explain the gate's limits in the next paragraph.

Keep the paragraphs that already explain a mechanism clearly. Editing for voice should preserve technical
depth and concrete failures. Describe a limitation through its consequence: a watcher could bypass the
task gate, or the player could show a failed play attempt as playing. Repeated reminders about what the
repository does or does not prove interrupt that explanation.

First person does not license invented memories. Do not add late-night debugging scenes, emotions,
conversations, user reports, motivations or measurements that the evidence does not support. Present-day
comparisons can explain how another system handles a problem without claiming we evaluated it at the time.

## How to dismantle Spotify. Building Crate from the ground.

The series was renamed from "How to forget Spotify" during editorial review. Its internal
`how-to-forget-spotify` identifier stays stable for grouping and timeline selection. Use the new title
and the "How to dismantle Spotify" topic label in visible copy; the topic URL is
`/blog/tags/how-to-dismantle-spotify`.

This series follows the problems Crate had to solve as it became a music platform. New entries should follow
this progression, with headings and section lengths chosen for the particular problem:

1. Identify the problem. Show the starting state and the failure, limitation or unmet need that made a change
   necessary. Make the consequences concrete for someone using or operating Crate.
2. Investigate solutions. Explain relevant approaches used elsewhere and how Crate handled the problem.
   Compare the mechanisms and their constraints using cited evidence. Distinguish alternatives considered at
   the time from comparisons made now while researching the article.
3. Explain the implementation. Follow the engineering decisions through the code, data and runtime behaviour.
   Use diagrams and relevant source excerpts to explain the parts that determine the outcome, including
   failure handling and tests where they matter.
4. Show the before and after. Return to the original problem and state what changed, what evidence supports
   the result and what remains unresolved. Use measurements when they exist; otherwise describe the changed
   behaviour precisely without inventing performance gains.

This is a preferred narrative progression, not a requirement for four headings. An investigation may need
several sections, and an implementation may need more space than the rest of the article. Existing posts
linked from the series keep their own structure; do not rewrite them just to fit this progression.

Review each draft alongside its neighbouring chapters as well as on its own. Compare their openings,
section rhythm, placement of evidence and endings so that a series does not repeat one structure with
different subjects. The [editorial variety inventory](engineering-blog-editorial-variety.md) records the
review of all 34 historical chapters, the revisions already applied and the next candidates. It is a
working plan, not another article template.

## Frontmatter

```yaml
---
title: "Serving hot screens from snapshots, not queries" # up to 90 characters
description: "One or two sentences, up to 160 characters."
date: 2026-11-10 # the publication date, same as the calendar (LAUNCH_DATE for launch posts)
tags: [read plane, Go, PostgreSQL]
sources: # repository paths, linked at the end of the post
  - app/readplane/internal/routes/server.go
draft: false # true keeps it out of production builds; it still shows with `npm run dev`
---
```

Series entries also declare their reading order:

```yaml
series:
  id: how-to-forget-spotify
  title: "How to dismantle Spotify. Building Crate from the ground."
  part: 2
related: [reads-from-snapshots, a-beat-grid-in-a-few-bytes]
```

The footer links to the previous and next available parts in the same series. Standalone posts use
publication order. Related reading appears beside the article on desktop and below it on smaller screens.
The optional `related` list names post slugs in editorial order; shared tags supply further matches, up to
three articles. The current post and its previous/next neighbours are excluded. Drafts can appear in the
development preview, but never in production navigation or recommendations. These links are rendered from
the content collection at build time and require no browser JavaScript.

The `how-to-forget-spotify` series also includes the Signal Track history navigator between its header and
article. Readers open it through “Explore the series”; linking to `#series-timeline` opens it directly.
A direct visit starts at the first milestone linked to the current post. Links from the navigator carry
`?milestone=<id>` so the destination keeps the selected event when several milestones share an article.
The client accepts that ID only when it belongs to the visible current article. “Continue reading” retains
the same context and returns to the prose. The link displays the destination’s actual title and series part. Maintain each milestone's `href` in `app/web/src/data/engineering-timeline.ts` when adding a
chapter. Rendered links and draft labels are resolved against the content collection: the complete history
remains visible, while posts absent from the build have no article link.

## Facts

Every claim about Crate must come from the repository: code, `docs/technical/`, `AGENTS.md` or release notes.
Check figures against `origin/main` before publishing, since they change (the production library
was 48K tracks in early 2026 and is roughly 138K now). Use performance figures only with enough context
to explain how they were measured. If the article has no measurement to support a speed claim, describe
the changed work or behaviour instead. An old commit message's timing figures can be omitted when they
would add an unsupported benchmark and a paragraph of caveats.

For comparisons with other systems, cite primary sources such as their documentation, source code or papers.
State the version or period the comparison describes. Present-day research must not imply that Crate's author
evaluated those alternatives during the historical decision unless there is evidence of that evaluation.

## Humanizer pass (required)

Every text goes through the `/humanizer:humanizer` skill before review: posts, calendar problems and any copy on
the blog pages. It removes the patterns that make text read as machine-written (not-X-but-Y contrasts, one-line
closers, forced groups of three, dashes everywhere, bold labels, inflated claims). It changes prose only, never
code, paths, frontmatter or link targets. It must preserve every fact and technical limit, including uncertainty,
tradeoffs and unfinished work. Check the revised prose against the sources before review.

Review the article's point of view before polishing individual sentences. Read the result aloud as an
engineer explaining a change: does it follow the problem and the implementation, or keep reporting what
was found in a repository? Revise the latter even if it contains none of the usual AI vocabulary.

## Code blocks

Code blocks use [Expressive Code](https://expressive-code.com) with Crate's theme
(`app/web/src/lib/code-theme.json`). Excerpts from the repository say where they come from:

````md
```go source="app/readplane/internal/routes/server.go#L424-L439" commit="<40-character commit>" "s.tryFallback(w, r)"
...the exact lines 424 to 439 of that file at that commit...
```
````

- `source` is the repository path with a `#L<start>` or `#L<start>-L<end>` range. The block shows the
  path as its title, the file's real line numbers and a "GitHub · L424–439" link in its header.
- `commit` is required with `source`: the full 40-character SHA the excerpt was copied from, so the link keeps
  pointing at the same lines after `main` moves on (`git rev-parse <revision>`). The build fails without it.
- Copy the lines exactly and contiguously. If a fragment needs trimming, use a shorter range rather than editing
  lines out, so the numbers stay true.
- Highlight what matters with text markers (`"tryFallback"`) or line markers (`{3-5}`, counted from the first
  line of the block).
- Shell commands use `sh` with a `title` and render as a terminal. Show commands, not invented output.
- `blog-calendar.test.ts` checks that every repository excerpt has `source` and full-commit metadata with
  a valid line range. Source files do not have to exist at `HEAD`.

Historical excerpts use the same `source` and `commit` metadata, even when the file has since moved or been
deleted. Use its path at that revision and verify the contiguous excerpt against `git show <commit>:<path>`.
This preserves the numbered block and source link used throughout the blog. The `sources` frontmatter still
lists paths that exist in the current repository.

## Links

External references in post prose use a leading arrow icon and an amber accent. GitHub links use a leading
GitHub mark and the existing cyan link colour. Keep them inline so long references can wrap with the text.
Internal article links and local diagrams retain the normal link style. The renderer applies this to
Markdown links automatically; authors do not add icons or HTML to the post. Source links in code headers,
the article's source list and the timeline also use the GitHub mark. Link destinations and whether they
open a new tab remain explicit authoring choices.

### File previews

GitHub `blob` links in prose, code headers and the source list open a large source viewer. Keep
writing ordinary Markdown links with the original destination. Without JavaScript, or with a
modified click to open a new tab, they still go to GitHub. Repository, directory, commit and issue
links retain their usual behaviour.

The viewer loads the complete file from a same-origin snapshot when opened. It shows the resolved
commit, scrolls to `#Lx-Ly` ranges and highlights them. Markdown has document and numbered source
views; heading anchors open the matching section. Copy uses the original text, optionally limited
to the referenced lines. Raw HTML in Markdown is disabled, relative links retain the same commit,
and embedded images become links.

Snapshots are generated by `/blog/source/[id].json.ts` for the files referenced by visible posts.
Historical commits are read from Git; an exported or shallow checkout can fetch the same immutable
object from GitHub. A missing historical file never falls back to its current version. `main` in
the source list resolves to `BLOG_SOURCE_COMMIT` or the local checkout's `HEAD`, with that resolution
shown in the viewer. The site Docker build receives `BLOG_SOURCE_COMMIT` from the workflow's merge
SHA. Other branches and tags resolve to a full SHA through Git's HTTP ref protocol, not the
rate-limited REST API, and the build warns that the link moves; pin such links to a commit. An
abbreviated SHA needs a local checkout, or `BLOG_SOURCE_GITHUB_TOKEN` for an authenticated API call.

A production build loads every referenced file before writing snapshots, at most six GitHub
requests at a time. Network errors, timeouts, 429 and 5xx responses are retried with backoff. If
a file still cannot be loaded, the build fails and lists every broken link; it never ships an
"unavailable" snapshot. `BLOG_SOURCE_NO_GIT=1 BLOG_SOURCE_COMMIT=$(git rev-parse HEAD) npm run
build` reproduces the Docker build, which has no Git history and reads everything from GitHub.

For another repository available locally, set `BLOG_SOURCE_REPOSITORIES` to a JSON object mapping
its GitHub name to an absolute checkout path, for example
`{"thecrateapp/crate-decks":"/path/to/crate-decks"}`. The loader checks the checkout's `origin`
before resolving the revision or reading its blob. This can preserve access to an exact historical
document that is no longer available from GitHub; it never substitutes a working-tree file.

Binary files and files over 1 MB retain an explicit GitHub fallback. Syntax highlighting runs on
the server, but a snapshot stores the text once: `styles` lists theme classes and each `runs` entry
encodes one line as `<letter><length>` runs over those classes. The viewer rebuilds the numbered
markup when a file opens. `GitHubFilePreview.astro` emits the class rules from `code-theme.json`.
The browser downloads a snapshot only when needed.

## Topics

The existing `tags` frontmatter supplies header chips and `/blog/tags/<tag>` indexes. `/blog/tags`
lists available topics and counts. The chips use the shared `FilterChip` geometry and typography,
rendered as native links in Astro. They work without JavaScript and do not need a CMS.

Topic grouping ignores case and repeated whitespace, preserves authored labels, and gives
punctuation distinct addresses so names such as C, C++ and C# cannot collide. Both the directory
and topic indexes follow the blog's visibility rules: drafts appear in development only. Tags
used exclusively by drafts do not produce production pages.

## Diagrams

### Interactive figures

Articles can use a server-rendered Astro figure at a marker in their Markdown:

```html
<div data-blog-visual="connect"></div>
```

Declare `visuals: [connect]` in frontmatter. The post page supplies the named component to
`BlogProse.astro`, which inserts it at the marker before sending HTML. Missing and duplicate markers fail
rendering. This keeps the figure in the passage that explains it and provides a complete static view
without JavaScript. Register future figure names in the content schema and post renderer.

A figure shows one mechanism in motion and still reads as a single frame. It follows the visual language
of the site's own visualizations: the home page "Inside Crate" mix, Admin's enrichment orbit and Listen's
federation graph. Every figure has the same five parts, in order:

1. A label bar: a cyan label, a mono context, a version switch when the article describes a
   transformation, and an `Example` tag when the sequence or values are illustrative.
2. One SVG scene at full width, with HTML labels positioned over it. Names and constants come from
   the code the article cites.
3. Three or four readouts in display type. Amber marks the failure and cyan the fix.
4. Three or four numbered phases, each a short title and one sentence.
5. A one-line caption with the provenance.

The prose explains; the figure shows. Figures have no heading of their own, no Play, Step or Reset
buttons, no scrubber and no paragraph of caveats.

`BlogFigure.astro` supplies the frame. `scripts/viz/blog/phase-loop.ts` runs it through the site's viz
registry (`data-viz`, `scripts/viz/index.ts`): the figure loops while visible, a click on a phase pins it
and a second click resumes, and the switch restarts the selected version. Reduced motion shows the end of
each version without looping. Without JavaScript the server-rendered frame and every phase remain
readable, and Astro navigation disposes the loop. Each figure contributes a pure model with tests, a
scene component and a render function. The `crate-blog-figures` skill
(`.agents/skills/crate-blog-figures/SKILL.md`) is the step-by-step recipe.

| Figure | Article | What it shows |
| --- | --- | --- |
| `connect` (`ConnectHandoff`) | H17 | v1 starts the desktop before the phone stops; v2 applies the queue silently, commits ownership, then resumes and pauses. |
| `crossfade` (`CrossfadeEngine`) | H19 | UI timer, PCM envelope and shared bus over one six-second transition; gain formulas from the Android code before and after `e08714d4`. |
| `workers` (`WorkersAdmission`) | H12 | The resource governor at `09da2273` defers the next repair and holds the next analysis batch while playback keeps its own slot; nothing already admitted is interrupted. |
| `enrichment` (`EnrichmentJourney`) | T01 | Six providers with their own cache lifetimes, a pool of three fetchers, a failed provider whose missing value does not erase stored data, and a locked field that the write keeps. |
| `smart-mix` (`SmartMixCandidates`) | H34 | The v2 default plan, the v3 menu up to its first choice, and v3 without structure; clash and omitted music recomputed from the exported planner fixture. |
| `music-paths` (`MusicPathJourney`) | H11 | The anchor-first builder (`f602d82d`) on three regression fixtures: destination and song family reserved before the middle, empty steps left visible. |
| `radio-rotation` (`RadioRotation`) | H31 | Ranked candidates, the 0.05 quality band and three memories (buffer, session cooldown, significant listening at `924b7fb6`). |

Every figure is built on the kit. Figures that replay Python output read their JSON on the server and send
the browser only what the render function needs:

- H34: `src/data/blog-smart-mix-fixture.json`, from `python3 tools/smart-mix-eval/export_blog_fixture.py`.
- H11: `src/data/blog-music-path-fixture.json`, from `python3 app/web/scripts/export_music_path_fixture.py`.
- H31: `src/data/blog-radio-fixture.json`, from `python3 app/web/scripts/export_radio_fixture.py`.

Each exporter runs pinned Python code on declared inputs and accepts `--check` to verify the committed
JSON without rewriting it. The browser never ranks, plans or queries the library.

### Static diagrams

- SVG files in `app/web/public/blog/<slug>/`, referenced from Markdown with alt text that explains the diagram:
  `![What the diagram shows](/blog/<slug>/name.svg)`.
- Same visual grammar as Crate Admin's StackMap: background `#0a0a0f`, panels `#0d0e14`, 1 px lines, the active
  path in `#67e8f9`, JetBrains Mono labels in upper case, and line patterns instead of colours to tell kinds of
  edges apart (solid for requests, `9 4` dashes for asynchronous data, `1 5` dots for notifications).
- A `viewBox` 1200 units wide, with text at 13 px or more so it stays readable at the post's width. Include
  `<title>` and `<desc>` inside the SVG.

## Workflow

1. Pick the next calendar entry, set it to `drafting`, read its sources.
2. Write the post and its diagrams. Run the humanizer pass.
3. Preview with `npm --prefix app/web run dev` (drafts show locally).
4. Set the post's `date` and the calendar entry to `published`, open a pull request and ask Diego for review.
   Merging publishes it.

```bash
npm --prefix app/web run dev
npm --prefix app/web run build
npm --prefix app/web test -- src/lib/blog.test.ts src/data/blog-calendar.test.ts
```
