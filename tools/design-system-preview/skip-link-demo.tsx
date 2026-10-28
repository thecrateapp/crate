import { useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { installFocusRingMotion } from "@crate/ui/lib/focus-ring-motion";
import { SkipLink } from "@crate/ui/primitives/SkipLink";
import { Button } from "@crate/ui/shadcn/button";
import en from "../../app/listen/src/i18n/catalogs/en.json";
import es from "../../app/listen/src/i18n/catalogs/es.json";
import fr from "../../app/listen/src/i18n/catalogs/fr.json";
import de from "../../app/listen/src/i18n/catalogs/de.json";
import it from "../../app/listen/src/i18n/catalogs/it.json";
import ca from "../../app/listen/src/i18n/catalogs/ca.json";
import eu from "../../app/listen/src/i18n/catalogs/eu.json";
import "./skip-link-demo.css";

const params = new URLSearchParams(location.search);
const app = params.get("app") === "admin" ? "Admin" : "Listen";
const labels = {
  en: en["common.skipToMainContent"],
  es: es["common.skipToMainContent"],
  fr: fr["common.skipToMainContent"],
  de: de["common.skipToMainContent"],
  it: it["common.skipToMainContent"],
  ca: ca["common.skipToMainContent"],
  eu: eu["common.skipToMainContent"],
};
const requested = params.get("locale") || "es";
const locale = Object.prototype.hasOwnProperty.call(labels, requested)
  ? (requested as keyof typeof labels)
  : "es";
const label = app === "Admin" ? "Skip to main content" : labels[locale];
document.documentElement.lang = "es";
applyCrateIdentity();
const disposeFocus = installFocusRingMotion();
if (import.meta.hot) import.meta.hot.dispose(disposeFocus);

function Example() {
  const [opened, setOpened] = useState(false);
  return (
    <>
      <div lang={app === "Admin" ? "en" : locale}>
        <SkipLink targetId="demo-main">{label}</SkipLink>
      </div>
      <nav aria-label="Navegación de muestra">
        <strong>Crate {app}</strong>
        <a href="#demo-main">Colección</a>
        <a href="#demo-main">Explorar</a>
      </nav>
      <main id="demo-main" tabIndex={-1}>
        <p className="font-mono text-meta text-text-muted">
          CONTENIDO PRINCIPAL · DATOS FICTICIOS
        </p>
        <h1>Tu música, a un salto.</h1>
        <p>
          El enlace aparece al enfocarlo. Enter lleva el foco aquí; Tab continúa
          con el contenido.
        </p>
        <Button variant="outline" onClick={() => setOpened(true)}>
          {opened ? "Muestra abierta" : "Abrir muestra"}
        </Button>
      </main>
    </>
  );
}
const root = createRoot(document.getElementById("root")!);
// The parent enables its demo control on load, after the link has been committed.
flushSync(() => root.render(<Example />));
