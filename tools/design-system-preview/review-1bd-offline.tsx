import { createRoot } from "react-dom/client";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { OfflineReview } from "../crate-ui-showcase/reviews/OfflineReview";
import "./review.css";
applyCrateIdentity();
createRoot(document.getElementById("root")!).render(
  <OfflineReview
    locale={
      new URL(location.href).searchParams.get("locale") === "eu" ? "eu" : "en"
    }
  />,
);
