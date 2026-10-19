import { useState } from "react";

import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";

import { CopyButton } from "@/components/admin/CopyButton";
import { mcpSnippets } from "@/lib/agent-connections";

type SnippetTab = "claudeCode" | "codex" | "http";

const TABS: { value: SnippetTab; label: string }[] = [
  { value: "claudeCode", label: "Claude Code" },
  { value: "codex", label: "Codex" },
  { value: "http", label: "Other clients" },
];

/** Shows a copyable client configuration snippet for connecting over MCP. */
export function ConnectionSnippets({
  url,
  token,
}: {
  url: string | null;
  token: string;
}) {
  const [tab, setTab] = useState<SnippetTab>("claudeCode");
  const snippets = mcpSnippets(url, token);
  const snippet = snippets[tab];

  return (
    <div className="space-y-2">
      <SegmentedControl
        as="tabs"
        label="Client configuration"
        items={TABS}
        value={tab}
        onValueChange={setTab}
      />
      {url === null ? (
        <p className="text-sm text-muted-foreground">
          Set CRATE_MCP_OAUTH_ISSUER on the server to show your MCP address
          here. Replace the placeholder with your Crate API address.
        </p>
      ) : null}
      <div className="flex items-start gap-2">
        <pre className="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-muted p-3 font-mono text-sm whitespace-pre-wrap">
          {snippet}
        </pre>
        <CopyButton value={snippet} label="configuration" />
      </div>
    </div>
  );
}
