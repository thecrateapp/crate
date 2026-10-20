import { useTranslation } from "react-i18next";
import { CRATE_ICON_SIZE, Plus, Server, Trash2 } from "@crate/ui/icons";
import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import { StatusDot } from "@crate/ui/primitives/StatusDot";
import { EntityRow } from "@crate/ui/domain/entity/EntityRow";
import { Button } from "@crate/ui/shadcn/button";
import { Section } from "./SettingsPrimitives";
export interface SettingsServerItem {
  id: string;
  label: string;
  url: string;
}
export function ServersSettingsView({
  servers,
  currentId,
  onSwitch,
  onRemove,
  onAdd,
}: {
  servers: SettingsServerItem[];
  currentId: string | null;
  onSwitch: (id: string) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Section
      title={t("settings.servers.title")}
      description={t("settings.servers.description")}
    >
      <div className="grid min-w-0 gap-2">
        {servers.map((server) => (
          <EntityRow
            key={server.id}
            title={server.label}
            openLabel={server.label}
            truncate={false}
            density="compact"
            disabled={server.id === currentId}
            active={server.id === currentId}
            leading={<Server size={CRATE_ICON_SIZE.md} aria-hidden="true" />}
            subtitle={
              <span className="grid min-w-0 gap-1">
                <span className="wrap-anywhere">{server.url}</span>
                {server.id === currentId ? (
                  <StatusDot label={t("settings.servers.current")} />
                ) : null}
              </span>
            }
            onOpen={() => onSwitch(server.id)}
            trailing={
              <ActionButton
                tooltip={t("common.remove")}
                label={t("settings.servers.remove", { name: server.label })}
                onClick={() => onRemove(server.id)}
              >
                <Trash2 aria-hidden="true" />
              </ActionButton>
            }
          />
        ))}
      </div>
      <Button variant="outline" onClick={onAdd}>
        <Plus size={CRATE_ICON_SIZE.sm} aria-hidden="true" />
        {t("settings.servers.add")}
      </Button>
    </Section>
  );
}
