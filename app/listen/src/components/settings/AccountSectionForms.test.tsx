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

import {
  AccountProfileForm,
  ConnectedAccounts,
  PasswordChangeForm,
} from "./AccountSectionForms";

const catalogs: Record<string, Record<string, unknown>> = {
  ca,
  de,
  en,
  es,
  eu,
  fr,
  it: itCatalog,
};

describe("canonical account forms", () => {
  it("keeps value case, normalization and canonical input styling", () => {
    const setUsername = vi.fn();
    render(
      <AccountProfileForm
        name="Diego"
        username="crate-user"
        bio="Music biography"
        instagram="crate"
        email="diego@example.test"
        saving={false}
        profileUnchanged={false}
        setName={vi.fn()}
        setUsername={setUsername}
        setBio={vi.fn()}
        setInstagram={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    const name = screen.getByRole("textbox", {
      name: "settings.account.displayName",
    });
    expect(name).toHaveValue("Diego");
    expect(name).not.toHaveClass("border-transparent");
    expect(
      name
        .closest('[data-slot="form-field"]')
        ?.querySelector('[data-slot="form-field-label"]'),
    ).not.toHaveClass("text-xs");
    fireEvent.change(
      screen.getByRole("textbox", { name: "settings.account.username" }),
      { target: { value: "crate user" } },
    );
    expect(setUsername).toHaveBeenCalledWith("crate-user");
    const email = screen.getByRole("textbox", { name: "common.email" });
    expect(email).toHaveValue("diego@example.test");
    expect(email).toHaveAttribute("readonly");
    expect(email).not.toBeDisabled();
    expect(screen.getAllByRole("textbox")[0]).toBe(email);
    expect(
      email.closest('[data-slot="form-field"]')?.querySelector("label"),
    ).toHaveTextContent("common.email");
  });
  it("gives each password an actual visible canonical caption", () => {
    render(
      <PasswordChangeForm
        showPassword
        setShowPassword={vi.fn()}
        currentPassword=""
        newPassword=""
        confirmPassword=""
        setCurrentPassword={vi.fn()}
        setNewPassword={vi.fn()}
        setConfirmPassword={vi.fn()}
        saving
        onChangePassword={vi.fn()}
      />,
    );
    for (const key of ["currentPassword", "newPassword", "confirmPassword"]) {
      const field = screen.getByLabelText(`settings.account.${key}`);
      expect(
        field
          .closest('[data-slot="form-field"]')
          ?.querySelector("label .uppercase"),
      ).toHaveTextContent(`settings.account.${key}`);
    }
    expect(
      screen.getByRole("button", {
        name: "settings.account.changePasswordAction",
      }),
    ).toBeDisabled();
  });
});

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
  it("keeps provider IDs and busy actions intact when presenting brand names", () => {
    const onLink = vi.fn(async () => {}),
      onUnlink = vi.fn(async () => {});
    render(
      <ConnectedAccounts
        providers={[
          [
            "google",
            { enabled: true, configured: true, login_url: "/auth/google" },
          ],
          [
            "apple",
            { enabled: true, configured: true, login_url: "/auth/apple" },
          ],
        ]}
        linkedProviders={new Set(["google"])}
        linkingProvider="apple"
        unlinkingProvider={null}
        onLink={onLink}
        onUnlink={onUnlink}
      />,
    );
    expect(screen.getByText("Google")).toBeInTheDocument();
    expect(screen.getByText("Apple")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "settings.account.unlink" }),
    );
    expect(onUnlink).toHaveBeenCalledWith("google");
    const busy = screen.getByRole("button", { name: "common.working" });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    expect(onLink).not.toHaveBeenCalled();
  });

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

    expect(screen.getByText("Google")).toBeInTheDocument();
    expect(screen.queryByText("Apple")).not.toBeInTheDocument();
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
