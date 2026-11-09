import { getCollection } from "astro:content";
import type { APIContext } from "astro";
import {
  loadGitHubSource, preloadGitHubSources, previewSourcesForPosts, type GitHubPreviewLink,
} from "../../../lib/github-preview-source";

export async function getStaticPaths() {
  const references = previewSourcesForPosts(await getCollection("blog"), import.meta.env.DEV);
  // A build loads every referenced file up front (bounded and retried) and fails
  // with the full list of broken links. Dev loads lazily when a viewer opens.
  if (!import.meta.env.DEV) await preloadGitHubSources(references);
  return references.map((reference) => ({ params: { id: reference.key }, props: { reference } }));
}

export async function GET({ props }: APIContext) {
  const snapshot = await loadGitHubSource(props.reference as GitHubPreviewLink);
  return new Response(JSON.stringify(snapshot), {
    headers: { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff" },
  });
}
