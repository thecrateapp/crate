import type { FormEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FormField } from "@crate/ui/primitives/FormField";
import { Input } from "@crate/ui/shadcn/input";
import { Button } from "@crate/ui/shadcn/button";
import { AuthFrame } from "./AuthFrame";
export function ServerSetupView({
  url,
  onUrlChange,
  busy,
  onSubmit,
  status,
  embedded,
}: {
  url: string;
  onUrlChange: (value: string) => void;
  busy: boolean;
  onSubmit: (event: FormEvent) => void;
  status: ReactNode;
  embedded?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <AuthFrame
      title={t("serverSetup.title")}
      subtitle={t("serverSetup.description")}
      embedded={embedded}
    >
      <form onSubmit={onSubmit} className="grid gap-5">
        <FormField label={t("serverSetup.urlLabel")}>
          <Input
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            placeholder="https://api.your-crate.com"
            required
          />
        </FormField>
        <div role="status" className="min-h-5 text-sm">
          {status}
        </div>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" loading={busy} disabled={busy}>
            {busy ? t("serverSetup.checking") : t("serverSetup.continue")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => onUrlChange("http://localhost:8585")}
          >
            {t("serverSetup.localDev")}
          </Button>
        </div>
        <p className="text-sm text-text-muted">
          {t("serverSetup.docsPrefix")}{" "}
          <a
            href="https://docs.cratemusic.app/technical/development-deployment-and-operations"
            className="link-accent"
            target="_blank"
            rel="noreferrer"
          >
            {t("serverSetup.docsLink")}
          </a>
          {t("serverSetup.docsSuffix")}
        </p>
      </form>
    </AuthFrame>
  );
}
