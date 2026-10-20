import { createRoot } from "react-dom/client";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { ActionLabelsReview } from "../crate-ui-showcase/reviews/ActionLabelsReview";
import "./review.css";
applyCrateIdentity();
createRoot(document.getElementById("root")!).render(<ActionLabelsReview />);
