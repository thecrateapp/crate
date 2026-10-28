import type { FormEvent } from "react";
import { PageHeader } from "@crate/ui/domain/navigation/PageHeader";
import { FormField } from "@crate/ui/primitives/FormField";
import { SearchInput } from "@crate/ui/primitives/SearchInput";
import { Button } from "@crate/ui/shadcn/button";

export function SearchFormView({
  value,
  onChange,
  onSearch,
  title,
  prompt,
  placeholder,
  clearLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  onSearch: (value: string) => void;
  title: string;
  prompt: string;
  placeholder: string;
  clearLabel: string;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (value.trim()) onSearch(value.trim());
  }
  return (
    <div className="grid gap-6">
      <PageHeader size="md" title={title} subtitle={prompt} />
      <form
        className="flex max-w-2xl flex-wrap items-end gap-3"
        onSubmit={submit}
      >
        <FormField kind="group" label={title} className="min-w-0 flex-1">
          {(group) => (
            <div {...group} role="group">
              <SearchInput
                value={value}
                onValueChange={onChange}
                label={placeholder}
                placeholder={placeholder}
                clearLabel={clearLabel}
              />
            </div>
          )}
        </FormField>
        <Button type="submit" disabled={!value.trim()}>
          {title}
        </Button>
      </form>
    </div>
  );
}
