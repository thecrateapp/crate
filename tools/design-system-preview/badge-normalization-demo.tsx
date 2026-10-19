import { createRoot } from "react-dom/client";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { BadgeNormalizationCheckpoint } from "./badge-normalization-checkpoint";
import "./style.css";
applyCrateIdentity();
createRoot(document.getElementById("root")!).render(
  <main className="mx-auto max-w-content px-6 py-8">
    <BadgeNormalizationCheckpoint />
  </main>,
);
