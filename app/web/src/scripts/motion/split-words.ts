export function splitWords(element: HTMLElement): void {
  element.setAttribute(
    "aria-label",
    (element.textContent ?? "").replace(/\s+/g, " ").trim(),
  );
  let index = 0;

  function walk(node: Node, target: Node) {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        for (const part of (child.textContent ?? "").split(/(\s+)/)) {
          if (!part) continue;
          if (/^\s+$/.test(part)) {
            target.appendChild(document.createTextNode(" "));
            continue;
          }
          const wrap = document.createElement("span");
          wrap.className = "w-wrap";
          wrap.setAttribute("aria-hidden", "true");
          const word = document.createElement("span");
          word.className = "w";
          word.style.setProperty("--i", String(index++));
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
