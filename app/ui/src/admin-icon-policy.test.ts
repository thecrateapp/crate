import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  analyzeSource,
  buildInventory,
  type IconEntry,
} from "../../../scripts/design-system/admin-icon-inventory.mjs";

const repo = resolve(process.cwd(), "../..");
const scope = ["Sidebar", "CommandPalette", "Shell", "SearchBar"]
  .map((name) => `app/ui/src/components/layout/${name}.tsx`)
  .concat([
    "app/ui/src/components/ui/AIButton.tsx",
    "app/ui/src/components/ui/AdminSelect.tsx",
    "app/ui/src/components/admin/ops-surfaces.tsx",
    "app/ui/src/components/layout/PageHeader.tsx",
    "app/ui/src/pages/Logs.tsx",
    "app/ui/src/pages/Stack.tsx",
    "app/ui/src/pages/Analysis.tsx",
    "app/ui/src/pages/Dashboard.tsx",
    "app/ui/src/pages/SystemHealth.tsx",
    "app/ui/src/pages/Health.tsx",
    "app/ui/src/pages/Trash.tsx",
    "app/ui/src/pages/Contributions.tsx",
    "app/ui/src/pages/Bandcamp.tsx",
    "app/ui/src/pages/Discover.tsx",
    "app/ui/src/pages/NewReleases.tsx",
    "app/ui/src/pages/GlobalCatalog.tsx",
    "app/ui/src/pages/Roles.tsx",
    "app/ui/src/pages/Users.tsx",
    "app/ui/src/pages/I18nReview.tsx",
    "app/ui/src/pages/Upcoming.tsx",
    "app/ui/src/pages/Playlists.tsx",
    "app/ui/src/pages/PlaylistEditor.tsx",
    "app/ui/src/components/playlists/PlaylistArtwork.tsx",
    "app/ui/src/components/shows/ShowCard.tsx",
  ]);
// Reviewed shared Select contract: disclosure, option selection and search glyphs are UX.
// The Admin wrapper itself is checked directly; no arbitrary wrapper or icon prop is exempt.
const approvedControls = new Map([
  // Reviewed composition owns no glyph; its shared primitives are scanned directly.
  [
    "app/ui/src/pages/PlaylistEditor.tsx:@/components/layout/PageHeader",
    { component: "PageHeaderAction", limit: 4 },
  ],
  [
    "app/ui/src/pages/Dashboard.tsx:@/components/layout/PageHeader",
    { component: "PageHeaderAction", limit: 2 },
  ],
  [
    "app/ui/src/pages/Analysis.tsx:@/components/layout/PageHeader",
    { component: "PageHeaderAction", limit: 5 },
  ],
  [
    "app/ui/src/pages/SystemHealth.tsx:@/components/layout/PageHeader",
    { component: "PageHeaderAction", limit: 1 },
  ],
  [
    "app/ui/src/pages/Trash.tsx:@/components/layout/PageHeader",
    { component: "PageHeaderAction", limit: 2 },
  ],
  [
    "app/ui/src/pages/Contributions.tsx:@/components/layout/PageHeader",
    { component: "PageHeaderAction", limit: 1 },
  ],
  [
    "app/ui/src/pages/Discover.tsx:@/components/layout/PageHeader",
    { component: "PageHeaderAction", limit: 3 },
  ],
  [
    "app/ui/src/pages/GlobalCatalog.tsx:@/components/layout/PageHeader",
    { component: "PageHeaderAction", limit: 3 },
  ],
  [
    "app/ui/src/pages/I18nReview.tsx:@/components/layout/PageHeader",
    { component: "PageHeaderAction", limit: 1 },
  ],
  [
    "app/ui/src/pages/Logs.tsx:@/components/layout/PageHeader",
    { component: "PageHeaderAction", limit: 2 },
  ],
  [
    "app/ui/src/pages/Stack.tsx:@/components/layout/PageHeader",
    { component: "PageHeaderAction", limit: 1 },
  ],
  [
    "app/ui/src/pages/Health.tsx:@/components/layout/PageHeader",
    { component: "PageHeaderAction", limit: 1 },
  ],
  [
    "app/ui/src/pages/Bandcamp.tsx:@/components/layout/PageHeader",
    { component: "PageHeaderAction", limit: 3 },
  ],
  [
    "app/ui/src/pages/NewReleases.tsx:@/components/layout/PageHeader",
    { component: "PageHeaderAction", limit: 3 },
  ],
  [
    "app/ui/src/pages/Users.tsx:@/components/layout/PageHeader",
    { component: "PageHeaderAction", limit: 2 },
  ],
  [
    "app/ui/src/pages/Upcoming.tsx:@/components/layout/PageHeader",
    { component: "PageHeaderAction", limit: 5 },
  ],
  [
    "app/ui/src/pages/Playlists.tsx:@/components/layout/PageHeader",
    { component: "PageHeaderAction", limit: 5 },
  ],
  [
    "app/ui/src/pages/PlaylistEditor.tsx:@/components/ui/AdminSelect",
    { component: "AdminSelect", limit: 7 },
  ],
  [
    "app/ui/src/pages/PlaylistEditor.tsx:@/components/ui/AIButton",
    { component: "AIButton", limit: 2 },
  ],
  [
    "app/ui/src/pages/PlaylistEditor.tsx:@/components/playlists/PlaylistArtwork",
    { component: "PlaylistArtwork", limit: 2 },
  ],

  [
    "app/ui/src/pages/Playlists.tsx:@/components/ui/AdminSelect",
    { component: "AdminSelect", limit: 8 },
  ],
  [
    "app/ui/src/pages/Playlists.tsx:@crate/ui/composites/ConfirmDialog",
    { component: "ConfirmDialog", limit: 1 },
  ],
  [
    "app/ui/src/pages/Playlists.tsx:@/components/playlists/PlaylistArtwork",
    { component: "PlaylistArtwork", limit: 1 },
  ],
  [
    "app/ui/src/pages/Upcoming.tsx:@/components/ui/AdminSelect",
    { component: "AdminSelect", limit: 2 },
  ],
  [
    "app/ui/src/pages/Upcoming.tsx:@/components/shows/ShowCard",
    { component: "ShowCard", limit: 2 },
  ],
  [
    "app/ui/src/pages/Users.tsx:@crate/ui/shadcn/dialog",
    { component: "DialogContent", limit: 4 },
  ],
  [
    "app/ui/src/pages/Users.tsx:@crate/ui/composites/ConfirmDialog",
    { component: "ConfirmDialog", limit: 1 },
  ],
  [
    "app/ui/src/pages/NewReleases.tsx:@crate/ui/primitives/ErrorState",
    { component: "ErrorState", limit: 1 },
  ],
  [
    "app/ui/src/pages/NewReleases.tsx:@/components/ui/AdminSelect",
    { component: "AdminSelect", limit: 1 },
  ],
  [
    "app/ui/src/pages/Discover.tsx:@crate/ui/primitives/ErrorState",
    { component: "ErrorState", limit: 1 },
  ],
  [
    "app/ui/src/pages/Trash.tsx:@crate/ui/composites/ConfirmDialog",
    { component: "ConfirmDialog", limit: 2 },
  ],
  [
    "app/ui/src/pages/Health.tsx:@crate/ui/primitives/ErrorState",
    { component: "ErrorState", limit: 1 },
  ],
  [
    "app/ui/src/pages/Health.tsx:@crate/ui/composites/ConfirmDialog",
    { component: "ConfirmDialog", limit: 1 },
  ],
  [
    "app/ui/src/pages/Dashboard.tsx:@crate/ui/primitives/AppModal",
    { component: "AppModal", limit: 1 },
  ],
  [
    "app/ui/src/pages/Dashboard.tsx:@crate/ui/primitives/ErrorState",
    { component: "ErrorState", limit: 1 },
  ],
  [
    "app/ui/src/pages/Dashboard.tsx:@crate/ui/composites/ConfirmDialog",
    { component: "ConfirmDialog", limit: 2 },
  ],
  [
    "app/ui/src/pages/Analysis.tsx:@crate/ui/primitives/ErrorState",
    { component: "ErrorState", limit: 2 },
  ],
  [
    "app/ui/src/pages/Logs.tsx:@/components/ui/AdminSelect",
    { component: "AdminSelect", limit: 2 },
  ],
  [
    "app/ui/src/pages/Logs.tsx:@crate/ui/primitives/ErrorState",
    { component: "ErrorState", limit: 1 },
  ],
  [
    "app/ui/src/pages/Stack.tsx:@crate/ui/primitives/ErrorState",
    { component: "ErrorState", limit: 1 },
  ],
  [
    "app/ui/src/pages/Stack.tsx:@crate/ui/composites/ConfirmDialog",
    { component: "ConfirmDialog", limit: 1 },
  ],
  [
    "app/ui/src/components/layout/Sidebar.tsx:@/components/ui/AdminSelect",
    { component: "AdminSelect", limit: 1 },
  ],
]);
// Diego's 1W steering explicitly retains UX glyphs. Each concrete site remains bounded.
const approvedUx = new Map([
  ["Playlists:playlists-open-editor", ["lucide-react", "Pencil"]],
  ["Playlists:playlists-deactivate", ["lucide-react", "PowerOff"]],
  ["Playlists:playlists-activate", ["lucide-react", "Power"]],
  ["Playlists:playlists-delete", ["lucide-react", "Trash2"]],
  // Explicit all-header adoption requested by Diego; one bounded site per action.
  ["Dashboard:header-refresh", ["lucide-react", "RefreshCw"]],
  ["Dashboard:header-maintenance", ["lucide-react", "Wrench"]],
  ["Analysis:header-refresh", ["lucide-react", "RefreshCw"]],
  ["Analysis:header-backfill-fingerprints", ["lucide-react", "Fingerprint"]],
  ["Analysis:header-recompute-popularity", ["lucide-react", "TrendingUp"]],
  ["Analysis:header-recompute-bliss", ["lucide-react", "Orbit"]],
  ["Analysis:header-re-analyze-all", ["lucide-react", "AudioLines"]],
  ["SystemHealth:header-refresh-metrics", ["lucide-react", "RefreshCw"]],
  ["Trash:header-refresh", ["lucide-react", "RefreshCw"]],
  ["Trash:header-empty-trash", ["lucide-react", "Trash2"]],
  ["Contributions:header-refresh", ["lucide-react", "RefreshCw"]],
  ["Discover:header-refresh", ["lucide-react", "RefreshCw"]],
  ["Discover:header-recompute-gaps", ["lucide-react", "ChartNoAxesCombined"]],
  ["Discover:header-check-releases", ["lucide-react", "Radar"]],
  ["GlobalCatalog:header-refresh", ["lucide-react", "RefreshCw"]],
  ["GlobalCatalog:header-reconcile", ["lucide-react", "GitMerge"]],
  ["GlobalCatalog:header-full-rebuild", ["lucide-react", "DatabaseBackup"]],
  ["I18nReview:header-refresh", ["lucide-react", "RefreshCw"]],
  ["Logs:header-refresh", ["lucide-react", "RefreshCw"]],
  ["Stack:header-refresh", ["lucide-react", "RefreshCw"]],
  ["Health:header-run-scan", ["lucide-react", "ScanSearch"]],
  ["Bandcamp:header-sync-collection", ["lucide-react", "FolderSync"]],
  ["Bandcamp:header-refresh-radar", ["lucide-react", "Radar"]],
  ["Bandcamp:header-backfill-urls", ["lucide-react", "Link"]],
  ["NewReleases:header-timeline", ["lucide-react", "List"]],
  ["NewReleases:header-grid", ["lucide-react", "LayoutGrid"]],
  ["NewReleases:header-check-now", ["lucide-react", "Radar"]],
  ["Users:header-invite-user", ["lucide-react", "MailPlus"]],
  ["Users:header-add-user", ["lucide-react", "UserPlus"]],
  ["Upcoming:header-sync-shows", ["lucide-react", "CalendarSync"]],
  ["Upcoming:header-clear-caches", ["lucide-react", "Eraser"]],
  ["Playlists:header-new-static", ["lucide-react", "FilePlus2"]],
  ["Playlists:header-new-smart", ["lucide-react", "ListPlus"]],
  // Diego's explicit 1AQ header-action amendment; no global primary-action exemption.
  ["PlaylistEditor:editor-duplicate-action", ["lucide-react", "Copy"]],
  ["PlaylistEditor:editor-preview-action", ["lucide-react", "Eye"]],
  ["PlaylistEditor:editor-generate-action", ["lucide-react", "ListRestart"]],
  ["PlaylistEditor:editor-save-action", ["lucide-react", "Save"]],
  ["PlaylistEditor:editor-remove-rule", ["lucide-react", "Trash2"]],
  ["PlaylistEditor:editor-remove-track", ["lucide-react", "Trash2"]],
  ["PlaylistEditor:editor-remove-cover", ["lucide-react", "Trash2"]],
  ["Playlists:playlists-remove-rule", ["lucide-react", "Trash2"]],
  ["PlaylistEditor:editor-loading", ["lucide-react", "Loader2"]],
  [
    "PlaylistEditor:editor-back",
    ["@crate/ui/domain/navigation/BackLink", "BackLink"],
  ],
  ["PlaylistEditor:editor-preview", ["lucide-react", "Loader2"]],
  ["PlaylistEditor:editor-generate", ["lucide-react", "Loader2"]],
  ["PlaylistEditor:editor-save", ["lucide-react", "Loader2"]],
  ["PlaylistEditor:editor-cover-upload", ["lucide-react", "Loader2"]],
  ["PlaylistEditor:editor-save-rules", ["lucide-react", "Loader2"]],
  ["PlaylistEditor:editor-apply-preview", ["lucide-react", "Loader2"]],
  ["PlaylistEditor:editor-search", ["lucide-react", "Search"]],
  ["PlaylistEditor:editor-search-loading", ["lucide-react", "Loader2"]],
  ["PlaylistEditor:editor-add-track", ["lucide-react", "Loader2"]],
  ["PlaylistEditor:editor-apply-refinement", ["lucide-react", "Loader2"]],
  ["PlaylistEditor:editor-drag", ["lucide-react", "GripVertical"]],

  ["Playlists:playlists-search", ["lucide-react", "Search"]],
  ["Playlists:playlists-loading", ["lucide-react", "Loader2"]],
  ["Playlists:playlists-static-close", ["lucide-react", "X"]],
  ["Playlists:playlists-static-saving", ["lucide-react", "Loader2"]],
  ["Playlists:playlists-smart-close", ["lucide-react", "X"]],
  ["Playlists:playlists-smart-saving", ["lucide-react", "Loader2"]],
  ["Upcoming:upcoming-view-list", ["lucide-react", "List"]],
  ["Upcoming:upcoming-view-calendar", ["lucide-react", "CalendarDays"]],
  ["Upcoming:upcoming-sync", ["lucide-react", "Loader2"]],
  ["Upcoming:upcoming-search", ["lucide-react", "Search"]],
  ["Upcoming:upcoming-loading", ["lucide-react", "Loader2"]],
  ["Upcoming:upcoming-download-loading", ["lucide-react", "Loader2"]],
  ["Upcoming:upcoming-dismiss", ["@crate/ui/icons", "X"]],
  ["Upcoming:upcoming-open-album", ["@crate/ui/icons", "ExternalLink"]],
  ["Upcoming:upcoming-download", ["@crate/ui/icons", "Download"]],
  ["Upcoming:upcoming-previous", ["lucide-react", "ChevronLeft"]],
  ["Upcoming:upcoming-next", ["lucide-react", "ChevronRight"]],
  ["Upcoming:upcoming-popover-loading", ["lucide-react", "Loader2"]],
  ["ShowCard:show-tickets-external", ["lucide-react", "ExternalLink"]],
  ["ShowCard:show-close", ["lucide-react", "X"]],

  ["I18nReview:translations-refresh", ["lucide-react", "Loader2"]],
  ["I18nReview:translations-draft", ["lucide-react", "Loader2"]],
  ["I18nReview:translations-export", ["lucide-react", "Loader2"]],
  ["I18nReview:translations-reject", ["lucide-react", "Loader2"]],
  ["I18nReview:translations-publish", ["lucide-react", "Loader2"]],
  ["I18nReview:translations-save", ["lucide-react", "Loader2"]],
  ["I18nReview:translations-workspace-save", ["lucide-react", "Loader2"]],
  ["I18nReview:translations-loading", ["lucide-react", "Loader2"]],
  ["Users:users-list-loading", ["lucide-react", "Loader2"]],
  ["Users:users-detail-loading", ["lucide-react", "Loader2"]],
  ["Users:users-roles-loading", ["lucide-react", "Loader2"]],
  ["Users:users-status-loading", ["lucide-react", "Loader2"]],
  ["Users:users-revoke-all-loading", ["lucide-react", "Loader2"]],
  ["Users:users-revoke-loading", ["lucide-react", "Loader2"]],
  ["Users:users-password-loading", ["lucide-react", "Loader2"]],
  ["Users:users-create-loading", ["lucide-react", "Loader2"]],
  ["Users:users-invite-loading", ["lucide-react", "Loader2"]],
  ["Users:users-search", ["lucide-react", "Search"]],
  ["Users:users-previous", ["lucide-react", "ChevronLeft"]],
  ["Users:users-next", ["lucide-react", "ChevronRight"]],
  ["GlobalCatalog:catalog-incremental-loading", ["lucide-react", "Loader2"]],
  ["GlobalCatalog:catalog-full-loading", ["lucide-react", "Loader2"]],
  ["NewReleases:releases-search", ["lucide-react", "Search"]],
  ["NewReleases:releases-loading", ["lucide-react", "Loader2"]],
  ["NewReleases:releases-check-loading", ["lucide-react", "Loader2"]],
  ["NewReleases:releases-download-loading", ["lucide-react", "Loader2"]],
  ["NewReleases:releases-timeline-dismiss", ["lucide-react", "X"]],
  ["NewReleases:releases-grid-dismiss", ["lucide-react", "X"]],
  ["Discover:discovery-search", ["lucide-react", "Search"]],
  ["Discover:discovery-loading", ["lucide-react", "Loader2"]],
  ["Discover:discovery-recompute-loading", ["lucide-react", "Loader2"]],
  ["Discover:discovery-check-loading", ["lucide-react", "Loader2"]],
  ["Bandcamp:bandcamp-sync-loading", ["lucide-react", "Loader2"]],
  ["Bandcamp:bandcamp-backfill-loading", ["lucide-react", "Loader2"]],
  ["Bandcamp:bandcamp-confirm-loading", ["lucide-react", "Loader2"]],
  ["Bandcamp:bandcamp-match-external", ["lucide-react", "ExternalLink"]],
  ["Bandcamp:bandcamp-confirmed-external", ["lucide-react", "ArrowUpRight"]],
  ["Bandcamp:bandcamp-item-external", ["lucide-react", "ExternalLink"]],
  ["Contributions:contributions-refresh-loading", ["lucide-react", "Loader2"]],
  ["Contributions:contributions-list-loading", ["lucide-react", "Loader2"]],
  ["Trash:trash-refresh-loading", ["lucide-react", "Loader2"]],
  ["Trash:trash-empty-loading", ["lucide-react", "Loader2"]],
  ["Trash:trash-list-loading", ["lucide-react", "Loader2"]],
  ["Trash:trash-row-loading", ["lucide-react", "Loader2"]],
  ["Health:health-scan-loading", ["lucide-react", "Loader2"]],
  ["Health:health-loading", ["lucide-react", "Loader2"]],
  ["Health:health-fix-loading", ["lucide-react", "Loader2"]],
  ["Health:health-group-collapse", ["lucide-react", "ChevronUp"]],
  ["Health:health-group-expand", ["lucide-react", "ChevronDown"]],
  ["Dashboard:dashboard-running-task", ["lucide-react", "Loader2"]],
  ["Analysis:analysis-loading", ["lucide-react", "Loader2"]],
  ["Analysis:analysis-action-fingerprints", ["lucide-react", "Loader2"]],
  ["Analysis:analysis-action-popularity", ["lucide-react", "Loader2"]],
  ["Analysis:analysis-action-bliss", ["lucide-react", "Loader2"]],
  ["Analysis:analysis-action-analysis", ["lucide-react", "Loader2"]],
  ["Analysis:analysis-action-lyrics", ["lucide-react", "Loader2"]],
  ["Analysis:analysis-action-portable", ["lucide-react", "Loader2"]],
  ["Analysis:analysis-action-rehydrate", ["lucide-react", "Loader2"]],
  ["Analysis:analysis-action-richExport", ["lucide-react", "Loader2"]],
  ["Logs:logs-loading", ["lucide-react", "Loader2"]],
  ["Logs:live-pause", ["lucide-react", "Pause"]],
  ["Logs:live-resume", ["lucide-react", "Play"]],
  ["Logs:logs-search", ["lucide-react", "Search"]],
  ["Stack:stack-loading", ["lucide-react", "Loader2"]],
  ["Stack:stack-search", ["lucide-react", "Search"]],
  ["Stack:service-logs-toggle", ["lucide-react", "ChevronDown"]],
  ["Stack:service-state-loading", ["lucide-react", "Loader2"]],
  ["Stack:service-stop", ["lucide-react", "Square"]],
  ["Stack:service-start", ["lucide-react", "Play"]],
  ["Stack:service-external", ["lucide-react", "ExternalLink"]],
  ["Stack:service-logs-loading", ["lucide-react", "Loader2"]],
  ["Shell:history-back", ["lucide-react", "ChevronLeft"]],
  ["Shell:history-forward", ["lucide-react", "ChevronRight"]],
  ["Shell:mobile-navigation", ["lucide-react", "Menu"]],
  ["Shell:help-close", ["@crate/ui/shadcn/dialog", "DialogContent"]],
  ["Sidebar:sidebar-collapse", ["lucide-react", "PanelLeftClose"]],
  ["Sidebar:sidebar-expand", ["lucide-react", "PanelLeftOpen"]],
  [
    "Sidebar:drawer-close",
    ["@crate/ui/shadcn/overlay-close-button", "OverlayCloseButton"],
  ],
  ["CommandPalette:palette-search", ["lucide-react", "Search"]],
  ["SearchBar:search-field", ["lucide-react", "Search"]],
  ["SearchBar:search-loading", ["lucide-react", "Loader2"]],
  ["SearchBar:search-clear", ["lucide-react", "X"]],
  ["AIButton:ai-loading", ["@crate/ui/icons", "Loader2"]],
  ["AIButton:ai-bot", ["@crate/ui/icons", "Bot"]],
  [
    "CommandPalette:palette-close",
    ["@crate/ui/shadcn/overlay-close-button", "OverlayCloseButton"],
  ],
]);
function violations(sources: Map<string, string>, entries: IconEntry[]) {
  const found: string[] = [];
  const controlUses = new Map<string, number>();
  const usedUx = new Set<string>();
  const trees = new Map<string, ts.SourceFile>();
  for (const entry of entries.filter((entry) => sources.has(entry.path))) {
    if (entry.kind === "external-visual") continue;
    if (
      ![
        "glyph-jsx",
        "owned-icon-consumer",
        "owned-vector-consumer",
        "icon-prop",
        "icon-property",
      ].includes(entry.kind)
    ) {
      found.push(entry.id);
      continue;
    }

    if (entry.source === "@crate/ui/domain/brand/CrateLogo") continue; // Existing identity asset.
    if (
      entry.path.endsWith("/Shell.tsx") &&
      ["./Sidebar", "./CommandPalette", "./SearchBar"].includes(
        entry.source ?? "",
      )
    )
      continue; // Checked directly in this scope.
    const key = `${entry.path}:${entry.source}`;
    const source = sources.get(entry.path)!;
    const tree =
      trees.get(entry.path) ??
      ts.createSourceFile(
        entry.path,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
    trees.set(entry.path, tree);
    let attributes: ts.JsxAttributes | undefined;
    let reviewedInstrument = false;
    function visit(node: ts.Node) {
      // Existing Leaflet marker assets are instrument data, not action glyph slots.
      if (
        entry.kind === "icon-property" &&
        entry.path === "app/ui/src/pages/Upcoming.tsx" &&
        ts.isPropertyAssignment(node)
      ) {
        const pos = tree.getLineAndCharacterOfPosition(node.getStart(tree));
        const call = ts.isObjectLiteralExpression(node.parent)
          ? node.parent.parent
          : undefined;
        const expected =
          entry.name === "iconUrl"
            ? "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png"
            : entry.name === "iconRetinaUrl"
              ? "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png"
              : undefined;
        if (
          pos.line + 1 === entry.line &&
          pos.character + 1 === entry.column &&
          call &&
          ts.isCallExpression(call) &&
          call.expression.getText(tree) === "L.Icon.Default.mergeOptions" &&
          ts.isStringLiteral(node.initializer) &&
          node.initializer.text === expected
        )
          reviewedInstrument = true;
      }
      if (entry.kind === "icon-prop" && ts.isJsxAttribute(node)) {
        const pos = tree.getLineAndCharacterOfPosition(node.getStart(tree));
        if (
          pos.line + 1 === entry.line &&
          pos.character + 1 === entry.column &&
          ts.isJsxAttributes(node.parent)
        )
          attributes = node.parent;
      }
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const pos = tree.getLineAndCharacterOfPosition(node.getStart(tree));
        if (pos.line + 1 === entry.line && pos.character + 1 === entry.column)
          attributes = node.attributes;
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
    const instrumentKey = `Upcoming:marker-${entry.name}`;
    if (reviewedInstrument && !usedUx.has(instrumentKey)) {
      usedUx.add(instrumentKey);
      continue;
    }
    if (!attributes) {
      found.push(entry.id);
      continue;
    }
    const attrs = attributes.properties;
    const prop = (name: string) =>
      attrs.find(
        (attr) => ts.isJsxAttribute(attr) && attr.name.getText(tree) === name,
      ) as ts.JsxAttribute | undefined;
    const unknownSpread = attrs.some(ts.isJsxSpreadAttribute);
    // Inventory's /icon/i also matches aiConfigured. This reviewed local boolean prop
    // is not a glyph channel; accept only its original binding at this concrete site.
    if (
      entry.kind === "icon-prop" &&
      entry.path === "app/ui/src/pages/I18nReview.tsx" &&
      entry.component === "OverviewSection" &&
      entry.name === "aiConfigured" &&
      !unknownSpread &&
      prop("aiConfigured")?.initializer?.getText(tree) === "{aiConfigured}" &&
      !usedUx.has("I18nReview:boolean-aiConfigured")
    ) {
      usedUx.add("I18nReview:boolean-aiConfigured");
      continue;
    }

    // Only the Admin artwork wrapper may pin the decorative fallback off.
    // Require the original imported component and false after every spread.
    const artworkParent = attributes.parent;
    const artworkTag =
      ts.isJsxOpeningElement(artworkParent) ||
      ts.isJsxSelfClosingElement(artworkParent)
        ? artworkParent.tagName.getText(tree)
        : "";
    const artworkImport = tree.statements.some(
      (statement) =>
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text ===
          "@crate/ui/domain/playlists/PlaylistArtwork" &&
        statement.importClause?.namedBindings &&
        ts.isNamedImports(statement.importClause.namedBindings) &&
        statement.importClause.namedBindings.elements.some(
          (binding) =>
            binding.name.text === artworkTag &&
            binding.propertyName?.text === "PlaylistArtwork",
        ),
    );
    const fallback = prop("showFallbackIcon");
    const artworkKey = `PlaylistArtwork:disabled-fallback:${entry.kind}`;
    if (
      entry.path === "app/ui/src/components/playlists/PlaylistArtwork.tsx" &&
      artworkImport &&
      artworkTag === "PlaylistArtworkBase" &&
      ((entry.kind === "owned-icon-consumer" &&
        entry.source === "@crate/ui/domain/playlists/PlaylistArtwork") ||
        (entry.kind === "icon-prop" && entry.name === "showFallbackIcon")) &&
      fallback?.initializer?.getText(tree) === "{false}" &&
      attrs.filter(
        (attr) =>
          ts.isJsxAttribute(attr) &&
          attr.name.getText(tree) === "showFallbackIcon",
      ).length === 1 &&
      attrs.indexOf(fallback) >
        attrs.reduce(
          (last, attr, index) => (ts.isJsxSpreadAttribute(attr) ? index : last),
          -1,
        ) &&
      !usedUx.has(artworkKey)
    ) {
      usedUx.add(artworkKey);
      continue;
    }

    const reviewedControl = approvedControls.get(key);
    if (
      !unknownSpread &&
      reviewedControl &&
      reviewedControl.component === (entry.origin ?? entry.name)
    ) {
      controlUses.set(key, (controlUses.get(key) ?? 0) + 1);
      continue;
    }
    const marker = prop("data-admin-ux")?.initializer;
    if (marker && ts.isStringLiteral(marker)) {
      const key = `${entry.path.split("/").pop()?.replace(".tsx", "")}:${
        marker.text
      }`;
      const approved = approvedUx.get(key);
      if (
        !unknownSpread &&
        approved &&
        approved[0] === entry.source &&
        approved[1] === (entry.origin ?? entry.name) &&
        !usedUx.has(key)
      ) {
        usedUx.add(key);
        continue;
      }
    }
    if (!entry.kind.startsWith("owned-")) {
      found.push(entry.id);
      continue;
    }
    if (
      !unknownSpread &&
      ((entry.source === "@crate/ui/primitives/CrateBadge" &&
        ["CrateChip", "CratePill"].includes(entry.origin ?? entry.name)) ||
        (entry.source === "@crate/ui/primitives/InfoBadge" &&
          (entry.origin ?? entry.name) === "InfoBadge") ||
        (entry.source === "@crate/ui/primitives/FilterChip" &&
          (entry.origin ?? entry.name) === "FilterChip")) &&
      !prop("icon")
    )
      continue; // Shared badges render no glyph without an explicit icon prop.
    if (
      entry.source === "@crate/ui/shadcn/button" &&
      ((!unknownSpread && !prop("loading")) ||
        (prop("loading")?.initializer?.getText(tree) === "{false}" &&
          attrs.indexOf(prop("loading")!) >
            attrs.reduce(
              (last, attr, index) =>
                ts.isJsxSpreadAttribute(attr) ? index : last,
              -1,
            )))
    )
      continue;
    if (
      !unknownSpread &&
      ["@crate/ui/shadcn/dialog", "@crate/ui/shadcn/sheet"].includes(
        entry.source ?? "",
      ) &&
      prop("showCloseButton")?.initializer?.getText(tree) === "{false}"
    )
      continue;
    found.push(entry.id);
  }
  for (const [key, count] of controlUses)
    if (count > approvedControls.get(key)!.limit)
      found.push(`${key}: reviewed control grew`);
  return found;
}

describe("Admin icon retirement policy — migrated Admin surfaces", () => {
  it("rejects direct, passed, mapped, dynamic and wrapped glyphs in the migrated files", () => {
    const inventory = buildInventory(repo);
    const sources = new Map(
      scope.map((path) => [path, readFileSync(join(repo, path), "utf8")]),
    );
    expect(violations(sources, inventory.entries)).toEqual([]);
  });
  it("treats the exact shared size token as data while still auditing Solar glyphs", () => {
    const result = analyzeSource(
      "fixture.tsx",
      'import { CRATE_ICON_SIZE as Sizes, Download } from "@crate/ui/icons"; const view=<Download size={Sizes.lg}/>;',
    );
    expect(
      result.entries.filter(
        (e) => e.kind === "glyph-reference" && e.name === "Sizes",
      ),
    ).toEqual([]);
    expect(
      result.entries.filter(
        (e) => e.kind === "glyph-jsx" && e.name === "Download",
      ),
    ).toHaveLength(1);
  });
  it("bounds the artwork opt-out to one exact imported wrapper with false after every spread", () => {
    const path = "app/ui/src/components/playlists/PlaylistArtwork.tsx";
    const prefix =
      'import {PlaylistArtwork as PlaylistArtworkBase} from "@crate/ui/domain/playlists/PlaylistArtwork";';
    for (const source of [
      prefix +
        "const view = <PlaylistArtworkBase {...props} showFallbackIcon={true}/>;",
      prefix +
        "const view = <PlaylistArtworkBase {...props} showFallbackIcon={enabled}/>;",
      prefix +
        "const view = <PlaylistArtworkBase showFallbackIcon={false} {...props}/>;",
      prefix +
        "const view = <OtherArtwork {...props} showFallbackIcon={false}/>;",
      prefix +
        "const view = <><PlaylistArtworkBase {...props} showFallbackIcon={false}/><PlaylistArtworkBase {...props} showFallbackIcon={false}/></>;",
      "const view = <PlaylistArtworkBase {...props} showFallbackIcon={false}/>;",
    ])
      expect(
        violations(
          new Map([[path, source]]),
          analyzeSource(path, source).entries,
        ).length,
      ).toBeGreaterThan(0);
  });
  it("bounds Leaflet marker asset properties to their original instrument call and literals", () => {
    const path = "app/ui/src/pages/Upcoming.tsx";
    for (const source of [
      'const view = {iconUrl:"https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png"};',
      "L.Icon.Default.mergeOptions({iconUrl: OtherIcon});",
      'L.Icon.Default.mergeOptions({iconUrl:"https://elsewhere.invalid/icon.svg"});',
    ])
      expect(
        violations(
          new Map([[path, source]]),
          analyzeSource(path, source).entries,
        ).length,
      ).toBeGreaterThan(0);
  });
  it("does not turn the aiConfigured inventory false positive into an icon channel", () => {
    const path = "app/ui/src/pages/I18nReview.tsx";
    for (const source of [
      "const view = <OverviewSection aiConfigured={SomeIcon}/>;",
      "const view = <OtherSection aiConfigured={aiConfigured}/>;",
      "const view = <OverviewSection {...props} aiConfigured={aiConfigured}/>;",
      "const view = <><OverviewSection aiConfigured={aiConfigured}/><OverviewSection aiConfigured={aiConfigured}/></>;",
    ])
      expect(
        violations(
          new Map([[path, source]]),
          analyzeSource(path, source).entries,
        ).length,
      ).toBeGreaterThan(0);
  });
  it.each([
    'import { Search as Glyph } from "lucide-react"; const view = <Glyph/>;',
    "const view = <Chip icon={someValue}/>;",
    "const map = {icon: value}; const view = <map.icon/>;",
    "const view = <svg><path/></svg>;",
    "const view = <Icon {...props}/>;",
  ])("detects an unapproved entry point: %s", (source) => {
    const path = scope[0]!;
    expect(
      violations(new Map([[path, source]]), analyzeSource(path, source).entries)
        .length,
    ).toBeGreaterThan(0);
  });
  it("rejects a new wrapper that hides an inline vector", () => {
    const root = mkdtempSync(join(tmpdir(), "crate-admin-icon-policy-"));
    try {
      const path = scope[0]!,
        source =
          'import { HiddenMark } from "./HiddenMark"; export const Sidebar = () => <HiddenMark/>;';
      mkdirSync(join(root, "app/ui/src/components/layout"), {
        recursive: true,
      });
      writeFileSync(join(root, path), source);
      writeFileSync(
        join(root, "app/ui/src/components/layout/HiddenMark.tsx"),
        "export const HiddenMark = () => <button><svg><path/></svg></button>;",
      );
      expect(
        violations(new Map([[path, source]]), buildInventory(root).entries),
      ).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("does not let a shared loading prop or implicit overlay close bypass the guard", () => {
    const path = scope[2]!,
      source = "<><Button loading/><DialogContent/></>";
    const entries: IconEntry[] = [
      ...analyzeSource(path, source).entries,
      {
        id: "spinner",
        path,
        line: 1,
        column: 3,
        kind: "owned-icon-consumer",
        name: "Button",
        source: "@crate/ui/shadcn/button",
        control: "Button",
        label: "",
        snippet: "",
      },
      {
        id: "close",
        path,
        line: 1,
        column: 20,
        kind: "owned-icon-consumer",
        name: "DialogContent",
        source: "@crate/ui/shadcn/dialog",
        control: "DialogContent",
        label: "",
        snippet: "",
      },
    ];
    expect(violations(new Map([[path, source]]), entries)).toEqual([
      "spinner",
      "close",
    ]);
  });
  it("only accepts forwarded Button props when built-in loading is explicitly off after every spread", () => {
    const path = scope[4]!;
    for (const [source, count] of [
      ["<Button {...props} loading={false}/>", 0],
      ["<Button loading={false} {...props}/>", 1],
      ["<Button {...props} loading/>", 1],
    ] as const) {
      const entry: IconEntry = {
        id: "forwarded-button",
        path,
        line: 1,
        column: 1,
        kind: "owned-icon-consumer",
        name: "Button",
        source: "@crate/ui/shadcn/button",
        control: "Button",
        label: "",
        snippet: "",
      };
      expect(violations(new Map([[path, source]]), [entry])).toHaveLength(
        count,
      );
    }
  });
});

it("does not extend a UX approval to another glyph or a duplicate callsite", () => {
  const path = scope[2]!;
  for (const source of [
    'import { Trash2 } from "lucide-react"; const view = <Trash2 data-admin-ux="history-back"/>;',
    'import { ChevronLeft } from "lucide-react"; const view = <><ChevronLeft data-admin-ux="history-back"/><ChevronLeft data-admin-ux="history-back"/></>;',
  ])
    expect(
      violations(
        new Map([[path, source]]),
        analyzeSource(path, source).entries,
      ),
    ).toHaveLength(1);
});

function operationalIconViolations(path: string, source: string) {
  const tree = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const surfaces = new Set(["OpsPageHero", "OpsPanel", "OpsStatTile"]);
  const bindings = new Set<string>();
  for (const node of tree.statements) {
    if (
      !ts.isImportDeclaration(node) ||
      !ts.isStringLiteral(node.moduleSpecifier) ||
      node.moduleSpecifier.text !== "@/components/admin/ops-surfaces"
    )
      continue;
    const imports = node.importClause?.namedBindings;
    if (imports && ts.isNamedImports(imports)) {
      for (const entry of imports.elements) {
        if (surfaces.has((entry.propertyName ?? entry.name).text))
          bindings.add(entry.name.text);
      }
    } else if (imports && ts.isNamespaceImport(imports)) {
      for (const surface of surfaces)
        bindings.add(`${imports.name.text}.${surface}`);
    }
  }
  const found: string[] = [];
  function visit(node: ts.Node) {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      bindings.has(node.tagName.getText(tree))
    ) {
      for (const attr of node.attributes.properties) {
        if (
          ts.isJsxSpreadAttribute(attr) ||
          (ts.isJsxAttribute(attr) && attr.name.getText(tree) === "icon")
        )
          found.push(
            `${path}:${
              tree.getLineAndCharacterOfPosition(attr.getStart(tree)).line + 1
            }`,
          );
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return found;
}

function productionTsx(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? productionTsx(path)
      : entry.name.endsWith(".tsx") && !entry.name.includes(".test.")
        ? [path]
        : [];
  });
}

describe("Admin operational surface consumer contracts", () => {
  it("does not pass decorative icons or opaque props to retired operational surfaces", () => {
    const found = productionTsx(join(repo, "app/ui/src")).flatMap((path) =>
      operationalIconViolations(path, readFileSync(path, "utf8")),
    );
    expect(found).toEqual([]);
  });
  it.each([
    [
      'import { OpsPanel } from "@/components/admin/ops-surfaces"; const view = <OpsPanel icon={Glyph}/>;',
      1,
    ],
    [
      'import { OpsPageHero as Hero } from "@/components/admin/ops-surfaces"; const view = <Hero icon={Glyph}/>;',
      1,
    ],
    [
      'import * as Ops from "@/components/admin/ops-surfaces"; const view = <Ops.OpsStatTile {...props}/>;',
      1,
    ],
    [
      'import { OpsPanel } from "@/components/admin/ops-surfaces"; const view = <OpsPanel title="Tasks" action={<button>Refresh</button>}>Jobs</OpsPanel>;',
      0,
    ],
  ] as const)(
    "checks aliases and spreads without banning action slots: %s",
    (source, count) => {
      expect(operationalIconViolations("fixture.tsx", source)).toHaveLength(
        count,
      );
    },
  );
});

it("does not let badge icon props or opaque spreads bypass the migrated page guard", () => {
  const path = "app/ui/src/pages/Logs.tsx";
  for (const [source, count] of [
    ["<CratePill>Live</CratePill>", 0],
    ["<CratePill icon={Glyph}>Live</CratePill>", 1],
    ["<CratePill {...props}>Live</CratePill>", 1],
  ] as const) {
    const entry: IconEntry = {
      id: "badge",
      path,
      line: 1,
      column: 1,
      kind: "owned-icon-consumer",
      name: "CratePill",
      source: "@crate/ui/primitives/CrateBadge",
      control: "CratePill",
      label: "",
      snippet: "",
    };
    expect(violations(new Map([[path, source]]), [entry])).toHaveLength(count);
  }
});
