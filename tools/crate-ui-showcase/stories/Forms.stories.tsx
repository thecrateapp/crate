import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { FormField } from "@crate/ui/primitives/FormField";
import { Input } from "@crate/ui/shadcn/input";
import { Textarea } from "@crate/ui/shadcn/textarea";
import { SearchInput } from "@crate/ui/primitives/SearchInput";
import { AdminSelect } from "@crate/ui/composites/AdminSelect";
import { Checkbox } from "@crate/ui/primitives/Checkbox";
import { Switch } from "@crate/ui/primitives/Switch";
import { RadioGroup, RadioGroupItem } from "@crate/ui/primitives/RadioGroup";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { FilterChip } from "@crate/ui/primitives/FilterChip";
import { Readout } from "@crate/ui/primitives/Readout";
import { StatNumber } from "@crate/ui/primitives/StatNumber";
import { Slider } from "@crate/ui/primitives/Slider";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@crate/ui/shadcn/select";
import { Button } from "@crate/ui/shadcn/button";
function CompleteForm() {
  const [mode, setMode] = useState("all"),
    [genre, setGenre] = useState("ambient"),
    [error, setError] = useState<string>(),
    [query, setQuery] = useState(""),
    [active, setActive] = useState(false);
  return (
    <form
      aria-label="Form family"
      className="showcase-stack"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setError(
          String(new FormData(e.currentTarget).get("name") ?? "").trim()
            ? undefined
            : "A playlist name is required.",
        );
      }}
    >
      <div className="showcase-form-grid">
        <FormField
          label="Playlist name"
          error={error}
          hint="Between 2 and 40 characters."
          required
        >
          <Input name="name" placeholder="Playlist name" />
        </FormField>
        <FormField label="Source">
          {(control) => (
            <Select defaultValue="library">
              <SelectTrigger {...control}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="library">Library</SelectItem>
                <SelectItem value="archive">Archive</SelectItem>
                <SelectItem value="blocked" disabled>
                  Unavailable
                </SelectItem>
              </SelectContent>
            </Select>
          )}
        </FormField>
        <FormField label="Genre" hint="Search by name or alias.">
          {(control) => (
            <AdminSelect
              {...control}
              placeholder="Choose a genre"
              value={genre}
              onChange={setGenre}
              searchable
              searchPlaceholder="Search genres"
              noMatchesLabel="No matching genres"
              options={[
                {
                  value: "ambient",
                  label: "Ambient",
                  count: 0,
                  searchText: "drone",
                },
                { value: "jazz", label: "Jazz", count: 12 },
              ]}
            />
          )}
        </FormField>
        <FormField label="Search tracks">
          <SearchInput
            label="Search tracks"
            defaultValue=""
            onDebouncedChange={setQuery}
          />
        </FormField>
        <FormField label="Description">
          <Textarea rows={3} defaultValue="Mixed Case remains unchanged." />
        </FormField>
        <FormField label="Library path">
          {(control) => <output {...control}>/music/library</output>}
        </FormField>
        <FormField label="Crossfade">
          <Slider min={0} max={12} step={0.5} defaultValue={4} />
        </FormField>
        <FormField label="Read-only query">
          <SearchInput
            label="Read-only query"
            defaultValue="ambient"
            readOnly
          />
        </FormField>
        <FormField layout="inline" label="Keep queue">
          <Checkbox defaultChecked />
        </FormField>
        <FormField layout="inline" label="Automatic playback">
          <Switch />
        </FormField>
        <FormField kind="group" label="Audio quality">
          {(control) => (
            <RadioGroup {...control} defaultValue="lossless">
              <FormField layout="inline" label="Lossless">
                <RadioGroupItem value="lossless" />
              </FormField>
              <FormField layout="inline" label="Compressed">
                <RadioGroupItem value="compressed" />
              </FormField>
              <FormField layout="inline" label="Unavailable">
                <RadioGroupItem value="unavailable" disabled />
              </FormField>
            </RadioGroup>
          )}
        </FormField>
        <FormField kind="group" label="Listening mode">
          {(control) => (
            <SegmentedControl
              {...control}
              label="Listening mode"
              as="radio"
              value={mode}
              onValueChange={setMode}
              items={[
                { value: "all", label: "All" },
                { value: "local", label: "Local" },
                { value: "blocked", label: "Unavailable", disabled: true },
              ]}
            />
          )}
        </FormField>
      </div>
      <div className="showcase-line">
        <FilterChip active={active} onClick={() => setActive(!active)}>
          Ambient filter
        </FilterChip>
        <Readout minWidthCh={0}>Flat · 0 dB</Readout>
        <StatNumber value="24" unit="bit" label="Bit depth" size="sm" />
      </div>
      <output aria-label="Applied query">{query || "No query"}</output>
      <Button type="submit">Validate sample</Button>
    </form>
  );
}
const meta = {
  id: "patterns-forms",
  title: "Patterns/Forms",
  component: CompleteForm,
  parameters: { controls: { disable: true } },
} satisfies Meta<typeof CompleteForm>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Complete: Story = {};
export const TypographyContext: Story = {
  render: () => (
    <div
      style={{
        fontFamily: "var(--font-mono-stack)",
        fontSize: 24,
        fontWeight: 700,
      }}
    >
      <CompleteForm />
    </div>
  ),
};
