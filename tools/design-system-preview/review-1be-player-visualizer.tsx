import { createRoot } from "react-dom/client";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { PlayerVisualizerReview } from "../crate-ui-showcase/reviews/PlayerVisualizerReview";
import "./review.css";
applyCrateIdentity();
createRoot(document.getElementById("root")!).render(<PlayerVisualizerReview />);
