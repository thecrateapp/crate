import { type ReactNode } from "react";
import { Link, type LinkProps } from "react-router";

import { ProfileHoverCard } from "@/components/social/ProfileHoverCard";

interface UserProfileLinkProps extends Omit<LinkProps, "to"> {
  username?: string | null;
  children: ReactNode;
  to?: LinkProps["to"];
  hoverClassName?: string;
}

export function UserProfileLink({
  username,
  children,
  to,
  hoverClassName,
  ...props
}: UserProfileLinkProps) {
  const normalizedUsername = username?.trim().replace(/^@/, "") || "";
  const href =
    to ||
    (normalizedUsername
      ? `/users/${encodeURIComponent(normalizedUsername)}`
      : "/people");
  const link = (
    <Link to={href} {...props}>
      {children}
    </Link>
  );

  if (!normalizedUsername) return link;

  return (
    <ProfileHoverCard username={normalizedUsername} className={hoverClassName}>
      {link}
    </ProfileHoverCard>
  );
}
