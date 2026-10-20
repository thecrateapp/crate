import { expect, it } from "vitest";
import { acquireBodyScrollLock } from "./body-scroll-lock";
it("restores document styles only after the last owner, independent of release order", () => {
  document.body.style.overflow = "auto";
  document.documentElement.style.overflow = "scroll";
  document.body.style.overscrollBehavior = "contain";
  const story = acquireBodyScrollLock(document),
    share = acquireBodyScrollLock(document);
  story();
  story();
  expect(document.body.style.overflow).toBe("hidden");
  expect(document.documentElement.style.overflow).toBe("hidden");
  share();
  expect(document.body.style.overflow).toBe("auto");
  expect(document.documentElement.style.overflow).toBe("scroll");
  expect(document.body.style.overscrollBehavior).toBe("contain");
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";
  document.body.style.overscrollBehavior = "";
});
