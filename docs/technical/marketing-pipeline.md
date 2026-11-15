# Marketing pipeline

How Crate's public communication is produced and published: the blog on cratemusic.app, Instagram and Reddit.
The design and the phased plan live outside the repo (`docs/plans/2026-11-03-crate-marketing-*.md`); this page is
the operational reference.

## Principles

- Every public word is approved by Diego. No agent publishes anything.
- The blog is published by merging a pull request. Instagram is published by `publish-content.yml` behind the
  `content` environment's manual approval. Reddit is posted by hand.
- Product visuals are real captures of a Crate instance running the licensed demo library. Nothing from a private
  library appears in public material (see the rights audit, M0.PR2).
- Rendered video never goes into git. It lives in workflow artifacts and in Postiz's media library.

## Content sources

| Source                           | Used for                                         |
| -------------------------------- | ------------------------------------------------ |
| `content/voice/`                 | Voice, glossary, positioning, examples, hashtags |
| `content/reddit/subreddits.yaml` | Rules per subreddit, copied by hand              |
| `docs/releases/vX.Y.Z.md`        | Release briefs                                   |
| `docs/technical/` and the code   | Engineering posts and fact-checking              |

Validate the content files:

```bash
npm --prefix tools/marketing ci
npm --prefix tools/marketing run check:content
npm --prefix tools/marketing test
```

## Rights audit

```bash
npm --prefix tools/marketing run audit:screencasts
```

Writes contact sheets and `report.md` to `tools/marketing/out/audit/` (ignored by git), covering every MP4 in
`app/web/public/screencast` and `app/web/public/film`, plus the soundtracks declared in
`app/web/src/content/films.ts`. Needs `ffmpeg` and `ffprobe`.

## Account setup (M0.3)

These steps are done by Diego. They are listed here so they can be repeated.

### Instagram

1. Create the account (`@cratemusic` or the closest available handle) and switch it to a **Business** account.
2. Create a Facebook Page for Crate and link it to the Instagram account.
3. Create a Meta app (developers.facebook.com) in development mode, with Diego as an administrator. Add the
   Instagram product. Postiz documents which login flow and permissions it expects (Instagram with Facebook Login
   or Instagram Login); follow Postiz's provider guide for the version you deploy.
4. If Meta asks for Page Publishing Authorization, complete it before connecting Postiz.

### Reddit

1. Diego's personal account, or a project account that Diego runs himself. Never shared with automation.
2. Create `r/cratemusic`: description, rules, a "Release" flair and a wiki page with links to the website, docs,
   GitHub and the manifesto.
3. Read each target subreddit's rules and copy them into `content/reddit/subreddits.yaml`, setting
   `status: reviewed` and `reviewed_on`. Re-review every quarter.

Reddit's public API no longer accepts new applications (since 2026-10-31) and RSS stops on 2026-11-13, so there is
no automated posting or monitoring.

### Postiz (self-hosted)

- Deploy Postiz with its official Docker Compose setup (Postiz, PostgreSQL, Redis) as its own stack, on its own
  subdomain with TLS. Follow the version-pinned instructions in Postiz's documentation; do not copy configuration
  from blog posts.
- If it shares a host with Crate, set `cpus` and `mem_limit` on its containers: it processes video on upload.
- Connect Instagram through the Meta app above. Create an API key for CI and store it as the `POSTIZ_API_KEY`
  secret of the GitHub `content` environment.
- Configuration and secrets stay on the Postiz host. Nothing about the deployment is committed here except this
  page.
- The Postiz MCP server may be used from Claude Code to create **drafts only**. Deny any tool that publishes
  immediately in `.claude/settings.json`.

### GitHub

- A Project named "Editorial" with the columns Idea, Draft, Review, Scheduled and Published.
- Labels: `content`, `content:blog`, `content:instagram`, `content:reddit`.
- An environment named `content` with required reviewers (Diego) and the secrets `ANTHROPIC_API_KEY_CONTENT` and
  `POSTIZ_API_KEY`.

## Not built yet

Blog (M1), skills and agents (M2), demo library and video templates (M3), the release pipeline and workflows
(M4) and the monthly report (M5) are described in the plan and land in later pull requests.
