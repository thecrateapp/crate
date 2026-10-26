import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { FilterChip } from "@crate/ui/primitives/FilterChip";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { OpsPageHero } from "@/components/admin/ops-surfaces";
import {
  PageHeaderAction,
  PageHeaderActions,
} from "@/components/layout/PageHeader";
import {
  MailPlus as HeaderMailPlus,
  UserPlus as HeaderUserPlus,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Search,
} from "lucide-react";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Link, useSearchParams } from "react-router";

import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@crate/ui/shadcn/card";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import { Badge } from "@crate/ui/shadcn/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@crate/ui/shadcn/dialog";
import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import { ErrorState } from "@crate/ui/primitives/ErrorState";

import { useAuth } from "@/contexts/AuthContext";
import { api, ApiError } from "@/lib/api";
import { albumPagePath, artistPagePath } from "@/lib/library-routes";
import { timeAgo } from "@/lib/utils";

interface ConnectedAccount {
  provider: string;
  status: string;
  external_username?: string | null;
}

function generatePassword(): string {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
  const values = new Uint32Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(values);
  } else {
    for (let index = 0; index < values.length; index += 1) {
      values[index] = Math.floor(Math.random() * chars.length);
    }
  }
  return Array.from(values, (value) => chars[value % chars.length]).join("");
}

interface CurrentTrack {
  track_id?: number | null;
  track_entity_uid?: string | null;
  title?: string | null;
  artist?: string | null;
  artist_id?: number | null;
  artist_slug?: string | null;
  album?: string | null;
  album_id?: number | null;
  album_slug?: string | null;
  played_at?: string | null;
}

interface UserRecord {
  id: number;
  email: string;
  username?: string | null;
  name: string;
  avatar?: string | null;
  role: string;
  roles?: string[];
  status?: "active" | "suspended" | "deleted" | string;
  status_reason?: string | null;
  suspended_at?: string | null;
  deleted_at?: string | null;
  capabilities?: string[];
  has_password?: boolean;
  active_sessions?: number;
  active_devices?: number;
  online_now?: boolean;
  listening_now?: boolean;
  current_track?: CurrentTrack | null;
  last_played_at?: string | null;
  last_seen_at?: string | null;
  last_activity_at?: string | null;
  activity_status?: "active" | "inactive" | "never_active" | string;
  connected_accounts?: ConnectedAccount[];
  last_login: string | null;
  created_at: string;
}

interface UserSession {
  id: string;
  created_at: string;
  expires_at: string;
  revoked_at?: string | null;
  last_seen_at?: string | null;
  last_seen_ip?: string | null;
  user_agent?: string | null;
  app_id?: string | null;
  device_label?: string | null;
  display_label?: string | null;
  client_name?: string | null;
  client_version?: string | null;
  os_name?: string | null;
  os_version?: string | null;
  device_type?: string | null;
  device_brand?: string | null;
  device_model?: string | null;
  device_fingerprint?: string | null;
  activity_state?:
    "active" | "recent" | "history" | "expired" | "revoked" | null;
  is_active?: boolean | null;
  is_recent?: boolean | null;
}

interface UserDetail extends UserRecord {
  bio?: string | null;
  sessions: UserSession[];
}

interface AuthInvite {
  token: string;
  email?: string | null;
  expires_at?: string | null;
  max_uses?: number | null;
  use_count?: number | null;
}

type UserFilter =
  | "all"
  | "online"
  | "listening"
  | "admins"
  | "suspended"
  | "deleted"
  | "inactive";
type SessionFilter = "active" | "recent" | "all";

const ROLE_OPTIONS = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "ops", label: "Ops" },
  { value: "librarian", label: "Librarian" },
  { value: "curator", label: "Curator" },
  { value: "editor", label: "Editor" },
  { value: "contributor", label: "Contributor" },
  { value: "user", label: "User" },
];

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
  { value: "deleted", label: "Deleted" },
];

const SESSION_ACTIVE_WINDOW_MS = 3 * 60 * 1000;
const SESSION_RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const USER_ACTIVITY_INACTIVE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const USERS_PAGE_SIZE = 20;

function roleLabel(role: string) {
  return ROLE_OPTIONS.find((option) => option.value === role)?.label ?? role;
}

function rolesForUser(user: Pick<UserRecord, "role" | "roles"> | null) {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  const normalized = roles.reduce<string[]>((values, role) => {
    const value = role.trim().toLowerCase();
    if (value) values.push(value);
    return values;
  }, []);
  if (normalized.length > 0) return Array.from(new Set(normalized));
  return [user?.role || "user"];
}

function sameRoleSet(left: string[], right: string[]) {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((role, index) => role === sortedRight[index])
  );
}

function toggleRole(current: string[], role: string) {
  if (current.includes(role)) {
    if (current.length === 1) return current;
    return current.filter((candidate) => candidate !== role);
  }
  const next = new Set([...current, role]);
  return ROLE_OPTIONS.map((option) => option.value).filter((candidate) =>
    next.has(candidate),
  );
}

function RolePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string[];
  onChange: (roles: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {ROLE_OPTIONS.map((option) => {
        const active = value.includes(option.value);
        return (
          <FilterChip
            key={option.value}
            disabled={disabled}
            active={active}
            onClick={() => onChange(toggleRole(value, option.value))}
          >
            {option.label}
          </FilterChip>
        );
      })}
    </div>
  );
}

interface SessionSourceSummary {
  key: string;
  label: string;
  count: number;
  online: number;
  connected: number;
  recent: number;
  history: number;
  revoked: number;
  last_seen_at?: string | null;
  app_id?: string | null;
}

function UserAvatar({
  user,
  size = "sm",
}: {
  user: { name?: string | null; email?: string | null; avatar?: string | null };
  size?: "sm" | "md";
}) {
  const dim = size === "md" ? "h-18 w-18 text-lg" : "h-14 w-14 text-base";
  const initial = (user.name || user.email || "?").charAt(0).toUpperCase();

  if (user.avatar) {
    return (
      <img
        src={user.avatar}
        alt=""
        className={`${dim} rounded-md object-cover shrink-0`}
      />
    );
  }

  return (
    <div
      className={`${dim} rounded-md border border-border-quiet bg-raised-surface flex items-center justify-center shrink-0 font-medium text-text-secondary`}
    >
      {initial}
    </div>
  );
}

function formatSessionTimestamp(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function toTimestamp(value?: string | null) {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function formatRelativeTimestamp(value?: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  return timeAgo(value);
}

function userStatus(user: Pick<UserRecord, "status">) {
  return (user.status || "active").trim().toLowerCase();
}

function userActivityStatus(
  user: Pick<
    UserRecord,
    | "activity_status"
    | "last_activity_at"
    | "last_played_at"
    | "last_seen_at"
    | "last_login"
  >,
) {
  if (
    user.activity_status === "inactive" ||
    user.activity_status === "never_active"
  ) {
    return user.activity_status;
  }
  const lastActivity = Math.max(
    toTimestamp(user.last_activity_at),
    toTimestamp(user.last_played_at),
    toTimestamp(user.last_seen_at),
    toTimestamp(user.last_login),
  );
  if (!lastActivity) return "never_active";
  return Date.now() - lastActivity > USER_ACTIVITY_INACTIVE_AFTER_MS
    ? "inactive"
    : "active";
}

function activityLabel(status: string) {
  if (status === "inactive") return "Inactive";
  if (status === "never_active") return "No activity yet";
  return "Active recently";
}

function activityBadgeClass(status: string) {
  if (status === "inactive") return "border-border-quiet text-text-subtle";
  if (status === "never_active") return "border-border-quiet text-text-subtle";
  return "border-accent-action/20 text-accent-action-hi";
}

function statusBadgeClass(status: string) {
  if (status === "active")
    return "border-accent-action/20 text-accent-action-hi";
  if (status === "suspended")
    return "border-state-warning/25 text-state-warning-text";
  if (status === "deleted") return "border-border-quiet text-text-subtle";
  return "border-border-quiet text-text-muted";
}

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function sessionUaLabel(userAgent?: string | null) {
  const raw = (userAgent || "").trim();
  if (!raw) return "Unknown client";
  const lowered = raw.toLowerCase();
  if (lowered.startsWith("curl/")) return "curl";
  if (lowered.startsWith("wget")) return "Wget";
  if (lowered.startsWith("python-urllib")) return "Python urllib";
  if (lowered.includes("chrome")) return "Chrome";
  if (lowered.includes("safari") && !lowered.includes("chrome"))
    return "Safari";
  if (lowered.includes("firefox")) return "Firefox";
  return raw.split(" ")[0]?.split("/")[0] || "Unknown client";
}

function deviceTypeLabel(deviceType?: string | null) {
  const normalized = (deviceType || "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "smartphone") return "Phone";
  if (normalized === "desktop") return "Desktop";
  if (normalized === "tablet") return "Tablet";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function sessionDisplayName(session: UserSession) {
  return (
    session.display_label ||
    session.device_label ||
    session.app_id ||
    sessionUaLabel(session.user_agent)
  );
}

function sessionSourceKey(session: UserSession) {
  const appKey = session.app_id?.trim().toLowerCase() || "web";
  return [
    session.device_fingerprint || "",
    appKey,
    session.display_label?.trim().toLowerCase() || "",
    session.device_label?.trim().toLowerCase() || "",
    sessionUaLabel(session.user_agent).trim().toLowerCase(),
  ].join("::");
}

function sessionActivityState(session: UserSession) {
  if (session.activity_state) return session.activity_state;

  const now = Date.now();
  const lastSeen = new Date(
    session.last_seen_at || session.created_at,
  ).getTime();
  const expires = new Date(session.expires_at).getTime();

  if (session.revoked_at) return "revoked";
  if (!Number.isNaN(expires) && expires < now) return "expired";
  if (!Number.isNaN(lastSeen) && now - lastSeen <= SESSION_ACTIVE_WINDOW_MS)
    return "active";
  if (!Number.isNaN(lastSeen) && now - lastSeen <= SESSION_RECENT_WINDOW_MS)
    return "recent";
  return "history";
}

function sessionMetaLine(session: UserSession) {
  const parts = [
    [session.client_name, session.client_version].filter(Boolean).join(" "),
    [session.os_name, session.os_version].filter(Boolean).join(" "),
    deviceTypeLabel(session.device_type),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function getSessionStatus(session: UserSession) {
  switch (sessionActivityState(session)) {
    case "revoked":
      return {
        key: "revoked",
        label: "Revoked",
        className: "border-border-quiet bg-transparent text-text-secondary",
      };
    case "expired":
      return {
        key: "expired",
        label: "Expired",
        className:
          "border-state-warning/25 bg-state-warning/10 text-state-warning-text",
      };
    case "active":
      return {
        key: "active",
        label: "Active now",
        className:
          "border-accent-action/25 bg-accent-action/10 text-accent-action-hi",
      };
    case "recent":
      return {
        key: "recent",
        label: "Recent",
        className:
          "border-accent-action/25 bg-accent-action/10 text-accent-action-hi",
      };
    default:
      return {
        key: "history",
        label: "History",
        className: "border-border-quiet bg-card text-text-muted",
      };
  }
}

function filterSessions(sessions: UserSession[], mode: SessionFilter) {
  if (mode === "all") return sessions;
  return sessions.filter((session) => {
    const status = getSessionStatus(session).key;
    if (mode === "active") return status === "active";
    return status === "active" || status === "recent";
  });
}

function summarizeSessions(sessions: UserSession[]): SessionSourceSummary[] {
  const groups = new Map<string, SessionSourceSummary>();

  for (const session of sessions) {
    const key = sessionSourceKey(session);
    const status = getSessionStatus(session).key;
    const lastSeenAt = session.last_seen_at || session.created_at;
    const existing = groups.get(key);

    if (existing) {
      existing.count += 1;
      existing.last_seen_at =
        toTimestamp(lastSeenAt) > toTimestamp(existing.last_seen_at)
          ? lastSeenAt
          : existing.last_seen_at;
      if (status === "active") existing.online += 1;
      else if (status === "recent") existing.recent += 1;
      else if (status === "revoked") existing.revoked += 1;
      else existing.history += 1;
      continue;
    }

    groups.set(key, {
      key,
      label: sessionDisplayName(session),
      count: 1,
      online: status === "active" ? 1 : 0,
      connected: 0,
      recent: status === "recent" ? 1 : 0,
      history: status === "history" || status === "expired" ? 1 : 0,
      revoked: status === "revoked" ? 1 : 0,
      last_seen_at: lastSeenAt,
      app_id: session.app_id,
    });
  }

  return Array.from(groups.values()).sort((left, right) => {
    const leftLive = left.online + left.connected;
    const rightLive = right.online + right.connected;
    if (leftLive !== rightLive) return rightLive - leftLive;
    if (left.count !== right.count) return right.count - left.count;
    return toTimestamp(right.last_seen_at) - toTimestamp(left.last_seen_at);
  });
}

function sortUsersByPresence(left: UserRecord, right: UserRecord) {
  if (left.listening_now !== right.listening_now)
    return Number(right.listening_now) - Number(left.listening_now);
  if (left.online_now !== right.online_now)
    return Number(right.online_now) - Number(left.online_now);
  if ((left.active_devices ?? 0) !== (right.active_devices ?? 0))
    return (right.active_devices ?? 0) - (left.active_devices ?? 0);
  if ((left.active_sessions ?? 0) !== (right.active_sessions ?? 0))
    return (right.active_sessions ?? 0) - (left.active_sessions ?? 0);
  const lastSeenDiff =
    toTimestamp(right.last_seen_at || right.last_login) -
    toTimestamp(left.last_seen_at || left.last_login);
  if (lastSeenDiff !== 0) return lastSeenDiff;
  return (left.name || left.email).localeCompare(right.name || right.email);
}

function listenRegisterUrl(inviteToken: string) {
  const url = new URL(window.location.href);
  if (url.hostname.startsWith("admin.")) {
    url.hostname = url.hostname.replace(/^admin\./, "listen.");
  } else if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    url.port = "5174";
  }
  url.pathname = "/register";
  url.search = new URLSearchParams({ invite: inviteToken }).toString();
  url.hash = "";
  return url.toString();
}

function UserPresence({
  user,
}: {
  user: Pick<
    UserRecord,
    | "online_now"
    | "listening_now"
    | "active_devices"
    | "active_sessions"
    | "last_seen_at"
    | "current_track"
  >;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <InfoBadge tone={user.online_now ? "accent" : "neutral"}>
        {user.online_now
          ? "Active now"
          : user.last_seen_at
            ? `Last seen ${formatRelativeTimestamp(user.last_seen_at)}`
            : "Offline"}
      </InfoBadge>
      <InfoBadge tone={user.listening_now ? "accent" : "neutral"}>
        {user.listening_now ? "Listening now" : "Not playing"}
      </InfoBadge>
      <InfoBadge>
        {user.active_devices ?? 0} device
        {(user.active_devices ?? 0) === 1 ? "" : "s"}
      </InfoBadge>
      <InfoBadge>
        {user.active_sessions ?? 0} active session
        {(user.active_sessions ?? 0) === 1 ? "" : "s"}
      </InfoBadge>
    </div>
  );
}

function CurrentTrackLine({ track }: { track?: CurrentTrack | null }) {
  if (!track?.title) return null;
  const artistHref =
    track.artist_id != null
      ? artistPagePath({
          artistId: track.artist_id,
          artistSlug: track.artist_slug || undefined,
          artistName: track.artist || "",
        })
      : null;
  const albumHref =
    track.album_id != null
      ? albumPagePath({
          albumId: track.album_id,
          albumSlug: track.album_slug || undefined,
          artistName: track.artist || "",
          albumName: track.album || "",
        })
      : null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm text-text-secondary">
      <span className="text-text-primary">{track.title}</span>
      {track.artist ? (
        <>
          <span className="text-text-subtle">by</span>
          {artistHref ? (
            <Link to={artistHref} className="hover:text-text-primary">
              {track.artist}
            </Link>
          ) : (
            <span>{track.artist}</span>
          )}
        </>
      ) : null}
      {track.album ? (
        <>
          <span className="text-text-subtle">on</span>
          {albumHref ? (
            <Link to={albumHref} className="hover:text-text-primary">
              {track.album}
            </Link>
          ) : (
            <span>{track.album}</span>
          )}
        </>
      ) : null}
    </div>
  );
}

function authModeSummary(
  user: Pick<UserRecord, "has_password" | "connected_accounts">,
) {
  const providerCount = user.connected_accounts?.length ?? 0;
  if (user.has_password && providerCount > 0) {
    return `Password + ${providerCount} linked provider${
      providerCount === 1 ? "" : "s"
    }`;
  }
  if (user.has_password) {
    return "Password login enabled";
  }
  if (providerCount > 0) {
    return providerCount === 1
      ? "SSO-only account"
      : `SSO-only · ${providerCount} providers`;
  }
  return "No sign-in method configured";
}

export function Users() {
  const { user: currentUser, hasCapability } = useAuth();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserRecord | null>(null);
  const [detailTarget, setDetailTarget] = useState<UserRecord | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<UserFilter>("all");
  const [page, setPage] = useState(1);
  const [searchParams, setSearchParams] = useSearchParams();
  const canCreateUsers =
    hasCapability("users.create") || hasCapability("users.manage");
  const canManageStatus =
    hasCapability("users.status.manage") || hasCapability("users.manage");
  const canManagePasswords =
    hasCapability("users.password.manage") || hasCapability("users.manage");
  const canManageSessions =
    hasCapability("users.sessions.manage") || hasCapability("users.manage");
  const canDeleteUsers =
    hasCapability("users.delete") || hasCapability("users.manage");
  const canAssignRoles =
    hasCapability("roles.assign") || hasCapability("roles.manage");

  const setInspectParam = useCallback(
    (userId: number | null) => {
      const next = new URLSearchParams(searchParams);
      if (userId == null) next.delete("inspect");
      else next.set("inspect", String(userId));
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  function openUserDetail(user: UserRecord) {
    setDetailTarget(user);
    setInspectParam(user.id);
  }

  async function fetchUsers() {
    try {
      const data = await api<UserRecord[]>("/api/auth/users");
      setUsers(Array.isArray(data) ? data : []);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  async function retryUsers() {
    setLoading(true);
    await fetchUsers();
  }

  useEffect(() => {
    void fetchUsers();
  }, []);

  useEffect(() => {
    const inspectRaw = searchParams.get("inspect");
    if (!inspectRaw) {
      if (detailTarget) setDetailTarget(null);
      return;
    }
    const inspectId = Number(inspectRaw);
    if (!Number.isFinite(inspectId)) {
      setInspectParam(null);
      return;
    }
    if (detailTarget?.id === inspectId) {
      return;
    }
    const target = users.find((candidate) => candidate.id === inspectId);
    if (target) {
      setDetailTarget(target);
    } else if (users.length > 0 && currentUser?.id === inspectId) {
      setInspectParam(null);
    }
  }, [currentUser?.id, detailTarget, searchParams, setInspectParam, users]);

  async function handleDelete() {
    if (!deleteTarget || !canDeleteUsers) return;
    await api(`/api/auth/users/${deleteTarget.id}`, "DELETE");
    toast.success("User deleted");
    setDeleteTarget(null);
    await fetchUsers();
  }

  const counts = useMemo(
    () => ({
      total: users.length,
      online: users.filter((user) => user.online_now).length,
      listening: users.filter((user) => user.listening_now).length,
      devices: users.reduce((sum, user) => sum + (user.active_devices ?? 0), 0),
    }),
    [users],
  );

  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return users
      .filter((user) => {
        const matchesFilter =
          filter === "all" ||
          (filter === "online" && user.online_now) ||
          (filter === "listening" && user.listening_now) ||
          (filter === "admins" &&
            rolesForUser(user).some(
              (role) => role === "admin" || role === "owner",
            )) ||
          (filter === "suspended" && userStatus(user) === "suspended") ||
          (filter === "deleted" && userStatus(user) === "deleted") ||
          (filter === "inactive" && userActivityStatus(user) === "inactive");

        const providerText = (user.connected_accounts || [])
          .map((account) => account.provider)
          .join(" ");
        const haystack = `${user.name} ${user.email} ${
          user.username ?? ""
        } ${providerText}`.toLowerCase();
        const matchesQuery =
          !normalizedQuery || haystack.includes(normalizedQuery);
        return matchesFilter && matchesQuery;
      })
      .sort(sortUsersByPresence);
  }, [filter, query, users]);

  const pageCount = Math.max(
    1,
    Math.ceil(filteredUsers.length / USERS_PAGE_SIZE),
  );
  const pageStart = (page - 1) * USERS_PAGE_SIZE;
  const paginatedUsers = filteredUsers.slice(
    pageStart,
    pageStart + USERS_PAGE_SIZE,
  );
  const showingStart = filteredUsers.length === 0 ? 0 : pageStart + 1;
  const showingEnd = Math.min(
    pageStart + USERS_PAGE_SIZE,
    filteredUsers.length,
  );

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  if (loading) {
    return (
      <div
        role="status"
        aria-label="Loading users"
        className="flex items-center justify-center py-24"
      >
        <Loader2
          data-admin-ux="users-list-loading"
          aria-hidden="true"
          className="h-6 w-6 animate-spin text-primary"
        />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-6">
        <OpsPageHero
          title="Users"
          description="Account access, presence and listening activity."
        />
        <Card>
          <CardContent className="flex flex-col items-start gap-4 py-8">
            <div>
              <MonoLabel as="h2" tone="accent">
                Users unavailable
              </MonoLabel>
              <p role="alert" className="mt-2 text-sm text-text-muted">
                The user directory could not be loaded. Your filters and access
                settings have not changed.
              </p>
            </div>
            <Button variant="outline" onClick={retryUsers}>
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <OpsPageHero
        title="Users"
        description="Presence, linked identities, active devices and recent listening activity across the system."
        compactActions
        actions={
          <PageHeaderActions>
            {canCreateUsers ? (
              <>
                <PageHeaderAction
                  label="Invite user"
                  onClick={() => setInviteOpen(true)}
                >
                  <HeaderMailPlus
                    data-admin-ux="header-invite-user"
                    aria-hidden="true"
                  />
                </PageHeaderAction>
                <PageHeaderAction
                  label="Add user"
                  onClick={() => setAddOpen(true)}
                >
                  <HeaderUserPlus
                    data-admin-ux="header-add-user"
                    aria-hidden="true"
                  />
                </PageHeaderAction>
              </>
            ) : null}
          </PageHeaderActions>
        }
      >
        <InfoBadge>{counts.total} total users</InfoBadge>
        <InfoBadge tone={counts.online > 0 ? "accent" : undefined}>
          {counts.online} active now
        </InfoBadge>
        <InfoBadge tone={counts.listening > 0 ? "accent" : undefined}>
          {counts.listening} listening
        </InfoBadge>
        <InfoBadge>{counts.devices} active devices</InfoBadge>
      </OpsPageHero>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full max-w-md">
              <Search
                data-admin-ux="users-search"
                aria-hidden="true"
                size={14}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-subtle"
              />
              <Input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                aria-label="Search users"
                placeholder="Search users..."
                className="pl-10"
              />
            </div>
            <div
              aria-label="Filter users"
              className="flex max-w-full flex-nowrap gap-2 overflow-x-auto pb-1 lg:flex-wrap"
            >
              {[
                { key: "all", label: "All", count: users.length },
                {
                  key: "online",
                  label: "Active",
                  count: users.filter((user) => user.online_now).length,
                },
                {
                  key: "listening",
                  label: "Listening",
                  count: users.filter((user) => user.listening_now).length,
                },
                {
                  key: "admins",
                  label: "Admins",
                  count: users.filter((user) =>
                    rolesForUser(user).some(
                      (role) => role === "admin" || role === "owner",
                    ),
                  ).length,
                },
                {
                  key: "suspended",
                  label: "Suspended",
                  count: users.filter(
                    (user) => userStatus(user) === "suspended",
                  ).length,
                },
                {
                  key: "deleted",
                  label: "Deleted",
                  count: users.filter((user) => userStatus(user) === "deleted")
                    .length,
                },
                {
                  key: "inactive",
                  label: "Inactive",
                  count: users.filter(
                    (user) => userActivityStatus(user) === "inactive",
                  ).length,
                },
              ].map((item) => (
                <FilterChip
                  key={item.key}
                  className="shrink-0 whitespace-nowrap"
                  active={filter === item.key}
                  onClick={() => {
                    setFilter(item.key as UserFilter);
                    setPage(1);
                  }}
                >
                  {item.label} {item.count}
                </FilterChip>
              ))}
            </div>
          </div>

          <div className="text-sm text-text-muted">
            Showing {showingStart}-{showingEnd} of {filteredUsers.length} users
          </div>

          <div role="table" aria-label="Users" className="min-w-0 text-sm">
            <div role="rowgroup">
              <div
                role="row"
                className="hidden grid-cols-[minmax(0,2.2fr)_minmax(7.5rem,.8fr)_minmax(12rem,1.2fr)_auto] gap-4 border-b border-border-quiet py-3 font-mono text-[10px] uppercase tracking-[0.12em] text-text-subtle lg:grid"
              >
                <span role="columnheader">User</span>
                <span role="columnheader">Status</span>
                <span role="columnheader">Presence</span>
                <span role="columnheader" className="text-right">
                  Actions
                </span>
              </div>
            </div>
            <div role="rowgroup" className="border-t border-border-quiet">
              {paginatedUsers.map((user) => (
                <div
                  key={user.id}
                  role="row"
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-3 border-b border-border-quiet-subtle py-4 last:border-b-0 lg:grid-cols-[minmax(0,2.2fr)_minmax(7.5rem,.8fr)_minmax(12rem,1.2fr)_auto] lg:items-center lg:gap-4"
                >
                  <div role="cell" className="flex min-w-0 items-start gap-3">
                    <div className="shrink-0">
                      <UserAvatar user={user} />
                    </div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="crate-form-field">
                        <h2 className="break-words font-display text-base font-semibold text-text-primary">
                          {user.name || user.email}
                        </h2>
                        <span className="break-all text-xs text-text-muted">
                          {user.email}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                        {rolesForUser(user).map((role) => (
                          <Badge key={role} variant="outline">
                            {roleLabel(role)}
                          </Badge>
                        ))}
                        {user.username ? (
                          <span className="break-all font-mono text-[10px] text-text-subtle">
                            @{user.username}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div
                    role="cell"
                    className="flex flex-col items-end gap-1.5 lg:items-start"
                  >
                    <MonoLabel as="span" className="lg:hidden">
                      Status
                    </MonoLabel>
                    <Badge
                      variant="outline"
                      className={statusBadgeClass(userStatus(user))}
                    >
                      {statusLabel(userStatus(user))}
                    </Badge>
                    {userActivityStatus(user) !== "active" ? (
                      <span
                        className={`text-xs ${activityBadgeClass(userActivityStatus(user))}`}
                      >
                        {activityLabel(userActivityStatus(user))}
                      </span>
                    ) : null}
                  </div>
                  <div role="cell" className="col-span-2 min-w-0 lg:col-span-1">
                    <MonoLabel as="span" className="lg:hidden">
                      Presence
                    </MonoLabel>
                    <div className="mt-1.5 space-y-1.5 lg:mt-0">
                      <span className="flex items-center gap-2 text-text-primary">
                        <span
                          aria-hidden="true"
                          className={`h-1 w-1 shrink-0 rounded-full ${user.listening_now || user.online_now ? "bg-accent-action-hi" : "bg-text-subtle"}`}
                        />
                        {user.listening_now
                          ? "Listening now"
                          : user.online_now
                            ? "Active now"
                            : "Offline"}
                      </span>
                      <div className="font-mono text-[10px] text-text-subtle">
                        Devices {user.active_devices ?? 0} · Sessions{" "}
                        {user.active_sessions ?? 0}
                      </div>
                      <div className="text-xs text-text-muted">
                        Seen {formatRelativeTimestamp(user.last_seen_at)}
                      </div>
                    </div>
                  </div>
                  <div
                    role="cell"
                    className="col-span-2 flex flex-wrap justify-end gap-2 lg:col-span-1"
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openUserDetail(user)}
                    >
                      Inspect
                    </Button>
                    {canDeleteUsers ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteTarget(user)}
                        disabled={userStatus(user) === "deleted"}
                      >
                        Delete
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
              {filteredUsers.length === 0 ? (
                <div
                  role="row"
                  className="py-10 text-center text-sm text-text-muted"
                >
                  <span role="cell">
                    No users match the current search or filter.
                  </span>
                </div>
              ) : null}
            </div>
          </div>

          {filteredUsers.length > 0 && pageCount > 1 ? (
            <div className="flex items-center justify-between gap-3 border-t border-border-quiet pt-4">
              <Button
                size="sm"
                variant="outline"
                aria-label="Previous page"
                disabled={page === 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                <ChevronLeft
                  data-admin-ux="users-previous"
                  aria-hidden="true"
                  size={15}
                  className="mr-1"
                />
                Previous
              </Button>
              <span className="text-xs text-text-muted">
                Page {page} of {pageCount}
              </span>
              <Button
                size="sm"
                variant="outline"
                aria-label="Next page"
                disabled={page === pageCount}
                onClick={() =>
                  setPage((current) => Math.min(pageCount, current + 1))
                }
              >
                Next
                <ChevronRight
                  data-admin-ux="users-next"
                  aria-hidden="true"
                  size={15}
                  className="ml-1"
                />
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <AddUserDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onSuccess={fetchUsers}
        canAssignRoles={canAssignRoles}
      />
      {canCreateUsers ? (
        <InviteUserDialog open={inviteOpen} onOpenChange={setInviteOpen} />
      ) : null}

      <UserDetailDialog
        key={detailTarget?.id ?? "closed"}
        user={detailTarget}
        onOpenChange={(open) => {
          if (!open) {
            setDetailTarget(null);
            setInspectParam(null);
          }
        }}
        onSuccess={fetchUsers}
        canManageStatus={canManageStatus}
        canManagePasswords={canManagePasswords}
        canManageSessions={canManageSessions}
        canAssignRoles={canAssignRoles}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete user"
        description={`Soft-delete ${
          deleteTarget?.name || deleteTarget?.email
        }? Open sessions will be revoked and owned contributions may be queued for cleanup.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
        onError={(err) =>
          toast.error(
            err instanceof ApiError ? err.message : "Failed to delete user",
          )
        }
        eyebrow="Confirm action"
        consequence={`${
          deleteTarget?.name || deleteTarget?.email || "User"
        } · soft-deletes the account · revokes open sessions`}
      />
    </div>
  );
}

function UserDetailDialog({
  user,
  onOpenChange,
  onSuccess,
  canManageStatus,
  canManagePasswords,
  canManageSessions,
  canAssignRoles,
}: {
  user: UserRecord | null;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  canManageStatus: boolean;
  canManagePasswords: boolean;
  canManageSessions: boolean;
  canAssignRoles: boolean;
}) {
  const { user: currentUser, refetch } = useAuth();
  const open = !!user;
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const detailRequestRef = useRef(0);
  const [loadingRequest, setLoadingRequest] = useState<number | null>(null);
  const loading = loadingRequest !== null;
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>("active");
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [roleDraft, setRoleDraft] = useState<string[]>(["user"]);
  const [statusDraft, setStatusDraft] = useState("active");
  const [statusReason, setStatusReason] = useState("");
  const [roleSaving, setRoleSaving] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);

  const fetchDetail = useCallback(
    async (userId: number, signal?: AbortSignal) => {
      const requestId = ++detailRequestRef.current;
      setLoadingRequest(requestId);
      setDetailError(null);
      try {
        const data = await api<UserDetail>(
          `/api/auth/users/${userId}`,
          "GET",
          undefined,
          { signal },
        );
        if (signal?.aborted || requestId !== detailRequestRef.current) return;
        setDetail(data);
      } catch (err) {
        if (
          signal?.aborted ||
          requestId !== detailRequestRef.current ||
          (err instanceof DOMException && err.name === "AbortError")
        ) {
          return;
        }
        toast.error(
          err instanceof ApiError ? err.message : "Failed to load user detail",
        );
        setDetailError("User detail could not be loaded. Try again.");
        setDetail(null);
      } finally {
        setLoadingRequest((activeRequest) =>
          activeRequest === requestId ? null : activeRequest,
        );
      }
    },
    [],
  );

  useEffect(() => {
    if (!open || !user) {
      setDetail(null);
      setPasswordDialogOpen(false);
      return;
    }
    setSessionFilter("active");
    const controller = new AbortController();
    void fetchDetail(user.id, controller.signal);
    return () => controller.abort();
  }, [fetchDetail, open, user]);

  useEffect(() => {
    if (detail) {
      setRoleDraft(rolesForUser(detail));
    }
  }, [detail]);

  useEffect(() => {
    if (detail?.status) {
      setStatusDraft(userStatus(detail));
      setStatusReason(detail.status_reason ?? "");
    }
  }, [detail]);

  async function handleRoleSave() {
    if (
      !detail ||
      !canAssignRoles ||
      sameRoleSet(roleDraft, rolesForUser(detail))
    )
      return;
    setRoleSaving(true);
    try {
      const updated = await api<UserDetail>(
        `/api/auth/users/${detail.id}/role`,
        "PATCH",
        { roles: roleDraft },
      );
      setDetail(updated);
      toast.success("Role updated");
      onSuccess();
      if (currentUser?.id === detail.id) {
        refetch();
      }
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to update role",
      );
    } finally {
      setRoleSaving(false);
    }
  }

  async function handleStatusSave() {
    if (!detail || !canManageStatus || statusDraft === userStatus(detail))
      return;
    setStatusSaving(true);
    try {
      const updated = await api<UserDetail>(
        `/api/auth/users/${detail.id}/status`,
        "PATCH",
        {
          status: statusDraft,
          reason: statusReason || undefined,
          revoke_sessions: statusDraft !== "active",
        },
      );
      setDetail(updated);
      toast.success("User status updated");
      onSuccess();
      if (currentUser?.id === detail.id) {
        refetch();
      }
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to update user status",
      );
    } finally {
      setStatusSaving(false);
    }
  }

  async function handleRevokeSession(sessionId: string) {
    if (!detail || !canManageSessions) return;
    setRevokingId(sessionId);
    try {
      await api(`/api/auth/users/${detail.id}/sessions/${sessionId}`, "DELETE");
      toast.success("Session revoked");
      await fetchDetail(detail.id);
      onSuccess();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to revoke session",
      );
    } finally {
      setRevokingId(null);
    }
  }

  async function handleRevokeAll() {
    if (!detail || !canManageSessions) return;
    setRevokingAll(true);
    try {
      const result = await api<{ revoked: number }>(
        `/api/auth/users/${detail.id}/sessions/revoke-all`,
        "POST",
      );
      toast.success(
        `Revoked ${result.revoked} session${result.revoked === 1 ? "" : "s"}`,
      );
      await fetchDetail(detail.id);
      onSuccess();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to revoke sessions",
      );
    } finally {
      setRevokingAll(false);
    }
  }

  const visibleSessions = useMemo(
    () => filterSessions(detail?.sessions ?? [], sessionFilter),
    [detail?.sessions, sessionFilter],
  );
  const openSessions = useMemo(
    () => (detail?.sessions ?? []).filter((session) => !session.revoked_at),
    [detail?.sessions],
  );
  const staleOpenCount = useMemo(
    () =>
      openSessions.filter((session) => {
        const status = getSessionStatus(session).key;
        return status === "history" || status === "expired";
      }).length,
    [openSessions],
  );
  const sessionSourceSummary = useMemo(
    () => summarizeSessions(detail?.sessions ?? []),
    [detail?.sessions],
  );
  const sessionStatusCounts = useMemo(
    () =>
      (detail?.sessions ?? []).reduce(
        (acc, session) => {
          const status = getSessionStatus(session).key;
          if (status === "active") acc.connected += 1;
          else if (status === "recent") acc.recent += 1;
          else if (status === "revoked") acc.revoked += 1;
          else acc.history += 1;
          return acc;
        },
        { connected: 0, recent: 0, history: 0, revoked: 0 },
      ),
    [detail?.sessions],
  );
  const hiddenSessionsCount = Math.max(
    (detail?.sessions?.length ?? 0) - visibleSessions.length,
    0,
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          data-overlay-size={undefined}
          className="flex max-h-[90vh] max-w-7xl flex-col overflow-hidden"
        >
          <DialogHeader>
            <DialogTitle className="font-display">User Detail</DialogTitle>
            <DialogDescription>
              Inspect real-time presence, what the user is currently hearing,
              and filter session history by meaningful recency.
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div
              role="status"
              aria-label="Loading user detail"
              className="flex items-center justify-center py-12 text-muted-foreground"
            >
              <Loader2
                data-admin-ux="users-detail-loading"
                aria-hidden="true"
                className="h-5 w-5 animate-spin"
              />
            </div>
          ) : detailError ? (
            <ErrorState
              title="User detail unavailable"
              message={detailError}
              onRetry={() => {
                if (user) void fetchDetail(user.id);
              }}
            />
          ) : detail ? (
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
              <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr_1fr]">
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-start gap-4">
                      <UserAvatar user={detail} size="md" />
                      <div className="crate-form-field min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-display text-xl font-semibold tracking-tight text-text-primary">
                            {detail.name || detail.email}
                          </h3>
                          {rolesForUser(detail).map((role) => (
                            <Badge
                              key={role}
                              variant={
                                role === "admin" || role === "owner"
                                  ? "default"
                                  : "secondary"
                              }
                            >
                              {roleLabel(role)}
                            </Badge>
                          ))}
                          <Badge
                            variant="outline"
                            className={statusBadgeClass(userStatus(detail))}
                          >
                            {statusLabel(userStatus(detail))}
                          </Badge>
                          {detail.username ? (
                            <Badge variant="outline">@{detail.username}</Badge>
                          ) : null}
                        </div>
                        <div className="break-all text-sm text-text-muted">
                          {detail.email}
                        </div>
                      </div>
                    </div>
                    {detail.bio ? (
                      <p className="mt-4 text-sm leading-relaxed text-text-muted">
                        {detail.bio}
                      </p>
                    ) : null}
                    <div className="mt-4 rounded-md border border-border-quiet bg-card p-3">
                      <div className="crate-form-field">
                        <MonoLabel as="div" size="eyebrow">
                          Roles
                        </MonoLabel>
                        {canAssignRoles ? (
                          <div className="space-y-3">
                            <RolePicker
                              value={roleDraft}
                              onChange={setRoleDraft}
                              disabled={roleSaving}
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                roleSaving ||
                                sameRoleSet(roleDraft, rolesForUser(detail))
                              }
                              aria-label="Save roles"
                              onClick={handleRoleSave}
                            >
                              {roleSaving ? (
                                <Loader2
                                  data-admin-ux="users-roles-loading"
                                  aria-hidden="true"
                                  className="h-4 w-4 animate-spin"
                                />
                              ) : (
                                "Save roles"
                              )}
                            </Button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-2 text-sm text-text-secondary">
                            {rolesForUser(detail).map((role) => (
                              <InfoBadge key={role}>
                                {roleLabel(role)}
                              </InfoBadge>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {(detail.capabilities || [])
                          .slice(0, 8)
                          .map((capability) => (
                            <InfoBadge
                              key={capability}
                              className="text-text-muted"
                            >
                              {capability}
                            </InfoBadge>
                          ))}
                        {(detail.capabilities?.length ?? 0) > 8 ? (
                          <InfoBadge className="text-text-subtle">
                            +{(detail.capabilities?.length ?? 0) - 8} more
                          </InfoBadge>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-4 rounded-md border border-border-quiet bg-card p-3">
                      <div className="crate-form-field">
                        <MonoLabel
                          as="div"
                          size="eyebrow"
                          className="flex items-center gap-2"
                        >
                          Account status
                        </MonoLabel>
                        {canManageStatus ? (
                          <div className="space-y-3">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                              <SegmentedControl
                                as="radio"
                                label="Account status"
                                value={statusDraft}
                                onValueChange={setStatusDraft}
                                items={STATUS_OPTIONS.map((item) => ({
                                  ...item,
                                  disabled: statusSaving,
                                }))}
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={
                                  statusSaving ||
                                  statusDraft === userStatus(detail)
                                }
                                aria-label="Save status"
                                onClick={handleStatusSave}
                              >
                                {statusSaving ? (
                                  <Loader2
                                    data-admin-ux="users-status-loading"
                                    aria-hidden="true"
                                    className="h-4 w-4 animate-spin"
                                  />
                                ) : (
                                  "Save status"
                                )}
                              </Button>
                            </div>
                            <Input
                              value={statusReason}
                              onChange={(event) =>
                                setStatusReason(event.target.value)
                              }
                              aria-label="Reason for suspension/deletion"
                              placeholder="Reason for suspension/deletion"
                            />
                            {statusDraft !== "active" ? (
                              <p className="text-xs text-state-warning-text/75">
                                Saving this status revokes open sessions and
                                blocks future login/refresh attempts.
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <div className="text-sm text-text-secondary">
                            {statusLabel(userStatus(detail))}
                          </div>
                        )}
                      </div>
                      {detail.status_reason ? (
                        <div className="mt-3 text-xs text-text-muted">
                          Reason: {detail.status_reason}
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="crate-form-field rounded-md border border-border-quiet bg-card p-3">
                        <MonoLabel as="div" size="eyebrow">
                          Created
                        </MonoLabel>
                        <div className="text-sm text-text-secondary">
                          {formatSessionTimestamp(detail.created_at)}
                        </div>
                      </div>
                      <div className="crate-form-field rounded-md border border-border-quiet bg-card p-3">
                        <MonoLabel as="div" size="eyebrow">
                          Last login
                        </MonoLabel>
                        <div className="text-sm text-text-secondary">
                          {formatSessionTimestamp(detail.last_login)}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="font-display text-base text-text-primary">
                      Presence
                    </CardTitle>
                    <CardDescription>
                      Real activity, not just open tokens.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <UserPresence user={detail} />
                    <div className="grid gap-3">
                      <div className="crate-form-field rounded-md border border-border-quiet bg-card p-3">
                        <MonoLabel as="div" size="eyebrow">
                          Last seen
                        </MonoLabel>
                        <div className="text-sm text-text-secondary">
                          {formatSessionTimestamp(detail.last_seen_at)}
                        </div>
                      </div>
                      <div className="crate-form-field rounded-md border border-border-quiet bg-card p-3">
                        <MonoLabel as="div" size="eyebrow">
                          Last play event
                        </MonoLabel>
                        <div className="text-sm text-text-secondary">
                          {formatSessionTimestamp(detail.last_played_at)}
                        </div>
                      </div>
                    </div>
                    {detail.current_track ? (
                      <div className="crate-form-field rounded-md border border-accent-action/15 bg-accent-action/8 p-3">
                        <MonoLabel as="div" size="eyebrow" tone="accent">
                          {detail.listening_now
                            ? "Currently playing"
                            : "Latest track"}
                        </MonoLabel>
                        <CurrentTrackLine track={detail.current_track} />
                      </div>
                    ) : null}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="font-display text-base text-text-primary">
                      Access & session footprint
                    </CardTitle>
                    <CardDescription>
                      Linked identity plus the real shape of the user’s device
                      history.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                      {(detail.connected_accounts || []).length > 0 ? (
                        (detail.connected_accounts || []).map((account) => (
                          <InfoBadge key={`${detail.id}-${account.provider}`}>
                            {account.provider}
                            {account.external_username
                              ? ` · ${account.external_username}`
                              : ""}
                          </InfoBadge>
                        ))
                      ) : (
                        <InfoBadge className="text-text-muted">
                          No linked providers
                        </InfoBadge>
                      )}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="crate-form-field rounded-md border border-border-quiet bg-card p-3">
                        <MonoLabel as="div" size="eyebrow">
                          Active footprint
                        </MonoLabel>
                        <div className="text-lg font-semibold text-text-primary">
                          {detail.active_devices ?? 0} device
                          {(detail.active_devices ?? 0) === 1 ? "" : "s"}
                        </div>
                        <div className="text-xs text-text-subtle">
                          {detail.active_sessions ?? 0} active session token
                          {(detail.active_sessions ?? 0) === 1 ? "" : "s"}
                        </div>
                      </div>
                      <div className="crate-form-field rounded-md border border-border-quiet bg-card p-3">
                        <MonoLabel as="div" size="eyebrow">
                          Historical tokens
                        </MonoLabel>
                        <div className="text-lg font-semibold text-text-primary">
                          {detail.sessions.length}
                        </div>
                        <div className="text-xs text-text-subtle">
                          {sessionStatusCounts.history} stale/history ·{" "}
                          {sessionStatusCounts.revoked} revoked
                        </div>
                      </div>
                    </div>
                    <div className="crate-form-field rounded-md border border-border-quiet bg-card p-3">
                      <MonoLabel as="div" size="eyebrow">
                        Security
                      </MonoLabel>
                      <div className="text-sm text-text-primary">
                        {authModeSummary(detail)}
                      </div>
                      {canManagePasswords ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setPasswordDialogOpen(true)}
                          >
                            {detail.has_password
                              ? "Reset password"
                              : "Set password"}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                    {sessionSourceSummary.length > 0 ? (
                      <div className="space-y-2">
                        <MonoLabel as="div" size="eyebrow">
                          Top clients
                        </MonoLabel>
                        <div className="space-y-2">
                          {sessionSourceSummary.slice(0, 4).map((source) => (
                            <div
                              key={source.key}
                              className="rounded-md border border-border-quiet bg-card p-3"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="crate-form-field min-w-0">
                                  <div className="truncate text-sm font-medium text-text-primary">
                                    {source.label}
                                  </div>
                                  <div className="text-xs text-text-subtle">
                                    {source.app_id || "web"} · last seen{" "}
                                    {formatRelativeTimestamp(
                                      source.last_seen_at,
                                    )}
                                  </div>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  {source.online + source.connected > 0 ? (
                                    <InfoBadge tone="accent">
                                      {source.online + source.connected} active
                                    </InfoBadge>
                                  ) : null}
                                  {source.recent > 0 ? (
                                    <InfoBadge>
                                      {source.recent} recent
                                    </InfoBadge>
                                  ) : null}
                                  {source.history > 0 ? (
                                    <InfoBadge className="text-text-muted">
                                      {source.history} history
                                    </InfoBadge>
                                  ) : null}
                                  {source.revoked > 0 ? (
                                    <InfoBadge className="text-text-muted">
                                      {source.revoked} revoked
                                    </InfoBadge>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {staleOpenCount > 0 ? (
                      <div className="rounded-md border border-state-warning/20 bg-state-warning/10 p-3 text-sm text-state-warning-text/80">
                        {staleOpenCount} open session
                        {staleOpenCount === 1 ? "" : "s"} look stale or
                        historical. They remain valid records, but they are not
                        counted as active devices anymore.
                      </div>
                    ) : null}
                    {canManageSessions ? (
                      <div>
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label="Revoke all sessions"
                          onClick={handleRevokeAll}
                          disabled={revokingAll || detail.sessions.length === 0}
                        >
                          {revokingAll ? (
                            <Loader2
                              data-admin-ux="users-revoke-all-loading"
                              aria-hidden="true"
                              className="mr-2 h-4 w-4 animate-spin"
                            />
                          ) : null}
                          Revoke all sessions
                        </Button>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <CardTitle className="font-display text-base text-text-primary">
                        Sessions
                      </CardTitle>
                      <CardDescription>
                        `Active` shows only real live sessions, `Recent` keeps
                        the last few days, and `All` exposes full history.
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <FilterChip
                        active={sessionFilter === "active"}
                        onClick={() => setSessionFilter("active")}
                      >
                        Active
                      </FilterChip>
                      <FilterChip
                        active={sessionFilter === "recent"}
                        onClick={() => setSessionFilter("recent")}
                      >
                        Recent
                      </FilterChip>
                      <FilterChip
                        active={sessionFilter === "all"}
                        onClick={() => setSessionFilter("all")}
                      >
                        All history
                      </FilterChip>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-sm text-text-muted">
                    Showing {visibleSessions.length} of {detail.sessions.length}{" "}
                    recorded sessions
                  </div>
                  {sessionFilter !== "all" && hiddenSessionsCount > 0 ? (
                    <div className="rounded-md border border-border-quiet bg-card px-4 py-3 text-sm text-text-muted">
                      {hiddenSessionsCount} historical or stale session
                      {hiddenSessionsCount === 1 ? "" : "s"} hidden to keep the
                      view focused on real devices and recent sign-ins.
                    </div>
                  ) : null}

                  {visibleSessions.length > 0 ? (
                    visibleSessions.map((session) => {
                      const status = getSessionStatus(session);
                      const metaLine = sessionMetaLine(session);
                      return (
                        <div
                          key={session.id}
                          className="flex flex-col gap-3 rounded-md border border-border-quiet bg-card p-4 lg:flex-row lg:items-start lg:justify-between"
                        >
                          <div className="min-w-0 flex-1 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-sm font-medium text-text-primary">
                                {sessionDisplayName(session)}
                              </div>
                              <Badge className={status.className}>
                                {status.label}
                              </Badge>
                              <InfoBadge>{session.app_id || "web"}</InfoBadge>
                            </div>
                            <div className="flex flex-wrap gap-4 text-sm text-text-muted">
                              <span>
                                Seen{" "}
                                {formatRelativeTimestamp(
                                  session.last_seen_at || session.created_at,
                                )}
                              </span>
                              <span>
                                Created{" "}
                                {formatRelativeTimestamp(session.created_at)}
                              </span>
                              <span>IP {session.last_seen_ip || "—"}</span>
                            </div>
                            {metaLine ? (
                              <div className="text-xs text-text-subtle">
                                {metaLine}
                              </div>
                            ) : null}
                            {session.device_brand || session.device_model ? (
                              <div className="text-xs text-text-subtle">
                                {[session.device_brand, session.device_model]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </div>
                            ) : null}
                            <div className="text-xs font-mono text-text-subtle">
                              {session.id}
                            </div>
                          </div>
                          {canManageSessions ? (
                            <div className="flex shrink-0 gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={
                                  !!session.revoked_at ||
                                  revokingId === session.id
                                }
                                aria-label="Revoke"
                                onClick={() => handleRevokeSession(session.id)}
                              >
                                {revokingId === session.id ? (
                                  <Loader2
                                    data-admin-ux="users-revoke-loading"
                                    aria-hidden="true"
                                    className="h-4 w-4 animate-spin"
                                  />
                                ) : (
                                  "Revoke"
                                )}
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  ) : (
                    <div className="rounded-md border border-dashed border-border-quiet bg-card px-6 py-10 text-center text-sm text-text-muted">
                      No sessions match the current visibility filter.
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {canManagePasswords ? (
        <SetPasswordDialog
          open={passwordDialogOpen && !!detail}
          onOpenChange={setPasswordDialogOpen}
          user={detail}
          onSuccess={async () => {
            if (detail) {
              await fetchDetail(detail.id);
            }
            onSuccess();
          }}
        />
      ) : null}
    </>
  );
}

function SetPasswordDialog({
  open,
  onOpenChange,
  user,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserDetail | null;
  onSuccess: () => Promise<void> | void;
}) {
  const [newPassword, setNewPassword] = useState("");
  const [revokeAllSessions, setRevokeAllSessions] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setNewPassword("");
      setRevokeAllSessions(true);
      return;
    }
    setNewPassword(generatePassword());
    setRevokeAllSessions(true);
  }, [open]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!user) return;
    setSubmitting(true);
    try {
      const result = await api<{ revoked: number }>(
        `/api/auth/users/${user.id}/set-password`,
        "POST",
        {
          new_password: newPassword,
          revoke_all_sessions: revokeAllSessions,
        },
      );
      toast.success(
        revokeAllSessions
          ? `Password updated and ${result.revoked} session${
              result.revoked === 1 ? "" : "s"
            } revoked`
          : "Password updated",
      );
      onOpenChange(false);
      await onSuccess();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to update password",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">
            {user?.has_password ? "Reset local password" : "Set local password"}
          </DialogTitle>
          <DialogDescription>
            {user?.has_password
              ? "Replace the current local password. SSO sign-in stays linked."
              : "Enable password login for this account without removing SSO providers."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="crate-form-field">
            <div className="flex items-end justify-between gap-3">
              <label
                className="text-sm font-medium text-text-primary"
                htmlFor="admin-user-password"
              >
                New password
              </label>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="text-text-secondary hover:text-text-primary"
                onClick={() => setNewPassword(generatePassword())}
              >
                Generate
              </Button>
            </div>
            <Input
              id="admin-user-password"
              type="text"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              minLength={8}
              required
            />
          </div>
          <label className="flex items-start gap-3 rounded-md border border-border-quiet bg-card p-3 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={revokeAllSessions}
              onChange={(event) => setRevokeAllSessions(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border-quiet bg-transparent"
            />
            <span>Revoke other sessions after changing the password</span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              aria-label={
                user?.has_password ? "Reset password" : "Set password"
              }
              type="submit"
              disabled={submitting || newPassword.trim().length < 8}
            >
              {submitting ? (
                <Loader2
                  data-admin-ux="users-password-loading"
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin"
                />
              ) : user?.has_password ? (
                "Reset password"
              ) : (
                "Set password"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddUserDialog({
  open,
  onOpenChange,
  onSuccess,
  canAssignRoles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  canAssignRoles: boolean;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [roles, setRoles] = useState<string[]>(["user"]);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setEmail("");
    setName("");
    setPassword("");
    setRoles(["user"]);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await api("/api/auth/users", "POST", {
        email,
        name: name || undefined,
        password,
        roles: canAssignRoles ? roles : ["user"],
      });
      toast.success("User created");
      onOpenChange(false);
      reset();
      onSuccess();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to create user",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Add User</DialogTitle>
          <DialogDescription>
            Create a new account with initial roles and password.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="crate-form-field">
            <label
              htmlFor="new-user-name"
              className="font-mono text-xs text-text-muted"
            >
              Name
            </label>
            <Input
              id="new-user-name"
              placeholder="Name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>
          <div className="crate-form-field">
            <label
              htmlFor="new-user-email"
              className="font-mono text-xs text-text-muted"
            >
              Email
            </label>
            <Input
              id="new-user-email"
              type="email"
              placeholder="Email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div className="crate-form-field">
            <label
              htmlFor="new-user-password"
              className="font-mono text-xs text-text-muted"
            >
              Password
            </label>
            <Input
              id="new-user-password"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={8}
            />
          </div>
          {canAssignRoles ? (
            <div className="crate-form-field rounded-md border border-border-quiet bg-card p-3">
              <MonoLabel as="div" size="eyebrow">
                Roles
              </MonoLabel>
              <RolePicker value={roles} onChange={setRoles} />
            </div>
          ) : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button aria-label="Create" type="submit" disabled={submitting}>
              {submitting ? (
                <Loader2
                  data-admin-ux="users-create-loading"
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin"
                />
              ) : (
                "Create"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InviteUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [email, setEmail] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("14");
  const [submitting, setSubmitting] = useState(false);
  const [invite, setInvite] = useState<AuthInvite | null>(null);

  const inviteUrl = invite ? listenRegisterUrl(invite.token) : "";

  useEffect(() => {
    if (open) return;
    setEmail("");
    setExpiresInDays("14");
    setInvite(null);
  }, [open]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return;
    setSubmitting(true);
    try {
      const days = Math.max(1, Number.parseInt(expiresInDays, 10) || 14);
      const result = await api<AuthInvite>("/api/admin/auth/invites", "POST", {
        email: normalizedEmail,
        expires_in_hours: days * 24,
        max_uses: 1,
      });
      setInvite(result);
      toast.success(`Invite created for ${normalizedEmail}`);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to create invite",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function copyInvite() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      toast.success("Invite link copied");
    } catch {
      toast.error("Failed to copy invite link");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Invite user</DialogTitle>
          <DialogDescription>
            Create a single-use invite locked to the exact email address the
            user signs in with.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="crate-form-field">
            <label
              className="text-sm font-medium text-text-primary"
              htmlFor="invite-email"
            >
              Email
            </label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="person@example.com"
              required
            />
          </div>
          <div className="crate-form-field">
            <label
              className="text-sm font-medium text-text-primary"
              htmlFor="invite-expiry"
            >
              Expires in days
            </label>
            <Input
              id="invite-expiry"
              type="number"
              min={1}
              max={90}
              value={expiresInDays}
              onChange={(event) => setExpiresInDays(event.target.value)}
              required
            />
          </div>

          {invite ? (
            <div className="rounded-md border border-accent-action/20 bg-accent-action/8 p-3">
              <div className="crate-form-field">
                <div className="font-mono text-xs uppercase tracking-[0.12em] text-accent-action-hi/70">
                  Invite link
                </div>
                <div className="break-all rounded-md border border-border-quiet bg-card p-3 font-mono text-xs text-text-secondary">
                  {inviteUrl}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted">
                <span>
                  Locked to {invite.email || email.trim().toLowerCase()} ·
                  single use
                  {invite.expires_at
                    ? ` · expires ${formatSessionTimestamp(invite.expires_at)}`
                    : ""}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={copyInvite}
                >
                  Copy link
                </Button>
              </div>
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
            <Button
              aria-label="Create invite"
              type="submit"
              disabled={submitting || !email.trim()}
            >
              {submitting ? (
                <Loader2
                  data-admin-ux="users-invite-loading"
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin"
                />
              ) : (
                "Create invite"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
