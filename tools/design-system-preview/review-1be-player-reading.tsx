import { createRoot } from "react-dom/client";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { PlayerReadingReview } from "../crate-ui-showcase/reviews/PlayerReadingReview";
import "./review.css";
applyCrateIdentity();
createRoot(document.getElementById("root")!).render(<PlayerReadingReview />);
