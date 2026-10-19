import { createRoot } from "react-dom/client";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { PlayerReview } from "../crate-ui-showcase/reviews/PlayerReview";
import "./review.css";
applyCrateIdentity();
createRoot(document.getElementById("root")!).render(<PlayerReview />);
