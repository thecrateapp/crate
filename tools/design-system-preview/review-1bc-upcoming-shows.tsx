import { createRoot } from "react-dom/client";
import { UpcomingShowsReview } from "../crate-ui-showcase/reviews/UpcomingShowsReview";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import "./review.css";
applyCrateIdentity();
createRoot(document.getElementById("root")!).render(<UpcomingShowsReview />);
