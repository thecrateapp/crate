import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  contactSheetArgs,
  declaredSoundtracks,
  renderAuditReport,
  type MediaFinding,
} from "./src/audit";

const run = promisify(execFile);
const here = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(here, "../../app/web/public");
const filmsModule = join(here, "../../app/web/src/content/films.ts");
const outDir = join(here, "out/audit");
const folders = ["screencast", "film"];

async function probe(path: string) {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_type",
    "-of",
    "json",
    path,
  ]);
  const data = JSON.parse(stdout) as {
    format: { duration: string };
    streams: { codec_type: string }[];
  };
  return {
    durationSeconds: Number(data.format.duration),
    hasAudio: data.streams.some((stream) => stream.codec_type === "audio"),
  };
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const findings: MediaFinding[] = [];
  for (const folder of folders) {
    const entries = await readdir(join(publicDir, folder));
    for (const entry of entries
      .filter((name) => extname(name) === ".mp4")
      .sort()) {
      const input = join(publicDir, folder, entry);
      const { durationSeconds, hasAudio } = await probe(input);
      const sheet = join(outDir, `${folder}-${basename(entry, ".mp4")}.jpg`);
      await run("ffmpeg", contactSheetArgs(input, sheet, durationSeconds));
      findings.push({
        path: `${folder}/${entry}`,
        durationSeconds,
        hasAudio,
        sheet: relative(here, sheet),
      });
    }
  }
  const soundtracks = declaredSoundtracks(await readFile(filmsModule, "utf8"));
  const report = renderAuditReport(
    findings,
    soundtracks,
    new Date().toISOString().slice(0, 10),
  );
  await writeFile(join(outDir, "report.md"), report);
  console.log(
    `${findings.length} files audited, ${soundtracks.length} declared soundtracks`,
  );
  console.log(relative(process.cwd(), join(outDir, "report.md")));
}

await main();
