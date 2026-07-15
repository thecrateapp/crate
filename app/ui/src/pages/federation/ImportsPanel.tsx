import { toast } from "sonner";

import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { Badge } from "@crate/ui/shadcn/badge";
import { Button } from "@crate/ui/shadcn/button";
import { Card, CardContent } from "@crate/ui/shadcn/card";

import { PanelState } from "./PanelState";
import { formatBytes } from "./types";

interface ImportRequest {
  request_id: string;
  node_uid: string;
  title: string;
  status: string;
  expected_bytes: number | null;
  reserved_bytes: number;
  received_bytes: number;
  manifest_digest: string | null;
  failure_reason?: string | null;
  metadata_json: Record<string, unknown>;
  created_at: string;
}

export function ImportsPanel({ canManage }: { canManage: boolean }) {
  const requests = useApi<ImportRequest[]>(
    "/api/admin/federation/import-requests",
  );
  const decide = async (id: string, decision: "approve" | "deny") => {
    try {
      await api(
        `/api/admin/federation/import-requests/${id}/${decision}`,
        "POST",
      );
      await requests.refetch();
      toast.success(
        decision === "approve" ? "Import approved" : "Import rejected",
      );
    } catch {
      toast.error("Import operation failed");
    }
  };
  return (
    <PanelState loading={requests.loading} error={requests.error}>
      <div className="space-y-3">
        {(requests.data ?? []).length === 0 ? (
          <p className="text-sm text-white/45">No remote import requests.</p>
        ) : (
          requests.data?.map((item) => {
            const pending = item.status === "awaiting_approval";
            const globalAlbumUid = item.metadata_json.global_album_uid;
            return (
              <Card key={item.request_id}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex justify-between">
                    <p className="font-medium">
                      {item.title}{" "}
                      <Badge variant="secondary">{item.status}</Badge>
                    </p>
                    {canManage && pending ? (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() =>
                            void decide(item.request_id, "approve")
                          }
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => void decide(item.request_id, "deny")}
                        >
                          Reject
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  <dl className="grid gap-2 text-xs sm:grid-cols-3">
                    <div>
                      <dt className="text-white/35">Global album</dt>
                      <dd>
                        {typeof globalAlbumUid === "string"
                          ? globalAlbumUid
                          : "-"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-white/35">Manifest digest</dt>
                      <dd className="break-all font-mono">
                        {item.manifest_digest ?? "Not fetched yet"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-white/35">Received / expected</dt>
                      <dd>
                        {formatBytes(item.received_bytes)} /{" "}
                        {item.expected_bytes
                          ? formatBytes(item.expected_bytes)
                          : "unknown"}
                      </dd>
                    </div>
                  </dl>
                  {item.failure_reason ? (
                    <p className="text-xs text-red-300">
                      {item.failure_reason}
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </PanelState>
  );
}
