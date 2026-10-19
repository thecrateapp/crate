import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { GenrePill } from "@crate/ui/domain/genres/GenrePill";
const meta = {
  id: "components-genrepill",
  title: "Components/Data Display/GenrePill",
  component: GenrePill,
  args: { item: { name: "Shoegaze", percent: 61, source: "MusicBrainz" } },
  argTypes: { className: { table: { disable: true } } },
} satisfies Meta<typeof GenrePill>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const Percentages: Story = {
  render: () => (
    <div className="showcase-line">
      <GenrePill item={{ name: "Post-rock" }} />
      <GenrePill item={{ name: "Drone", percent: 0 }} />
      <GenrePill item={{ name: "Noise", percent: 100 }} />
    </div>
  ),
};
export const Editing: Story = {
  render: function Editing() {
    const [removed, setRemoved] = useState(false);
    return (
      <div className="showcase-stack">
        {!removed ? (
          <GenrePill
            item={{ name: "Ambient", percent: 42, source: "Last.fm" }}
            onClick={() => {}}
            onRemove={() => setRemoved(true)}
            removeLabel="Remove Ambient"
          />
        ) : null}
        <p role="status">{removed ? "Ambient removed" : "No actions"}</p>
      </div>
    );
  },
};
