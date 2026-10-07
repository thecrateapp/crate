import { createContext } from "react";
import type { LocalOfflineIdentity } from "@/lib/offline-identity";

export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
  role: string;
  roles?: string[];
  capabilities?: string[];
  avatar?: string | null;
  username?: string | null;
  bio?: string | null;
  instagram_handle?: string | null;
  timezone?: string | null;
  session_id?: string | null;
  connected_accounts?: Array<{ provider: string; status: string }>;
}

export interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  sessionUnavailable?: boolean;
  accessMode: "loading" | "authenticated" | "offline" | "unauthenticated";
  offlineIdentity: LocalOfflineIdentity | null;
  refetch: () => Promise<AuthUser | null>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
