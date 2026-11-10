import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";

import { PeersPanel } from "./PeersPanel";
import type { FederationPairing, FederationStatus, Peer } from "./types";

vi.mock("@/hooks/use-api", () => ({ useApi: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const nodeUid = "peer-node-uid";
const pairingUid = "actual-pairing-request-uid";
const refetch = vi.fn();
const peer: Peer = {
  node_uid: nodeUid,
  display_name: "Crate Home",
  api_base_url: "https://peer.example",
  trust_state: "pending",
  default_grant_preset: "discovery",
  health_json: {},
  last_health_at: null,
  disabled_at: null,
};

function pairing(
  overrides: Partial<FederationPairing> = {},
): FederationPairing {
  return {
    pairing_uid: pairingUid,
    remote_node_uid: nodeUid,
    direction: "inbound",
    state: "remote_pending",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

function renderPeers(
  data: Partial<FederationStatus> & { pairings?: ReturnType<typeof pairing>[] },
  canManage = true,
) {
  vi.mocked(useApi).mockImplementation((path: string | null) => ({
    data: path?.endsWith("status")
      ? {
          local_node: null,
          peers: [peer],
          peer_count: 1,
          approved_peer_count: 0,
          pending_pairing_count: 1,
          ...data,
        }
      : [],
    loading: false,
    error: null,
    refetch,
  }));
  return renderWithAdminProviders(<PeersPanel canManage={canManage} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api).mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
});

it("renders an explicit empty peer state", () => {
  renderPeers({ peers: [] });
  expect(screen.getByText("No peers configured")).toBeInTheDocument();
});

it("approves with the pairing request UID, never the peer node UID", async () => {
  renderPeers({ pairings: [pairing()] });

  fireEvent.click(screen.getByRole("button", { name: "Approve" }));

  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      `/api/admin/federation/pairing/${pairingUid}/approve`,
      "POST",
    ),
  );
  expect(refetch).toHaveBeenCalledOnce();
});

it.each(["pending", "approved"])(
  "can resume an accepted pairing when the peer is %s",
  async (trustState) => {
    renderPeers({
      peers: [{ ...peer, trust_state: trustState }],
      pairings: [pairing({ state: "accepted" })],
    });

    fireEvent.click(screen.getByRole("button", { name: "Retry approval" }));

    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        `/api/admin/federation/pairing/${pairingUid}/approve`,
        "POST",
      ),
    );
  },
);

it("waits for the remote owner to approve an outbound pairing", () => {
  renderPeers({
    pairings: [pairing({ direction: "outbound", state: "offered" })],
  });

  expect(
    screen.getByText("Awaiting approval from Crate Home."),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /approve|retry approval/i }),
  ).not.toBeInTheDocument();
  expect(api).not.toHaveBeenCalled();
});

it("requires a new request once the inbound pairing has expired", () => {
  renderPeers({
    pairings: [pairing({ expires_at: new Date(Date.now() - 1).toISOString() })],
  });

  expect(
    screen.getByText("Pairing request expired. Start a new request."),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /approve|retry approval/i }),
  ).not.toBeInTheDocument();
  expect(api).not.toHaveBeenCalled();
});

it("does not fall back to a node UID when pairing metadata is unavailable", () => {
  renderPeers({});

  expect(
    screen.queryByRole("button", { name: /approve|retry approval/i }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText(
      "No pending pairing request is available. Start a new request.",
    ),
  ).toBeInTheDocument();
  expect(api).not.toHaveBeenCalled();
});

it("uses the newest request instead of an older inbound request with a later expiry", () => {
  renderPeers({
    pairings: [
      pairing({
        pairing_uid: "new-outbound-request",
        direction: "outbound",
        state: "offered",
      }),
      pairing({ expires_at: new Date(Date.now() + 120_000).toISOString() }),
    ],
  });

  expect(
    screen.getByText("Awaiting approval from Crate Home."),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /approve|retry approval/i }),
  ).not.toBeInTheDocument();
});

it("does not revive an older accepted request after the newest pairing completed", () => {
  renderPeers({
    peers: [{ ...peer, trust_state: "approved" }],
    pairings: [
      pairing({ pairing_uid: "completed-request", state: "completed" }),
      pairing({ state: "accepted" }),
    ],
  });

  expect(screen.getByRole("button", { name: "Sync" })).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /approve|retry approval/i }),
  ).not.toBeInTheDocument();
});

it("expires an approval action while the page remains open", () => {
  vi.useFakeTimers();
  renderPeers({ pairings: [pairing()] });
  expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();

  act(() => vi.advanceTimersByTime(60_001));

  expect(
    screen.queryByRole("button", { name: "Approve" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText("Pairing request expired. Start a new request."),
  ).toBeInTheDocument();
  expect(api).not.toHaveBeenCalled();
});

it("fails closed when the pairing expiry cannot be read", () => {
  renderPeers({ pairings: [pairing({ expires_at: "invalid-date" })] });

  expect(
    screen.queryByRole("button", { name: /approve|retry approval/i }),
  ).not.toBeInTheDocument();
  expect(api).not.toHaveBeenCalled();
});

it("shows the server error and refreshes resumable pairing state after failure", async () => {
  vi.mocked(api).mockRejectedValue(
    new Error(
      JSON.stringify({ detail: "Remote acceptance failed; retry approval" }),
    ),
  );
  renderPeers({ pairings: [pairing()] });

  fireEvent.click(screen.getByRole("button", { name: "Approve" }));

  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Remote acceptance failed; retry approval",
    ),
  );
  expect(refetch).toHaveBeenCalledOnce();
});

it("does not show approval actions without management capability", () => {
  renderPeers({ pairings: [pairing()] }, false);

  expect(
    screen.queryByRole("button", { name: /approve|retry approval/i }),
  ).not.toBeInTheDocument();
});

it("does not offer approval or sync for a disabled peer", () => {
  renderPeers({
    peers: [
      {
        ...peer,
        trust_state: "approved",
        disabled_at: new Date().toISOString(),
      },
    ],
    pairings: [pairing({ state: "accepted" })],
  });

  expect(screen.getByText("Peer is disabled.")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /approve|retry approval|sync/i }),
  ).not.toBeInTheDocument();
  expect(api).not.toHaveBeenCalled();
});
