// Brings the Crate web's static fonts and icons into public/ so this site serves the
// same files at the same URLs that tokens.css and the web layout reference. The copies
// are git-ignored: app/web stays the only source.
import { cpSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("../../web/public/", import.meta.url));
const here = fileURLToPath(new URL("../public/", import.meta.url));

for (const dir of ["fonts", "icons"]) {
  const from = `${web}${dir}`;
  if (!existsSync(from))
    throw new Error(`missing ${from}: app/web/public is required`);
  rmSync(`${here}${dir}`, { recursive: true, force: true });
  cpSync(from, `${here}${dir}`, { recursive: true });
}
