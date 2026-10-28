import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`1AD restores the approved sketch's accents and hierarchy at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1100 });
    await page.goto("/admin-health-demo.html");
    const real = page.getByRole("region", {
      name: "Página real de Admin",
      exact: true,
    });
    const toggle = real.getByRole("button", {
      name: "Review issues: Artist Layout Fix",
      exact: true,
    });
    await toggle.click();
    const detail = real.getByRole("region", {
      name: "Artist Layout Fix issues",
      exact: true,
    });
    await expect
      .soft(detail)
      .toHaveCSS("border-left-color", "rgb(6, 182, 212)", { timeout: 1000 });
    await expect.soft(detail).toHaveCSS("border-left-width", "1px");
    await expect
      .soft(toggle)
      .toHaveCSS("color", "rgb(103, 232, 249)", { timeout: 1000 });
    const nextStep = detail.getByRole("link", {
      name: "Review and repair",
      exact: true,
    });
    await expect
      .soft(nextStep)
      .toHaveCSS("background-color", "rgba(0, 0, 0, 0)", { timeout: 1000 });
    await expect
      .soft(nextStep)
      .toHaveCSS("border-top-color", "rgb(6, 182, 212)", { timeout: 1000 });
    await expect
      .soft(nextStep)
      .toHaveCSS("color", "rgb(6, 182, 212)", { timeout: 1000 });
    await expect.soft(nextStep).toHaveAttribute("href", /\?repair=1$/);
    const title = real.getByRole("heading", {
      name: "Artist Layout Fix",
      exact: true,
    });
    await expect.soft(title).toHaveCSS("font-size", "23px", { timeout: 1000 });
    await expect.soft(title).toHaveCSS("font-weight", "600", { timeout: 1000 });
    const heading = real.getByRole("heading", {
      name: "Library Health",
      exact: true,
    });
    await expect
      .soft(heading)
      .toHaveCSS("font-size", width === 390 ? "36px" : "54px", {
        timeout: 1000,
      });
    await expect
      .soft(heading)
      .toHaveCSS("font-weight", "700", { timeout: 1000 });
    const pageWidth = await heading
      .locator("xpath=ancestor::header/..")
      .evaluate((el) => el.getBoundingClientRect().width);
    expect.soft(pageWidth).toBeLessThanOrEqual(1128);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });
}

test("1AD embeds real Library Health and preserves the published System Health checkpoint", async ({
  page,
}) => {
  await page.goto("/?tab=albums&listenTab=history#salud-admin");
  const section = page.getByRole("region", {
    name: "Checkpoint 1AD, Library Health de Admin",
  });
  await section.locator("iframe").scrollIntoViewIfNeeded();
  await expect(
    section
      .frameLocator("iframe")
      .getByRole("heading", { name: "Library Health", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.locator("#sistema-admin")).toHaveCount(1);
  await expect(page.locator("footer")).toContainText("1AC publicado");
  await expect(page.locator("footer")).toContainText("1AD publicado");
});

test("keeps the last health snapshot when task completion cannot refresh it", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/admin-health-demo.html");
  const real = page.getByRole("region", {
    name: "Página real de Admin",
    exact: true,
  });
  await page.getByRole("radio", { name: "Error al actualizar" }).click();
  const issue = real.getByRole("button", {
    name: "Review issues: Unindexed Files",
    exact: true,
  });
  await expect(issue).toBeVisible();
  await real.getByRole("button", { name: "Run scan", exact: true }).click();
  await page
    .getByRole("button", { name: "Completar tarea de muestra", exact: true })
    .click();
  const notice = real.getByRole("alert");
  await expect(notice).toContainText(
    "Could not refresh library health. Showing the last successful snapshot.",
  );
  await expect(issue).toBeVisible();
  await notice.getByRole("button", { name: "Retry" }).click();
  await expect(notice).toHaveCount(0);
  await expect(issue).toBeVisible();
  expect(errors).toEqual([]);
});

for (const width of [1440, 768, 390])
  test.describe(`Library Health ${width}`, () => {
    test.use({
      viewport: { width, height: 1100 },
      isMobile: width === 390,
      hasTouch: width === 390,
    });
    test("keeps text actions, keyboard disclosure, confirmations and isolated sample states", async ({
      page,
    }) => {
      const errors: string[] = [],
        network: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });
      page.on("request", (r) => {
        if (r.url().includes("/api/")) network.push(r.url());
      });
      await page.goto("/admin-health-demo.html");
      const real = page.getByRole("region", {
        name: "Página real de Admin",
        exact: true,
      });
      const toggle = real.getByRole("button", {
        name: "Review issues: Unindexed Files",
        exact: true,
      });
      await expect(toggle).toBeVisible();
      await real
        .locator("summary")
        .filter({ hasText: /^Latest activity/ })
        .click();
      expect(
        await real.getByText("4 issues found", { exact: true }).count(),
      ).toBe(1);
      await expect(toggle).toHaveAccessibleDescription(
        /Unindexed Files 1 issue medium Safe Database.*Checked/,
      );
      await expect(
        real.getByRole("button", {
          name: "Review issues: Artist Layout Fix",
          exact: true,
        }),
      ).toHaveAccessibleDescription(
        /Artist Layout Fix 1 issue high Needs review DB \+ filesystem.*Checked.*Review artist-by-artist before applying this fix\./,
      );
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
      await expect(real.locator("button button,button a")).toHaveCount(0);
      await expect(
        real.locator(
          "svg:not(.lucide-chevron-down):not(.lucide-chevron-up):not(.lucide-loader-circle):not([data-admin-ux=header-run-scan])",
        ),
      ).toHaveCount(0);
      await expect(
        real.getByRole("heading", { name: "Library Health", exact: true }),
      ).toHaveCSS("font-family", /Bricolage Grotesque/);
      await expect(
        real.getByRole("button", { name: "Run scan", exact: true }),
      ).toHaveCSS("font-family", /^"?Roboto"?/);
      await real.getByRole("button", { name: "Run scan", exact: true }).click();
      await page
        .getByRole("button", {
          name: "Completar tarea de muestra",
          exact: true,
        })
        .click();
      await expect(
        real.getByRole("button", { name: "Run scan", exact: true }),
      ).toBeEnabled();
      await expect(
        real.getByText("4 issues found", { exact: true }),
      ).toBeVisible();
      await toggle.focus();
      await page.keyboard.press("Space");
      const region = real.getByRole("region", {
        name: "Unindexed Files issues",
        exact: true,
      });
      await expect(region).toBeVisible();
      await real
        .locator("summary")
        .filter({ hasText: /^Filter issues$/ })
        .click();
      const fields = region.locator(".crate-form-field");
      await expect(fields).toHaveCount(2);
      expect(
        await fields.evaluateAll((nodes) =>
          nodes.map(
            (n) =>
              n.children[1]!.getBoundingClientRect().top -
              n.children[0]!.getBoundingClientRect().bottom,
          ),
        ),
      ).toEqual([8, 8]);
      const coarse = await page.evaluate(
        () => matchMedia("(pointer: coarse)").matches,
      );
      for (const control of await real
        .locator("button:visible,a:visible,summary:visible")
        .all()) {
        const box = await control.boundingBox(),
          pill = await control.getAttribute("aria-pressed");
        // Match layout precision without rejecting a 43.999992 px rendering of 44 px.
        expect(
          Number(Math.min(box!.width, box!.height).toFixed(2)),
        ).toBeGreaterThanOrEqual(pill !== null && !coarse ? 32 : 44);
      }

      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await region
        .getByRole("button", { name: "Mark as resolved", exact: true })
        .click();
      await expect(
        page.getByRole("status", { name: "Última acción de muestra" }),
      ).toContainText("/health-issues/101/resolve");
      await expect(region).toHaveCount(0);
      const artistToggle = real.getByRole("button", {
        name: "Review issues: Artist Layout Fix",
        exact: true,
      });
      const fix = artistToggle
        .locator("xpath=ancestor::article")
        .getByRole("button", {
          name: "Queue repair for Artist Layout Fix",
          exact: true,
        });
      await artistToggle.click();
      await fix.click();
      let dialog = page.getByRole("alertdialog", {
        name: "Queue artist repairs",
      });
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(fix).toBeFocused();
      await fix.click();
      dialog = page.getByRole("alertdialog");
      await dialog
        .getByRole("button", { name: "Queue repairs", exact: true })
        .click();
      await expect(fix).toHaveAttribute("aria-busy", "true");
      await expect(artistToggle).toHaveAttribute("aria-expanded", "true");
      await page
        .getByRole("button", {
          name: "Completar tarea de muestra",
          exact: true,
        })
        .click();
      await expect(artistToggle).toHaveCount(0);
      await expect(
        real.getByText("1 applied, 2 open after revalidation", { exact: true }),
      ).toBeVisible();
      await page.getByRole("radio", { name: "Vacío", exact: true }).click();
      await expect(
        real.getByRole("heading", {
          name: "No open issues recorded",
          exact: true,
        }),
      ).toBeVisible();
      await page.getByRole("radio", { name: "Cargando", exact: true }).click();
      await expect(
        real.getByRole("status", { name: "Loading health issues" }),
      ).toBeVisible();
      await page
        .getByRole("radio", { name: "Sin servicio", exact: true })
        .click();
      await expect(real.getByRole("alert")).toBeVisible();
      await page
        .getByRole("radio", { name: "Sin catálogo", exact: true })
        .click();
      await expect(
        real.getByRole("button", {
          name: "Review issues: Unindexed Files",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        real.getByText("Repair catalog", { exact: true }),
      ).toHaveCount(0);
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
      expect(network).toEqual([]);
      expect(errors).toEqual([]);
    });
  });

test("1AD distinguishes missing, stale and limited real-shaped results", async ({
  page,
}) => {
  await page.goto("/admin-health-demo.html");
  const real = page.getByRole("region", {
    name: "Página real de Admin",
    exact: true,
  });
  await page.getByRole("radio", { name: "Sin resultado", exact: true }).click();
  await expect(
    real.getByRole("heading", {
      name: "No check result available",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    real.getByText("Latest check: unavailable", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("radio", { name: "Desactualizado", exact: true })
    .click();
  await expect(
    real.getByText("Recorded results may be out of date.", { exact: true }),
  ).toBeVisible();
  await expect(
    real.getByRole("heading", { name: "4 recorded issues", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("radio", { name: "Lista limitada", exact: true })
    .click();
  await expect(
    real.getByText("Showing 4 of 603 recorded issues.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("radio", { name: "Severidades mixtas", exact: true })
    .click();
  await expect(real.getByRole("article").first()).toHaveAccessibleName(
    "Unindexed Files",
  );
  await expect(
    real.getByRole("heading", { name: "5 recorded issues", exact: true }),
  ).toBeVisible();
});

test("1AD preserves recorded counts outside the loaded sample", async ({
  page,
}) => {
  await page.goto("/admin-health-demo.html");
  const real = page.getByRole("region", {
    name: "Página real de Admin",
    exact: true,
  });
  await page
    .getByRole("radio", { name: "Lista limitada", exact: true })
    .click();
  await real
    .getByRole("button", {
      name: "Review issues: Unindexed Files",
      exact: true,
    })
    .click();
  await real
    .getByRole("region", { name: "Unindexed Files issues", exact: true })
    .getByRole("button", { name: "Mark as resolved", exact: true })
    .click();
  await expect(
    real.getByRole("heading", { name: "602 recorded issues", exact: true }),
  ).toBeVisible();
  await expect(
    real.getByText("Showing 3 of 602 recorded issues.", { exact: true }),
  ).toBeVisible();
  await real.getByRole("button", { name: "Run scan", exact: true }).click();
  await page
    .getByRole("button", { name: "Completar tarea de muestra", exact: true })
    .click();
  await real
    .locator("summary")
    .filter({ hasText: /^Latest activity/ })
    .click();
  await expect(
    real.getByText("602 issues found", { exact: true }),
  ).toBeVisible();
  await expect(
    real.getByRole("heading", { name: "602 recorded issues", exact: true }),
  ).toBeVisible();
});
