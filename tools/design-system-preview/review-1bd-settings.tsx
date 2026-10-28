import { createRoot } from "react-dom/client";
import { SETTINGS_TABS } from "../../app/listen/src/pages/SettingsPageView";
import { SettingsReview } from "../crate-ui-showcase/reviews/SettingsReview";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import "./review.css";
applyCrateIdentity();
const tab = new URLSearchParams(window.location.search).get("tab");
const initialTab =
  SETTINGS_TABS.find((candidate) => candidate === tab) ?? "preferences";
createRoot(document.getElementById("root")!).render(
  <SettingsReview initialTab={initialTab} />,
);
