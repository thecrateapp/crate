import { createRoot } from "react-dom/client";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import {
  SettingsRemainingReview,
  type SettingsRemainingTab,
} from "../crate-ui-showcase/reviews/SettingsRemainingReview";
import "./review.css";
applyCrateIdentity();
const tab = new URLSearchParams(location.search).get("tab");
const initialTab = [
  "location",
  "connections",
  "offline",
  "navigation",
].includes(tab ?? "")
  ? (tab as SettingsRemainingTab)
  : "connections";
createRoot(document.getElementById("root")!).render(
  <SettingsRemainingReview initialTab={initialTab} />,
);
