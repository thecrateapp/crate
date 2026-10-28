import { createRoot } from "react-dom/client";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { ShellReview } from "../crate-ui-showcase/reviews/ShellReview";
import "./review.css";
applyCrateIdentity();
createRoot(document.getElementById("root")!).render(<ShellReview />);
