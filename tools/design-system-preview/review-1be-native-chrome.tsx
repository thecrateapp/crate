import { createRoot } from "react-dom/client";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { NativeChromeReview } from "../crate-ui-showcase/reviews/NativeChromeReview";
import "./review.css";
applyCrateIdentity();
createRoot(document.getElementById("root")!).render(
  <NativeChromeReview
    initialMobile={
      new URLSearchParams(location.search).get("view") === "mobile"
    }
  />,
);
