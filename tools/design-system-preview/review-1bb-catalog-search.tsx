import { createRoot } from "react-dom/client";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { CatalogSearchReview } from "../crate-ui-showcase/reviews/CatalogSearchReview";
import "./review.css";
applyCrateIdentity();
createRoot(document.getElementById("root")!).render(<CatalogSearchReview />);
