export const reducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;
export const finePointer = window.matchMedia("(pointer: fine)").matches;
export const isMobile = window.matchMedia("(max-width: 760px)").matches;

const INSTALL_COMMAND = "curl -fsSL https://cratemusic.app/install.sh | bash";
const GLYPHS = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789#/<>_";

export function spring(t) {
  return 1 - Math.exp(-6.2 * t) * Math.cos(8.4 * t);
}

export function mountNav() {
  const nav = document.createElement("header");
  nav.className = "nav";
  nav.innerHTML = `
    <a class="brand" href="index.html"><img src="../../site/public/icons/logo.svg" alt="" />Crate</a>
    <nav class="links" aria-label="Primary">
      ${["Listen", "Admin", "Architecture", "Developers", "GitHub"]
        .map((label, index) => `<a href="#" style="--i:${index}">${label}</a>`)
        .join("")}
    </nav>`;
  document.body.prepend(nav);
}

export function heroMarkup({ eyebrow = true } = {}) {
  return `
    ${
      eyebrow
        ? `<p class="eyebrow" data-enter style="--d:40ms"><b>Free</b> / open source / self hosted</p>`
        : ""
    }
    <h1 class="display" data-split style="--d:90ms;--step:55ms">Crate is not a streaming service.</h1>
    <p class="sub" data-split style="--d:300ms;--step:40ms">It's a tool for revolution.</p>
    <button class="cta" type="button" data-enter data-copy style="--d:440ms" aria-label="Copy the install command">
      <span class="cmd"><i>$</i> ${INSTALL_COMMAND}</span>
      <span class="pill">Copy</span>
    </button>`;
}

export function splitWords(element) {
  element.setAttribute(
    "aria-label",
    element.textContent.replace(/\s+/g, " ").trim(),
  );
  let index = 0;

  function walk(node, target) {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        const parts = child.textContent.split(/(\s+)/);
        for (const part of parts) {
          if (!part) continue;
          if (/^\s+$/.test(part)) {
            target.append(" ");
            continue;
          }
          const wrap = document.createElement("span");
          wrap.className = "w-wrap";
          wrap.setAttribute("aria-hidden", "true");
          const word = document.createElement("span");
          word.className = "w";
          word.style.setProperty("--i", index++);
          word.textContent = part;
          wrap.appendChild(word);
          target.appendChild(wrap);
        }
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const clone = child.cloneNode(false);
        walk(child, clone);
        target.appendChild(clone);
      }
    }
  }

  const fragment = document.createDocumentFragment();
  walk(element, fragment);
  element.textContent = "";
  element.appendChild(fragment);
}

export function mountHero(root) {
  root.innerHTML = heroMarkup();
  root.querySelectorAll("[data-split]").forEach(splitWords);

  const button = root.querySelector("[data-copy]");
  const pill = button.querySelector(".pill");
  button.addEventListener("click", async () => {
    await navigator.clipboard?.writeText(INSTALL_COMMAND);
    scrambleText(pill, "Copied", 320);
    setTimeout(() => scrambleText(pill, "Copy", 320), 1700);
  });
}

export function startEntry(root, delay = 0) {
  setTimeout(
    () => requestAnimationFrame(() => root.classList.add("is-in")),
    delay,
  );
}

export function mountSections(main) {
  const statement = document.createElement("section");
  statement.className = "statement";
  statement.innerHTML = [
    `Crate is free, open-source software for taking music back from streaming platforms and returning it to the people who give it meaning: fans and artists. <span class="hl">No subscriptions. No algorithms.</span>`,
    `Install it in your server. Bring your files. Tell your friends. Start a community and break with the system.`,
    `Own your music. Support your artists. <span class="hl">Refuse the middleman.</span>`,
  ]
    .map(
      (text, index) => `
      <div class="row" data-reveal>
        <p class="eyebrow" data-enter>0${index + 1}</p>
        <p data-split style="--step:14ms">${text}</p>
      </div>`,
    )
    .join("");

  const explore = document.createElement("nav");
  explore.className = "explore";
  explore.setAttribute("data-reveal", "");
  explore.setAttribute("aria-label", "Explore Crate");
  explore.innerHTML = [
    ["Listen", "Player, radio, paths, offline"],
    ["Admin", "Library health, enrichment, analysis"],
    ["Architecture", "Workers, read plane, events"],
    ["Developers", "APIs, tokens, contributing"],
  ]
    .map(
      ([label, meta], index) => `
      <a href="#" style="--i:${index}">
        <span class="label">${label}</span>
        <span class="meta">${meta}<span class="arrow">&rarr;</span></span>
      </a>`,
    )
    .join("");

  const screencast = document.createElement("section");
  screencast.className = "screencast";
  screencast.innerHTML = `
    <div class="frame" data-frame>
      <p class="eyebrow"><b>01</b> / Library</p>
      <span class="play" aria-hidden="true">&#9654;</span>
    </div>`;

  main.append(statement, explore, screencast);
  statement.querySelectorAll("[data-split]").forEach(splitWords);
}

export function initReveals() {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-in");
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0.2, rootMargin: "0px 0px -8% 0px" },
  );
  document
    .querySelectorAll("[data-reveal]")
    .forEach((element) => observer.observe(element));
}

export function initSmoothScroll() {
  const { gsap, ScrollTrigger, Lenis } = window;
  gsap.registerPlugin(ScrollTrigger);
  if (reducedMotion || !finePointer) return;
  const lenis = new Lenis({ lerp: 0.1 });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
}

export function scrambleText(element, text, durationMs = 520) {
  if (reducedMotion) {
    element.textContent = text;
    return;
  }
  const start = performance.now();
  function frame(now) {
    const progress = Math.min(1, (now - start) / durationMs);
    const settled = Math.floor(text.length * progress);
    element.textContent =
      text.slice(0, settled) +
      [...text.slice(settled)]
        .map((char) =>
          char === " "
            ? " "
            : GLYPHS[Math.floor(Math.random() * GLYPHS.length)],
        )
        .join("");
    if (progress < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
