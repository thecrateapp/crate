import { useState } from "react";
import { Checkbox } from "@crate/ui/primitives/Checkbox";
import { FormField } from "@crate/ui/primitives/FormField";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { RadioGroup, RadioGroupItem } from "@crate/ui/primitives/RadioGroup";
import { Switch } from "@crate/ui/primitives/Switch";
import { Input } from "@crate/ui/shadcn/input";
import { Textarea } from "@crate/ui/shadcn/textarea";
import { SearchInput } from "@crate/ui/primitives/SearchInput";
import { AdminSelect } from "@crate/ui/composites/AdminSelect";
import { Slider } from "@crate/ui/primitives/Slider";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { FilterChip } from "@crate/ui/primitives/FilterChip";
import { Readout } from "@crate/ui/primitives/Readout";
import { StatNumber } from "@crate/ui/primitives/StatNumber";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@crate/ui/shadcn/select";

/** One review scene, shared by the standalone page and Storybook. Layout only. */
export function FormsReview() {
  const [selected, setSelected] = useState(false);
  const [autoplay, setAutoplay] = useState(false);
  const [genre, setGenre] = useState("ambient");
  const [crossfade, setCrossfade] = useState(4);
  const [mode, setMode] = useState("all");
  const [filtered, setFiltered] = useState(false);
  const [query, setQuery] = useState("");
  const [partial, setPartial] = useState<boolean | "indeterminate">(
    "indeterminate",
  );
  return (
    <main className="mx-auto grid w-full max-w-6xl gap-8 p-6 sm:p-10">
      <header className="grid gap-3">
        <MonoLabel accent="1AR">Review · forms · 12 components</MonoLabel>
        <h1 className="font-display text-3xl font-semibold tracking-display">
          The complete form family.
        </h1>
        <p className="text-body text-text-secondary">
          Captions use MonoLabel. Editable values keep their original case.
        </p>
      </header>
      <section
        aria-label="Form family review"
        className="grid gap-6 border-y border-border-quiet py-6 md:grid-cols-2 lg:grid-cols-3"
      >
        <FormField
          label="Track name"
          hint="This value stays editable and keeps its case."
        >
          <Input defaultValue="First Song" />
        </FormField>
        <FormField label="Description">
          <Textarea rows={3} defaultValue="Mixed Case stays as written." />
        </FormField>
        <FormField
          label="Search tracks"
          hint="Debounced search with a clear action."
        >
          <SearchInput label="Search tracks" onDebouncedChange={setQuery} />
        </FormField>
        <FormField label="Audio format">
          {(control) => (
            <Select defaultValue="flac">
              <SelectTrigger {...control}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="flac">FLAC</SelectItem>
                <SelectItem value="alac">ALAC</SelectItem>
                <SelectItem value="mp3">MP3</SelectItem>
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
              value={genre}
              onChange={setGenre}
              searchable
              placeholder="Choose a genre"
              searchPlaceholder="Search genres"
              noMatchesLabel="No matching genres"
              options={[
                { value: "ambient", label: "Ambient", searchText: "drone" },
                { value: "jazz", label: "Jazz" },
              ]}
            />
          )}
        </FormField>
        <FormField label="Crossfade" hint={`${crossfade} s · Range 0–12 s`}>
          <Slider
            min={0}
            max={12}
            step={0.5}
            value={crossfade}
            aria-valuetext={`${crossfade} seconds`}
            onChange={(event) => setCrossfade(Number(event.target.value))}
          />
        </FormField>
        <FormField layout="inline" label="First Song · FLAC">
          <Checkbox
            checked={selected}
            onCheckedChange={(checked) => setSelected(checked === true)}
          />
        </FormField>
        <FormField layout="inline" label="Automatic playback">
          <Switch checked={autoplay} onCheckedChange={setAutoplay} />
        </FormField>
        <FormField kind="group" label="Source">
          {(control) => (
            <RadioGroup {...control} defaultValue="library">
              <FormField layout="inline" label="Library">
                <RadioGroupItem value="library" />
              </FormField>
              <FormField layout="inline" label="Archive">
                <RadioGroupItem value="archive" />
              </FormField>
            </RadioGroup>
          )}
        </FormField>
        <FormField kind="group" label="Listening mode">
          {(control) => (
            <SegmentedControl
              {...control}
              as="radio"
              label="Listening mode"
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
        <FormField
          kind="group"
          label="Genre filter"
          hint="Filters keep their own interactive role."
        >
          {(control) => (
            <div {...control} role="group">
              <FilterChip
                active={filtered}
                onClick={() => setFiltered(!filtered)}
              >
                Ambient filter
              </FilterChip>
            </div>
          )}
        </FormField>
        <FormField layout="inline" label="Partial selection">
          <Checkbox checked={partial} onCheckedChange={setPartial} />
        </FormField>
      </section>
      <section aria-label="Form states" className="grid gap-6 md:grid-cols-3">
        <FormField label="Disabled field">
          <Input disabled defaultValue="Unavailable" />
        </FormField>
        <FormField label="Read-only value">
          <Input readOnly defaultValue="/music/library" />
        </FormField>
        <FormField label="Invalid value" required error="Choose a value.">
          <Input placeholder="Required value" />
        </FormField>
      </section>
      <section
        aria-label="Typography roles"
        className="flex flex-wrap items-center gap-6"
      >
        <Readout minWidthCh={0}>Flat · 0 dB</Readout>
        <StatNumber value="24" unit="bit" label="Bit depth" size="sm" />
        <output
          aria-label="Applied query"
          className="text-sm text-text-secondary"
        >
          {query || "No search applied."}
        </output>
      </section>
      <p role="status" className="text-sm text-text-secondary">
        {selected ? "Track selected." : "No track selected."}{" "}
        {autoplay ? "Automatic playback on." : "Automatic playback off."}
      </p>
    </main>
  );
}
