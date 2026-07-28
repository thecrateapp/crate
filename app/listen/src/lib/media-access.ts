export type MediaAccessAudience = "artwork" | "stream" | "sse" | "ws";

export interface MediaAccessTarget {
  audience: MediaAccessAudience;
  path: string;
}

export interface MediaAccessTicket extends MediaAccessTarget {
  ticket: string;
  expires_at: string;
}

export type MediaAccessTickets = MediaAccessTicket[];

export const MEDIA_ACCESS_TICKETS_EVENT = "crate:media-access-tickets-updated";
const EXPIRY_MARGIN_MS = 5_000;
const MAX_TARGETS_PER_SCOPE = 512;
const ticketsByScope = new Map<string, Map<string, MediaAccessTicket>>();
const targetsByScope = new Map<string, Map<string, MediaAccessTarget>>();
const ticketListeners = new Set<() => void>();
let ticketVersion = 0;

function normalizedPath(path: string): string | null {
  try {
    const parsed = new URL(path, "https://crate.local");
    return parsed.pathname.startsWith("/api/") ? parsed.pathname : null;
  } catch {
    return null;
  }
}

function ticketKey(audience: MediaAccessAudience, path: string): string {
  return `${audience}:${path}`;
}

function rememberTarget(
  audience: MediaAccessAudience,
  path: string,
  scope: string,
): void {
  const scoped = targetsByScope.get(scope) ?? new Map();
  const key = ticketKey(audience, path);
  scoped.delete(key);
  scoped.set(key, { audience, path });
  while (scoped.size > MAX_TARGETS_PER_SCOPE) {
    const oldest = scoped.keys().next().value as string | undefined;
    if (!oldest) break;
    scoped.delete(oldest);
    ticketsByScope.get(scope)?.delete(oldest);
  }
  targetsByScope.set(scope, scoped);
}

function notifyMediaAccessTicketsChanged(): void {
  ticketVersion += 1;
  for (const listener of ticketListeners) listener();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(MEDIA_ACCESS_TICKETS_EVENT));
  }
}

export function subscribeMediaAccessTickets(listener: () => void): () => void {
  ticketListeners.add(listener);
  return () => ticketListeners.delete(listener);
}

export function getMediaAccessTicketsVersion(): number {
  return ticketVersion;
}

export function setMediaAccessTickets(
  next: MediaAccessTickets,
  scope: string,
): void {
  const scoped = ticketsByScope.get(scope) ?? new Map();
  for (const ticket of next) {
    const path = normalizedPath(ticket.path);
    if (!path) continue;
    rememberTarget(ticket.audience, path, scope);
    scoped.set(ticketKey(ticket.audience, path), { ...ticket, path });
  }
  ticketsByScope.set(scope, scoped);
  notifyMediaAccessTicketsChanged();
}

export function clearMediaAccessTickets(): void {
  ticketsByScope.clear();
  targetsByScope.clear();
  notifyMediaAccessTicketsChanged();
}

export function getMediaAccessTicket(
  audience: MediaAccessAudience,
  path: string,
  scope: string,
): string | null {
  const normalized = normalizedPath(path);
  if (!normalized) return null;
  rememberTarget(audience, normalized, scope);
  const tickets = ticketsByScope.get(scope);
  const key = ticketKey(audience, normalized);
  const current = tickets?.get(key);
  if (!current?.ticket) return null;
  const expiresAt = new Date(current.expires_at).getTime();
  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now() + EXPIRY_MARGIN_MS
  ) {
    tickets?.delete(key);
    return null;
  }
  return current.ticket;
}

export function getMediaAccessTargets(scope: string): MediaAccessTarget[] {
  const scoped = targetsByScope.get(scope);
  if (!scoped) return [];
  return Array.from(scoped.values());
}
