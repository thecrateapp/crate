import { createRoot } from "react-dom/client";
import { AdminSettingsTranslationsReview } from "../crate-ui-showcase/reviews/AdminSettingsTranslationsReview";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import "./admin-navigation-demo.css";

applyCrateIdentity();
createRoot(document.getElementById("root")!).render(
  <AdminSettingsTranslationsReview />,
);
