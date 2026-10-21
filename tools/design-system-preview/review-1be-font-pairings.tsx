import { createRoot } from "react-dom/client";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import {
  FontPairingReview,
  FONT_PAIRINGS,
} from "../crate-ui-showcase/reviews/FontPairingReview";
import "./review.css";
applyCrateIdentity();
const requested = new URLSearchParams(location.search).get("pairing");
const initialPairing =
  requested === "all"
    ? "all"
    : FONT_PAIRINGS.find((pairing) => pairing.id === requested)?.id ?? "new";
createRoot(document.getElementById("root")!).render(
  <FontPairingReview initialPairing={initialPairing} />,
);
