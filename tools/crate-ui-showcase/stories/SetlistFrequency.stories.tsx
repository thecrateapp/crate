import type { Meta, StoryObj } from "@storybook/react-vite";
import { SetlistFrequency } from "@crate/ui/domain/shows/SetlistFrequency";

const meta = {
  id: "components-setlistfrequency",
  title: "Components/Data Display/SetlistFrequency",
  component: SetlistFrequency,
  args: { frequency: 0.76, label: "Hey frequency", plays: "11 plays" },
} satisfies Meta<typeof SetlistFrequency>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Base: Story = {};

export const AlignedRows: Story = {
  render: () => (
    <div className="grid max-w-md gap-3">
      <SetlistFrequency
        frequency={1}
        label="Where Is My Mind? frequency"
        plays="12 plays"
      />
      <SetlistFrequency
        frequency={0.61}
        label="Cactus frequency"
        plays="9 plays"
      />
      <SetlistFrequency
        frequency={0.07}
        label="Tame frequency"
        plays="1 play"
      />
    </div>
  ),
};

export const WithLastPlayed: Story = {
  render: () => (
    <div className="grid max-w-xl gap-3">
      <SetlistFrequency
        frequency={1}
        label="Where Is My Mind? frequency"
        plays="12 plays"
        showLastPlayed
        lastPlayed="2026-10-12"
      />
      <SetlistFrequency
        frequency={0.35}
        label="Velouria frequency"
        plays="5 plays"
        showLastPlayed
      />
    </div>
  ),
};
