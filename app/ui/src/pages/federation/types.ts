export interface LocalNode {
  node_uid: string;
  display_name: string;
  api_base_url: string | null;
  active_key_id: string;
}

export interface Peer {
  node_uid: string;
  display_name: string;
  api_base_url: string;
  trust_state: string;
  default_grant_preset: string;
  health_json: Record<string, unknown>;
  last_health_at: string | null;
  disabled_at: string | null;
}

export interface FederationStatus {
  local_node: LocalNode | null;
  peer_count: number;
  approved_peer_count: number;
  pending_pairing_count: number;
  key_health?: Record<string, unknown>;
  peers: Peer[];
}

export interface StreamingPeerStat {
  node_uid: string;
  display_name: string;
  preset: string;
  active_streams: number;
  daily_bytes: number;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${
    units[index]
  }`;
}
