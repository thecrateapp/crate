import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import ca from "@/i18n/catalogs/ca.json";
import de from "@/i18n/catalogs/de.json";
import en from "@/i18n/catalogs/en.json";
import es from "@/i18n/catalogs/es.json";
import eu from "@/i18n/catalogs/eu.json";
import fr from "@/i18n/catalogs/fr.json";
import itCatalog from "@/i18n/catalogs/it.json";

import { ConnectedAccounts, PasswordChangeForm } from "./AccountSectionForms";

const catalogs: Record<string, Record<string, unknown>> = {
  ca,
  de,
  en,
  es,
  eu,
  fr,
  it: itCatalog,
};

describe("PasswordChangeForm", () => {
  it("submits the visible password form and clears it on cancel", () => {
    const onChangePassword = vi.fn();
    const setShowPassword = vi.fn();
    const setCurrentPassword = vi.fn();
    const setNewPassword = vi.fn();
    const setConfirmPassword = vi.fn();

    render(
      <PasswordChangeForm
        showPassword
        setShowPassword={setShowPassword}
        currentPassword="current"
        newPassword="new-password"
        confirmPassword="new-password"
        setCurrentPassword={setCurrentPassword}
        setNewPassword={setNewPassword}
        setConfirmPassword={setConfirmPassword}
        saving={false}
        onChangePassword={onChangePassword}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.account.changePasswordAction",
      }),
    );
    expect(onChangePassword).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
    expect(setShowPassword).toHaveBeenCalledWith(false);
    expect(setCurrentPassword).toHaveBeenCalledWith("");
    expect(setNewPassword).toHaveBeenCalledWith("");
    expect(setConfirmPassword).toHaveBeenCalledWith("");
  });
});

describe("ConnectedAccounts", () => {
  it("lists only configured providers with provider-neutral copy", () => {
    render(
      <ConnectedAccounts
        providers={[
          [
            "google",
            { enabled: true, configured: true, login_url: "/auth/google" },
          ],
        ]}
        linkedProviders={new Set()}
        linkingProvider={null}
        unlinkingProvider={null}
        onLink={vi.fn(async () => {})}
        onUnlink={vi.fn(async () => {})}
      />,
    );

    expect(screen.getByText("google")).toBeInTheDocument();
    expect(screen.queryByText("apple")).not.toBeInTheDocument();
    expect(
      screen.getByText("settings.account.connectedAccountsDescription"),
    ).toBeInTheDocument();
    for (const catalog of Object.values(catalogs)) {
      const description = catalog[
        "settings.account.connectedAccountsDescription"
      ] as string;
      expect(description).not.toMatch(/google|apple/i);
    }
  });
});
