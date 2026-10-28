import { FormField } from "@crate/ui/primitives/FormField";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { useState } from "react";
import { toast } from "sonner";

import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { Button } from "@crate/ui/shadcn/button";
import { Card, CardContent, CardHeader } from "@crate/ui/shadcn/card";
import { Input } from "@crate/ui/shadcn/input";
import { LoadingState } from "@crate/ui/domain/states/LoadingState";
import { EmptyState } from "@crate/ui/domain/lists/EmptyState";

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

  if (loading) return <LoadingState label="Loading directories" />;
  if (error)
    return (
      <p role="alert" className="text-sm text-state-warning-text">
        Could not load directories.
      </p>
    );

  return (
    <div className="space-y-4">
      {canManage ? (
        <Card>
          <CardHeader>
            <MonoLabel as="h3" tone="accent">
              Signed directories
            </MonoLabel>
          </CardHeader>
          <CardContent className="grid gap-2 md:grid-cols-2">
            <FormField label="Directory URL">
              <Input
                aria-label="Directory URL"
                placeholder="https://directory.example/nodes.json"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
            </FormField>
            <FormField label="Trusted key ID">
              <Input
                aria-label="Trusted key ID"
                placeholder="Trusted key ID"
                value={keyId}
                onChange={(event) => setKeyId(event.target.value)}
              />
            </FormField>
            <FormField
              label="Trusted Ed25519 public key"
              className="md:col-span-2"
            >
              <Input
                aria-label="Trusted Ed25519 public key"
                placeholder="Trusted Ed25519 public key (base64)"
                value={publicKey}
                onChange={(event) => setPublicKey(event.target.value)}
              />
            </FormField>
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
        <EmptyState title="No directory subscriptions" />
      ) : (
        data.map((subscription) => (
          <Card key={subscription.subscription_uid}>
            <CardContent className="space-y-4 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{subscription.url}</span>
                    <InfoBadge
                      tone={
                        subscription.state === "active"
                          ? "success"
                          : subscription.state === "error"
                            ? "danger"
                            : "neutral"
                      }
                    >
                      {subscription.state}
                    </InfoBadge>
                  </div>
                  <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs text-text-muted sm:grid-cols-2">
                    <div>
                      <dt className="inline">Trusted key: </dt>
                      <dd className="inline text-text-secondary">
                        {subscription.trusted_keys_json
                          .map((key) => key.key_id)
                          .join(", ")}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline">Last verified: </dt>
                      <dd className="inline text-text-secondary">
                        <AbsoluteTime value={subscription.last_success_at} />
                      </dd>
                    </div>
                  </dl>
                  {subscription.last_error_code ? (
                    <p className="mt-2 text-xs text-state-warning-text">
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
                      variant="outline"
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
                  <p className="text-xs text-text-muted">
                    No candidates discovered.
                  </p>
                ) : (
                  subscription.candidates.map((candidate) => (
                    <div
                      key={candidate.id}
                      className="rounded-md border border-border-quiet p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">
                              {candidate.display_name || candidate.node_uid}
                            </span>
                            <InfoBadge
                              tone={
                                candidate.state === "pending"
                                  ? "warning"
                                  : candidate.state === "ignored"
                                    ? "neutral"
                                    : candidate.state === "stale"
                                      ? "danger"
                                      : "info"
                              }
                            >
                              {candidate.state}
                            </InfoBadge>
                            {candidate.peer_trust_state ? (
                              <InfoBadge
                                tone={
                                  candidate.peer_trust_state === "approved"
                                    ? "success"
                                    : candidate.peer_trust_state === "pending"
                                      ? "warning"
                                      : "neutral"
                                }
                              >
                                {candidate.peer_trust_state}
                              </InfoBadge>
                            ) : null}
                          </div>
                          <div className="mt-1 font-mono text-xs text-text-subtle">
                            {candidate.node_uid}
                          </div>
                          <div className="text-xs text-text-muted">
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
                        <div className="mt-2 rounded-lg bg-state-warning/10 p-2 text-xs text-state-warning-text">
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
