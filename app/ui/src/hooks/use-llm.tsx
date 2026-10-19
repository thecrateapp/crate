import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useApi } from "@/hooks/use-api";
import { AuthContext, useAuth } from "@/contexts/AuthContext";
export interface ActionLLMStatus {
  action_id: string;
  available: boolean;
  status: "legacy" | "configured" | "unavailable";
  provider: string | null;
  model_id: string | null;
  fingerprint: string | null;
  error_code: string | null;
}
// Domain permissions mirror the registered operations, not provider capabilities.
const permissions: Record<string, string> = {
  "shows.extract.vision": "curation.shows.write",
  "shows.extract.text": "curation.shows.write",
  "shows.extract.ocr_text": "curation.shows.write",
  "artwork.hero.analyze": "library.metadata.write",
  "artists.bio.research": "library.metadata.write",
  "genres.description.generate": "curation.genres.write",
  "genres.taxonomy.propose": "curation.genres.write",
  "genres.eq.propose": "curation.genres.write",
  "playlists.description.generate": "curation.playlists.write",
  "music_paths.refine": "library.view",
  "i18n.listen.draft": "settings.manage",
};
interface StatusContext {
  statuses: Record<string, ActionLLMStatus | null>;
  subscribe: (id: string) => () => void;
  publish: (id: string, status: ActionLLMStatus | null) => void;
}
const LLMStatusContext = createContext<StatusContext | null>(null);
function StatusReader({
  id,
  publish,
}: {
  id: string;
  publish: StatusContext["publish"];
}) {
  const { data } = useApi<ActionLLMStatus>(
    `/api/admin/ai/actions/${encodeURIComponent(id)}/availability`,
  );
  useEffect(() => publish(id, data), [id, data, publish]);
  useEffect(() => () => publish(id, null), [id, publish]);
  return null;
}
export function LLMStatusProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  // Remount the subscription cache when the authenticated identity changes.
  return (
    <ActionStatuses key={user?.id ?? "anonymous"}>{children}</ActionStatuses>
  );
}
function ActionStatuses({ children }: { children: ReactNode }) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [statuses, setStatuses] = useState<
    Record<string, ActionLLMStatus | null>
  >({});
  const subscribe = useCallback((id: string) => {
    setCounts((x) => ({ ...x, [id]: (x[id] ?? 0) + 1 }));
    return () =>
      setCounts((x) => ({ ...x, [id]: Math.max(0, (x[id] ?? 0) - 1) }));
  }, []);
  const publish = useCallback(
    (id: string, status: ActionLLMStatus | null) =>
      setStatuses((x) => ({ ...x, [id]: status })),
    [],
  );
  const value = useMemo(
    () => ({ statuses, subscribe, publish }),
    [statuses, subscribe, publish],
  );
  return (
    <LLMStatusContext.Provider value={value}>
      {Object.entries(counts)
        .filter(([, count]) => count > 0)
        .map(([id]) => (
          <StatusReader key={id} id={id} publish={publish} />
        ))}
      {children}
    </LLMStatusContext.Provider>
  );
}
export function useActionLLMStatus(actionId: string): ActionLLMStatus | null {
  const auth = useContext(AuthContext);
  const allowed =
    !!permissions[actionId] && !!auth?.hasCapability(permissions[actionId]);
  const context = useContext(LLMStatusContext);
  const subscribe = context?.subscribe;
  useEffect(() => {
    if (allowed && subscribe) return subscribe(actionId);
  }, [allowed, actionId, subscribe]);
  return allowed ? (context?.statuses[actionId] ?? null) : null;
}
