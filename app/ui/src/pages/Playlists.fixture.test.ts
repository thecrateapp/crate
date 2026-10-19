import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import sample from "../../../../tests/admin-e2e/fixtures/playlists-1ap.json";
import { beforeEach, expect, it, vi } from "vitest";
beforeEach(() => vi.resetModules());
it("keeps created sample playlists actionable after returning from their editor destination", async () => {
  const fixture = await import(
    "../../../../tools/design-system-preview/admin-playlists-fixtures"
  );
  const pending = fixture.api<{ id: number }>(
    "/api/admin/system-playlists",
    "POST",
    { name: "Nueva muestra" },
  );
  fixture.complete();
  const created = await pending;
  expect(created.id).toBe(99);
  const toggle = fixture.api(
    `/api/admin/system-playlists/${created.id}/deactivate`,
    "POST",
  );
  fixture.complete();
  await toggle;
  expect(await fixture.api("/api/admin/system-playlists")).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 99, is_active: false }),
    ]),
  );
  const remove = fixture.api(
    `/api/admin/system-playlists/${created.id}`,
    "DELETE",
  );
  fixture.complete();
  await remove;
  expect(await fixture.api("/api/admin/system-playlists")).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ id: 99 })]),
  );
});
it("rejects unknown local IDs without scheduling an impossible sample mutation", async () => {
  const fixture = await import(
    "../../../../tools/design-system-preview/admin-playlists-fixtures"
  );
  await expect(
    fixture.api("/api/admin/system-playlists/999/deactivate", "POST"),
  ).rejects.toThrow("Unsupported playlist specimen");
  expect(fixture.snapshot().pending).toBe(0);
});

it("includes every field declared by the API filter-options response", () => {
  const schema = readFileSync(
    resolve(process.cwd(), "../crate/api/schemas/playlists.py"),
    "utf8",
  );
  const declaration = schema
    .split("class PlaylistFilterOptionsResponse(BaseModel):")[1]!
    .split("\nclass ")[0]!;
  const required = Array.from(
    declaration.matchAll(/^ {4}(\w+):/gm),
    (match) => match[1],
  );
  expect(Object.keys(sample.filterOptions).sort()).toEqual(required.sort());
});
