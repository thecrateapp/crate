import type { Director } from "../director";

export function content(director: Director) {
  return director.page.getByTestId("listen-content");
}

export async function openLibrary(director: Director) {
  await director.goto(
    director.device === "desktop"
      ? "/library?tab=albums"
      : "/collection/albums",
  );
  await content(director).locator("article").first().waitFor();
}

export async function openFirstAlbum(director: Director) {
  await openLibrary(director);
  const card = content(director)
    .locator("article")
    .first()
    .getByRole("button", { name: /^(?!Play )/ })
    .first();
  await director.click(card);
  await director.page.getByTestId("album-action-row").waitFor();
}

export function albumAction(director: Director, name: string) {
  return director.page
    .getByTestId("album-action-row")
    .getByRole("button", { name, exact: true });
}
