import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { AdminEntityRecoveryReview } from "../crate-ui-showcase/reviews/AdminEntityRecoveryReview";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { installFocusRingMotion } from "@crate/ui/lib/focus-ring-motion";
import "./admin-navigation-demo.css";

applyCrateIdentity();
const dispose = installFocusRingMotion();
if (import.meta.hot) import.meta.hot.dispose(dispose);
flushSync(() =>
  createRoot(document.getElementById("root")!).render(
    <AdminEntityRecoveryReview />,
  ),
);
