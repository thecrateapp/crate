import { Checkbox } from "@crate/ui/primitives/Checkbox";
import { FormField } from "@crate/ui/primitives/FormField";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { Button } from "@crate/ui/shadcn/button";
import { toasterConfig } from "@crate/ui/lib/toaster-config";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { installFocusRingMotion } from "@crate/ui/lib/focus-ring-motion";
import { Toaster } from "sonner";
import { useEffect, useState, useSyncExternalStore } from "react";
import { MemoryRouter } from "react-router";
import {
  AuthContext,
  type AuthContextValue,
} from "../../../app/ui/src/contexts/AuthContext";
import { I18nReview } from "../../../app/ui/src/pages/I18nReview";
import { Settings } from "../../../app/ui/src/pages/Settings";
import {
  installCatalogSample,
  setSample as setTranslationSample,
  setWorkspace,
  setFailure,
  complete as completeTranslationAction,
  snapshot as translationsSnapshot,
  subscribe as subscribeTranslations,
  type Sample as TranslationSample,
} from "../../design-system-preview/admin-translations-fixtures";
import {
  installSettingsFetchSample,
  setSettingsSample,
  settingsSampleSnapshot,
  subscribeSettingsSample,
} from "../../design-system-preview/admin-settings-fixtures";

type ReviewPage = "settings" | "translations";
type SettingsSample = "ready" | "loading" | "error";

const authValue: AuthContextValue = {
  user: {
    id: 9001,
    email: "reviewer@example.test",
    name: "Review account",
    role: "owner",
    roles: ["owner"],
  },
  actualUser: null,
  loading: false,
  logout: () => {},
  isAdmin: true,
  canAccessAdmin: true,
  hasCapability: () => true,
  hasAnyCapability: () => true,
  refetch: () => {},
  rolePresets: [],
  previewRole: null,
  setPreviewRole: () => {},
  clearRolePreview: () => {},
};

export function AdminSettingsTranslationsReview({
  initialPage = "settings",
}: {
  initialPage?: ReviewPage;
}) {
  const [page, setPage] = useState<ReviewPage>(initialPage);
  const settingsState = useSyncExternalStore(
    subscribeSettingsSample,
    settingsSampleSnapshot,
  );
  const translationState = useSyncExternalStore(
    subscribeTranslations,
    translationsSnapshot,
  );

  useEffect(() => {
    applyCrateIdentity();
    const disposeMotion = installFocusRingMotion();
    const disposeCatalog = installCatalogSample();
    const disposeSettingsFetch = installSettingsFetchSample();
    setSettingsSample("ready");
    setTranslationSample("ready");
    return () => {
      disposeSettingsFetch();
      disposeCatalog();
      disposeMotion();
    };
  }, []);

  return (
    <AuthContext.Provider value={authValue}>
      <MemoryRouter
        key={page}
        initialEntries={page === "settings" ? ["/?section=general"] : ["/"]}
      >
        <main className="grid min-w-0 content-start gap-6 p-4 sm:p-6">
          <header
            data-admin-review-controls="settings-translations"
            className="grid min-w-0 gap-4 border-b border-border-quiet pb-5"
          >
            <p className="m-0 max-w-4xl text-sm text-text-muted">
              Settings and Translations real pages · datos ficticios en memoria.
              Las acciones quedan dentro de esta muestra y no cambian la
              configuración ni los paquetes reales.
            </p>
            <div className="grid min-w-0 gap-4 lg:grid-cols-2">
              <FormField
                kind="group"
                label="Página de revisión"
                className="min-w-0"
              >
                <SegmentedControl
                  as="radio"
                  label="Página de revisión"
                  className="min-w-0"
                  value={page}
                  onValueChange={(value) => setPage(value as ReviewPage)}
                  items={[
                    { value: "settings", label: "Settings" },
                    { value: "translations", label: "Translations" },
                  ]}
                />
              </FormField>
              {page === "settings" ? (
                <FormField
                  kind="group"
                  label="Estado de Settings"
                  className="min-w-0"
                >
                  <SegmentedControl
                    as="radio"
                    label="Estado de Settings"
                    className="min-w-0"
                    value={settingsState.sample}
                    onValueChange={(value) =>
                      setSettingsSample(value as SettingsSample)
                    }
                    items={[
                      { value: "ready", label: "Datos" },
                      { value: "loading", label: "Carga" },
                      { value: "error", label: "Error" },
                    ]}
                  />
                </FormField>
              ) : (
                <FormField
                  kind="group"
                  label="Estado de Translations"
                  className="min-w-0"
                >
                  <SegmentedControl
                    as="radio"
                    label="Estado de Translations"
                    className="min-w-0"
                    value={translationState.sample}
                    onValueChange={(value) =>
                      setTranslationSample(value as TranslationSample)
                    }
                    items={[
                      {
                        value: "ready",
                        label: "Datos",
                        disabled: !!translationState.pending,
                      },
                      {
                        value: "loading",
                        label: "Carga",
                        disabled: !!translationState.pending,
                      },
                      {
                        value: "empty",
                        label: "Vacío",
                        disabled: !!translationState.pending,
                      },
                      {
                        value: "no-ai",
                        label: "Sin IA",
                        disabled: !!translationState.pending,
                      },
                    ]}
                  />
                </FormField>
              )}
            </div>
            {page === "translations" ? (
              <div className="flex flex-wrap items-center gap-4">
                <Button
                  className="min-h-11"
                  variant="outline"
                  onClick={completeTranslationAction}
                  disabled={!translationState.pending}
                >
                  Completar acción de muestra
                </Button>
                <FormField
                  layout="inline"
                  label="Catálogo JSON de muestra disponible"
                >
                  <Checkbox
                    checked={translationState.workspace}
                    disabled={!!translationState.pending}
                    onCheckedChange={(checked) =>
                      setWorkspace(checked === true)
                    }
                  />
                </FormField>
                <FormField layout="inline" label="Fallar la siguiente acción">
                  <Checkbox
                    checked={translationState.failNext}
                    disabled={!!translationState.pending}
                    onCheckedChange={(checked) => setFailure(checked === true)}
                  />
                </FormField>
              </div>
            ) : null}
            <MonoLabel as="span" role="status" className="break-all">
              {page === "settings"
                ? settingsState.action
                : translationState.action}
            </MonoLabel>
          </header>
          <section
            key={page}
            aria-label={`Página real de ${page === "settings" ? "Settings" : "Translations"}`}
            className="min-w-0"
          >
            {page === "settings" ? <Settings /> : <I18nReview />}
          </section>
          <Toaster {...toasterConfig} />
        </main>
      </MemoryRouter>
    </AuthContext.Provider>
  );
}
