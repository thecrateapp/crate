import type { Meta, StoryObj } from "@storybook/react-vite";
import { EntityCard } from "@crate/ui/domain/entity/EntityCard";
import { IMAGE_SAMPLES } from "../fixtures/image-identity";
import { MemoryRouter } from "react-router";
import { MediaGrid } from "@crate/ui/domain/lists/MediaGrid";
const cards = (grid: boolean) =>
  ["Luz de octubre", "Bruma", "Marea", "Horizonte"].map((title, index) => (
    <EntityCard
      key={title}
      title={title}
      subtitle="Costa Norte"
      layout={grid ? "grid" : "rail"}
      cover={{ src: IMAGE_SAMPLES[index % 2] }}
      menuButton="none"
      href="/album/sample"
    />
  ));
const meta = {
  id: "components-mediagrid",
  title: "Components/Layout/MediaGrid",
  component: MediaGrid,
  args: { children: cards(true) },
  decorators: [
    (Story) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
} satisfies Meta<typeof MediaGrid>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};

export const Compact: Story = { args: { density: "compact" } };
export const Wide: Story = { args: { density: "wide" } };
export const BoundedMinimum: Story = { args: { minItemWidth: 220 } };
