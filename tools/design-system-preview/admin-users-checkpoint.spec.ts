import { expect, test } from "@playwright/test";
for (const width of [1440, 768, 390])
  test(`Users specimen ${width}: list, real detail, safe local action`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1100 });
    const errors: string[] = [],
      unexpected: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (request) => {
      const u = new URL(request.url());
      if (
        u.pathname.startsWith("/api/") ||
        (!["127.0.0.1", "localhost"].includes(u.hostname) &&
          u.protocol !== "data:")
      )
        unexpected.push(request.url());
    });
    await page.goto("/admin-users-demo.html");
    const root = page.getByRole("region", {
      name: "Página real de Users",
      exact: true,
    });
    const table = root.getByRole("table", { name: "Users", exact: true });
    const row = table.getByRole("row", { name: /Ada Costa/ });
    await expect(row).toBeVisible();
    await page.waitForFunction(() => document.fonts.status === "loaded");
    await expect(root.locator("canvas")).toHaveCount(0);
    await expect(table.getByRole("row")).toHaveCount(5);
    expect(
      await root
        .getByRole("heading", { name: "Users", exact: true })
        .evaluate((el) => getComputedStyle(el).fontFamily),
    ).toContain("Bricolage");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await row
      .getByRole("button", { name: "Inspect", exact: true })
      .press("Enter");
    const dialog = page.getByRole("dialog", {
      name: "User Detail",
      exact: true,
    });
    await expect(
      dialog.getByText("Fictional user for the local preview."),
    ).toBeVisible();
    await expect(dialog.getByText("Marea", { exact: true })).toBeVisible();
    await dialog.evaluate((el) =>
      Promise.all(el.getAnimations().map((animation) => animation.finished)),
    );
    expect(
      await dialog.evaluate((el) => el.getBoundingClientRect().width),
    ).toBeGreaterThan(width * 0.9);
    for (const field of await dialog.locator(".crate-form-field").all())
      expect(
        await field.evaluate((el) => {
          const [label, value] = Array.from(el.children);
          return (
            value!.getBoundingClientRect().top -
            label!.getBoundingClientRect().bottom
          );
        }),
      ).toBe(8);
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await dialog.getByRole("radio", { name: "Suspended", exact: true }).click();
    await dialog
      .getByRole("button", { name: "Save status", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Save status", exact: true }),
    ).toBeDisabled();
    await dialog
      .getByRole("button", { name: "Completar acción de muestra", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Save status", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(
      table
        .getByRole("row", { name: /Ada Costa/ })
        .getByText("Suspended", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("checkbox", { name: "Solo lectura", exact: true })
      .check();
    await expect(
      root.getByRole("button", { name: "Add user", exact: true }),
    ).toHaveCount(0);
    await table
      .getByRole("row", { name: /Ada Costa/ })
      .getByRole("button", { name: "Inspect", exact: true })
      .click();
    const readDialog = page.getByRole("dialog", {
      name: "User Detail",
      exact: true,
    });
    await expect(
      readDialog.getByText("Fictional user for the local preview."),
    ).toBeVisible();
    await expect(
      readDialog.getByRole("button", { name: "Save roles", exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.getByRole("radio", { name: "Vacío", exact: true }).click();
    await expect(
      root.getByText("No users match the current search or filter.", {
        exact: true,
      }),
    ).toBeVisible();
    expect(unexpected).toEqual([]);
    expect(errors).toEqual([]);
  });
test("Users persistent checkpoint preserves published Roles and earlier frames", async ({
  page,
}) => {
  await page.goto("/#usuarios-admin");
  await expect(
    page.getByRole("region", {
      name: "Checkpoint 1AM, Users de Admin",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page
      .frameLocator('iframe[title="Users real con datos de muestra"]')
      .getByRole("table", { name: "Users" }),
  ).toBeVisible();
  await expect(page.locator("footer")).toContainText("1AL publicado");
  await expect(page.locator("footer")).toContainText("1AM publicado");
  await expect(
    page.locator('iframe[src="./admin-roles-demo.html"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('iframe[src="./admin-timeline-demo.html"]'),
  ).toHaveCount(0);
});

test("Users pending read and rejected local mutation stay explicit", async ({
  page,
}) => {
  await page.goto("/admin-users-demo.html");
  const root = page.getByRole("region", {
    name: "Página real de Users",
    exact: true,
  });
  await expect(root.getByRole("table", { name: "Users" })).toBeVisible();
  await page.getByRole("radio", { name: "Cargando", exact: true }).click();
  await expect(
    root.getByRole("status", { name: "Loading users", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Completar acción de muestra", exact: true })
    .click();
  await expect(root.getByRole("table", { name: "Users" })).toBeVisible();
  await page
    .getByRole("checkbox", { name: "La siguiente acción fallará", exact: true })
    .check();
  await root
    .getByRole("row", { name: /Ada Costa/ })
    .getByRole("button", { name: "Inspect", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "User Detail", exact: true });
  await expect(
    dialog.getByText("Fictional user for the local preview."),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Curator", exact: true }).click();
  await dialog.getByRole("button", { name: "Save roles", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Completar acción de muestra", exact: true })
    .click();
  await expect(
    page.getByText("Fallo ficticio solicitado", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Save roles", exact: true }),
  ).toBeEnabled();
});

for (const field of ["account", "password"])
  test(`actual ${field} label is exactly8px from control`, async ({ page }) => {
    await page.goto("/admin-users-demo.html");
    await page
      .getByRole("row", { name: /Ada Costa/ })
      .getByRole("button", { name: "Inspect", exact: true })
      .click();
    const detail = page.getByRole("dialog", {
      name: "User Detail",
      exact: true,
    });
    await expect(
      detail.getByText("Fictional user for the local preview."),
    ).toBeVisible();
    let label = detail.getByText("Account status", { exact: true }),
      control = detail.getByRole("radiogroup", {
        name: "Account status",
        exact: true,
      }),
      dialog = detail;
    if (field === "password") {
      await detail
        .getByRole("button", { name: "Reset password", exact: true })
        .click();
      dialog = page.getByRole("dialog", {
        name: "Reset local password",
        exact: true,
      });
      label = dialog.getByText("New password", { exact: true });
      control = dialog.getByLabel("New password", { exact: true });
    }
    await dialog.evaluate((el) =>
      Promise.all(el.getAnimations().map((a) => a.finished)),
    );
    const labelBox = await label.boundingBox(),
      controlBox = await control.boundingBox();
    expect(controlBox!.y - (labelBox!.y + labelBox!.height)).toBe(8);
  });
for (const surface of ["password", "delete"])
  test(`pending sample ${surface} remains operable`, async ({ page }) => {
    await page.goto("/admin-users-demo.html");
    const row = page.getByRole("row", { name: /Ada Costa/ });
    let dialog = page.getByRole("dialog", {
      name: "Reset local password",
      exact: true,
    });
    if (surface === "password") {
      await row.getByRole("button", { name: "Inspect", exact: true }).click();
      const detail = page.getByRole("dialog", {
        name: "User Detail",
        exact: true,
      });
      await expect(
        detail.getByText("Fictional user for the local preview."),
      ).toBeVisible();
      await detail
        .getByRole("button", { name: "Reset password", exact: true })
        .click();
      await dialog
        .getByRole("button", { name: "Reset password", exact: true })
        .click();
    } else {
      await row.getByRole("button", { name: "Delete", exact: true }).click();
      dialog = page.getByRole("alertdialog", {
        name: "Delete user",
        exact: true,
      });
      await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    }
    if (surface === "delete") {
      // Existing onConfirm dispatches a void async handler: confirmation closes before the readback.
      await expect(dialog).toHaveCount(0);
      await page
        .getByRole("button", {
          name: "Completar acción de muestra",
          exact: true,
        })
        .click();
      await expect(row.getByText("Deleted", { exact: true })).toBeVisible();
      return;
    }
    const finish = dialog.getByRole("button", {
      name: "Completar acción de muestra",
      exact: true,
    });
    await expect(finish).toBeVisible();
    await finish.press("Tab");
    await expect(dialog).toBeVisible();
    await finish.click();
    if (surface === "password")
      await expect(
        page.getByRole("dialog", { name: "Reset local password", exact: true }),
      ).toHaveCount(0);
    else await expect(row.getByText("Deleted", { exact: true })).toBeVisible();
  });
