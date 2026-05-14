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
export * from "@crate/ui/shadcn/progress";
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
export { CardSkeleton } from "./card-skeleton";
export { ConfirmDialog } from "./confirm-dialog";
export { ErrorState } from "./error-state";
export { GridSkeleton } from "./grid-skeleton";
export { ImageLightbox } from "./image-lightbox";
export { MusicContextMenu } from "./music-context-menu";
export { QrCodeImage } from "./QrCodeImage";
export { StarRating } from "./star-rating";
export { TableSkeleton } from "./table-skeleton";
