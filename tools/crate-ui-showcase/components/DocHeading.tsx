import type { ReactNode } from "react";
import { Unstyled } from "@storybook/addon-docs/blocks";

/** Owned documentation typography; never targets the components demonstrated below it. */
export function DocHeading({
  as: Tag,
  children,
}: {
  as: "h1" | "h2" | "h3";
  children: ReactNode;
}) {
  const id =
    typeof children === "string"
      ? children
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
      : undefined;
  return (
    <Unstyled>
      <Tag id={id} className="showcase-doc-heading">
        {children}
      </Tag>
    </Unstyled>
  );
}
