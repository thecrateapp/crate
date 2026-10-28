import { createRoot } from "react-dom/client";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { HomeSignalsReview } from "../crate-ui-showcase/reviews/HomeSignalsReview";
import "./review.css";
applyCrateIdentity();
createRoot(document.getElementById("root")!).render(<HomeSignalsReview />);
