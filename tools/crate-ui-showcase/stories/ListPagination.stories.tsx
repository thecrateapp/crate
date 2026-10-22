import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ListPagination } from "../../../app/ui/src/components/admin/ListPagination";

const meta = {
  title: "Components/Admin/List pagination",
  component: ListPagination,
  parameters: { layout: "padded" },
} satisfies Meta<typeof ListPagination>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MultiplePages: Story = {
  args: {
    label: "playlists",
    itemCount: 43,
    page: 2,
    pageSize: 20,
    onPageChange: () => {},
  },
  render: () => {
    const [page, setPage] = useState(2);
    return (
      <div className="max-w-3xl">
        <ListPagination
          label="playlists"
          itemCount={43}
          page={page}
          pageSize={20}
          onPageChange={setPage}
        />
      </div>
    );
  },
};
