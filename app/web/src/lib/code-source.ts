export interface CodeSource {
  path: string;
  startLine?: number;
  label: string;
  url: string;
}

const REPO = "https://github.com/thecrateapp/crate";
const FULL_COMMIT = /^[0-9a-f]{40}$/;
const RANGE = /^L(\d+)(?:-L(\d+))?$/;

export function codeSource(
  source: string,
  commit: string | undefined,
): CodeSource {
  if (!commit || !FULL_COMMIT.test(commit)) {
    throw new Error(
      `Code source "${source}" needs commit="<40-character commit>" so the link never drifts with main`,
    );
  }
  const [path, fragment] = source.split("#");
  const base = `${REPO}/blob/${commit}/${path}`;
  if (!fragment) return { path, label: "", url: base };

  const match = fragment.match(RANGE);
  const start = Number(match?.[1]);
  const end = match?.[2] ? Number(match[2]) : start;
  if (!match || end < start) {
    throw new Error(`Code source "${source}" has an invalid line range`);
  }
  const single = end === start;
  return {
    path,
    startLine: start,
    label: single ? `L${start}` : `L${start}–${end}`,
    url: `${base}#${single ? `L${start}` : `L${start}-L${end}`}`,
  };
}
