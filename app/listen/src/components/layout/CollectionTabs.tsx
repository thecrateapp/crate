import { useId, type ReactNode } from "react";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@crate/ui/shadcn/tabs";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
export const COLLECTION_SECTIONS = [
  "artists",
  "crates",
  "playlists",
  "albums",
  "liked",
  "bandcamp",
  "contributions",
] as const;
export type CollectionSection = (typeof COLLECTION_SECTIONS)[number];
export function CollectionTabs({
  items,
  value,
  onValueChange,
  label,
  visible,
  children,
}: {
  items: { value: CollectionSection; label: string; count?: number }[];
  value: CollectionSection;
  onValueChange: (value: string) => void;
  label: string;
  visible: boolean;
  children: ReactNode;
}) {
  const id = useId();
  if (!visible) return <>{children}</>;
  return (
    <Tabs value={value} onValueChange={onValueChange}>
      <TabsList aria-label={label}>
        {items.map((item) => (
          <TabsTrigger
            key={item.value}
            value={item.value}
            aria-label={item.label}
            aria-describedby={
              item.count !== undefined ? `${id}-${item.value}-count` : undefined
            }
          >
            {item.label}
            {item.count !== undefined && (
              <InfoBadge id={`${id}-${item.value}-count`} variant="counter">
                {item.count}
              </InfoBadge>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
      {items.map((item) => (
        <TabsContent key={item.value} value={item.value}>
          {item.value === value ? children : null}
        </TabsContent>
      ))}
    </Tabs>
  );
}
