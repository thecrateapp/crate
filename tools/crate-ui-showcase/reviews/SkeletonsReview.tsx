import { MemoryRouter } from "react-router";
import { CardSkeleton } from "@crate/ui/composites/CardSkeleton";
import { GridSkeleton } from "@crate/ui/composites/GridSkeleton";
import { TableSkeleton } from "@crate/ui/composites/TableSkeleton";
import { LoadingState } from "@crate/ui/domain/states";
import { FormField } from "@crate/ui/primitives/FormField";
import { Skeleton } from "@crate/ui/shadcn/skeleton";
import { SettingsFixtureProvider } from "./SettingsFixtureProvider";
import { SettingsConnectionsFixture } from "./SettingsRemainingFixtures";

export function SkeletonsReview() {
  return (
    <MemoryRouter>
      <SettingsFixtureProvider>
        <div className="grid min-w-0 gap-8">
          <FormField kind="group" label="Generic section loading">
            {(field) => (
              <div {...field} role="group">
                <LoadingState label="Loading collection" />
              </div>
            )}
          </FormField>
          <FormField kind="group" label="Reserved metric readings">
            {(field) => (
              <div {...field} role="group" className="grid grid-cols-2 gap-4">
                <CardSkeleton label="Loading plays" />
                <CardSkeleton label="Loading time" />
              </div>
            )}
          </FormField>
          <FormField kind="group" label="Album grid">
            {(field) => (
              <div {...field} role="group">
                <GridSkeleton
                  count={4}
                  density="default"
                  variant="album"
                  label="Loading albums"
                />
              </div>
            )}
          </FormField>
          <FormField kind="group" label="Artist rail">
            {(field) => (
              <div {...field} role="group">
                <GridSkeleton
                  count={5}
                  layout="rail"
                  variant="artist"
                  label="Loading artists"
                />
              </div>
            )}
          </FormField>
          <FormField kind="group" label="Known table layout">
            {(field) => (
              <div {...field} role="group">
                <TableSkeleton rows={3} columns={3} label="Loading table" />
              </div>
            )}
          </FormField>
          <FormField kind="group" label="Decorative block">
            {(field) => (
              <div {...field} role="group">
                <Skeleton className="h-4 w-1/2" />
              </div>
            )}
          </FormField>
          <FormField
            kind="group"
            label="Actual connection settings while loading"
          >
            {(field) => (
              <div {...field} role="group" className="grid gap-8">
                <SettingsConnectionsFixture read="loading" onEvent={() => {}} />
              </div>
            )}
          </FormField>
        </div>
      </SettingsFixtureProvider>
    </MemoryRouter>
  );
}
