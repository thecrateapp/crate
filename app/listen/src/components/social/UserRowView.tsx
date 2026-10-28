import { EntityRow, type EntityRowProps } from "@crate/ui/domain/entity";

/** Shared person-row presentation; the Listen adapter supplies managed avatars and menus. */
export function UserRowView(props: EntityRowProps) {
  return <EntityRow {...props} />;
}

export interface UserRowUser {
  id: number;
  username: string | null;
  display_name: string | null;
  avatar: string | null;
  bio?: string | null;
}
