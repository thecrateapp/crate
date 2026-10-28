import { createRoot } from "react-dom/client";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { AlbumAccessReview } from "../crate-ui-showcase/reviews/AlbumAccessReview";
import "./review.css";
applyCrateIdentity();
createRoot(document.getElementById("root")!).render(<AlbumAccessReview />);
