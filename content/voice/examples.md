# Voice examples

Good and bad examples for each format, with the reason. Facts in the good examples are real and checkable:
`AGENTS.md` (library size), `app/web/src/i18n/en.ts` (Radio, Smart Mix copy) and
`docs/technical/smart-mix-design.md` (planning budgets).

## Blog paragraphs

**Good**

1. "The production server holds roughly 900 artists, 4,400 albums and 48K tracks. That number decides most of the
   architecture: no request is allowed to count, sum or average over the tracks table."
   _Why:_ a real number, then the consequence.
2. "Smart Mix plans every transition on the server and the phone only plays the plan. That split exists because
   the server has the analysis and the phone has the clock."
   _Why:_ explains a decision in two sentences.
3. "This post covers what we built, what it costs per request and what we would change. The code is in
   `app/crate/smart_mix/planner.py`."
   _Why:_ sets expectations and points at the source.
4. "Radio picks the next track by how it sounds. The seed is a 20-number bliss vector; sound, artists, genre, BPM,
   energy, Camelot key and era each get a weight."
   _Why:_ precise, matches the product, no adjectives.
5. "It isn't finished. Jams stays behind a feature flag until it is, and we haven't promised a date."
   _Why:_ honest status in the project's own words.

**Bad**

1. "Crate is a blazing fast, next-gen music experience." _Why:_ banned words, no information.
2. "We leveraged cutting-edge AI to supercharge your listening." _Why:_ banned words; which model, doing what?
3. "Crate's revolutionary architecture scales infinitely." _Why:_ unverifiable and false.
4. "As everyone knows, streaming is dead." _Why:_ lazy claim; the manifesto argues with numbers.
5. "Stay tuned for something huge!" _Why:_ empty teaser, fake urgency.

## Instagram captions

**Good**

1. "A transition planned for each pair of tracks. Beatmatched, loudness-matched, bass swapped at the midpoint.
   Planned on your server, played on Android. Smart Mix, in Crate 3."
   _Why:_ the first line works alone; facts from the product.
2. "Your server, drawn live. Every container, the requests reaching it and the devices playing right now. Stack
   map, in Crate Admin."
   _Why:_ short, concrete, names the feature and where it lives.
3. "Library health: fixes the safe problems, asks about the rest. Duplicates, orphans and stale files, checked for
   you."
   _Why:_ reuses approved website copy.
4. "Crate 3.1.3 is out. What changed, in 30 seconds. Full notes: link in bio."
   _Why:_ plain release post, no hype.
5. "Own your music. Support your artists. Refuse the middleman. Crate is free and open source. Install it on your
   own server."
   _Why:_ the brand line, used once, with a concrete next step.

**Bad**

1. "OMG this update is INSANE" _Why:_ hype, caps, no information.
2. "Comment CRATE and we'll DM you the link!" _Why:_ engagement bait.
3. "The Spotify killer is here." _Why:_ banned phrase and the wrong framing.
4. "AI-powered mixing that just works, like magic." _Why:_ three banned terms, nothing checkable.
5. A caption that shows a Jams screen with "Now available". _Why:_ Jams is in development.

## Reddit posts

**Good**

1. Title: "I built a self-hosted music server that plans DJ transitions on the server (AGPL, OpenSubsonic
   compatible)". Body opens with "I'm the developer of Crate.", then what it does, what it doesn't do yet, how to
   install and what feedback I'm looking for.
   _Why:_ disclosure, honest scope, a real ask.
2. A comment answering "how is this different from Navidrome?" with two concrete differences, one thing Navidrome
   does better and a link to the docs.
   _Why:_ respectful, specific, credits the other project.
3. In r/Beatmatch: "How Smart Mix decides when to swap the bass, with the numbers", explaining the 1–12 s window and
   the ±4% tempo limit, with no install link unless the subreddit allows it.
   _Why:_ useful to the community first.
4. Answering a bug report in public: "You're right, that's a bug. Issue #NNN, fix in the next release."
   _Why:_ honest and traceable.
5. Crossposting a blog post only where `subreddits.yaml` allows links, with a summary that stands on its own.
   _Why:_ the post is useful even without the click.

**Bad**

1. Posting the same release announcement to ten subreddits on the same day. _Why:_ spam.
2. "Check out this amazing new app I found!" from the developer's account. _Why:_ hidden affiliation.
3. Replying to every Plex thread with a Crate link. _Why:_ self-promotion without contribution.
4. Asking friends to upvote. _Why:_ vote manipulation, against Reddit's rules.
5. A post that reads like a press release. _Why:_ Reddit punishes marketing tone.
