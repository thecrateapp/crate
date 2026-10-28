import { createRoot } from "react-dom/client";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { ActionsReview } from "../crate-ui-showcase/reviews/ActionsReview";
import "./review.css";
applyCrateIdentity();
createRoot(document.getElementById("root")!).render(<ActionsReview />);
