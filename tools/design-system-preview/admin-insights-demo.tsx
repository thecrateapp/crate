import { createRoot } from "react-dom/client";
import { Insights } from "../../app/ui/src/pages/Insights";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { installFocusRingMotion } from "@crate/ui/lib/focus-ring-motion";
import "./admin-navigation-demo.css";

function Demo() {
  return (
    <main className="grid gap-6 p-4 sm:p-6">
      <p className="text-sm text-text-muted">
        Página real de Admin · datos de muestra. El aviso de actualización
        fallida conserva los gráficos y las lecturas de la última respuesta.
      </p>
      <Insights />
    </main>
  );
}

applyCrateIdentity();
const dispose = installFocusRingMotion();
if (import.meta.hot) import.meta.hot.dispose(dispose);
createRoot(document.getElementById("root")!).render(<Demo />);
