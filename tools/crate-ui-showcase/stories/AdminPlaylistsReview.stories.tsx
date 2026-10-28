import type { Meta, StoryObj } from "@storybook/react-vite";
import { AdminPlaylistsReview } from "../reviews/AdminPlaylistsReview";

const meta = {
  id: "reviews-admin-a5-playlists",
  title: "Reviews/Admin/A5 Playlists",
  component: AdminPlaylistsReview,
  parameters: { layout: "fullscreen", controls: { disable: true } },
} satisfies Meta<typeof AdminPlaylistsReview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PlaylistList: Story = { args: { initialPage: "list" } };
export const PlaylistEditor: Story = { args: { initialPage: "editor" } };
