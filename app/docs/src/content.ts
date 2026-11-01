import manifest from "../../../docs/manifest.json";
import mcpContractUrl from "../../../docs/technical/crate-mcp-v1.json?url";
import mcpLoadEvidenceUrl from "../../../docs/technical/crate-mcp-phase7-load.json?url";

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
  "docs/technical/ai-agents.md": () =>
    import("../../../docs/technical/ai-agents.md?raw").then(
      (module) => module.default,
    ),
  "docs/technical/smart-mix-operations.md": () =>
    import("../../../docs/technical/smart-mix-operations.md?raw").then(
      (module) => module.default,
    ),
  "docs/technical/smart-mix-design.md": () =>
    import("../../../docs/technical/smart-mix-design.md?raw").then(
      (module) => module.default,
    ),
  "docs/technical/smart-mix-implementation-plan.md": () =>
    import("../../../docs/technical/smart-mix-implementation-plan.md?raw").then(
      (module) => module.default,
    ),
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
  "docs/technical/00a-install-with-ai.md": () =>
    import("../../../docs/technical/00a-install-with-ai.md?raw").then(
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
  "docs/technical/opensubsonic.md": () =>
    import("../../../docs/technical/opensubsonic.md?raw").then(
      (module) => module.default,
    ),
  "docs/technical/11-crate-mcp.md": () =>
    import("../../../docs/technical/11-crate-mcp.md?raw").then(
      (module) => module.default,
    ),
  "docs/technical/crate-mcp.md": () =>
    import("../../../docs/technical/crate-mcp.md?raw").then(
      (module) => module.default,
    ),
  "docs/technical/crate-mcp-distribution.md": () =>
    import("../../../docs/technical/crate-mcp-distribution.md?raw").then(
      (module) => module.default,
    ),
  "docs/technical/crate-mcp-acquisition.md": () =>
    import("../../../docs/technical/crate-mcp-acquisition.md?raw").then(
      (module) => module.default,
    ),
  "docs/technical/tauri-desktop-support.md": () =>
    import("../../../docs/technical/tauri-desktop-support.md?raw").then(
      (module) => module.default,
    ),
  "docs/operators/cast-receiver.md": () =>
    import("../../../docs/operators/cast-receiver.md?raw").then(
      (module) => module.default,
    ),
  "docs/testing/cast-release-checklist.md": () =>
    import("../../../docs/testing/cast-release-checklist.md?raw").then(
      (module) => module.default,
    ),
  "docs/technical/10-development-deployment-and-operations.md": () =>
    import(
      "../../../docs/technical/10-development-deployment-and-operations.md?raw"
    ).then((module) => module.default),
  "docs/technical/artist-hero-theming-rollout.md": () =>
    import("../../../docs/technical/artist-hero-theming-rollout.md?raw").then(
      (module) => module.default,
    ),
  "docs/technical/artwork-delivery.md": () =>
    import("../../../docs/technical/artwork-delivery.md?raw").then(
      (module) => module.default,
    ),
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
  "docs/technical/hermes-plan-confirmation.md": () =>
    import("../../../docs/technical/hermes-plan-confirmation.md?raw").then(
      (module) => module.default,
    ),
  "docs/technical/hermes-operator-release.md": () =>
    import("../../../docs/technical/hermes-operator-release.md?raw").then(
      (module) => module.default,
    ),
  "docs/technical/crate-operator.md": () =>
    import("../../../docs/technical/crate-operator.md?raw").then(
      (module) => module.default,
    ),
  "docs/technical/upgrade-v2-to-v3.md": () =>
    import("../../../docs/technical/upgrade-v2-to-v3.md?raw").then(
      (module) => module.default,
    ),
  "docs/technical/operations.md": () =>
    import("../../../docs/technical/operations.md?raw").then(
      (module) => module.default,
    ),
  "docs/technical/monitoring.md": () =>
    import("../../../docs/technical/monitoring.md?raw").then(
      (module) => module.default,
    ),
  "docs/technical/crate-agent.md": () =>
    import("../../../docs/technical/crate-agent.md?raw").then(
      (module) => module.default,
    ),
  "docs/technical/local-media-delivery-slos.md": () =>
    import("../../../docs/technical/local-media-delivery-slos.md?raw").then(
      (module) => module.default,
    ),
  "docs/technical/listen-design-system-visual-qa.md": () =>
    import(
      "../../../docs/technical/listen-design-system-visual-qa.md?raw"
    ).then((module) => module.default),
  "docs/technical/ops-runbook.md": () =>
    import("../../../docs/technical/ops-runbook.md?raw").then(
      (module) => module.default,
    ),
  "docs/technical/storage-retention.md": () =>
    import("../../../docs/technical/storage-retention.md?raw").then(
      (module) => module.default,
    ),
};

const documentAssets: Record<string, string> = {
  "docs/technical/crate-mcp-v1.json": mcpContractUrl,
  "docs/technical/crate-mcp-phase7-load.json": mcpLoadEvidenceUrl,
};

export interface DocEntry extends ManifestDoc {
  id: string;
  slug: string;
  load: MarkdownLoader;
}

export interface DocMeta {
  verified?: string;
  audience: string[];
}

export interface LoadedDoc {
  markdown: string;
  headings: DocHeading[];
  meta: DocMeta;
}

export function splitFrontmatter(source: string): {
  frontmatter: string;
  markdown: string;
} {
  if (!source.startsWith("---\n")) return { frontmatter: "", markdown: source };
  const end = source.indexOf("\n---\n", 4);
  if (end === -1) return { frontmatter: "", markdown: source };
  return {
    frontmatter: source.slice(4, end),
    markdown: source.slice(end + 5).trimStart(),
  };
}

export function parseDocMeta(frontmatter: string): DocMeta {
  const field = (name: string) =>
    new RegExp(`^${name}:[ \\t]*(.*)$`, "m").exec(frontmatter)?.[1]?.trim();
  const audience = field("audience") ?? "";
  return {
    verified: field("verified") || undefined,
    audience: audience
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  };
}

export function headingText(raw: string): string {
  return raw
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/\s+#+\s*$/, "")
    .trim();
}

export function extractHeadings(markdown: string): DocHeading[] {
  const headings: DocHeading[] = [];
  const seen = new Map<string, number>();
  let fence: string | null = null;

  for (const line of markdown.split("\n")) {
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch?.[1]) {
      const marker = fenceMatch[1];
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length)
        fence = null;
      continue;
    }
    if (fence) continue;

    const match = /^(#{2,4})\s+(.+)$/.exec(line.trim());
    if (!match) continue;
    const hashes = match[1];
    const rawText = match[2];
    if (!hashes || !rawText) continue;

    const text = headingText(rawText);
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

export function filterDocs(query: string): Record<DocSection, DocEntry[]> {
  const term = query.trim().toLowerCase();
  if (!term) return docsBySection;

  return sections.reduce(
    (result, section) => {
      result[section] = docsBySection[section].filter((doc) =>
        `${doc.title} ${doc.summary} ${doc.keywords.join(" ")}`
          .toLowerCase()
          .includes(term),
      );
      return result;
    },
    {} as Record<DocSection, DocEntry[]>,
  );
}

const loadedDocs = new Map<string, Promise<LoadedDoc>>();

export function loadDoc(doc: DocEntry): Promise<LoadedDoc> {
  const existing = loadedDocs.get(doc.id);
  if (existing) return existing;

  const pending = doc.load().then((source) => {
    const { frontmatter, markdown } = splitFrontmatter(source);
    return {
      markdown,
      headings: extractHeadings(markdown),
      meta: parseDocMeta(frontmatter),
    };
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
  if (!target) return href;

  const targetPath = resolveSourcePath(sourcePath, target);
  const asset = documentAssets[targetPath];
  if (asset) return `${asset}${fragment ? `#${fragment}` : ""}`;
  if (!target.endsWith(".md")) return href;
  const targetDoc = docs.find((doc) => doc.sourcePath === targetPath);
  if (!targetDoc) return href;
  return `${targetDoc.route}${fragment ? `#${fragment}` : ""}`;
}

export function sourceUrl(sourcePath: string): string {
  return `https://github.com/thecrateapp/crate/blob/main/${sourcePath}`;
}
