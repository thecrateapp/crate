export function chapterId(index: number, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${String(index).padStart(2, "0")}-${slug}`;
}

export type Status = "coming-soon" | "optional-llm";

export interface Feature {
  title: string;
  body: string;
  status?: Status;
}

export interface ChapterContent {
  title: string;
  lede: string[];
  status?: "coming-soon";
  features?: Feature[];
}

export interface PageIntro {
  meta: { title: string; description: string };
  eyebrow: string;
  title: string;
  lede: string;
}

export interface Step {
  title: string;
  body: string;
}
