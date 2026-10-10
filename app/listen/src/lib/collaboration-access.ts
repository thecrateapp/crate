export type CollaborationAccess = "owner" | "collaborator" | "public";

interface AccessSubject {
  access?: CollaborationAccess | null;
  visibility?: "public" | "private" | null;
}

export function canEdit(subject: AccessSubject | null | undefined): boolean {
  return subject?.access === "owner" || subject?.access === "collaborator";
}

export function canManage(subject: AccessSubject | null | undefined): boolean {
  return subject?.access === "owner";
}

export function canLeave(subject: AccessSubject | null | undefined): boolean {
  return subject?.access === "collaborator";
}

export function canFollow(subject: AccessSubject | null | undefined): boolean {
  return subject?.access === "public" && subject.visibility === "public";
}

export function canCopy(subject: AccessSubject | null | undefined): boolean {
  return canFollow(subject);
}
