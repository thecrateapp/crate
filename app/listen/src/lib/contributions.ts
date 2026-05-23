export interface ContributorIdentity {
  user_email?: string | null;
  user_username?: string | null;
  user_name?: string | null;
}

export function contributionSourceLabel(source?: string | null): string | null {
  const normalized = (source || "").trim().toLowerCase();
  if (!normalized) return null;
  if (
    normalized === "upload" ||
    normalized === "admin_upload" ||
    normalized === "listen_upload" ||
    normalized === "library_upload"
  ) {
    return "upload";
  }
  if (normalized === "bandcamp") return "Bandcamp";
  return normalized.replace(/[_-]+/g, " ");
}

export function contributorDisplayName(
  contributor?: ContributorIdentity | null,
): string {
  const username = contributor?.user_username?.trim();
  if (username) return username.startsWith("@") ? username : `@${username}`;

  return (
    contributor?.user_name?.trim() || contributor?.user_email?.trim() || ""
  );
}

export function contributorProfilePath(
  contributor?: ContributorIdentity | null,
): string | null {
  const username = contributor?.user_username?.trim().replace(/^@/, "");
  return username ? `/users/${encodeURIComponent(username)}` : null;
}
