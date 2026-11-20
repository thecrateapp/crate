# Crate Website Implementation Plan

> **Estado (2026-11-18):** Implementado en app/web (cratemusic.app); app/site retirado. Se conserva como histórico.

> **For agents:** REQUIRED SUB-SKILL: Use viterbit:executing-plans to implement this plan task-by-task.

**Goal:** Build `app/web`, the multi-page Astro site for cratemusic.app (A3 · Mark hero, statement, downloads, content pages, manifesto, screencast), and swap it in for `crate-site` without changing the deploy.

**Architecture:** Static Astro site, English first with Astro i18n routing ready for more locales. Motion is framework-free TypeScript (GSAP + ScrollTrigger + Lenis + a small WebGL2 point renderer ported from `app/web/prototypes/field.js`). React islands are added only when a section needs component state; none of the phases below need one. The image keeps the name `crate-site`, so `make deploy` and the release manifest do not change.

**Tech Stack:** Astro 5 (content layer `glob` loader, `i18n` config), TypeScript, Vitest + jsdom, Playwright, GSAP 3.13, Lenis 1.x, nginx:alpine, Python 3.13 + numpy for the offline export, Remotion for the screencast edit.

**Source of truth for decisions:** `docs/plans/2026-10-13-website-design.md`. Do not re-open decisions recorded there.

**Reference implementation:** `app/web/prototypes/a3-mark.html`, `field.js`, `hero.js`, `shared.css`. Port behaviour and values from these files; do not ship the prototypes.

**Repo rules that apply:** AGENTS.md "If you touch it, you test it"; conventional commits, no attribution footers; never write to the library from the API (the export is an offline read-only script); deploy is image-first; do not commit without Diego's go-ahead when executing interactively.

---

## Phase 1 — Scaffold `app/web`

### Task 1.1: Create the Astro project

**Files:**
- Create: `app/web/package.json`
- Create: `app/web/astro.config.mjs`
- Create: `app/web/tsconfig.json`
- Create: `app/web/.gitignore`

**Step 1: Write `app/web/package.json`**

```json
{
  "name": "crate-web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "astro dev --port 5176 --host",
    "build": "astro check && astro build",
    "preview": "astro preview --port 5176",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "budget": "node scripts/check-budget.mjs dist 122880"
  },
  "dependencies": {
    "astro": "^5.0.0",
    "gsap": "^3.13.0",
    "lenis": "^1.1.13"
  },
  "devDependencies": {
    "@astrojs/check": "^0.9.0",
    "@fontsource/jetbrains-mono": "^5.0.0",
    "@playwright/test": "^1.48.0",
    "jsdom": "^25.0.0",
    "typescript": "^5.9.0",
    "vitest": "^3.0.0"
  }
}
```

Use the latest compatible minors at execution time and commit the lockfile. If a newer Astro major is current, stay on `^5` unless the content-layer and i18n APIs used below are unchanged.

**Step 2: Write `app/web/astro.config.mjs`**

```js
import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://cratemusic.app",
  trailingSlash: "never",
  build: { format: "file" },
  i18n: {
    defaultLocale: "en",
    locales: ["en"],
    routing: { prefixDefaultLocale: false },
  },
  vite: {
    resolve: {
      alias: { "@shared": fileURLToPath(new URL("../shared", import.meta.url)) },
    },
  },
});
```

**Step 3: Write `app/web/tsconfig.json`**

```json
{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "src/**/*", "e2e/**/*", "scripts/**/*"],
  "exclude": ["dist", "prototypes"]
}
```

**Step 4: Write `app/web/.gitignore`**

```
node_modules/
dist/
.astro/
test-results/
playwright-report/
```

**Step 5: Install and verify**

Run: `npm install --prefix app/web && npm run --prefix app/web build`
Expected: the build reports no pages. That is fine until Task 1.4.

**Step 6: Commit**

```bash
git add app/web/package.json app/web/package-lock.json app/web/astro.config.mjs app/web/tsconfig.json app/web/.gitignore
git commit -m "chore(web): scaffold Astro project for the new site"
```

### Task 1.2: Design tokens, fonts and base styles

**Files:**
- Create: `app/web/public/fonts/cabinet-grotesk-500.woff2`, `-700.woff2`, `-800.woff2`
- Create: `app/web/public/fonts/LICENSE-cabinet-grotesk.txt`
- Create: `app/web/src/styles/tokens.css`
- Create: `app/web/src/styles/base.css`

**Step 1: Self-host Cabinet Grotesk**

Download the 500/700/800 woff2 files from fontshare.com (Cabinet Grotesk, ITF Free Font License) into `app/web/public/fonts/`. Save the licence text next to them. Do not hotlink `api.fontshare.com` in production.

**Step 2: Write `src/styles/tokens.css`**

Copy the `:root` block from `app/web/prototypes/shared.css` verbatim (colours, `--display`, `--sans`, `--mono`, `--spring-snappy`, `--spring-smooth`, `--ease-*`). Load fonts locally:

```css
@import "@shared/fonts/poppins.css";
@import "@fontsource/jetbrains-mono/400.css";

@font-face {
  font-family: "Cabinet Grotesk";
  src: url("/fonts/cabinet-grotesk-800.woff2") format("woff2");
  font-weight: 800;
  font-display: swap;
}
/* repeat for 700 and 500 */
```

**Step 3: Write `src/styles/base.css`**

Port these blocks from `prototypes/shared.css`: `html, body` (keep `overflow-x: clip`, never `hidden`, which breaks sticky), grain `body::after`, `::selection`, `.nav*` including `.nav::before`, `.eyebrow`, `.display`, `.sub`, `.w-wrap`/`.w`/`.is-in .w`, `[data-enter]`, `@keyframes enter-up`, `.cta*`, `.statement*`, `.explore*`, `.screencast`/`.frame`, the mobile media query and the reduced-motion block. Drop `.proto-tag`.

**Step 4: Verify**

Run: `grep -n "overflow-x" app/web/src/styles/base.css`
Expected: one line, `overflow-x: clip;`

**Step 5: Commit**

```bash
git add app/web/public/fonts app/web/src/styles
git commit -m "feat(web): add design tokens, self-hosted fonts and base styles"
```

### Task 1.3: i18n dictionary and helper

**Files:**
- Create: `app/web/src/i18n/en.ts`
- Create: `app/web/src/i18n/index.ts`
- Create: `app/web/vitest.config.ts`
- Test: `app/web/src/i18n/index.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { locales, t } from "./index";

describe("t", () => {
  it("returns the English string for a known key", () => {
    expect(t("hero.title")).toBe("Crate is not a streaming service.");
  });

  it("falls back to English for an unknown locale", () => {
    expect(t("hero.subline", "xx")).toBe("It's a tool for revolution.");
  });

  it("interpolates named values", () => {
    expect(t("hero.caption", "en", { tracks: "48,213" })).toBe("48,213 tracks · one library");
  });

  it("exposes English as the only shipped locale", () => {
    expect(locales).toEqual(["en"]);
  });
});
```

**Step 2: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "jsdom", include: ["src/**/*.test.ts", "scripts/**/*.test.ts"] },
});
```

**Step 3: Run test to verify it fails**

Run: `npm test --prefix app/web`
Expected: FAIL, cannot resolve `./index`.

**Step 4: Implement**

`src/i18n/en.ts`:

```ts
export const en = {
  "nav.listen": "Listen",
  "nav.admin": "Admin",
  "nav.architecture": "Architecture",
  "nav.developers": "Developers",
  "nav.docs": "Docs",
  "nav.github": "GitHub",
  "hero.eyebrow": "Free / open source / self hosted",
  "hero.title": "Crate is not a streaming service.",
  "hero.subline": "It's a tool for revolution.",
  "hero.caption": "{tracks} tracks · one library",
  "cta.copy": "Copy",
  "cta.copied": "Copied",
  "cta.copyLabel": "Copy the install command",
  "statement.1":
    'Crate is free, open-source software for taking music back from streaming platforms and returning it to the people who give it meaning: fans and artists. <span class="hl">No subscriptions. No algorithms.</span>',
  "statement.2":
    "Install it in your server. Bring your files. Tell your friends. Start a community and break with the system.",
  "statement.3": 'Own your music. Support your artists. <span class="hl">Refuse the middleman.</span>',
  "get.title": "Get Crate",
  "get.server": "Server",
  "get.requirements": "Linux x86_64 with Docker. 4 cores and 8 GB RAM recommended.",
  "get.clients": "Apps",
  "get.ios": "On iPhone, open your server in Safari and add it to the Home Screen.",
  "explore.listen": "Player, radio, paths, offline",
  "explore.admin": "Library health, enrichment, analysis",
  "explore.architecture": "Workers, read plane, events",
  "explore.developers": "APIs, tokens, contributing",
  "footer.manifesto": "Read the manifesto",
  "footer.license": "AGPL-3.0",
} as const;

export type MessageKey = keyof typeof en;
```

`src/i18n/index.ts`:

```ts
import { en, type MessageKey } from "./en";

const dictionaries: Record<string, Record<MessageKey, string>> = { en };

export const locales = Object.keys(dictionaries);

export function t(key: MessageKey, locale = "en", values: Record<string, string> = {}): string {
  const message = (dictionaries[locale] ?? en)[key] ?? en[key];
  return message.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? `{${name}}`);
}
```

**Step 5: Run tests**

Run: `npm test --prefix app/web`
Expected: 4 passed.

**Step 6: Commit**

```bash
git add app/web/src/i18n app/web/vitest.config.ts
git commit -m "feat(web): add typed English dictionary with locale fallback"
```

### Task 1.4: Base layout, nav and footer

**Files:**
- Create: `app/web/src/layouts/Base.astro`
- Create: `app/web/src/components/Nav.astro`
- Create: `app/web/src/components/Footer.astro`
- Create: `app/web/src/pages/index.astro` (placeholder)
- Copy: `app/site/public/icons/*` → `app/web/public/icons/`

**Step 1: `Base.astro`**

Props: `title`, `description`, `locale = "en"`. Renders `<html lang={locale}>`, meta description, OG tags (`og:title`, `og:description`, `og:url` from `Astro.url`), favicon, imports `../styles/tokens.css` and `../styles/base.css`, a skip link to `#main`, `<Nav/>`, `<main id="main"><slot/></main>`, `<Footer/>`, and `<ClientRouter />` from `astro:transitions`.

**Step 2: `Nav.astro`**

Static version of `mountNav()` in `prototypes/hero.js`: brand link to `/`, links `/listen`, `/admin`, `/architecture`, `/developers`, `https://docs.cratemusic.app`, `https://github.com/thecrateapp/crate`. Labels from `t()`, `style="--i:N"` for the stagger.

**Step 3: `Footer.astro`**

Links: `/why` ("Read the manifesto"), GitHub, Docs, `AGPL-3.0` (to the repo `LICENSE`).

**Step 4: Placeholder page** `pages/index.astro`: `<Base title="Crate" description="..."><h1>Crate</h1></Base>`.

**Step 5: Verify**

Run: `npm run --prefix app/web build && ls app/web/dist`
Expected: `index.html`; `astro check` reports 0 errors.

**Step 6: Commit**

```bash
git add app/web/src/layouts app/web/src/components app/web/src/pages app/web/public/icons
git commit -m "feat(web): add base layout with nav, footer and view transitions"
```

### Task 1.5: Docker image and nginx

**Files:**
- Create: `app/web/Dockerfile`
- Create: `app/web/nginx.conf`
- Create: `app/web/Dockerfile.dockerignore`

**Step 1: Dockerfile** (build context = repo root, same as `app/site`)

```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS build
WORKDIR /app
COPY app/web/package.json app/web/package-lock.json ./
RUN npm ci
COPY app/web/ .
COPY app/shared/ /shared/
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY install.sh /usr/share/nginx/html/install.sh
COPY app/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

The `@shared` alias resolves to `../shared` from `/app`, i.e. `/shared`.

`Dockerfile.dockerignore`: `**/node_modules`, `app/web/dist`, `app/web/prototypes`.

**Step 2: `nginx.conf`**

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    location /_astro/ { expires 1y; add_header Cache-Control "public, immutable"; }
    location /fonts/  { expires 1y; add_header Cache-Control "public, immutable"; }
    location /data/   { expires 7d; add_header Cache-Control "public"; }
    location = /install.sh { default_type text/x-shellscript; }

    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/javascript application/javascript application/json image/svg+xml application/octet-stream;

    location / { try_files $uri $uri.html $uri/ =404; }
    error_page 404 /404.html;
}
```

**Step 3: Build and smoke the image**

```bash
docker build -f app/web/Dockerfile -t crate-web:local .
docker run --rm -d -p 8091:80 --name crate-web-smoke crate-web:local
curl -s -o /dev/null -w "%{http_code} " http://localhost:8091/
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8091/install.sh
docker rm -f crate-web-smoke
```

Expected: `200 200`

**Step 4: Commit**

```bash
git add app/web/Dockerfile app/web/nginx.conf app/web/Dockerfile.dockerignore
git commit -m "build(web): add nginx image serving the static site and install.sh"
```

### Task 1.6: CI job

**Files:**
- Modify: `.github/workflows/test-frontend.yml` (both `paths` lists, around lines 14 and 34; "Install auxiliary frontend dependencies" around line 64; new step after "Test and build marketing site")

1. Add `"app/web/**"` to both `paths` lists.
2. Add `npm ci --prefix app/web` to the auxiliary install step.
3. Add:

```yaml
      - name: Test and build new site
        run: |
          npm test --prefix app/web
          npm run build --prefix app/web
```

Task 6.1 extends this step with the budget check, Task 6.2 with Playwright.

**Commit**

```bash
git add .github/workflows/test-frontend.yml
git commit -m "ci(web): test and build the new site on frontend changes"
```

---

## Phase 2 — Home page with the A3 · Mark hero

### Task 2.1: Motion utilities

**Files:**
- Create: `app/web/src/scripts/motion/env.ts`
- Create: `app/web/src/scripts/motion/split-words.ts`
- Create: `app/web/src/scripts/motion/scramble.ts`
- Create: `app/web/src/scripts/motion/reveal.ts`
- Create: `app/web/src/scripts/motion/smooth-scroll.ts`
- Test: `app/web/src/scripts/motion/split-words.test.ts`
- Test: `app/web/src/scripts/motion/scramble.test.ts`

**Step 1: Write the failing tests**

```ts
// split-words.test.ts
import { describe, expect, it } from "vitest";
import { splitWords } from "./split-words";

describe("splitWords", () => {
  it("wraps each word in a masked span and keeps the text accessible", () => {
    const p = document.createElement("p");
    p.innerHTML = 'Own your music. <span class="hl">Refuse the middleman.</span>';
    splitWords(p);
    expect(p.getAttribute("aria-label")).toBe("Own your music. Refuse the middleman.");
    expect(p.querySelectorAll(".w").length).toBe(6);
    expect(p.querySelector(".hl .w")?.textContent).toBe("Refuse");
    const order = [...p.querySelectorAll<HTMLElement>(".w")].map((w) => w.style.getPropertyValue("--i"));
    expect(order).toEqual(["0", "1", "2", "3", "4", "5"]);
  });
});
```

```ts
// scramble.test.ts
import { describe, expect, it } from "vitest";
import { scrambleText } from "./scramble";

describe("scrambleText", () => {
  it("writes the final text immediately when motion is reduced", () => {
    const span = document.createElement("span");
    scrambleText(span, "Copied", { reducedMotion: true });
    expect(span.textContent).toBe("Copied");
  });
});
```

**Step 2: Run to verify they fail**

Run: `npm test --prefix app/web`
Expected: FAIL, modules not found.

**Step 3: Implement**

- `env.ts`: `reducedMotion()`, `finePointer()`, `isMobile()` using the same media queries as `prototypes/hero.js`.
- `split-words.ts`: port `splitWords` from `prototypes/hero.js`, typed.
- `scramble.ts`: `scrambleText(element, text, { durationMs = 520, reducedMotion = reducedMotion() } = {})`; when reduced, set `textContent` and return.
- `reveal.ts`: port `initReveals()` (IntersectionObserver, threshold 0.2, rootMargin `0px 0px -8% 0px`, adds `is-in`, unobserves).
- `smooth-scroll.ts`: port `initSmoothScroll()` importing `gsap`, `ScrollTrigger` and `Lenis` from npm; skip Lenis under reduced motion or without a fine pointer.

**Step 4: Run tests** → all pass.

**Step 5: Commit**

```bash
git add app/web/src/scripts/motion
git commit -m "feat(web): port word split, scramble, reveals and smooth scroll"
```

### Task 2.2: Field math and point sources

**Files:**
- Create: `app/web/src/scripts/field/math.ts`
- Create: `app/web/src/scripts/field/sources.ts`
- Test: `app/web/src/scripts/field/math.test.ts`
- Test: `app/web/src/scripts/field/sources.test.ts`

**Step 1: Write the failing tests**

```ts
// math.test.ts
import { describe, expect, it } from "vitest";
import { lookAt, multiply, perspective, project } from "./math";

describe("project", () => {
  it("maps the look-at target to the centre of the viewport", () => {
    const mvp = multiply(perspective(0.85, 1440 / 900, 0.04, 50), lookAt([0, 0, 3], [0, 0, 0]));
    const s = project(mvp, [0, 0, 0], 1440, 900);
    expect(s.x).toBeCloseTo(720, 3);
    expect(s.y).toBeCloseTo(450, 3);
    expect(s.w).toBeGreaterThan(0);
  });
});
```

```ts
// sources.test.ts
import { describe, expect, it } from "vitest";
import { cloudPositions, clusterCenters, decodeCloud, mulberry32 } from "./sources";

describe("cloudPositions", () => {
  it("is deterministic for a given seed", () => {
    const a = cloudPositions(500, clusterCenters(8, 0.9, mulberry32(7)), mulberry32(7));
    const b = cloudPositions(500, clusterCenters(8, 0.9, mulberry32(7)), mulberry32(7));
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(a.positions.length).toBe(1500);
  });
});

describe("decodeCloud", () => {
  it("dequantises int16 xyz triples into the [-scale, scale] range", () => {
    const buffer = new Int16Array([32767, -32767, 0]).buffer;
    expect(Array.from(decodeCloud(buffer, 1.5))).toEqual([1.5, -1.5, 0]);
  });
});
```

**Step 2: Run to verify they fail.**

**Step 3: Implement**

- `math.ts`: port `perspective`, `lookAt`, `multiply` from `prototypes/field.js`; add `project(mvp, point, width, height)` returning `{ x, y, w }`.
- `sources.ts`: port `gaussian`, `clusterCenters`, `cloudPositions`, `sampleImage`, each with an optional `random = Math.random` parameter. Add:

```ts
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function decodeCloud(buffer: ArrayBuffer, scale: number): Float32Array {
  const ints = new Int16Array(buffer);
  const out = new Float32Array(ints.length);
  for (let i = 0; i < ints.length; i++) out[i] = (ints[i] / 32767) * scale;
  return out;
}

export async function loadLibraryCloud(url: string, count: number, scale = 1.5): Promise<Float32Array | null> {
  try {
    const response = await fetch(url, { priority: "low" } as RequestInit);
    if (!response.ok) return null;
    const cloud = decodeCloud(await response.arrayBuffer(), scale);
    return cloud.length >= count * 3 ? cloud.subarray(0, count * 3) : null;
  } catch {
    return null;
  }
}
```

**Step 4: Run tests** → all pass.

**Step 5: Commit**

```bash
git add app/web/src/scripts/field
git commit -m "feat(web): add field projection math and point sources"
```

### Task 2.3: WebGL point renderer

**Files:**
- Create: `app/web/src/scripts/field/renderer.ts`

**Step 1:** Port `createField` from `prototypes/field.js`. Keep the shaders exactly as they are now (per-seed morph stagger, cursor repel radius `0.17` and strength `0.09`, point size capped at `uScale * 2.2`). Add:
- `setPositions(positions: Float32Array)` to re-upload the base buffer when the real library cloud arrives;
- `dispose()` to delete buffers and the program (called on `astro:before-swap` for View Transitions);
- return `null` when `canvas.getContext("webgl2")` is `null`.

Put this line at the top of the file:

```ts
// TEST_GAP: WebGL2 rendering cannot run in jsdom; covered by the Playwright smoke in e2e/home.spec.ts.
```

**Step 2: Verify**

Run: `npm run --prefix app/web build`
Expected: `astro check` passes.

**Step 3: Commit**

```bash
git add app/web/src/scripts/field/renderer.ts
git commit -m "feat(web): port the WebGL2 point field renderer"
```

### Task 2.4: Hero (A3 · Mark)

**Files:**
- Create: `app/web/src/components/InstallCommand.astro`
- Create: `app/web/src/components/Hero.astro`
- Create: `app/web/src/scripts/hero/mark.ts`
- Create: `app/web/src/data/scale.json` (`{"tracks": "48,213", "albums": "4,400"}`; replaced by the generator in Task 5.3)
- Modify: `app/web/src/pages/index.astro`

**Step 1: `InstallCommand.astro`**

Port the `.cta` button from `heroMarkup()` in `prototypes/hero.js`: command text, `Copy` pill, `aria-label={t("cta.copyLabel")}`, and a script that copies `curl -fsSL https://cratemusic.app/install.sh | bash` and scrambles the pill to "Copied" and back after 1.7 s.

**Step 2: `Hero.astro`**

Markup from `prototypes/a3-mark.html`: `<canvas id="field" aria-hidden="true">`, scrim, caption with `t("hero.caption", locale, scale)`, `.hero-pin` > `.hero-sticky` > `.hero-copy` with `h1.display[data-split]`, `p.sub[data-split]`, `<InstallCommand/>`. Add `<img class="mark-static" src="/icons/logo.svg" alt="" width="..." height="...">` placed where the particle mark renders; it is visible by default and hidden by `mark.ts` once WebGL runs. Port the page `<style>` block into the component.

**Step 3: `mark.ts`**

Port the module script of `a3-mark.html`:
- synthetic cloud `cloudPositions(isMobile() ? 12000 : 40000, clusterCenters(16, 1.1))`;
- mark sampled from `/icons/logo.svg`, lifted by `0.62` (`0.55` on mobile);
- `createField`; when it returns `null`, keep `.mark-static` and stop;
- `loadLibraryCloud("/data/library-cloud.bin", count)`; on success, `setPositions` with the real cloud;
- intro morph `0 → 1` over 2.6 s `power3.inOut`, repel on after 2.4 s, caption in at 2.6 s;
- ScrollTrigger on `.hero-pin`: morph back by 45 %, dive from 30 %, copy fade by 35 %;
- field fade to 16 % behind `.statement` and to 0 before `.screencast`;
- render loop paused when `document.hidden` or opacity is 0;
- reduced motion: one frame with `morph = 1`, no ScrollTrigger.

**Step 4: Page**

`pages/index.astro`: `<Base title="Crate — not a streaming service" description="..."><Hero/></Base>`.

**Step 5: Verify (checkpoint with Diego)**

Run: `npm run dev --prefix app/web` and open http://localhost:5176 at 1440×900 next to `prototypes/a3-mark.html`.
Expected: same assembly timing, local cursor hole, dissolve and dive on scroll.

**Step 6: Commit**

```bash
git add app/web/src/components/Hero.astro app/web/src/components/InstallCommand.astro app/web/src/scripts/hero app/web/src/data/scale.json app/web/src/pages/index.astro
git commit -m "feat(web): add the particle mark hero with install command"
```

### Task 2.5: Statement and Explore

**Files:**
- Create: `app/web/src/components/Statement.astro`
- Create: `app/web/src/components/Explore.astro`
- Modify: `app/web/src/pages/index.astro`

1. Port `mountSections()` markup: three `.row[data-reveal]` with `0N` eyebrow and `p[data-split]` filled with `set:html={t("statement.N")}`; Explore with four links to `/listen`, `/admin`, `/architecture`, `/developers`, meta from `t("explore.*")`, arrow.
2. A page script calls `splitWords` on `.statement [data-split]` and `initReveals()`.
3. Verify in the browser: words rise on scroll, row lines draw, hover slides the label and shows the arrow.

Commit: `feat(web): add statement and explore sections to the home page`.

### Task 2.6: Download links and Get Crate

**Files:**
- Create: `app/web/src/lib/downloads.ts`
- Test: `app/web/src/lib/downloads.test.ts`
- Create: `app/web/src/components/GetCrate.astro`
- Modify: `app/web/src/pages/index.astro`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { downloads } from "./downloads";

const base = "https://github.com/thecrateapp/crate/releases/latest/download/";

describe("downloads", () => {
  it("links every desktop and Android build to the unversioned latest alias", () => {
    expect(downloads.map((d) => d.url)).toEqual([
      `${base}Crate-macos-arm64.app.zip`,
      `${base}Crate-macos-intel.app.zip`,
      `${base}crate-windows.exe`,
      `${base}crate-windows.msi`,
      `${base}crate-linux.AppImage`,
      `${base}crate-linux.deb`,
      `${base}crate-linux.rpm`,
      `${base}crate.apk`,
    ]);
  });

  it("groups builds by platform", () => {
    expect(new Set(downloads.map((d) => d.platform))).toEqual(new Set(["macOS", "Windows", "Linux", "Android"]));
  });
});
```

**Step 2: Run to verify it fails.**

**Step 3: Implement**

```ts
const BASE = "https://github.com/thecrateapp/crate/releases/latest/download/";

export interface Download {
  platform: "macOS" | "Windows" | "Linux" | "Android";
  label: string;
  file: string;
  url: string;
}

const entries: Omit<Download, "url">[] = [
  { platform: "macOS", label: "Apple Silicon", file: "Crate-macos-arm64.app.zip" },
  { platform: "macOS", label: "Intel", file: "Crate-macos-intel.app.zip" },
  { platform: "Windows", label: "Installer (.exe)", file: "crate-windows.exe" },
  { platform: "Windows", label: "MSI", file: "crate-windows.msi" },
  { platform: "Linux", label: "AppImage", file: "crate-linux.AppImage" },
  { platform: "Linux", label: ".deb", file: "crate-linux.deb" },
  { platform: "Linux", label: ".rpm", file: "crate-linux.rpm" },
  { platform: "Android", label: "APK", file: "crate.apk" },
];

export const downloads: Download[] = entries.map((entry) => ({ ...entry, url: BASE + entry.file }));
```

**Step 4: `GetCrate.astro`**: server block (`<InstallCommand/>`, `t("get.requirements")`, link to the install docs), apps grouped by platform, iOS line `t("get.ios")`, `data-reveal`.

**Step 5: Run tests** → pass. Desktop aliases resolve only after `chore/stable-release-asset-names` is merged and a release is tagged; that is a launch gate (Task 6.4), not a blocker here.

**Step 6: Commit**

```bash
git add app/web/src/lib app/web/src/components/GetCrate.astro app/web/src/pages/index.astro
git commit -m "feat(web): add Get Crate section with latest-release download links"
```

### Task 2.7: Screencast section shell

**Files:**
- Create: `app/web/src/components/Screencast.astro`
- Modify: `app/web/src/pages/index.astro`

Port the `.screencast` frame (`data-frame`, scrub `scale 0.86 → 1`). Five chapter slots (`01 Library` … `05 Offline`), each a `<video preload="none" muted playsinline>` without `src` until Phase 5, showing `public/screencast/<chapter>.jpg` as poster when present and the play glyph otherwise. Page order: Hero → Statement → Screencast → Get Crate → Explore.

Commit: `feat(web): add screencast section shell`.

---

## Phase 3 — `/why` manifesto

### Task 3.1: Manifesto collection and page

**Files:**
- Create: `app/web/src/content.config.ts`
- Create: `app/web/src/content/manifesto/en.md`
- Create: `app/web/src/pages/why.astro`

**Step 1: `content.config.ts`**

```ts
import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const manifesto = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/manifesto" }),
  schema: z.object({ title: z.string(), description: z.string() }),
});

export const collections = { manifesto };
```

**Step 2: `content/manifesto/en.md`**

Front matter: `title: "The Crate Manifesto"`, one-sentence `description`. Body: the text of `app/site/src/components/Manifesto.tsx`, one paragraph per block, restoring the missing paragraph break before "This is also not a solo project", with these four paragraphs replaced verbatim:

1. Replace the paragraph starting "The system isn't broken" with:
   > The system isn't broken — it's working exactly as designed. Designed to extract value from artists and redistribute it upward. An independent musician needs nearly four hundred thousand streams to earn one month of US minimum wage. Fractions of a cent per play while the platforms hand billions to shareholders. The pro-rata model is a legal scam: your listens subsidize major label hits and executive bonuses.
2. In the paragraph starting "Spotify is the largest extractor", replace everything up to "military AI contracts." with:
   > **Spotify is the largest extractor.** It pays roughly half of what Apple Music pays per stream, and since 2024 it pays no recording royalties at all on any track with fewer than a thousand streams a year. Meanwhile it spent over a billion dollars chasing podcast exclusives, and its founder's investment fund led a €600 million round into Helsing, a military AI and strike-drone company he chairs.
3. Replace the paragraph starting "That's why more and more artists" with:
   > That's why more and more artists are saying **enough**. Deerhoof, Massive Attack, King Gizzard & the Lizard Wizard, Godspeed You! Black Emperor, Xiu Xiu and others have pulled their music from Spotify — not just over the miserable payouts, but because they refuse to let their listeners' money enrich a platform whose founder bankrolls military AI.
4. Replace the paragraph starting "The math is public" with:
   > The math is public. On Bandcamp Friday, thirty fans buying a ten-dollar album put close to two hundred and eighty dollars directly in the artist's hands. To earn the same from Spotify, that artist needs around ninety thousand streams — before the label and the distributor take their cut. The platforms know this math. They're counting on you not doing it.

**Step 3: `why.astro`**

`getEntry("manifesto", "en")` and `render(entry)`. Large Cabinet Grotesk title with word reveal, body Poppins ~20px at max 68ch, the four short emphasis paragraphs at display size, back link to `/`.

**Step 4: Verify**

Run: `npm run --prefix app/web build && grep -c "four hundred thousand streams" app/web/dist/why.html`
Expected: `1`

**Step 5: Commit**

```bash
git add app/web/src/content.config.ts app/web/src/content app/web/src/pages/why.astro
git commit -m "feat(web): add corrected manifesto at /why"
```

---

## Phase 4 — Content pages

All four pages share one pattern; build it once (Task 4.1), then author content (4.2–4.5). Copy comes from the matching sections of the design doc, where every claim was checked against code. Diego reviews each page's copy before its commit.

### Task 4.1: Page building blocks

**Files:**
- Create: `app/web/src/components/PageHeader.astro` (eyebrow, word-split H1, lede)
- Create: `app/web/src/components/Chapter.astro` (props `index`, `title`, `status?: "coming-soon"`; slot; `data-reveal`; `id={chapterId(index, title)}`)
- Create: `app/web/src/components/FeatureList.astro` (props `items: { title: string; body: string }[]`; staggered reveal)
- Create: `app/web/src/components/StatusBadge.astro` (amber "Coming soon")
- Create: `app/web/src/lib/chapters.ts`
- Test: `app/web/src/lib/chapters.test.ts`

TDD `chapterId(2, "Radio")` → `"02-radio"` and `chapterId(9, "Decks & DJs")` → `"09-decks-djs"`, then build the components.

Commit: `feat(web): add chapter page building blocks`.

### Task 4.2: `/listen`

Nine chapters from the design doc (Play, Radio, Paths, Discover, Yours, Together, Everywhere, Live, Decks). Rules:
- Smart Mix described as available on Android (launch gate in Task 6.4).
- Jams and Decks use `<StatusBadge/>`.
- No waypoints, no "save a path as a playlist"; Subsonic clients named only as Feishin, Symfonium, Subtracks.
- Radio and Paths deep-dives reuse `renderer.ts` with `library-cloud.bin` (Phase 5) in sticky sections: Radio shows seed → neighbours → weights; Paths draws the six-node path from `prototypes/a1-paths.html`.

Commit: `feat(web): add Listen page`.

### Task 4.3: `/admin`

Seven chapters (Health, Imports, Acquisition, Enrichment, Genres, Analysis & Insights, Operations). Acquisition in a neutral tone; LLM features labelled "optional — bring your own model". Commit: `feat(web): add Admin page`.

### Task 4.4: `/architecture`

Static SVG system map (WebGL map is out of scope for this plan), the "follow one like" trace as a sticky scrubbed sequence, the twelve stories as chapters, scale numbers from `src/data/scale.json`, the stack list. No latency figures. Commit: `feat(web): add Architecture page`.

### Task 4.5: `/developers`

APIs (REST + OpenAPI, OpenSubsonic `/rest`, `/api/capabilities`, access tokens and scopes, Smart Mix APIs), `make dev`, contributing and testing policy, VirtualDJ plugin build status, deep links to docs. Commit: `feat(web): add Developers page`.

---

## Phase 5 — Data exports and screencast

### Task 5.1: Bliss sample query

**Files:**
- Create: `app/crate/db/queries/site_library_sample.py`
- Test: `app/tests/test_site_library_sample.py`

**Step 1: Write the failing test** (helpers from `app/tests/test_bliss_queries.py`)

```python
from __future__ import annotations

import pytest

from crate.db.queries.site_library_sample import get_bliss_sample
from tests.conftest import PG_AVAILABLE
from tests.test_bliss_queries import _insert_album, _insert_artist, _insert_track, make_vec

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def test_get_bliss_sample_returns_only_tracks_with_vectors(pg_db):
    _insert_artist(pg_db, "Artist")
    album_id = _insert_album(pg_db, "Artist", "Album", "/music/a")
    _insert_track(pg_db, album_id, "Artist", "Album", "One", "/music/a/1.flac", bliss_vector=make_vec(0.1), bpm=120.0)
    _insert_track(pg_db, album_id, "Artist", "Album", "Two", "/music/a/2.flac")

    rows = get_bliss_sample(limit=10, seed=0.5)

    assert [row["title"] for row in rows] == ["One"]
    assert len(rows[0]["bliss_vector"]) == 20


def test_get_bliss_sample_is_stable_for_a_seed(pg_db):
    _insert_artist(pg_db, "Artist")
    album_id = _insert_album(pg_db, "Artist", "Album", "/music/a")
    for i in range(30):
        _insert_track(pg_db, album_id, "Artist", "Album", f"T{i}", f"/music/a/{i}.flac", bliss_vector=make_vec(i / 10))

    first = [row["track_id"] for row in get_bliss_sample(limit=10, seed=0.25)]
    second = [row["track_id"] for row in get_bliss_sample(limit=10, seed=0.25)]

    assert first == second
    assert len(first) == 10
```

**Step 2: Run to verify it fails**

Run: `cd app && ../.venv/bin/python -m pytest tests/test_site_library_sample.py -q`
Expected: FAIL, `ModuleNotFoundError`.

**Step 3: Implement**

```python
from __future__ import annotations

from sqlalchemy import text

from crate.db.queries.playable_media_filters import playable_media_params, playable_track_clause
from crate.db.tx import optional_scope


def get_bliss_sample(session=None, *, limit: int, seed: float) -> list[dict]:
    with optional_scope(session) as active:
        rows = active.execute(
            text(
                f"""
                SELECT t.id AS track_id, t.title, t.artist, t.genre, t.bpm, t.audio_key,
                       t.bliss_vector
                FROM library_tracks t
                JOIN library_albums a ON t.album_id = a.id
                WHERE t.bliss_vector IS NOT NULL
                  AND cardinality(t.bliss_vector) = 20
                  AND {playable_track_clause("t", "a")}
                ORDER BY md5(t.id::text || :seed)
                LIMIT :limit
                """
            ),
            {"limit": limit, "seed": repr(seed), **playable_media_params()},
        ).mappings()
        return [dict(row) for row in rows]
```

Hashing the id with the seed gives a uniform sample that is stable for a seed and changes when the seed changes.

This query only runs from the offline export (Task 5.2), never in an HTTP request. Do not add it to `crate/db/__init__.py`.

**Step 4: Run tests** → 2 passed.

**Step 5: Commit**

```bash
git add app/crate/db/queries/site_library_sample.py app/tests/test_site_library_sample.py
git commit -m "feat(db): add seeded bliss sample query for the site export"
```

### Task 5.2: Export script

**Files:**
- Create: `app/scripts/export_site_library.py`
- Test: `app/tests/test_export_site_library.py`

**Step 1: Write the failing test**

```python
import numpy as np

from scripts.export_site_library import project_to_3d, quantise


def test_project_to_3d_returns_centred_points_within_radius():
    rng = np.random.default_rng(1)
    points = project_to_3d(rng.normal(size=(200, 20)), radius=1.5)
    assert points.shape == (200, 3)
    assert np.abs(points).max() <= 1.5 + 1e-9


def test_quantise_maps_radius_to_int16_range():
    data = quantise(np.array([[1.5, -1.5, 0.0]]), radius=1.5)
    assert data.dtype == np.int16
    assert data.tolist() == [32767, -32767, 0]
```

**Step 2: Run to verify it fails.**

**Step 3: Implement**

```python
"""Offline, read-only export of the library cloud used by the website hero."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from crate.db.queries.site_library_sample import get_bliss_sample


def project_to_3d(vectors: np.ndarray, radius: float) -> np.ndarray:
    centred = vectors - vectors.mean(axis=0)
    _, _, components = np.linalg.svd(centred, full_matrices=False)
    points = centred @ components[:3].T
    points -= points.mean(axis=0)
    scale = np.percentile(np.abs(points), 99.5) or 1.0
    return np.clip(points / scale * radius, -radius, radius)


def quantise(points: np.ndarray, radius: float) -> np.ndarray:
    return np.round(points.reshape(-1) / radius * 32767).astype(np.int16)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=24000)
    parser.add_argument("--seed", type=float, default=0.42)
    parser.add_argument("--radius", type=float, default=1.5)
    parser.add_argument("--out", type=Path, default=Path("web/public/data"))
    args = parser.parse_args()

    rows = get_bliss_sample(limit=args.limit, seed=args.seed)
    vectors = np.array([row["bliss_vector"] for row in rows], dtype=np.float64)
    points = project_to_3d(vectors, args.radius)

    args.out.mkdir(parents=True, exist_ok=True)
    quantise(points, args.radius).tofile(args.out / "library-cloud.bin")
    (args.out / "library-cloud.json").write_text(
        json.dumps({"count": len(rows), "radius": args.radius, "seed": args.seed})
    )
    print(f"wrote {len(rows)} points to {args.out}")


if __name__ == "__main__":
    main()
```

The hero needs positions only; titles and artists are not exported. If the `/listen` deep-dives need labels, add a separate small labelled sample in Task 4.2.

**Step 4: Run tests** → pass.

**Step 5: Generate from production (read-only, never from the API container)**

```bash
ssh -L 15432:localhost:5432 crate@95.216.3.27   # tunnel to crate-postgres, read-only role
cd app && CRATE_DATABASE_URL=postgresql://<read-only-role>@localhost:15432/crate \
  ../.venv/bin/python -m scripts.export_site_library
ls -l web/public/data/library-cloud.bin
```

Use the DSN variable the app actually reads (check `crate/db/engine.py`). Expected size ≈ 144 KB for 24,000 points.

**Step 6: Commit**

```bash
git add app/scripts/export_site_library.py app/tests/test_export_site_library.py app/web/public/data
git commit -m "feat(web): export the library cloud for the hero from bliss vectors"
```

### Task 5.3: Scale numbers at build time

**Files:**
- Create: `app/web/scripts/scale-numbers.mjs`
- Test: `app/web/scripts/scale-numbers.test.ts`
- Modify: `app/web/package.json` (`"prebuild": "node scripts/scale-numbers.mjs"`)

TDD pure counters over fixture strings: pytest `def test_` (Python), `it(`/`test(` (Vitest), `func Test` (Go), `#[test]` (Rust), task types in `TASK_POOL_CONFIG`, Alembic revision files. The script walks the repo (paths relative to `app/web`), writes `src/data/scale.json`, and keeps `tracks`/`albums` from `public/data/library-cloud.json` plus a hand-maintained `albums` value. In Docker builds the repo is not present: the script must keep the existing `scale.json` when the source folders are missing.

Commit: `feat(web): generate scale numbers at build time`.

### Task 5.4: Screencast capture (Playwright)

**Files:**
- Create: `tools/screencast/package.json` (`@playwright/test`, `tsx`, `vitest`)
- Create: `tools/screencast/.gitignore` (`.auth/`, `out/`, `node_modules/`)
- Create: `tools/screencast/login.ts`
- Create: `tools/screencast/events.ts`
- Test: `tools/screencast/events.test.ts`
- Create: `tools/screencast/capture.ts`
- Create: `tools/screencast/chapters/{library,player,radio,paths,offline}.ts`

1. `login.ts`: headed Chromium at `https://listen.lespedants.org`; Diego signs in by hand; save `storageState` to `.auth/state.json`. No credentials in the repo.
2. `events.ts`: `createEventLog(startTime)` with `click(box, at)` and `scroll(deltaY, at)` producing `{ t, type, x, y, box }`. TDD it: a click on box `{x: 100, y: 200, width: 40, height: 20}` at 1.5 s logs `{ t: 1.5, type: "click", x: 120, y: 210 }`.
3. `capture.ts <chapter> <desktop|mobile>`: load the state, viewport 1440×900 or 390×844 at deviceScaleFactor 2, CDP `Page.startScreencast({ format: "png" })`, write frames with timestamps to `out/<chapter>/<device>/frames/`, run the chapter script through helpers that log to the event log, write `events.json`. Print a warning that recordings create play events and scrobbles.
4. Chapter scripts use role/text selectors with explicit waits and finish under 25 s.

Commit: `feat(screencast): capture Listen chapters with event logs`.

### Task 5.5: Screencast edit (Remotion)

**Files:**
- Create: `tools/screencast/remotion/` (`Root.tsx`, `Chapter.tsx`, `camera.ts`, `cursor.ts`)
- Test: `tools/screencast/remotion/camera.test.ts`

1. `camera.ts`: keyframed camera from `events.json` (spring zoom 1 → 1.6 towards each target, hold, release). TDD: one click at `(1000, 600)` at 2 s gives a camera centre within 40 px of the target at 2.4 s and zoom above 1.4.
2. `cursor.ts`: Catmull-Rom path between events, click pulse.
3. `Chapter.tsx`: frames as `<Img>`, camera transform, cursor, desktop window chrome, synced phone overlay from the mobile capture, mono captions from `app/web/src/i18n/en.ts`.
4. Render each chapter to `app/web/public/screencast/<chapter>.mp4` (H.264), `<chapter>.webm` (AV1) and `<chapter>.jpg` poster. Wire them into `Screencast.astro`: play on enter, pause on leave, `preload="none"`, no autoplay when `navigator.connection.saveData`.

Commit: `feat(screencast): edit chapters with camera, cursor and captions`.

---

## Phase 6 — QA and launch

### Task 6.1: JS budget check

**Files:**
- Create: `app/web/scripts/check-budget.mjs`
- Test: `app/web/scripts/check-budget.test.ts`

TDD `pageScriptBytes(html, distDir)`: collect `<script src>` and `<link rel="modulepreload">` targets of one HTML page, gzip each with `zlib.gzipSync`, return the sum. The CLI walks `dist/**/*.html` and exits 1 when a page exceeds the limit argument (122880 bytes), printing the page and its size. Append `npm run budget --prefix app/web` to the CI step from Task 1.6.

Commit: `ci(web): enforce the per-page JavaScript budget`.

### Task 6.2: Playwright smoke

**Files:**
- Create: `app/web/playwright.config.ts` (webServer `npm run preview`, port 5176, Chromium only)
- Create: `app/web/e2e/pages.spec.ts`
- Create: `app/web/e2e/home.spec.ts`

`pages.spec.ts`: for `/`, `/listen`, `/admin`, `/architecture`, `/developers`, `/why` at 1440×900 and 390×844: status 200, no console errors, `document.documentElement.scrollWidth <= innerWidth`.

`home.spec.ts`:
- `canvas#field` exists and `.mark-static` is hidden after 3 s;
- with `reducedMotion: "reduce"`, `.mark-static` stays visible and `.hero-copy .w` has no transform;
- clicking the install button writes the command to the clipboard (grant `clipboard-read`, `clipboard-write`).

Append to the CI step: `npx playwright install --with-deps chromium && npm run test:e2e --prefix app/web`.

Commit: `test(web): add Playwright smoke for pages, hero and reduced motion`.

### Task 6.3: Accessibility pass

Run the `web-design-guidelines` review on all six pages. Fix `--fg-3` contrast where it fails AA at its size, visible focus on every link and button, `aria-hidden` on decorative canvases, skip link working. Commit: `fix(web): accessibility fixes from review`.

### Task 6.4: Launch gates (checklist)

- [ ] `LICENSE` (AGPL-3.0) in the repo root.
- [ ] `chore/stable-release-asset-names` merged; every URL in `downloads.ts` returns 302 (`curl -sI <url> | head -1`).
- [ ] Smart Mix R1 merged and enabled in production; otherwise switch its `/listen` copy to `<StatusBadge/>`.
- [ ] `docs/technical/federation-overview.md` matches "available".
- [ ] Copy of every page approved by Diego.
- [ ] `library-cloud.bin` generated from production and committed.

### Task 6.5: Serve cratemusic.app from `app/web`

**Files:**
- Modify: `.github/workflows/build-images.yml` (site path filter in the `changes` job; `file: ./app/site/Dockerfile` → `./app/web/Dockerfile` in `build-site`, around line 570)
- Modify: `docker-compose.project.yaml:74-76` (`dockerfile: app/site/Dockerfile` → `app/web/Dockerfile`)
- Modify: `Makefile` (the `app/site` dev targets around lines 55, 67, 71, 126, 150, 181, 190, 216 → `npm --prefix app/web run dev`)
- Modify: `.github/workflows/test-frontend.yml` (remove the `app/site` steps)

1. Make the edits. The image stays `crate-site`; no compose service, Traefik label or deploy script changes.
2. Verify: `docker compose -f docker-compose.yaml -f docker-compose.project.yaml build crate-site` builds from `app/web/Dockerfile`.
3. PR → merge → "Build & Push Docker Images" publishes the new digest → `make deploy-preflight VERSION=<sha>` and `make deploy VERSION=<sha>` → check `https://cratemusic.app/` and `https://cratemusic.app/install.sh`.

Commit: `build(site): serve cratemusic.app from the new Astro site`.

### Task 6.6: Remove `app/site`

Only after one release cycle in production and Diego's confirmation. Delete `app/site/`, clear references (`grep -rn "app/site" .github Makefile docs`), keep `install.sh` at the repo root. Commit: `chore(site): remove the old marketing site`.

---

## Order and checkpoints

- Phases 1–3 ship as one PR: a deployable site with home and `/why`. Checkpoints with Diego after Task 2.4 (hero parity) and at the end of Phase 3.
- Phase 4 lands page by page, each PR after a copy review.
- Phase 5 can run in parallel with Phase 4: 5.1–5.3 unblock the deep-dives and the real hero cloud; 5.4–5.5 unblock the screencast.
- Phase 6 gates the swap.
