import { useState } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import {
  AuthContext,
  type AuthContextValue,
  type AuthUser,
} from "../../../app/ui/src/contexts/AuthContext";
import { Shell } from "../../../app/ui/src/components/layout/Shell";
import { Button } from "@crate/ui/shadcn/button";
import { Toaster } from "sonner";
import { toasterConfig } from "@crate/ui/lib/toaster-config";

const actual: AuthUser = {
  id: 1,
  name: "Diego",
  email: "sample@example.test",
  role: "admin",
  roles: ["admin"],
};

function Page({ message }: { message: string }) {
  const route = useLocation();
  return (
    <div className="grid gap-6 py-6">
      <h1 className="font-display text-3xl">Navegación de Admin</h1>
      <p className="text-sm text-text-muted">
        Shell, Sidebar y CommandPalette reales. Cabeceras fijas sobre la
        superficie sólida de Admin.
      </p>
      <output
        aria-label="Ruta de muestra"
        className="break-all font-mono text-xs"
      >
        {route.pathname}
        {route.search}
        {route.hash}
      </output>
      <p role="status" aria-label="Sesión de muestra">
        {message}
      </p>
      <Button
        className="min-h-11 justify-self-start"
        variant="outline"
        onClick={() =>
          document.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "k",
              ctrlKey: true,
              bubbles: true,
            }),
          )
        }
      >
        Abrir paleta de muestra
      </Button>
      <p className="text-sm text-text-muted">
        Usa Ctrl/⌘ K para la paleta, / para buscar y ? para la ayuda. Las
        acciones son ficticias. El avatar junto a la búsqueda abre el perfil, el
        cierre de sesión y la vista previa de permisos; los glifos funcionales
        de UX se conservan.
      </p>
    </div>
  );
}

export function AdminNavigationReview() {
  const [role, setRole] = useState<string | null>(null);
  const [message, setMessage] = useState("Sesión ficticia activa.");
  const capabilities = role
    ? ["library.view", "curation.playlists.write"]
    : null;
  const auth: AuthContextValue = {
    user: role
      ? {
          ...actual,
          role: "curator",
          roles: ["curator"],
          capabilities: capabilities!,
        }
      : actual,
    actualUser: actual,
    loading: false,
    isAdmin: !role,
    canAccessAdmin: true,
    hasCapability: (capability) =>
      !capabilities || capabilities.includes(capability),
    hasAnyCapability: (required) =>
      !capabilities ||
      required.some((capability) => capabilities.includes(capability)),
    rolePresets: [
      {
        slug: "curator",
        name: "Curator",
        capabilities: ["library.view", "curation.playlists.write"],
      },
    ],
    previewRole: role,
    setPreviewRole: setRole,
    clearRolePreview: () => setRole(null),
    logout: () =>
      setMessage("Salida de muestra solicitada; no hay una sesión real."),
    refetch: () => {},
  };
  return (
    <MemoryRouter
      initialEntries={[
        "/browse?tab=albums#sample",
        "/tasks?tab=running#sample",
      ]}
      initialIndex={1}
    >
      <AuthContext.Provider value={auth}>
        <Routes>
          <Route element={<Shell />}>
            <Route path="*" element={<Page message={message} />} />
          </Route>
        </Routes>
        <Toaster {...toasterConfig} />
      </AuthContext.Provider>
    </MemoryRouter>
  );
}
