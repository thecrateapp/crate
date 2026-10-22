import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { MemoryRouter } from "react-router";
import { Toaster } from "sonner";

import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { installFocusRingMotion } from "@crate/ui/lib/focus-ring-motion";
import { toasterConfig } from "@crate/ui/lib/toaster-config";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { FormField } from "@crate/ui/primitives/FormField";
import {
  AuthContext,
  type AuthContextValue,
} from "../../../app/ui/src/contexts/AuthContext";
import { Federation } from "../../../app/ui/src/pages/Federation";
import {
  installFederationFetchSample,
  setSample,
  snapshot,
  subscribe,
  type FederationSample,
} from "../../design-system-preview/admin-federation-fixtures";

type Access = "owner" | "viewer";

export function AdminFederationReview() {
  const [fixtureReady, setFixtureReady] = useState(false);
  const [access, setAccess] = useState<Access>("owner");
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  const auth = useMemo<AuthContextValue>(() => {
    const hasCapability = (capability: string) =>
      capability === "federation.nodes.view" ||
      (access === "owner" &&
        ["federation.nodes.manage", "federation.import.manage"].includes(
          capability,
        ));
    return {
      user: {
        id: 9301,
        email: "reviewer@example.test",
        name: access === "owner" ? "Federation Owner" : "Federation Viewer",
        role: access,
        roles: [access],
      },
      actualUser: null,
      loading: false,
      logout: () => {},
      isAdmin: access === "owner",
      canAccessAdmin: true,
      hasCapability,
      hasAnyCapability: (capabilities) => capabilities.some(hasCapability),
      refetch: () => {},
      rolePresets: [],
      previewRole: null,
      setPreviewRole: () => {},
      clearRolePreview: () => {},
    };
  }, [access]);

  useLayoutEffect(() => {
    applyCrateIdentity();
    const restoreFetch = installFederationFetchSample();
    const disposeMotion = installFocusRingMotion();
    setSample("ready");
    setFixtureReady(true);
    return () => {
      restoreFetch();
      disposeMotion();
    };
  }, []);

  return (
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={["/federation"]}>
        <main className="grid min-w-0 content-start gap-6 p-4 sm:p-6">
          <header
            data-admin-review-controls="federation"
            className="grid min-w-0 gap-4 border-b border-border-quiet pb-5"
          >
            <div className="max-w-4xl space-y-2">
              <h2 className="m-0 font-display text-xl font-semibold text-text-primary">
                Federation review
              </h2>
              <p className="m-0 text-sm text-text-muted">
                The real Admin page with local sample data. No peer, policy, or
                library changes leave this preview.
              </p>
            </div>
            <div className="grid min-w-0 gap-4 lg:grid-cols-2">
              <FormField kind="group" label="Sample state" className="min-w-0">
                <SegmentedControl
                  as="radio"
                  label="Sample state"
                  className="min-w-0"
                  value={state.sample}
                  onValueChange={(value) =>
                    setSample(value as FederationSample)
                  }
                  items={[
                    { value: "ready", label: "Data" },
                    { value: "loading", label: "Loading" },
                    { value: "empty", label: "Empty" },
                    { value: "error", label: "Error" },
                  ]}
                />
              </FormField>
              <FormField kind="group" label="Access" className="min-w-0">
                <SegmentedControl
                  as="radio"
                  label="Access"
                  className="min-w-0"
                  value={access}
                  onValueChange={(value) => setAccess(value as Access)}
                  items={[
                    { value: "owner", label: "Owner" },
                    { value: "viewer", label: "Read only" },
                  ]}
                />
              </FormField>
            </div>
            <MonoLabel as="span" role="status" className="break-all">
              {state.action}
            </MonoLabel>
          </header>
          {fixtureReady ? (
            <section aria-label="Federation page" className="min-w-0">
              <Federation key={state.sample} />
            </section>
          ) : null}
          <Toaster {...toasterConfig} />
        </main>
      </MemoryRouter>
    </AuthContext.Provider>
  );
}
