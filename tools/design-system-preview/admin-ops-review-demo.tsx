import { createRoot } from "react-dom/client";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { installFocusRingMotion } from "@crate/ui/lib/focus-ring-motion";
import { AdminOpsCheckpoint } from "./admin-ops-checkpoint";
import "./admin-navigation-demo.css";

applyCrateIdentity();
const dispose = installFocusRingMotion();
if (import.meta.hot) import.meta.hot.dispose(dispose);
createRoot(document.getElementById("root")!).render(
  <main className="mx-auto min-h-screen max-w-7xl p-6">
    <AdminOpsCheckpoint />
  </main>,
);
