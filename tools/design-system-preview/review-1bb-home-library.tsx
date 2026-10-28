import { createRoot } from "react-dom/client";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { HomeLibraryReview } from "../crate-ui-showcase/reviews/HomeLibraryReview";
import "./review.css";
applyCrateIdentity();
createRoot(document.getElementById("root")!).render(<HomeLibraryReview />);
