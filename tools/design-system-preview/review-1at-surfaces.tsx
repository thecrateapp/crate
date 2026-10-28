import { createRoot } from "react-dom/client";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { SurfacesReview } from "../crate-ui-showcase/reviews/SurfacesReview";
import "./review.css";
applyCrateIdentity();
createRoot(document.getElementById("root")!).render(<SurfacesReview />);
