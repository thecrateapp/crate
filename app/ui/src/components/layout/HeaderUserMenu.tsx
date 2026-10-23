import { useMemo, useState } from "react";
import { useNavigate } from "react-router";

import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { Button } from "@crate/ui/shadcn/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@crate/ui/shadcn/dropdown-menu";
import { useAuth, userCanAccessAdminConsole } from "@/contexts/AuthContext";

const ACTUAL_PERMISSIONS = "__actual_permissions__";

export function HeaderUserMenu() {
  const navigate = useNavigate();
  const auth = useAuth();
  const [avatarFailed, setAvatarFailed] = useState(false);
  const rolePresets = auth.rolePresets ?? [];
  const previewableRolePresets = useMemo(
    () =>
      rolePresets.filter((role) =>
        userCanAccessAdminConsole({
          id: 0,
          email: "",
          name: role.name,
          role: role.slug,
          roles: [role.slug],
          capabilities: role.capabilities,
        }),
      ),
    [rolePresets],
  );
  const user = auth.user;
  if (!user) return null;
  const profileHref = auth.hasAnyCapability(["users.view"])
    ? `/users?inspect=${user.id}`
    : "/browse";
  const selectedRole = auth.previewRole || ACTUAL_PERMISSIONS;
  const userName = user.name || user.email;
  const initial = userName.slice(0, 1).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-lg"
          className="shrink-0 rounded-full p-0"
          aria-label={`${userName} account menu`}
        >
          <span className="relative flex size-9 items-center justify-center overflow-hidden rounded-full border border-border-quiet-subtle bg-surface-control text-sm text-text-secondary">
            {user.avatar && !avatarFailed ? (
              <img
                src={user.avatar}
                alt=""
                className="absolute inset-0 size-full object-cover"
                onError={() => setAvatarFailed(true)}
              />
            ) : (
              <span aria-hidden="true">{initial}</span>
            )}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-72">
        <DropdownMenuLabel className="px-3 py-2">
          <span className="block truncate text-sm font-medium text-text-primary">
            {userName}
          </span>
          <span className="mt-1 block truncate text-xs font-normal text-text-muted">
            {user.email}
          </span>
          <span className="mt-2 block">
            <MonoLabel as="span" className="text-text-subtle">
              {auth.previewRole ? `PREVIEWING ${auth.previewRole}` : user.role}
            </MonoLabel>
          </span>
        </DropdownMenuLabel>
        {auth.actualUser && previewableRolePresets.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>
              <MonoLabel as="span">Permission preview</MonoLabel>
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={selectedRole}
              onValueChange={(value) =>
                auth.setPreviewRole?.(
                  value === ACTUAL_PERMISSIONS ? null : value,
                )
              }
            >
              <DropdownMenuRadioItem value={ACTUAL_PERMISSIONS}>
                <MonoLabel as="span">Actual permissions</MonoLabel>
              </DropdownMenuRadioItem>
              {previewableRolePresets.map((role) => (
                <DropdownMenuRadioItem key={role.slug} value={role.slug}>
                  <MonoLabel as="span">{role.name}</MonoLabel>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate(profileHref)}>
          <MonoLabel as="span">Profile</MonoLabel>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={auth.logout}>
          <MonoLabel as="span">Log out</MonoLabel>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
