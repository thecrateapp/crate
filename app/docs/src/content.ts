import manifest from "../../../docs/manifest.json";

import { slugify } from "@/lib/utils";

export type DocSection =
  | "start"
  | "architecture"
  | "developer"
  | "operations"
  | "federation"
  | "reference";

const sections: DocSection[] = [
  "start",
  "architecture",
  "developer",
  "operations",
  "federation",
  "reference",
];

export interface DocHeading {
  level: number;
  text: string;
  id: string;
}

interface ManifestDoc {
  sourcePath: string;
  route: string;
  section: DocSection;
  title: string;
  summary: string;
  keywords: string[];
  order: number;
}

type MarkdownLoader = () => Promise<string>;

const loaders: Record<string, MarkdownLoader> = {
  "docs/README.md": () =>
    import("../../../docs/README.md?raw").then((module) => module.default),
  "docs/api.md": () =>
    import("../../../docs/api.md?raw").then((module) => module.default),
  "docs/architecture.md": () =>
    import("../../../docs/architecture.md?raw").then(
      (module) => module.default,
    ),
  "docs/audio-analysis.md": () =>
    import("../../../docs/audio-analysis.md?raw").then(
      (module) => module.default,
    ),
  "docs/enrichment.md": () =>
    import("../../../docs/enrichment.md?raw").then((module) => module.default),
  "docs/technical/00-quickstart.md": () =>
    import("../../../docs/technical/00-quickstart.md?raw").then(
      (module) => module.default,
    ),
  "docs/technical/00b-development-setup.md": () =>
    import("../../../docs/technical/00b-development-setup.md?raw").then(
      (module) => module.default,
    ),
  "docs/technical/01-system-overview.md": () =>
    import("../../../docs/technical/01-system-overview.md?raw").then(
      (module) => module.default,
    ),
  "docs/technical/02-backend-api-and-data.md": () =>
    import("../../../docs/technical/02-backend-api-and-data.md?raw").then(
      (module) => module.default,
    ),
  "docs/technical/03-worker-tasks-and-background-services.md": () =>
    import(
      "../../../docs/technical/03-worker-tasks-and-background-services.md?raw"
    ).then((module) => module.default),
  "docs/technical/04-library-storage-sync-and-imports.md": () =>
    import(
      "../../../docs/technical/04-library-storage-sync-and-imports.md?raw"
    ).then((module) => module.default),
  "docs/technical/05-enrichment-acquisition-and-integrations.md": () =>
    import(
      "../../../docs/technical/05-enrichment-acquisition-and-integrations.md?raw"
    ).then((module) => module.default),
  "docs/technical/06-audio-analysis-similarity-and-discovery.md": () =>
    import(
      "../../../docs/technical/06-audio-analysis-similarity-and-discovery.md?raw"
    ).then((module) => module.default),
  "docs/technical/07-auth-users-social-and-sessions.md": () =>
    import(
      "../../../docs/technical/07-auth-users-social-and-sessions.md?raw"
    ).then((module) => module.default),
  "docs/technical/08-frontends-admin-and-listen.md": () =>
    import("../../../docs/technical/08-frontends-admin-and-listen.md?raw").then(
      (module) => module.default,
    ),
  "docs/technical/09-playback-realtime-and-subsonic.md": () =>
    import(
      "../../../docs/technical/09-playback-realtime-and-subsonic.md?raw"
    ).then((module) => module.default),
  "docs/technical/10-development-deployment-and-operations.md": () =>
    import(
      "../../../docs/technical/10-development-deployment-and-operations.md?raw"
    ).then((module) => module.default),
  "docs/technical/developer-guide.md": () =>
    import("../../../docs/technical/developer-guide.md?raw").then(
      (module) => module.default,
    ),
  "docs/technical/deployment-profiles.md": () =>
    import("../../../docs/technical/deployment-profiles.md?raw").then(
      (module) => module.default,
    ),
  "docs/technical/federation-capacity.md": () =>
    import("../../../docs/technical/federation-capacity.md?raw").then(
      (module) => module.default,
    ),
  "docs/technical/federation-imports.md": () =>
    import("../../../docs/technical/federation-imports.md?raw").then(
      (module) => module.default,
    ),
  "docs/technical/federation-key-management.md": () =>
    import("../../../docs/technical/federation-key-management.md?raw").then(
      (module) => module.default,
    ),
  "docs/technical/federation-operations-runbook.md": () =>
    import("../../../docs/technical/federation-operations-runbook.md?raw").then(
      (module) => module.default,
    ),
  "docs/technical/federation-overview.md": () =>
    import("../../../docs/technical/federation-overview.md?raw").then(
      (module) => module.default,
    ),
  "docs/technical/federation-production-acceptance.md": () =>
    import(
      "../../../docs/technical/federation-production-acceptance.md?raw"
    ).then((module) => module.default),
  "docs/technical/federation-protocol.md": () =>
    import("../../../docs/technical/federation-protocol.md?raw").then(
      (module) => module.default,
    ),
  "docs/technical/federation-slos.md": () =>
    import("../../../docs/technical/federation-slos.md?raw").then(
      (module) => module.default,
    ),
  "docs/technical/federation-streaming-benchmark.md": () =>
    import(
      "../../../docs/technical/federation-streaming-benchmark.md?raw"
    ).then((module) => module.default),
  "docs/technical/federation-threat-model.md": () =>
    import("../../../docs/technical/federation-threat-model.md?raw").then(
      (module) => module.default,
    ),
  "docs/technical/federation-upgrade-and-rollback.md": () =>
    import(
      "../../../docs/technical/federation-upgrade-and-rollback.md?raw"
    ).then((module) => module.default),
  "docs/technical/operations.md": () =>
    import("../../../docs/technical/operations.md?raw").then(
      (module) => module.default,
    ),
  "docs/technical/ops-runbook.md": () =>
    import("../../../docs/technical/ops-runbook.md?raw").then(
      (module) => module.default,
    ),
};

export interface DocEntry extends ManifestDoc {
  id: string;
  slug: string;
  load: MarkdownLoader;
}

export interface LoadedDoc {
  markdown: string;
  headings: DocHeading[];
}

function stripFrontmatter(markdown: string): string {
  if (!markdown.startsWith("---\n")) return markdown;
  const end = markdown.indexOf("\n---\n", 4);
  return end === -1 ? markdown : markdown.slice(end + 5).trimStart();
}

function extractHeadings(markdown: string): DocHeading[] {
  const headings: DocHeading[] = [];
  const seen = new Map<string, number>();

  for (const line of markdown.split("\n")) {
    const match = /^(#{2,4})\s+(.+)$/.exec(line.trim());
    if (!match) continue;
    const hashes = match[1];
    const rawText = match[2];
    if (!hashes || !rawText) continue;

    const text = rawText.trim();
    const baseId = slugify(text);
    const duplicate = seen.get(baseId) ?? 0;
    seen.set(baseId, duplicate + 1);
    headings.push({
      level: hashes.length,
      text,
      id: duplicate === 0 ? baseId : `${baseId}-${duplicate + 1}`,
    });
  }

  return headings;
}

function isDocSection(value: string): value is DocSection {
  return sections.includes(value as DocSection);
}

const manifestDocs = manifest as ManifestDoc[];

export const docs: DocEntry[] = [...manifestDocs]
  .map((meta) => {
    if (!isDocSection(meta.section)) {
      throw new Error(`Unknown documentation section: ${meta.section}`);
    }

    const load = loaders[meta.sourcePath];
    if (!load) {
      throw new Error(`No Markdown loader configured for ${meta.sourcePath}`);
    }

    const routeParts = meta.route.split("/").filter(Boolean);
    const slug = routeParts[routeParts.length - 1];
    if (!slug) throw new Error(`Invalid documentation route: ${meta.route}`);

    return { ...meta, id: meta.sourcePath, slug, load };
  })
  .sort(
    (left, right) =>
      left.order - right.order || left.title.localeCompare(right.title),
  );

export const docsBySection: Record<DocSection, DocEntry[]> = sections.reduce(
  (result, section) => {
    result[section] = docs.filter((doc) => doc.section === section);
    return result;
  },
  {} as Record<DocSection, DocEntry[]>,
);

export const sectionMeta: Record<
  DocSection,
  { label: string; description: string }
> = {
  start: {
    label: "Start here",
    description: "Choose the supported home-hosting or local-development path.",
  },
  architecture: {
    label: "Architecture",
    description: "Service ownership, data flow and subsystem boundaries.",
  },
  developer: {
    label: "Developer guide",
    description:
      "Repository map, contribution workflow and implementation rules.",
  },
  operations: {
    label: "Operations",
    description:
      "Deployment profiles, runtime ownership and recovery procedures.",
  },
  federation: {
    label: "Federation",
    description:
      "Node trust, catalog synchronization and controlled rollout guidance.",
  },
  reference: {
    label: "Reference",
    description: "Focused supporting references and documentation policy.",
  },
};

const loadedDocs = new Map<string, Promise<LoadedDoc>>();

export function loadDoc(doc: DocEntry): Promise<LoadedDoc> {
  const existing = loadedDocs.get(doc.id);
  if (existing) return existing;

  const pending = doc.load().then((source) => {
    const markdown = stripFrontmatter(source);
    return { markdown, headings: extractHeadings(markdown) };
  });
  loadedDocs.set(doc.id, pending);
  return pending;
}

export function getDoc(
  section: string | undefined,
  slug: string | undefined,
): DocEntry | undefined {
  return docs.find((doc) => doc.section === section && doc.slug === slug);
}

export function getAdjacentDocs(doc: DocEntry): {
  previous?: DocEntry;
  next?: DocEntry;
} {
  const inSection = docsBySection[doc.section];
  const index = inSection.findIndex((entry) => entry.id === doc.id);
  return {
    previous: index > 0 ? inSection[index - 1] : undefined,
    next:
      index >= 0 && index < inSection.length - 1
        ? inSection[index + 1]
        : undefined,
  };
}

function resolveSourcePath(sourcePath: string, target: string): string {
  const base = sourcePath.split("/").slice(0, -1);
  const resolved = [...base, ...target.split("/")].reduce<string[]>(
    (segments, segment) => {
      if (!segment || segment === ".") return segments;
      if (segment === "..") {
        segments.pop();
        return segments;
      }
      segments.push(segment);
      return segments;
    },
    [],
  );
  return resolved.join("/");
}

export function resolveDocHref(sourcePath: string, href: string): string {
  if (!href || href.startsWith("#") || href.startsWith("/")) return href;
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) return href;

  const [target, fragment] = href.split("#", 2);
  if (!target?.endsWith(".md")) return href;

  const targetPath = resolveSourcePath(sourcePath, target);
  const targetDoc = docs.find((doc) => doc.sourcePath === targetPath);
  if (!targetDoc) return href;
  return `${targetDoc.route}${fragment ? `#${fragment}` : ""}`;
}

export function sourceUrl(sourcePath: string): string {
  return `https://github.com/thecrateapp/crate/blob/main/${sourcePath}`;
}
