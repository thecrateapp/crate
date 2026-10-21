import { createRoot } from "react-dom/client";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { PrimaryHintsReview } from "../crate-ui-showcase/reviews/PrimaryHintsReview";
import "./review.css";
applyCrateIdentity();
createRoot(document.getElementById("root")!).render(<PrimaryHintsReview />);
