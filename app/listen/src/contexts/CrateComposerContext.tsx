import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router";

import {
  CrateCreateModal,
  type CrateComposerAlbum,
  type CreatedCrate,
} from "@/components/CrateCreateModal";
import { cratePagePath } from "@/components/crates/crate-model";

interface OpenCrateComposerOptions {
  album?: CrateComposerAlbum;
}

interface CrateComposerContextValue {
  openCreateCrate: (options?: OpenCrateComposerOptions) => void;
}

export interface CrateComposerAlbumInput {
  globalAlbumUid?: string | null;
  name: string;
  artistName: string;
}

const CrateComposerContext = createContext<
  CrateComposerContextValue | undefined
>(undefined);

export function openCrateComposerForAlbum(
  composer:
    | Pick<CrateComposerContextValue, "openCreateCrate">
    | null
    | undefined,
  album: CrateComposerAlbumInput,
): boolean {
  if (!composer || !album.globalAlbumUid) return false;

  composer.openCreateCrate({
    album: {
      globalAlbumUid: album.globalAlbumUid,
      name: album.name,
      artistName: album.artistName,
    },
  });
  return true;
}

export function CrateComposerProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [initialAlbum, setInitialAlbum] = useState<
    CrateComposerAlbum | undefined
  >();

  const openCreateCrate = useCallback((options?: OpenCrateComposerOptions) => {
    setInitialAlbum(options?.album);
    setOpen(true);
  }, []);

  const handleCreated = useCallback(
    (created: CreatedCrate) => {
      setOpen(false);
      navigate(cratePagePath(created));
    },
    [navigate],
  );

  const contextValue = useMemo(() => ({ openCreateCrate }), [openCreateCrate]);

  return (
    <CrateComposerContext.Provider value={contextValue}>
      {children}
      <CrateCreateModal
        key={`${open ? "open" : "closed"}-${
          initialAlbum?.globalAlbumUid ?? "new"
        }`}
        open={open}
        initialAlbum={initialAlbum}
        onClose={() => setOpen(false)}
        onCreated={handleCreated}
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
