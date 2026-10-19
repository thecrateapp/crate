import { createRoot } from "react-dom/client";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { LayersReview } from "../crate-ui-showcase/reviews/LayersReview";
import "./review.css";
applyCrateIdentity();
createRoot(document.getElementById("root")!).render(<LayersReview />);
