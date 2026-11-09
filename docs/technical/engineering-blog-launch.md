# Engineering blog: first publication

Plan reviewed on 9 November 2026. The blog launches with every written post at once: the 34 chapters
of _How to dismantle Spotify. Building Crate from the ground._ and eight technical articles. The
launch date is Tuesday, 10 November 2026 (`LAUNCH_DATE` in `app/web/src/data/blog-calendar.ts`).

This replaces the earlier plan of five launch posts followed by one post a week. A reader can start
the series at chapter 1 and read it to the end, or go straight to a technical article.

## What launches

| Group | Posts |
| --- | --- |
| Series | Parts 1–34, from "Crate started as a librarian" to "Giving Smart Mix a sense of musical structure" |
| Database and read path | "Serving hot screens from snapshots, not queries" |
| Library | "Building an artist page when the providers disagree" |
| Smart Mix | "Planning DJ transitions on the server, playing them on a phone", "A beat grid in two bytes per beat", "Finding the one: where every bar starts", "Lyrics as labels: calibrating a voice detector without listening" |
| Operations | "Observing a home server without a monitoring team", "Reading production errors in Admin without trusting what they say" |

Seven posts carry interactive figures built on the shared figure kit (H11, H12, H17, H19, H31, H34
and T01); see "Interactive figures" in [the guide](engineering-blog.md).

## Dates

Every launch post has the launch date. A post's `date` records when it became public, so the
launch posts share it rather than inventing earlier publication dates. The series' chronology is
in each chapter's opening line, which names the period it covers, and in the Signal Track, which
orders the milestones by their real dates. The homepage lists the chapters in part order. Standalone
articles and the RSS feed follow the calendar order when dates are equal.

## What controls publication

`publishedPosts()` filters on `draft`; a date never delays visibility. Merging and deploying the
reviewed change publishes every post at once, whatever the day. Proposed articles in the
[editorial roadmap](engineering-blog-roadmap.md) keep provisional Tuesday dates after the launch and
are published one at a time: write the post, set its `date` and calendar status, review, merge and
deploy.

## Before release

1. Editorial: commit pins that GitHub knows, prose consistent with each rebuilt figure, the
   article limits in the roadmap, and the reviewed proposals for repeated openings and endings.
2. Source viewer: the build snapshots every file the posts link. Snapshots must stay small enough
   for the site image, and the build must fail rather than bake an unavailable preview.
3. CI on [PR #362](https://github.com/thecrateapp/crate/pull/362): Frontend Tests (Vitest, build,
   budget, Playwright) and Native Tool Tests.
4. Validate the production build: 42 article pages and 42 RSS items, no links to missing routes,
   working source links, diagrams and figures, on desktop and at 390 px.

## Review branch and release

PR #362 targets `main` from `feat/engineering_blog`. This worktree uses
`feat/blog-error-inbox-post`, whose history contains the PR branch, so the reviewed commit can
advance that head without a force push. Checks must run against the revised PR head; an earlier
green result does not validate later work.

Release follows the repository process: merge, wait for "Build & Push Docker Images" on the merge
SHA, then `make deploy-preflight VERSION=<sha>` and `make deploy VERSION=<sha>`. After the deploy,
check `https://cratemusic.app/blog`, the RSS feed and a source preview. Merging and deploying are
release decisions taken explicitly; this preparation does neither.
