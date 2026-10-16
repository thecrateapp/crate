import { describe, expect, it } from "vitest";

import { permissionLabels } from "./agent-integrations";

describe("instance operation permission labels", () => {
  it("distinguishes cancellation requests from confirmed task completion", () => {
    expect(permissionLabels["ops.jobs.cancel"]).toBe(
      "Request cooperative job cancellation",
    );
    expect(permissionLabels["ops.jobs.cancel_pending"]).toBe(
      "Cancel owned pending jobs",
    );
  });

  it("describes separate authority for instance controls, schedules and runtime policy", () => {
    for (const grant of [
      "ops.audit.read",
      "ops.jobs.manage_instance",
      "ops.schedules.read",
      "ops.schedules.run",
      "ops.schedules.write",
      "ops.runtime.read",
      "ops.runtime.write",
    ]) {
      expect(permissionLabels[grant]).toBeTruthy();
      expect(permissionLabels[grant]).not.toBe(grant);
    }
    expect(permissionLabels["ops.runtime.read"]).toContain("worker adoption");
  });
});
