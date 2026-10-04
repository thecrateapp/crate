import { CRATE_ICON_SIZE, Users } from "@crate/ui/icons";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { notify } from "@crate/ui/lib/notify";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";

import { extractInviteToken } from "@/pages/jam-session-utils";

export function JamInvitePanel({
  inviteInput,
  setInviteInput,
}: {
  inviteInput: string;
  setInviteInput: (value: string) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <section className="jam-panel rounded-panel p-5 sm:p-6">
      <h2 className="text-lg font-semibold text-text-primary">
        {t("jam.lobby.joinInviteTitle")}
      </h2>
      <p className="mt-1 text-sm text-text-muted">
        {t("jam.lobby.joinInviteSubtitle")}
      </p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <Input
          value={inviteInput}
          onChange={(event) => setInviteInput(event.target.value)}
          placeholder={t("jam.lobby.invitePlaceholder")}
          aria-label={t("jam.lobby.invitePlaceholder")}
          className="jam-input flex-1 rounded-lg px-4 shadow-none backdrop-blur-none placeholder:text-text-primary/40 md:text-base"
        />
        <Button
          variant="ghost"
          onClick={() => {
            const token = extractInviteToken(inviteInput);
            if (!token) {
              notify.error(t("jam.toasts.invalidInvite"));
              return;
            }
            navigate(`/jam/invite/${token}`);
          }}
          className="jam-secondary-action h-auto rounded-lg px-4 py-2.5 text-text-primary hover:text-text-primary [&_svg:not([class*='size-'])]:size-4 has-[>svg]:px-4"
        >
          <Users size={CRATE_ICON_SIZE.sm} />
          {t("jam.lobby.joinRoom")}
        </Button>
      </div>
    </section>
  );
}
