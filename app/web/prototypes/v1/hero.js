export const reducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

const INSTALL_COMMAND = "curl -fsSL https://cratemusic.app/install.sh | bash";
const GLYPHS = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789#/<>_";

const HERO_HTML = `
  <p class="eyebrow" data-decode>Free music platform / open source / self hosted</p>
  <h1 data-decode>Crate is not a streaming service.</h1>
  <p class="subline" data-decode>It's a tool for revolution.</p>
  <div class="body">
    <p data-fade>Crate is free, open-source software for taking music back from streaming
      platforms and returning it to the people who give it meaning: fans and artists.
      No subscriptions. No algorithms.</p>
    <p data-fade>Install it in your server. Bring your files. Tell your friends.
      Start a community and break with the system.</p>
    <p data-fade>Own your music. Support your artists. Refuse the middleman.</p>
  </div>
  <div class="installer" data-fade>
    <code><span class="prompt">$</span> ${INSTALL_COMMAND}</code>
    <button type="button" data-copy>Copy</button>
    <a href="https://github.com/thecrateapp/crate/issues/new?title=Help%20installing%20Crate">Help</a>
  </div>
  <nav class="links" data-fade>
    <a href="#">Listen</a>
    <a href="#">Admin</a>
    <a href="#">Architecture</a>
    <a href="#">Developers</a>
  </nav>
`;

const FRAME_HTML = ["tl", "tr", "bl", "br"]
  .map(
    (corner) =>
      `<svg class="${corner}" viewBox="0 0 34 34"><path d="M1 33 V1 H33" /></svg>`,
  )
  .join("");

export function mountHero(copyRoot, frameRoot) {
  copyRoot.innerHTML = HERO_HTML;
  if (frameRoot) frameRoot.innerHTML = FRAME_HTML;

  const copyButton = copyRoot.querySelector("[data-copy]");
  copyButton.addEventListener("click", async () => {
    await navigator.clipboard?.writeText(INSTALL_COMMAND);
    copyButton.textContent = "Copied";
    setTimeout(() => (copyButton.textContent = "Copy"), 1600);
  });

  for (const element of copyRoot.querySelectorAll("[data-decode]")) {
    splitForDecode(element);
  }
}

function splitForDecode(element) {
  const words = element.textContent.trim().split(/\s+/);
  element.textContent = "";
  words.forEach((word, wordIndex) => {
    const wordSpan = document.createElement("span");
    wordSpan.style.whiteSpace = "nowrap";
    for (const char of word) {
      const charSpan = document.createElement("span");
      charSpan.className = "dc";
      charSpan.textContent = char;
      wordSpan.appendChild(charSpan);
    }
    element.appendChild(wordSpan);
    if (wordIndex < words.length - 1) element.append(" ");
  });
}

export function playIntro({ delay = 0 } = {}) {
  const style = document.createElement("style");
  style.textContent = `
    .dc { position: relative; color: transparent; }
    .dc.on { color: inherit; transition: color 120ms linear; }
    .dc i { position: absolute; left: 0; top: 0; font-style: normal; color: var(--cyan); opacity: 0.85; }
    [data-fade] { opacity: 0; transform: translateY(14px); }
  `;
  document.head.appendChild(style);

  if (reducedMotion) {
    document
      .querySelectorAll(".dc")
      .forEach((char) => char.classList.add("on"));
    document
      .querySelectorAll("[data-fade]")
      .forEach((el) =>
        Object.assign(el.style, { opacity: 1, transform: "none" }),
      );
    return;
  }

  let offset = delay;
  for (const element of document.querySelectorAll("[data-decode]")) {
    const chars = [...element.querySelectorAll(".dc")];
    decodeChars(chars, offset, element.tagName === "H1" ? 26 : 14);
    offset += chars.length * (element.tagName === "H1" ? 18 : 9) + 120;
  }

  window.gsap.to("[data-fade]", {
    opacity: 1,
    y: 0,
    duration: 0.9,
    ease: "power3.out",
    stagger: 0.09,
    delay: offset / 1000,
  });
  window.gsap.to(".hud-frame path", {
    strokeDashoffset: 0,
    duration: 1.1,
    ease: "power2.inOut",
    stagger: 0.12,
    delay: delay / 1000,
  });
}

function decodeChars(chars, startMs, stepMs) {
  const start = performance.now() + startMs;
  const settleAt = chars.map((_, index) => start + index * stepMs + 180);
  for (const char of chars) {
    const glyph = document.createElement("i");
    char.appendChild(glyph);
  }

  function frame(now) {
    let pending = 0;
    chars.forEach((char, index) => {
      if (char.classList.contains("on")) return;
      if (now >= settleAt[index]) {
        char.querySelector("i")?.remove();
        char.classList.add("on");
        return;
      }
      pending += 1;
      const glyph = char.querySelector("i");
      glyph.textContent =
        now < start + index * stepMs
          ? ""
          : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
    });
    if (pending) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
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
