import { createRoot } from "react-dom/client";
import { ExploreBrowseReview } from "../crate-ui-showcase/reviews/ExploreBrowseReview";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import "./review.css";
applyCrateIdentity();
createRoot(document.getElementById("root")!).render(<ExploreBrowseReview />);
