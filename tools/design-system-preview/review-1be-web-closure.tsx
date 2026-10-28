import { createRoot } from "react-dom/client";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { WebClosureReview } from "../crate-ui-showcase/reviews/WebClosureReview";
import "./review.css";
applyCrateIdentity();
createRoot(document.getElementById("root")!).render(<WebClosureReview />);
