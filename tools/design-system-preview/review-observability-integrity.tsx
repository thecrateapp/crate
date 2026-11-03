import { createRoot } from "react-dom/client";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { installFocusRingMotion } from "@crate/ui/lib/focus-ring-motion";
import { ObservabilityIntegrityReview } from "../crate-ui-showcase/reviews/ObservabilityIntegrityReview";
import "./admin-navigation-demo.css";

applyCrateIdentity();
const dispose = installFocusRingMotion();
if (import.meta.hot) import.meta.hot.dispose(dispose);
createRoot(document.getElementById("root")!).render(
  <ObservabilityIntegrityReview />,
);
