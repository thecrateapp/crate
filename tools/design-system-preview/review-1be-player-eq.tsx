import { createRoot } from "react-dom/client";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { PlayerEqReview } from "../crate-ui-showcase/reviews/PlayerEqReview";
import "./review.css";
applyCrateIdentity();
createRoot(document.getElementById("root")!).render(<PlayerEqReview />);
