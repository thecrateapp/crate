import { createRoot } from "react-dom/client";
import { ArtistPageReview } from "../crate-ui-showcase/reviews/ArtistPageReview";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import "./review.css";
applyCrateIdentity();
createRoot(document.getElementById("root")!).render(<ArtistPageReview />);
