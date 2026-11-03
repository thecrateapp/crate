# content

Source material for Crate's public communication: the blog, Instagram and Reddit.

| Path                     | What it is                                                            |
| ------------------------ | --------------------------------------------------------------------- |
| `voice/voice.md`         | How Crate sounds in public, the rules and the AI policy               |
| `voice/glossary.yaml`    | Canonical names and banned words                                      |
| `voice/positioning.md`   | What Crate is, audiences, messages and pillars (draft until approved) |
| `voice/examples.md`      | Good and bad examples per format, with the reason                     |
| `voice/hashtags.yaml`    | Instagram hashtags; only `approved` ones are used                     |
| `reddit/subreddits.yaml` | Target subreddits and their rules, copied by hand with a review date  |
| `social/<id>/`           | One content package per release or piece (created by the pipeline)    |

Nothing here is published automatically. Diego approves every post; Reddit posts are made by hand.

Validate with:

```bash
npm --prefix tools/marketing run check:content
npm --prefix tools/marketing test
```

Operations and account setup: `docs/technical/marketing-pipeline.md`.
