import { OpsPanel } from "../../../app/ui/src/components/admin/ops-surfaces";
import { GenreTaxonomyExplorer } from "../../../app/ui/src/components/genres/GenreTaxonomyExplorer";
import { MemoryRouter } from "react-router";

export function AdminGenreWheelReview() {
  return (
    <MemoryRouter>
      <main className="grid min-h-screen content-start gap-6 p-4 sm:p-6">
        <header className="grid gap-2 border-b border-border-quiet pb-5">
          <h1 className="m-0 font-display text-3xl font-extrabold tracking-tight text-foreground">
            Genre taxonomy
          </h1>
          <p className="m-0 max-w-3xl text-sm text-text-muted">
            Browse the taxonomy tree, inspect the selected genre's connected
            wheel and catalog summary, then edit its cover, description, EQ and
            curation controls below.
          </p>
        </header>
        <OpsPanel
          title="Taxonomy explorer"
          description="Select a node in the tree, wheel or relationship summary to keep all three views in sync."
        >
          <GenreTaxonomyExplorer canCurate canCreatePlaylists />
        </OpsPanel>
      </main>
    </MemoryRouter>
  );
}
