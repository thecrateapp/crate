import { createRoot } from "react-dom/client";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { PlayerOutputReview } from "../crate-ui-showcase/reviews/PlayerOutputReview";
import "./review.css";
applyCrateIdentity();
createRoot(document.getElementById("root")!).render(<PlayerOutputReview />);
