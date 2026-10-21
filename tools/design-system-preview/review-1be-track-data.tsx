import { createRoot } from "react-dom/client";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { TrackDataReview } from "../crate-ui-showcase/reviews/TrackDataReview";
import "./review.css";
applyCrateIdentity();
createRoot(document.getElementById("root")!).render(<TrackDataReview />);
