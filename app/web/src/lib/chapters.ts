export function chapterId(index: number, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${String(index).padStart(2, "0")}-${slug}`;
}

export type Status =
  | "in-development"
  | "optional-llm"
  | "opt-in"
  | "available"
  | "planned";

export type ChapterStatus = "in-development" | "opt-in";

export interface Feature {
  title: string;
  body: string;
  status?: Status;
  link?: { href: string; label: string };
}

export interface ChapterContent {
  title: string;
  id?: string;
  lede: string[];
  status?: ChapterStatus;
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
