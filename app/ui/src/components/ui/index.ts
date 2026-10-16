/* Barrel for shadcn components and local UI primitives */

export * from "@crate/ui/shadcn/alert-dialog";
export * from "@crate/ui/shadcn/badge";
export * from "@crate/ui/shadcn/button";
export * from "@crate/ui/shadcn/card";
export * from "@crate/ui/shadcn/context-menu";
export * from "@crate/ui/shadcn/dialog";
export * from "@crate/ui/shadcn/dropdown-menu";
export * from "@crate/ui/shadcn/input";
export * from "@crate/ui/shadcn/popover";
export * from "@crate/ui/shadcn/scroll-area";
export * from "@crate/ui/shadcn/select";
export * from "@crate/ui/shadcn/separator";
export * from "@crate/ui/shadcn/sheet";
export * from "@crate/ui/shadcn/skeleton";
export * from "@crate/ui/shadcn/table";
export * from "@crate/ui/shadcn/tabs";
export * from "@crate/ui/shadcn/textarea";
export * from "@crate/ui/shadcn/tooltip";

export {
  AppPopover,
  AppPopoverDivider,
  AppMenuButton,
  APP_FLOATING_SURFACE_BASE,
  APP_POPOVER_SURFACE,
  APP_DROPDOWN_SURFACE,
} from "@crate/ui/primitives/AppPopover";
export { VtNavLink } from "@crate/ui/primitives/VtNavLink";
export { CratePill, CrateChip } from "@crate/ui/primitives/CrateBadge";

export { AdminSelect, type AdminSelectOption } from "./AdminSelect";
export { AIButton } from "./AIButton";
export { CardSkeleton } from "@crate/ui/composites/CardSkeleton";
export { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
export { ErrorState } from "@crate/ui/primitives/ErrorState";
export { GridSkeleton } from "@crate/ui/composites/GridSkeleton";
export { ImageLightbox } from "./image-lightbox";
export { MusicContextMenu } from "./music-context-menu";
export { QrCodeImage } from "./QrCodeImage";
export { StarRating } from "./star-rating";
export { TableSkeleton } from "@crate/ui/composites/TableSkeleton";
