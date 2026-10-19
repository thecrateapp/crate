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

export const MCP_OFF_WARNING =
  "MCP is turned off on this server. Agents can't connect until it is enabled.";

function SnippetBlock({
  snippet,
  copyLabel,
  caption,
}: {
  snippet: string;
  copyLabel: string;
  caption?: string;
}) {
  return (
    <div className="space-y-1">
      {caption ? (
        <p className="text-xs text-muted-foreground">{caption}</p>
      ) : null}
      <div className="flex items-start gap-2">
        <pre className="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-muted p-3 font-mono text-sm whitespace-pre-wrap">
          {snippet}
        </pre>
        <CopyButton value={snippet} label={copyLabel} />
      </div>
    </div>
  );
}

/**
 * Shows copyable client configuration for connecting over MCP, with a
 * warning when MCP is turned off on this server.
 */
export function ConnectionSnippets({
  url,
  token,
  mcpEnabled = true,
}: {
  url: string | null;
  token: string;
  mcpEnabled?: boolean;
}) {
  const [tab, setTab] = useState<SnippetTab>("claudeCode");
  const snippets = mcpSnippets(url, token);

  return (
    <div className="space-y-2">
      {mcpEnabled ? null : (
        <p role="note" className="text-sm text-amber-200">
          {MCP_OFF_WARNING}
        </p>
      )}
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
      {tab === "claudeCode" ? (
        <SnippetBlock snippet={snippets.claudeCode} copyLabel="configuration" />
      ) : null}
      {tab === "codex" ? (
        <>
          <SnippetBlock
            snippet={snippets.codex.shell}
            copyLabel="shell command"
            caption="In the shell that runs Codex:"
          />
          <SnippetBlock
            snippet={snippets.codex.toml}
            copyLabel="configuration"
            caption="In ~/.codex/config.toml:"
          />
        </>
      ) : null}
      {tab === "http" ? (
        <SnippetBlock snippet={snippets.http} copyLabel="configuration" />
      ) : null}
    </div>
  );
}
