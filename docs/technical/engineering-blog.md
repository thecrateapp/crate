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

## Calendar

One post a week, on Tuesdays. Every calendar entry has a slug, a title, the problem the post solves, a date, a
status (`planned`, `drafting`, `review`, `published`) and the repository paths it is based on.
`blog-calendar.test.ts` checks that dates fall on Tuesdays in order, that every source path exists, that every
post is in the calendar and that published entries match their post's date.

Releases can add posts. When a Crate or Crate Decks release contains something worth explaining from an
engineering point of view, add an entry for it. It can take the next Tuesday slot and push the rest back a week.
Release notes stay in `docs/releases/`; a release post explains one engineering change in depth, not the whole
release.

## What a post looks like

- **Length:** 800 to 1,300 words. The calendar test fails above 1,400.
- **Shape:** the problem, with a concrete symptom or number; the constraints; what Crate does now; what it cost
  or what is still open; where the code is. Headings name what each section contains.
- **Tone:** technical and easy to read. Short paragraphs, plain words, one idea per paragraph. Write for an
  engineer who doesn't know Crate.
- **Code:** real excerpts, trimmed to the lines that matter, with the file named in the text. Never invent an API.
- **Diagrams:** when the idea has moving parts, draw it (below).
- **Honesty:** say what isn't measured, what is eventually consistent and what the design costs.

## Frontmatter

```yaml
---
title: "Serving hot screens from snapshots, not queries" # up to 90 characters
description: "One or two sentences, up to 160 characters."
date: 2026-11-10 # the publication Tuesday, same as the calendar
tags: [read plane, Go, PostgreSQL]
sources: # repository paths, linked at the end of the post
  - app/readplane/internal/routes/server.go
draft: false # true keeps it out of production builds; it still shows with `npm run dev`
---
```

## Facts

Every number, limit, name and behaviour must come from the repository: code, `docs/technical/`, `AGENTS.md` or
release notes. Check figures against `origin/main` before publishing, since they change (the production library
was 48K tracks in early 2026 and is roughly 138K now). If a measurement doesn't exist, say so instead of
estimating it.

## Humanizer pass (required)

Every text goes through the `/humanizer:humanizer` skill before review: posts, calendar problems and any copy on
the blog pages. It removes the patterns that make text read as machine-written (not-X-but-Y contrasts, one-line
closers, forced groups of three, dashes everywhere, bold labels, inflated claims). It changes prose only, never
code, paths, frontmatter or link targets, and it must not add or drop facts.

## Code blocks

Code blocks use [Expressive Code](https://expressive-code.com) with Crate's theme
(`app/web/src/lib/code-theme.json`). Excerpts from the repository say where they come from:

````md
```go source="app/readplane/internal/routes/server.go#L424-L439" commit="<40-character commit>" "s.tryFallback(w, r)"
...the exact lines 424 to 439 of that file at that commit...
```
````

- `source` is the repository path with an optional `#L<start>` or `#L<start>-L<end>` range. The block shows the
  path as its title, the file's real line numbers and a "GitHub · L424–439" link in its header.
- `commit` is required with `source`: the full 40-character SHA the excerpt was copied from, so the link keeps
  pointing at the same lines after `main` moves on (`git rev-parse origin/main`). The build fails without it.
- Copy the lines exactly and contiguously. If a fragment needs trimming, use a shorter range rather than editing
  lines out, so the numbers stay true.
- Highlight what matters with text markers (`"tryFallback"`) or line markers (`{3-5}`, counted from the first
  line of the block).
- Shell commands use `sh` with a `title` and render as a terminal. Show commands, not invented output.
- `blog-calendar.test.ts` checks that every `source` path exists.

## Diagrams

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
