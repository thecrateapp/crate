import type { ReactNode } from "react";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@crate/ui/shadcn/tabs";
/** Player-only composition; Radix owns activation, focus and panel relationships. */
export function PlayerPanels({
  value,
  onValueChange,
  label,
  items,
  leading,
}: {
  value: string;
  onValueChange: (value: string) => void;
  label: string;
  items: { value: string; label: string; content: ReactNode }[];
  leading?: ReactNode;
}) {
  return (
    <Tabs
      value={value}
      onValueChange={onValueChange}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex shrink-0 items-center gap-2 px-4">
        <div>{leading}</div>
        <div className="min-w-0 flex-1">
          <TabsList aria-label={label}>
            {items.map((item) => (
              <TabsTrigger key={item.value} value={item.value}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </div>
      {items.map((item) => (
        <TabsContent
          key={item.value}
          value={item.value}
          className="min-h-0 flex-1 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col"
        >
          {item.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
