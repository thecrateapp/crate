import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const manifesto = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/manifesto" }),
  schema: z.object({ title: z.string(), description: z.string() }),
});

const blog = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string().max(90),
    description: z.string().max(160),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    draft: z.boolean().default(false),
    tags: z.array(z.string()).default([]),
    sources: z.array(z.string()).min(1),
  }),
});

export const collections = { manifesto, blog };
