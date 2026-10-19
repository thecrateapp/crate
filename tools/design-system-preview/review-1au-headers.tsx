import { createRoot } from "react-dom/client";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { HeadersReview } from "../crate-ui-showcase/reviews/HeadersReview";
import "./review.css";
applyCrateIdentity();
createRoot(document.getElementById("root")!).render(<HeadersReview />);
