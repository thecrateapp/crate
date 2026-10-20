import { createRoot } from "react-dom/client";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { CollectionDetailsReview } from "../crate-ui-showcase/reviews/CollectionDetailsReview";
import "./review.css";
applyCrateIdentity();
createRoot(document.getElementById("root")!).render(
  <CollectionDetailsReview />,
);
