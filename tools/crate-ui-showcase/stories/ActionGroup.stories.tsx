import type { Meta, StoryObj } from "@storybook/react-vite";
import { Card, CardHeader, CardTitle, CardAction } from "@crate/ui/shadcn/card";
import { Copy, Eye, Save } from "@crate/ui/icons";
import {
  ActionButton,
  ActionGroup,
  ActionLink,
} from "@crate/ui/primitives/ActionGroup";
const meta = {
  id: "components-actiongroup",
  title: "Components/Actions/ActionGroup",
  component: ActionButton,
  args: {
    label: "Save Costa de noche",
    tooltip: "Save",
    children: <Save aria-hidden="true" />,
    disabled: false,
    loading: false,
  },
  argTypes: { children: { table: { disable: true } } },
} satisfies Meta<typeof ActionButton>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const Disabled: Story = { args: { disabled: true } };
export const Loading: Story = { args: { loading: true } };
export const Group: Story = {
  render: () => (
    <ActionGroup label="Playlist actions">
      <ActionButton label="Duplicate Costa de noche" tooltip="Duplicate">
        <Copy aria-hidden="true" />
      </ActionButton>
      <ActionLink
        href="#preview"
        label="Preview Costa de noche"
        tooltip="Preview"
      >
        <Eye aria-hidden="true" />
      </ActionLink>
      <ActionButton label="Save Costa de noche" tooltip="Save">
        <Save aria-hidden="true" />
      </ActionButton>
    </ActionGroup>
  ),
};
export const UnavailableLink: Story = {
  render: () => (
    <ActionGroup>
      <ActionLink
        disabled
        href="#preview"
        label="Preview Costa de noche"
        tooltip="Preview"
      >
        <Eye aria-hidden="true" />
      </ActionLink>
    </ActionGroup>
  ),
};

export const ContainerEdge: Story = {
  render: () => (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Playlist actions</CardTitle>
        <CardAction>
          <ActionGroup label="Playlist actions">
            <ActionButton label="Duplicate Costa de noche" tooltip="Duplicate">
              <Copy aria-hidden="true" />
            </ActionButton>
            <ActionLink
              label="Preview Costa de noche"
              tooltip="Preview"
              href="#preview"
            >
              <Eye aria-hidden="true" />
            </ActionLink>
            <ActionButton label="Save Costa de noche" tooltip="Save">
              <Save aria-hidden="true" />
            </ActionButton>
          </ActionGroup>
        </CardAction>
      </CardHeader>
    </Card>
  ),
};
