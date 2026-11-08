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

## How to forget Spotify. Building Crate from the ground.

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

Series entries also declare their reading order:

```yaml
series:
  id: how-to-forget-spotify
  title: "How to forget Spotify. Building Crate from the ground."
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
The navigator starts at the first milestone linked to the current post, and “Continue reading” returns to
the article. Maintain each milestone's `href` in `app/web/src/data/engineering-timeline.ts` when adding a
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
