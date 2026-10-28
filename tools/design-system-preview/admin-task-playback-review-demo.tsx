import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { installFocusRingMotion } from "@crate/ui/lib/focus-ring-motion";
import { AdminTaskPlaybackReview } from "./admin-task-playback-review";
import "./style.css";

applyCrateIdentity();
const dispose = installFocusRingMotion();
if (import.meta.hot) import.meta.hot.dispose(dispose);

createRoot(document.getElementById("root")!).render(
  <MemoryRouter initialEntries={["/tasks"]}>
    <AdminTaskPlaybackReview />
  </MemoryRouter>,
);
