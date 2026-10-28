import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
} from "@crate/ui/shadcn/card";
import { Button } from "@crate/ui/shadcn/button";
import { ActionGroup, ActionButton } from "@crate/ui/primitives/ActionGroup";
import { Pencil } from "@crate/ui/icons";
const meta = {
  id: "components-card",
  title: "Components/Layout/Card",
  component: Card,
  parameters: { controls: { disable: true } },
} satisfies Meta<typeof Card>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {
  render: () => (
    <Card>
      <CardHeader>
        <CardTitle>Saved query</CardTitle>
        <CardDescription>A standalone query object.</CardDescription>
      </CardHeader>
      <CardContent>Ready to run.</CardContent>
    </Card>
  ),
};
export const LongContent: Story = {
  render: () => (
    <div className="showcase-narrow">
      <Card>
        <CardHeader>
          <CardTitle>
            Averylongunbrokentitlethatmustwrapwithoutcomponentrepairs
          </CardTitle>
          <CardDescription>
            A translated description can wrap over several lines.
          </CardDescription>
          <CardAction>
            <ActionButton label="Edit query" tooltip="Edit">
              <Pencil aria-hidden="true" />
            </ActionButton>
          </CardAction>
        </CardHeader>
        <CardContent>
          https://example.test/averylongunbrokenpaththatdoesnotwidentheobject
        </CardContent>
      </Card>
    </div>
  ),
};
export const Semantic: Story = {
  render: () => (
    <Card as="article" aria-labelledby="object-title">
      <CardHeader>
        <CardTitle as="h2" id="object-title">
          Saved query
        </CardTitle>
      </CardHeader>
      <CardContent>0 results</CardContent>
    </Card>
  ),
};
export const AllSlots: Story = {
  render: () => (
    <Card>
      <CardHeader>
        <CardTitle>Collection export</CardTitle>
        <CardDescription>One standalone export record.</CardDescription>
        <CardAction>
          <ActionGroup>
            <ActionButton label="Edit export" tooltip="Edit">
              <Pencil aria-hidden="true" />
            </ActionButton>
          </ActionGroup>
        </CardAction>
      </CardHeader>
      <CardContent>12 albums · FLAC</CardContent>
      <CardFooter>
        <Button variant="outline">Open export</Button>
      </CardFooter>
    </Card>
  ),
};
