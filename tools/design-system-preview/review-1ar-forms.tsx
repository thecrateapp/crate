import { createRoot } from "react-dom/client";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { FormsReview } from "../crate-ui-showcase/reviews/FormsReview";
import "./review.css";

applyCrateIdentity();
createRoot(document.getElementById("root")!).render(<FormsReview />);
