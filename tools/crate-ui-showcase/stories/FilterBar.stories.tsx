import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { FilterBar } from "@crate/ui/domain/filters/FilterBar";
import { FormField } from "@crate/ui/primitives/FormField";
import { SearchInput } from "@crate/ui/primitives/SearchInput";
import { Button } from "@crate/ui/shadcn/button";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@crate/ui/shadcn/select";
const meta = {
  id: "components-filterbar",
  title: "Components/Forms/FilterBar",
  component: FilterBar,
  args: { align: "end" },
  render: function Example(args) {
    const [query, setQuery] = useState(""),
      [sort, setSort] = useState("recent");
    return (
      <FilterBar
        {...args}
        label="Collection controls"
        leading={<Button>Play all</Button>}
        search={
          <FormField kind="group" label="Search">
            {(group) => (
              <div {...group} role="group">
                <SearchInput
                  label="Filter tracks"
                  clearLabel="Clear"
                  value={query}
                  onValueChange={setQuery}
                />
              </div>
            )}
          </FormField>
        }
        sort={
          <FormField label="Sort">
            {(control) => (
              <Select value={sort} onValueChange={setSort}>
                <SelectTrigger {...control}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="recent">Recently added</SelectItem>
                  <SelectItem value="name">Name</SelectItem>
                </SelectContent>
              </Select>
            )}
          </FormField>
        }
      />
    );
  },
} satisfies Meta<typeof FilterBar>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Labelled: Story = {};
export const Centered: Story = { args: { align: "center" } };
