import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { getCollection } from "astro:content";
import { calendar } from "../../data/blog-calendar";
import { t } from "../../i18n";
import { postUrl, publishedPosts } from "../../lib/blog";

export async function GET(context: APIContext) {
  const posts = publishedPosts(await getCollection("blog"), {
    order: calendar.map((entry) => entry.slug),
  });
  return rss({
    title: `${t("blog.title")} · Crate`,
    description: t("blog.lede"),
    site: context.site ?? "https://cratemusic.app",
    trailingSlash: false,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.date,
      link: postUrl(post.id),
      categories: post.data.tags,
    })),
  });
}
