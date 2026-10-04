import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { CRATE_ICON_SIZE, Search } from "@crate/ui/icons";
import { SearchInput } from "@crate/ui/primitives/SearchInput";
import { Button } from "@crate/ui/shadcn/button";

export function SearchEmptyState({
  value,
  onChange,
  onSearch,
}: {
  value: string;
  onChange: (value: string) => void;
  onSearch: (query: string) => void;
}) {
  const { t } = useTranslation();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = value.trim();
    if (query) onSearch(query);
  }

  return (
    <div className="mx-auto max-w-2xl rounded-panel border border-border-quiet bg-text-primary/[0.035] p-6 shadow-card sm:p-8">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full border border-accent-action/15 bg-accent-action/8 text-text-accent">
          <Search size={CRATE_ICON_SIZE.md} />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-text-primary">
            {t("search.label")}
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            {t("search.emptyPrompt")}
          </p>
        </div>
      </div>
      <form
        className="mt-5 flex flex-col gap-2 sm:flex-row"
        onSubmit={handleSubmit}
      >
        <SearchInput
          value={value}
          onValueChange={onChange}
          placeholder={t("search.placeholder")}
          label={t("search.placeholder")}
          clearLabel={t("search.clear")}
          containerClassName="min-w-0 flex-1"
        />
        <Button
          type="submit"
          size="lg"
          disabled={!value.trim()}
          className="px-4 has-[>svg]:px-4"
        >
          <Search size={CRATE_ICON_SIZE.md} />
          {t("search.label")}
        </Button>
      </form>
    </div>
  );
}
