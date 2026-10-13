export function chapterId(index: number, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${String(index).padStart(2, "0")}-${slug}`;
}

export interface Feature {
  title: string;
  body: string;
  status?: "coming-soon";
}

export interface Step {
  title: string;
  body: string;
}
