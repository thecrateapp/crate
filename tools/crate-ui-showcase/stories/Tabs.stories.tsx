import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@crate/ui/shadcn/tabs";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { Button } from "@crate/ui/shadcn/button";
import { useTabParam } from "../../../app/listen/src/hooks/use-tab-param";
const values = ["albums", "tracks"] as const;
const meta = {
  id: "components-tabs",
  title: "Components/Navigation/Tabs",
  component: Tabs,
  args: { defaultValue: "albums" },
} satisfies Meta<typeof Tabs>;
export default meta;
type Story = StoryObj<typeof meta>;
function Panels() {
  return (
    <>
      <TabsList aria-label="Collection views">
        <TabsTrigger value="albums">Albums</TabsTrigger>
        <TabsTrigger value="tracks">Tracks</TabsTrigger>
        <TabsTrigger value="unavailable" disabled>
          Unavailable
        </TabsTrigger>
      </TabsList>
      <TabsContent value="albums">Album collection</TabsContent>
      <TabsContent value="tracks">Track collection</TabsContent>
    </>
  );
}
export const Base: Story = {
  render: (args) => (
    <Tabs {...args}>
      <Panels />
    </Tabs>
  ),
};
export const MovingUnderline: Story = {
  render: () => (
    <Tabs defaultValue="artists">
      <TabsList aria-label="Moving collection underline">
        <TabsTrigger value="artists">Artists</TabsTrigger>
        <TabsTrigger value="albums">Albums</TabsTrigger>
        <TabsTrigger value="liked">Liked tracks</TabsTrigger>
        <TabsTrigger value="contributions">Contributions</TabsTrigger>
      </TabsList>
      <TabsContent value="artists">Artist collection</TabsContent>
      <TabsContent value="albums">Album collection</TabsContent>
      <TabsContent value="liked">Liked tracks</TabsContent>
      <TabsContent value="contributions">Contributions</TabsContent>
    </Tabs>
  ),
};
export const Vertical: Story = { ...Base, args: { orientation: "vertical" } };
function UrlTabs() {
  const [tab, setTab] = useTabParam(values, "albums");
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <div className="grid gap-4">
      <Tabs value={tab} onValueChange={setTab}>
        <Panels />
      </Tabs>
      <output>
        {location.pathname}
        {location.search}
        {location.hash}
      </output>
      <div className="flex gap-3">
        <Button variant="ghost" onClick={() => navigate(-1)}>
          Back
        </Button>
        <Button variant="ghost" onClick={() => navigate(1)}>
          Forward
        </Button>
      </div>
    </div>
  );
}
export const UrlState: Story = {
  render: () => (
    <MemoryRouter
      initialEntries={["/collection?tab=unknown&node=sample#results"]}
    >
      <UrlTabs />
    </MemoryRouter>
  ),
};
