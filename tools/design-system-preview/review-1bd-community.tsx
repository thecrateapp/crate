import { createRoot } from "react-dom/client";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import {
  CommunityReview,
  type CommunityTab,
} from "../crate-ui-showcase/reviews/CommunityReview";
import "./review.css";
applyCrateIdentity();
const tab = new URLSearchParams(location.search).get("tab");
const initialTab = ["directory", "profile", "connections", "card"].includes(
  tab ?? "",
)
  ? (tab as CommunityTab)
  : "directory";
createRoot(document.getElementById("root")!).render(
  <CommunityReview initialTab={initialTab} />,
);
