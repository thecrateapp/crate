import { createRoot } from "react-dom/client";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { AdminFederationReview } from "../crate-ui-showcase/reviews/AdminFederationReview";
import "./admin-navigation-demo.css";

applyCrateIdentity();
createRoot(document.getElementById("root")!).render(<AdminFederationReview />);
