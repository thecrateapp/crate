import type { Meta, StoryObj } from "@storybook/react-vite";
import { AdminUsersRolesReview } from "../reviews/AdminUsersRolesReview";

const meta = {
  id: "reviews-admin-a5-users-roles",
  title: "Reviews/Admin/A5 Users and Roles",
  component: AdminUsersRolesReview,
  parameters: { layout: "fullscreen", controls: { disable: true } },
} satisfies Meta<typeof AdminUsersRolesReview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const UserDirectory: Story = { args: { initialPage: "users" } };
export const PermissionMatrix: Story = { args: { initialPage: "roles" } };
