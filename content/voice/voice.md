# Crate voice

This is how Crate sounds in public: the blog, Instagram, Reddit and every text the content pipeline drafts.
Agents load it through the `crate-voice` skill. Diego approves every published word.

The source of the voice is what Crate already says about itself: the manifesto
(`app/web/src/content/manifesto/en.md`) and the website copy (`app/web/src/i18n/en.ts`).

## Who is speaking

Crate speaks as a small, opinionated project built in the open by a developer who runs it for his own community.
First person singular ("I") on Reddit and in personal blog posts by Diego. "We" only for the project and its
contributors. Never a faceless company voice, never "the Crate team is thrilled".

## Tone

- **Direct.** Say the thing in the first sentence. "Crate is not a streaming service." Not "In today's landscape of
  music consumption...".
- **Factual.** Concrete numbers, named components, real limits. "48K tracks, p95 under 50 ms" beats "blazing fast".
- **Opinionated, not loud.** Crate has a position (own your music, support artists, refuse the middleman). State it
  plainly once; don't shout it in every post.
- **Honest about limits.** Say what isn't done, what is behind a flag and what needs a paid licence (VirtualDJ Pro).
  The website already does this ("Neither is released yet, and neither is promised a date.").
- **Warm about music.** The project exists because music matters. Specific artists, records and scenes are welcome;
  generic "your favourite tunes" is not.

## Rules

1. **No hype words.** See `glossary.yaml` (`banned`). No superlatives without a number behind them.
2. **No emojis.** Not in posts, captions, titles or alt text. Same rule as the UI.
3. **No clickbait.** A title says what the post contains.
4. **Every claim is checkable.** Numbers, features and behaviour must be traceable to the repo, the docs or a release
   note. The `crate-fact-check` skill blocks anything it can't verify.
5. **Name things correctly.** Use the canonical terms in `glossary.yaml`.
6. **Status words are exact.** Use the website's statuses: Available, Available (opt-in), In development, Planned.
   Never present something in development as available.
7. **Credit people and projects.** Mixxx, bliss, Navidrome and others are named with respect and linked. Crate Decks
   is "based on Mixxx", always.
8. **No manipulation.** No fake urgency, no engagement bait ("comment YES"), no vote requests, no sock puppets.

## AI policy

Agents research, draft, edit, storyboard and fact-check. A person decides and publishes:

- Diego approves every blog post, caption and Reddit draft before it is public.
- On Reddit, Diego posts personally, identifies himself and writes or rewrites the final text in his own words.
- No AI-generated images or video of the product. Product visuals are real captures of a real Crate instance
  (with the licensed demo library) or diagrams.
- Crate's own AI features (MCP, Smart Mix 3) are described like any other feature: what they do, what is opt-in,
  what leaves the server.

## Positions (decided by Diego, 2026-11-03)

The manifesto says piracy of catalogues the labels hold is self-defence, as long as the money goes to artists. That
is part of Crate's identity and the manifesto stays as it is. Social channels have their own rules, though:
Instagram's community guidelines and several target subreddits forbid promoting or discussing piracy.

The rule:

- Blog and website: the manifesto is linked and quoted freely.
- Instagram and Reddit: talk about owning your files and paying artists directly; link the manifesto; do not
  encourage piracy or show acquisition from P2P sources in posts or reels.
- Respect each subreddit's rules on piracy, as recorded in `content/reddit/subreddits.yaml`.

## Format conventions

| Thing    | Convention                                                                             |
| -------- | -------------------------------------------------------------------------------------- |
| Language | English (US spelling in product text, as on the website)                               |
| Numbers  | Digits with units and thin context: "48K tracks", "1.2 TB", "p95 under 50 ms", "±6 dB" |
| Versions | `v3.1.3` in code style in the blog; "3.1.3" in captions                                |
| Code     | Real snippets with their repo path; never invented APIs                                |
| Links    | Repo files link to `github.com/thecrateapp/crate/blob/main/...`                        |
| Headings | Sentence case                                                                          |
| Lists    | Short; prefer prose in the blog                                                        |

## Reddit disclosure

Every Reddit post or comment that mentions Crate starts or ends with a plain disclosure, for example:

> I'm the developer of Crate.

## Format lengths

| Format                | Length                                                   |
| --------------------- | -------------------------------------------------------- |
| Blog engineering post | 1,500–3,000 words                                        |
| Blog release post     | 300–800 words                                            |
| Instagram caption     | ≤ 1,200 characters; first line stands on its own         |
| Instagram alt text    | 1–3 sentences describing what is on screen               |
| Reel on-screen labels | ≤ 6 words each                                           |
| Reddit post           | As long as it needs to be useful; no marketing paragraph |
