import { expect, test } from "@playwright/test";

const scenes: [string, string[]][] = [
  ["admin-controls", ["Servicio de IA disponible"]],
  ["admin-dashboard", ["Permitir mantenimiento de muestra"]],
  ["admin-health", ["Permitir escaneo de muestra"]],
  ["admin-trash", ["La siguiente tarea fallará"]],
  ["admin-bandcamp", ["Fallar la siguiente acción"]],
  ["admin-discovery", ["Fallar el siguiente envío"]],
  ["admin-new-releases", ["Fallar el siguiente envío"]],
  [
    "admin-global-catalog",
    ["Permitir gestión de muestra", "Fallar el siguiente envío"],
  ],
  ["admin-users", ["Solo lectura", "La siguiente acción fallará"]],
  [
    "admin-translations",
    ["Fallar la siguiente acción", "Catálogo JSON de muestra disponible"],
  ],
  ["admin-upcoming", ["Fallar la siguiente acción"]],
  ["admin-playlists", ["Fallar la siguiente acción"]],
  [
    "admin-playlist-editor",
    ["Fallar la siguiente acción", "IA disponible en muestra"],
  ],
  ["badge-normalization", ["First Song · FLAC"]],
];
for (const [scene, labels] of scenes) {
  test(`${scene} uses the shared checkbox, inline caption and original state callbacks`, async ({
    page,
  }) => {
    await page.goto(`/${scene}-demo.html`);
    for (const name of labels) {
      const control = page.getByRole("checkbox", { name, exact: true });
      await expect(control).toHaveAttribute("data-slot", "checkbox");
      const field = page
        .locator('[data-slot="form-field"][data-layout="inline"]')
        .filter({ has: control });
      await expect(field).toHaveCount(1);
      const caption = field.locator('[data-slot="form-field-label"]');
      await expect(caption).toHaveCSS("font-family", /JetBrains/);
      await expect(caption).toHaveCSS("font-size", "11px");
      const before = await control.isChecked();
      await caption.click();
      await expect(control).toBeChecked({ checked: !before });
    }
  });
}

test("the original form samples use the same MonoLabel for binary choices", async ({
  page,
}) => {
  await page.goto("/#formularios");
  const section = page.locator("#formularios");
  for (const name of [
    "Reproducción automática",
    "Conservar la cola de muestra",
    "Selección parcial",
  ]) {
    const caption = section.getByText(name, { exact: true });
    await expect(caption).toHaveCSS("font-family", /JetBrains/);
    await expect(caption).toHaveCSS("font-size", "11px");
    await expect(caption).toHaveCSS("letter-spacing", "1.54px");
    await expect(caption).toHaveCSS("text-transform", "uppercase");
  }
  const checkbox = section.getByRole("checkbox", {
    name: "Conservar la cola de muestra",
  });
  const before = await checkbox.isChecked();
  await section
    .getByText("Conservar la cola de muestra", { exact: true })
    .click();
  await expect(checkbox).toBeChecked({ checked: !before });
  const toggle = section.getByRole("switch", {
    name: "Reproducción automática",
  });
  const wasChecked = await toggle.isChecked();
  await section.getByText("Reproducción automática", { exact: true }).click();
  await expect(toggle).toBeChecked({ checked: !wasChecked });
});
