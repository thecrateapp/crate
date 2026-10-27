import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const manifesto = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/manifesto" }),
  schema: z.object({ title: z.string(), description: z.string() }),
});

export const collections = { manifesto };
