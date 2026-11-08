# Engineering blog: first publication

Plan reviewed on 8 November 2026. The first release contains the opening chapter of
_How to forget Spotify. Building Crate from the ground._ and four standalone articles.
The proposed launch date is Tuesday, 10 November. The development preview includes all
ten written posts so their reading order and links can be reviewed together.

## First release and follow-ups

| Proposed date | Article                                                           | Place in the blog                       |
| ------------- | ----------------------------------------------------------------- | --------------------------------------- |
| 10 November   | Crate started as a librarian                                      | Series, part 1; the main starting point |
| 10 November   | Serving hot screens from snapshots, not queries                   | Database and read-path implementation   |
| 10 November   | Planning DJ transitions on the server, playing them on a phone    | Smart Mix implementation                |
| 10 November   | A beat grid in two bytes per beat                                 | Audio data representation               |
| 10 November   | Observing a home server without a monitoring team                 | Operating Crate                         |
| 17 November   | When the filesystem stopped being the catalogue                   | Series, part 2                          |
| 17 November   | Reading production errors in Admin without trusting what they say | Follow-up to observability              |
| 24 November   | Taking playback over from Navidrome                               | Series, part 3                          |
| 1 December    | Finding the one: where every bar starts                           | Smart Mix 3 beat and downbeat analysis  |
| 8 December    | Lyrics as labels: calibrating a voice detector without listening  | Smart Mix 3 voice analysis              |

The launch batch gives a new reader both the beginning of the story and examples of the
platform it became. After launch, the series advances one chapter a week. The error-inbox
article shares the second week's slot because it continues an already available operations
article. The two Smart Mix 3 articles then take consecutive weeks.

The remaining calendar entries are writing plans. _Twenty numbers that describe how a
track sounds_ has moved from 24 November to 15 December, leaving the completed playback
chapter in the November slot. _Never count the whole library during a request_ follows on
5 January, _Music Paths_ on 12 January and federation on 19 January. The later planned
articles move with that queue; the 22 and 29 December holiday break remains clear.

## Reading paths

The homepage gives the historical series its own heading, a starting link and chapters in
part order. The Signal Track lets a reader choose a development milestone and follow an
available article. Planned milestones remain visible without links to missing posts.

Standalone articles stay in a separate section, newest first. They can be read without
starting the series. Three useful paths through the available and forthcoming material are:

- Building the catalogue, then serving its busiest screens from snapshots.
- Planning a transition, storing its beat grid, finding bar boundaries, then identifying
  voices within those boundaries.
- Observing the server, then bringing production errors into Admin.

The `related` metadata supplies editorial connections; shared tags add further matches.
The current post and its previous/next neighbours are excluded from related reading.
Links to later instalments become available when those articles enter the production
collection. Their proposed dates alone do not make them available.

## What controls publication

`publishedPosts()` filters on `draft`. It does not compare a post's date with the clock.
The calendar's `status` field is an editorial record and also does not control visibility.
The homepage, article routes, related posts and RSS use the same visibility rule.

The local worktree now prepares exactly five production-eligible launch articles. Chapter
1 has `draft: false`; the four standalone launch articles keep their existing eligibility.
The other five posts have `draft: true`. The error-inbox article is now a draft with calendar
status `review`, holding it for the proposed 17 November slot.

Chapter 1 also remains `review` in the calendar while being included in the production
build under review. Editorial review status and production eligibility are separate. Dates
are displayed publication metadata, so the proposed launch still requires a deliberate
release; reaching 10 November will not publish or rebuild anything automatically.

Promoting an article means setting `draft: false`, confirming its publication date and
calendar status, then building and deploying the reviewed change. Each weekly promotion
needs a new build. There is no scheduled publishing job.

Chapter 1's closing mention of the next chapter is now plain text. Its original Markdown
link bypassed the visibility-aware footer and would have led to a missing page in the
launch build. Both timeline milestones that link to chapter 1 are marked available. The
six diagrams used by the launch articles are present locally; the other four launch
articles contain no body links to unpublished articles.

## Review branch and checks

[PR #362](https://github.com/thecrateapp/crate/pull/362) targets `main` from
`feat/engineering_blog`. This worktree uses `feat/blog-error-inbox-post`; its history
contains the PR branch, so the reviewed commit can advance that head without a force push.
Keep this work on the existing PR, with its title and description covering the homepage,
series navigation, reviewed articles and first-release visibility.

Validate the actual production build: five launch article pages and five RSS items, one
visible series chapter, no links to draft article routes, and working source links and
diagrams. Also exercise the full ten-post development preview on desktop and mobile,
including the timeline, chapter links, related reading and previous/next footer. Checks
must run against the revised PR head; an earlier green result does not validate later work.

Publication is a separate release decision. This preparation does not merge the PR or
deploy the site. A merge before the proposed launch date would still include all five
production-eligible posts because dates do not delay their visibility.
