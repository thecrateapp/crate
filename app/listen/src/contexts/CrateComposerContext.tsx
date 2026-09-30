import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  CrateCreateModal,
  type CrateComposerAlbum,
} from "@/components/CrateCreateModal";
import { api } from "@/lib/api";

interface OpenCrateComposerOptions {
  album?: CrateComposerAlbum;
}

interface CrateComposerContextValue {
  openCreateCrate: (options?: OpenCrateComposerOptions) => void;
}

const CrateComposerContext = createContext<
  CrateComposerContextValue | undefined
>(undefined);

interface CreateCrateResponse {
  id: string;
}

export function CrateComposerProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [initialAlbum, setInitialAlbum] = useState<
    CrateComposerAlbum | undefined
  >();

  const openCreateCrate = useCallback((options?: OpenCrateComposerOptions) => {
    setInitialAlbum(options?.album);
    setOpen(true);
  }, []);

  const handleSubmit = useCallback(
    async (payload: { name: string; description: string }) => {
      setSubmitting(true);
      try {
        const created = await api<CreateCrateResponse>("/api/crates", "POST", {
          name: payload.name,
          description: payload.description,
          is_collaborative: false,
        });
        if (initialAlbum) {
          await api(`/api/crates/${created.id}/albums`, "POST", {
            global_album_uid: initialAlbum.globalAlbumUid,
          });
        }
        setOpen(false);
        toast.success(t("library.crates.created"));
        navigate(`/crate/${created.id}`);
      } catch {
        toast.error(t("library.crates.createFailed"));
      } finally {
        setSubmitting(false);
      }
    },
    [initialAlbum, navigate, t],
  );

  const contextValue = useMemo(() => ({ openCreateCrate }), [openCreateCrate]);

  return (
    <CrateComposerContext.Provider value={contextValue}>
      {children}
      <CrateCreateModal
        open={open}
        initialAlbum={initialAlbum}
        submitting={submitting}
        onClose={() => setOpen(false)}
        onSubmit={handleSubmit}
      />
    </CrateComposerContext.Provider>
  );
}

export function useCrateComposer() {
  const value = useOptionalCrateComposer();
  if (!value) {
    throw new Error(
      "useCrateComposer must be used within CrateComposerProvider",
    );
  }
  return value;
}

export function useOptionalCrateComposer() {
  return useContext(CrateComposerContext);
}
