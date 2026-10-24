import { Bot } from "@crate/ui/icons";
import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import { useActionLLMStatus } from "@/hooks/use-llm";

/** The artist workflow supplies model availability; the shared action owns its presentation. */
export function ArtistBioResearchAction({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  const model = useActionLLMStatus("artists.bio.research");
  if (!model?.available) return null;
  return (
    <ActionButton
      label="Research with AI"
      tooltip="Research biography with AI"
      disabled={disabled}
      onClick={onClick}
    >
      <Bot data-admin-ux="artist-research-bio" aria-hidden="true" />
    </ActionButton>
  );
}
