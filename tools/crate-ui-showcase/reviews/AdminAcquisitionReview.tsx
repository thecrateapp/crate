import { useRef } from "react";
import { MemoryRouter } from "react-router";
import { Toaster } from "sonner";
import { toasterConfig } from "@crate/ui/lib/toaster-config";
import { DownloadPage } from "../../../app/ui/src/pages/Download";

export function AdminAcquisitionReview({
  initialSearch = true,
}: {
  initialSearch?: boolean;
}) {
  const resetSession = useRef(false);
  if (!resetSession.current && typeof window !== "undefined") {
    window.sessionStorage.removeItem("crate:acquisition:search");
    resetSession.current = true;
  }
  const entry = initialSearch ? "/download?q=Caspian" : "/download";

  return (
    <MemoryRouter initialEntries={[entry]}>
      <div className="grid min-h-screen content-start gap-6 p-4 sm:p-6">
        <p className="m-0 border-b border-border-quiet pb-4 text-sm text-text-muted">
          Página real de Admin · resultados ficticios. La búsqueda y las
          pestañas funcionan en local; no consulta ni modifica la biblioteca.
        </p>
        <section aria-label="Página real de Acquisition" className="min-w-0">
          <DownloadPage />
        </section>
      </div>
      <Toaster {...toasterConfig} />
    </MemoryRouter>
  );
}
