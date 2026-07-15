import { useState } from "react";
import { toast } from "sonner";

import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { Badge } from "@crate/ui/shadcn/badge";
import { Button } from "@crate/ui/shadcn/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@crate/ui/shadcn/card";
import { Input } from "@crate/ui/shadcn/input";

interface DirectoryCandidate {
  id: number;
  node_uid: string;
  display_name: string | null;
  descriptor_url: string;
  descriptor_digest: string;
  state: "pending" | "stale" | "changed" | "ignored";
  metadata_json: {
    api_base_url?: string;
    approved_peer_diff?: Record<
      string,
      { current?: string | null; advertised?: string | null }
    >;
  };
  peer_trust_state: string | null;
}

interface DirectorySubscription {
  subscription_uid: string;
  url: string;
  trusted_keys_json: { key_id: string }[];
  refresh_interval_seconds: number;
  state: "active" | "paused" | "error";
  last_success_at: string | null;
  last_error_code: string | null;
  last_error_detail?: string | null;
  candidates: DirectoryCandidate[];
}

function AbsoluteTime({ value }: { value: string | null }) {
  if (!value) return <span>Never</span>;
  const date = new Date(value);
  return <time dateTime={value}>{date.toLocaleString()}</time>;
}

export function DirectoriesPanel({ canManage }: { canManage: boolean }) {
  const { data, loading, error, refetch } = useApi<DirectorySubscription[]>(
    "/api/admin/federation/directories",
  );
  const [url, setUrl] = useState("");
  const [keyId, setKeyId] = useState("directory");
  const [publicKey, setPublicKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const mutate = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await action();
      await refetch();
    } catch {
      toast.error("Federation directory operation failed");
    } finally {
      setBusy(null);
    }
  };

  const addDirectory = () =>
    mutate("create", async () => {
      await api("/api/admin/federation/directories", "POST", {
        url: url.trim(),
        trusted_key_id: keyId.trim(),
        trusted_public_key: publicKey.trim(),
        refresh_interval_seconds: 3600,
      });
      setUrl("");
      setPublicKey("");
      toast.success("Directory subscription added");
    });

  if (loading)
    return <p className="text-sm text-white/45">Loading directories…</p>;
  if (error)
    return <p className="text-sm text-red-400">Could not load directories.</p>;

  return (
    <div className="space-y-4">
      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Signed directories</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 md:grid-cols-2">
            <Input
              aria-label="Directory URL"
              placeholder="https://directory.example/nodes.json"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
            <Input
              aria-label="Trusted key ID"
              placeholder="Trusted key ID"
              value={keyId}
              onChange={(event) => setKeyId(event.target.value)}
            />
            <Input
              aria-label="Trusted Ed25519 public key"
              placeholder="Trusted Ed25519 public key (base64)"
              value={publicKey}
              onChange={(event) => setPublicKey(event.target.value)}
              className="md:col-span-2"
            />
            <Button
              className="md:w-fit"
              disabled={
                busy === "create" ||
                !url.trim() ||
                !keyId.trim() ||
                !publicKey.trim()
              }
              onClick={() => void addDirectory()}
            >
              Add directory
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {!data?.length ? (
        <p className="text-sm text-white/45">No directory subscriptions.</p>
      ) : (
        data.map((subscription) => (
          <Card key={subscription.subscription_uid}>
            <CardContent className="space-y-4 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{subscription.url}</span>
                    <Badge variant="secondary">{subscription.state}</Badge>
                  </div>
                  <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs text-white/45 sm:grid-cols-2">
                    <div>
                      <dt className="inline">Trusted key: </dt>
                      <dd className="inline text-white/70">
                        {subscription.trusted_keys_json
                          .map((key) => key.key_id)
                          .join(", ")}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline">Last verified: </dt>
                      <dd className="inline text-white/70">
                        <AbsoluteTime value={subscription.last_success_at} />
                      </dd>
                    </div>
                  </dl>
                  {subscription.last_error_code ? (
                    <p className="mt-2 text-xs text-red-400">
                      {subscription.last_error_code}:{" "}
                      {subscription.last_error_detail}
                    </p>
                  ) : null}
                </div>
                {canManage ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={
                        busy === `refresh:${subscription.subscription_uid}`
                      }
                      onClick={() =>
                        void mutate(
                          `refresh:${subscription.subscription_uid}`,
                          () =>
                            api(
                              `/api/admin/federation/directories/${subscription.subscription_uid}/refresh`,
                              "POST",
                            ),
                        )
                      }
                    >
                      Refresh
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        void mutate(
                          `state:${subscription.subscription_uid}`,
                          () =>
                            api(
                              `/api/admin/federation/directories/${subscription.subscription_uid}`,
                              "PATCH",
                              {
                                state:
                                  subscription.state === "paused"
                                    ? "active"
                                    : "paused",
                              },
                            ),
                        )
                      }
                    >
                      {subscription.state === "paused" ? "Resume" : "Pause"}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => {
                        if (
                          !window.confirm("Delete this directory subscription?")
                        )
                          return;
                        void mutate(
                          `delete:${subscription.subscription_uid}`,
                          () =>
                            api(
                              `/api/admin/federation/directories/${subscription.subscription_uid}`,
                              "DELETE",
                            ),
                        );
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                ) : null}
              </div>

              <div className="space-y-2">
                {subscription.candidates.length === 0 ? (
                  <p className="text-xs text-white/45">
                    No candidates discovered.
                  </p>
                ) : (
                  subscription.candidates.map((candidate) => (
                    <div
                      key={candidate.id}
                      className="rounded-xl border border-white/10 p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">
                              {candidate.display_name || candidate.node_uid}
                            </span>
                            <Badge variant="secondary">{candidate.state}</Badge>
                            {candidate.peer_trust_state ? (
                              <Badge>{candidate.peer_trust_state}</Badge>
                            ) : null}
                          </div>
                          <div className="mt-1 font-mono text-xs text-white/35">
                            {candidate.node_uid}
                          </div>
                          <div className="text-xs text-white/45">
                            digest {candidate.descriptor_digest}
                          </div>
                        </div>
                        {canManage &&
                        !candidate.peer_trust_state &&
                        candidate.state !== "stale" ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            aria-label={`Pair ${
                              candidate.display_name || candidate.node_uid
                            }`}
                            onClick={() =>
                              void mutate(`pair:${candidate.id}`, () =>
                                api(
                                  `/api/admin/federation/directory-candidates/${candidate.id}/pair`,
                                  "POST",
                                  { outbound_grant: "discovery" },
                                ),
                              )
                            }
                          >
                            Pair
                          </Button>
                        ) : null}
                      </div>
                      {candidate.metadata_json.approved_peer_diff ? (
                        <div className="mt-2 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-300">
                          Descriptor changed. Review URL/key differences before
                          approving.
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
