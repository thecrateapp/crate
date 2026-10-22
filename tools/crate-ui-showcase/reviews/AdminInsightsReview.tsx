import { Insights } from "../../../app/ui/src/pages/Insights";

export function AdminInsightsReview() {
  return (
    <main className="grid min-h-screen content-start gap-6 p-4 sm:p-6">
      <p className="text-sm text-text-muted">
        Página real de Admin · datos de muestra. Conserva las lecturas
        disponibles cuando falla una actualización.
      </p>
      <Insights />
    </main>
  );
}
