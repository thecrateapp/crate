import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CRATE_ICON_SIZE,
} from "@crate/ui/icons";
import {
  AppMenuButton,
  AppPopoverDivider,
} from "@crate/ui/primitives/AppPopover";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { useHoverCapability } from "@crate/ui/lib/use-hover-capability";
import { cn } from "@crate/ui/lib/cn";

import { MobileActionSheet } from "./MobileActionSheet";
import type {
  ContextMenuEntry,
  ContextMenuHeader,
  ContextMenuMediaHeader,
  ContextMenuMediaImageProps,
  ContextMenuMediaImageRenderer,
  ContextMenuProps,
  DesktopMenuEnvironment,
} from "./types";

export type {
  ContextMenuEntry,
  ContextMenuHeader,
  ContextMenuMediaHeader,
  ContextMenuMediaImageProps,
  ContextMenuMediaImageRenderer,
  ContextMenuProps,
};

export function detectTouchDominant(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0) {
    return true;
  }
  if (typeof window.matchMedia === "function") {
    if (window.matchMedia("(pointer: coarse)").matches) return true;
    if (window.matchMedia("(hover: none)").matches) return true;
  }
  return false;
}

function detectCapacitor(): boolean {
  if (typeof window === "undefined") return false;
  const capacitor = (window as unknown as Record<string, unknown>).Capacitor as
    | { isNativePlatform?: () => boolean }
    | undefined;
  if (typeof capacitor?.isNativePlatform === "function") {
    return capacitor.isNativePlatform();
  }
  if (typeof navigator !== "undefined") {
    return /Capacitor\/\d/.test(navigator.userAgent);
  }
  return false;
}

export function shouldRenderDesktopContextMenu(
  environment: DesktopMenuEnvironment,
): boolean {
  const {
    isDesktop,
    canHover,
    isTouchDominant,
    isCapacitor = detectCapacitor(),
    forceMobileSheet = false,
  } = environment;

  if (!isDesktop || !canHover) return false;
  if (forceMobileSheet) return false;
  if (isCapacitor) return false;
  if (typeof window === "undefined") return false;
  if (isTouchDominant) return false;
  return true;
}

const DEFAULT_SURFACE_CLASS_NAME = "listen-glass-panel";
const MENU_ITEM_FOCUS_CLASS_NAME =
  "focus-visible:shadow-focus focus-visible:outline-none";
const MENU_ITEM_SELECTOR = '[role="menuitem"]:not([disabled])';

function syncClampedLabelTitle(element: HTMLElement, label: string) {
  const clamped =
    element.scrollHeight > element.clientHeight ||
    element.scrollWidth > element.clientWidth;
  if (clamped) element.title = label;
  else element.removeAttribute("title");
}

function ContextMenuItemLabel({ label }: { label: string }) {
  const labelRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const element = labelRef.current;
    if (!element) return;
    syncClampedLabelTitle(element, label);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() =>
      syncClampedLabelTitle(element, label),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [label]);

  return (
    <span
      ref={labelRef}
      data-slot="context-menu-item-label"
      className="line-clamp-2 min-w-0 break-words"
      onPointerEnter={(event) =>
        syncClampedLabelTitle(event.currentTarget, label)
      }
    >
      {label}
    </span>
  );
}

function getMenuItems(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(
    container.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR),
  ).filter((item) => item.closest('[role="menu"]') === container);
}

function focusMenuItem(item: HTMLElement | undefined) {
  item?.focus({ preventScroll: true });
}

function focusFirstMenuItem(container: HTMLElement | null) {
  focusMenuItem(getMenuItems(container)[0]);
}

function handleMenuNavigationKey(
  event: ReactKeyboardEvent<HTMLElement>,
  container: HTMLElement | null,
): boolean {
  const items = getMenuItems(container);
  if (items.length === 0) return false;
  const currentIndex = items.findIndex(
    (item) => item === document.activeElement,
  );
  let nextIndex: number | null = null;

  switch (event.key) {
    case "ArrowDown":
      nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
      break;
    case "ArrowUp":
      nextIndex =
        currentIndex < 0
          ? items.length - 1
          : (currentIndex - 1 + items.length) % items.length;
      break;
    case "Home":
      nextIndex = 0;
      break;
    case "End":
      nextIndex = items.length - 1;
      break;
    default:
      return false;
  }

  event.preventDefault();
  event.stopPropagation();
  focusMenuItem(items[nextIndex]);
  return true;
}

function useMenuFocusManagement(
  active: boolean,
  mode: "desktop" | "sheet",
  containerRef: RefObject<HTMLElement | null>,
) {
  const getContainer = useEffectEvent(() => containerRef.current);

  useEffect(() => {
    if (!active) return;
    const container = getContainer();
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    focusFirstMenuItem(container);

    return () => {
      const current = document.activeElement;
      const focusWasInMenu =
        !current ||
        current === document.body ||
        Boolean(container?.contains(current));
      if (
        focusWasInMenu &&
        previous &&
        previous !== document.body &&
        document.contains(previous)
      ) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [active, mode]);
}

function hasSelectableEntries(items: ContextMenuEntry[]): boolean {
  return items.some((item) => {
    if (item.type === "divider" || item.type === "label") return false;
    return true;
  });
}

function isStructuredHeader(
  header: ContextMenuHeader | ReactNode | undefined,
): header is ContextMenuMediaHeader {
  return (
    typeof header === "object" &&
    header !== null &&
    "type" in header &&
    header.type === "media"
  );
}

function ContextMenuMediaHeaderView({
  header,
  renderMediaImage,
}: {
  header: ContextMenuMediaHeader;
  renderMediaImage?: ContextMenuMediaImageRenderer;
}) {
  const FallbackIcon = header.fallbackIcon;
  const [imageFailed, setImageFailed] = useState(false);
  const hasImage = Boolean(header.imageUrl);
  const showImage = hasImage && !imageFailed;
  const imageShape =
    header.imageShape === "circle" ? "rounded-full" : "rounded-lg";

  useEffect(() => {
    setImageFailed(false);
  }, [header.imageUrl]);

  return (
    <div className="flex items-center gap-3 border-b border-border-quiet p-4 ">
      <div
        className={cn(
          "relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden bg-text-primary/5",
          imageShape,
        )}
      >
        {hasImage && renderMediaImage ? (
          renderMediaImage({
            src: header.imageUrl || "",
            alt: header.imageAlt ?? header.title,
            width: 48,
            height: 48,
            loading: "lazy",
            onLoad: () => {
              setImageFailed(false);
            },
            onError: () => {
              setImageFailed(true);
              header.imageOnError?.();
            },
            className: cn(
              "h-full w-full object-cover",
              imageFailed ? "opacity-0" : undefined,
            ),
          })
        ) : showImage ? (
          <img
            src={header.imageUrl || ""}
            alt={header.imageAlt ?? header.title}
            width={48}
            height={48}
            loading="lazy"
            onError={() => {
              setImageFailed(true);
              header.imageOnError?.();
            }}
            className=" size-full object-cover"
          />
        ) : FallbackIcon ? (
          <FallbackIcon
            size={CRATE_ICON_SIZE.xl}
            className="text-text-primary/35"
          />
        ) : null}
        {hasImage && renderMediaImage && imageFailed && FallbackIcon ? (
          <FallbackIcon
            size={CRATE_ICON_SIZE.xl}
            className="absolute text-text-primary/35"
          />
        ) : null}
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-text-primary">
          {header.title}
        </div>
        {header.subtitle ? (
          <div className="truncate text-xs text-text-muted">
            {header.subtitle}
          </div>
        ) : null}
        {header.detail ? (
          <div className="truncate text-xs text-text-primary/55">
            {header.detail}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ContextMenuHeaderView({
  header,
  renderMediaImage,
}: {
  header?: ContextMenuHeader | ReactNode;
  renderMediaImage?: ContextMenuMediaImageRenderer;
}) {
  if (!header) return null;
  if (isStructuredHeader(header)) {
    return (
      <ContextMenuMediaHeaderView
        header={header}
        renderMediaImage={renderMediaImage}
      />
    );
  }
  return <>{header}</>;
}

function ContextMenuDisclosure({
  entry,
  onClose,
  desktop,
  surfaceClassName,
}: {
  entry: Extract<ContextMenuEntry, { type: "disclosure" }>;
  onClose: () => void;
  desktop: boolean;
  surfaceClassName: string;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const focusSubmenuOnOpenRef = useRef(false);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  const Icon = entry.icon;
  const Indicator = entry.expanded ? ChevronDown : ChevronRight;

  useLayoutEffect(() => {
    if (!desktop || !entry.expanded) return;

    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;

    const margin = 12;
    const gap = 8;
    const submenuWidth = 288;
    const maxLeft = Math.max(margin, window.innerWidth - submenuWidth - margin);
    const maxTop = Math.max(margin, window.innerHeight - 120);
    const opensRight =
      rect.right + gap + submenuWidth <= window.innerWidth - margin;
    const preferredLeft = opensRight
      ? rect.right + gap
      : rect.left - gap - submenuWidth;

    setPosition({
      left: Math.min(Math.max(margin, preferredLeft), maxLeft),
      top: Math.min(Math.max(margin, rect.top), maxTop),
    });
  }, [desktop, entry.expanded]);

  useEffect(() => {
    if (!desktop || !entry.expanded || !focusSubmenuOnOpenRef.current) return;
    focusSubmenuOnOpenRef.current = false;
    focusFirstMenuItem(submenuRef.current);
  }, [desktop, entry.expanded]);

  const handleTriggerKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) => {
    if (entry.disabled) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      if (entry.expanded) {
        if (desktop) focusFirstMenuItem(submenuRef.current);
        return;
      }
      focusSubmenuOnOpenRef.current = desktop;
      entry.onToggle();
      return;
    }
    if (event.key === "ArrowLeft" && entry.expanded && !desktop) {
      event.preventDefault();
      event.stopPropagation();
      entry.onToggle();
    }
  };

  const handleSubmenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      entry.onToggle();
      anchorRef.current
        ?.querySelector<HTMLElement>('[role="menuitem"]')
        ?.focus({ preventScroll: true });
      return;
    }
    if (handleMenuNavigationKey(event, submenuRef.current)) return;
    if (event.key !== "Escape") event.stopPropagation();
  };

  const submenu = (
    <div
      ref={submenuRef}
      data-dismissible-layer-boundary="true"
      data-testid={`context-menu-submenu-${entry.key}`}
      role="menu"
      aria-label={entry.label}
      className={cn(
        surfaceClassName,
        "fixed z-app-context-menu w-72 max-w-[calc(100vw-24px)] max-h-[calc(100vh-24px)] overflow-y-auto rounded-2xl animate-pop-in",
      )}
      style={{ left: position.left, top: position.top }}
      onKeyDown={handleSubmenuKeyDown}
    >
      <div className="p-1.5">
        <ContextMenuItems
          items={entry.items}
          onClose={onClose}
          desktop
          surfaceClassName={surfaceClassName}
        />
      </div>
    </div>
  );

  return (
    <div
      ref={anchorRef}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <AppMenuButton
        role="menuitem"
        aria-haspopup={desktop ? "menu" : undefined}
        aria-expanded={entry.expanded}
        disabled={entry.disabled}
        onClick={(event) => {
          event.stopPropagation();
          if (!entry.disabled) entry.onToggle();
        }}
        onKeyDown={handleTriggerKeyDown}
        className={cn(
          MENU_ITEM_FOCUS_CLASS_NAME,
          entry.disabled ? "opacity-50" : undefined,
        )}
      >
        <span className="flex min-w-0 flex-1 items-center gap-3">
          {Icon ? (
            <Icon size={CRATE_ICON_SIZE.md} className="shrink-0" />
          ) : (
            <span className="w-[18px] shrink-0" />
          )}
          <ContextMenuItemLabel label={entry.label} />
        </span>
        <Indicator
          size={CRATE_ICON_SIZE.md}
          className="shrink-0 text-text-primary/45"
        />
      </AppMenuButton>
      {entry.expanded && desktop && typeof document !== "undefined"
        ? createPortal(submenu, document.body)
        : null}
      {!desktop && entry.expanded ? (
        <div className="space-y-1 px-3 pb-2">
          <ContextMenuItems
            items={entry.items}
            onClose={onClose}
            surfaceClassName={surfaceClassName}
          />
        </div>
      ) : null}
    </div>
  );
}

function ContextMenuItems({
  items,
  onClose,
  desktop = false,
  surfaceClassName,
}: {
  items: ContextMenuEntry[];
  onClose: () => void;
  desktop?: boolean;
  surfaceClassName: string;
}) {
  const handleSelect = (
    entry: Extract<ContextMenuEntry, { type?: "action" }>,
  ) => {
    if (entry.disabled) return;
    const result = entry.onSelect();
    onClose();
    if (result && typeof (result as Promise<void>).then === "function") {
      void (result as Promise<void>).catch(() => {
        /* callers surface action failures via toast */
      });
    }
  };

  return (
    <>
      {items.map((entry) => {
        if (entry.type === "divider") {
          return <AppPopoverDivider key={entry.key} className="mx-1" />;
        }

        if (entry.type === "label") {
          return (
            <div
              key={entry.key}
              className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-text-primary/40"
            >
              {entry.label}
            </div>
          );
        }

        const Icon = entry.icon;

        if (entry.type === "disclosure") {
          return (
            <ContextMenuDisclosure
              key={entry.key}
              entry={entry}
              onClose={onClose}
              desktop={desktop}
              surfaceClassName={surfaceClassName}
            />
          );
        }

        return (
          <AppMenuButton
            key={entry.key}
            role="menuitem"
            danger={entry.danger}
            disabled={entry.disabled}
            onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
              event.stopPropagation();
              handleSelect(entry);
            }}
            className={cn(
              MENU_ITEM_FOCUS_CLASS_NAME,
              entry.active ? "text-accent-action" : undefined,
              entry.disabled ? "opacity-50" : undefined,
            )}
          >
            <span className="flex min-w-0 flex-1 items-center gap-3">
              {Icon ? (
                <Icon
                  size={CRATE_ICON_SIZE.md}
                  className={cn(
                    "shrink-0",
                    entry.active && "animate-crate-icon-active-pulse",
                  )}
                />
              ) : (
                <span className="w-[18px] shrink-0" />
              )}
              <ContextMenuItemLabel label={entry.label} />
            </span>
            {entry.active ? (
              <Check
                size={CRATE_ICON_SIZE.md}
                className="shrink-0 text-accent-action"
              />
            ) : null}
          </AppMenuButton>
        );
      })}
    </>
  );
}

export function ContextMenu({
  items,
  header,
  open,
  position,
  menuRef,
  onClose,
  className,
  surfaceClassName: surfaceClassNameProp,
  sheetLabel,
  renderMediaImage,
}: ContextMenuProps) {
  const surfaceClassName = cn(DEFAULT_SURFACE_CLASS_NAME, surfaceClassNameProp);
  const isDesktop = useIsDesktop();
  const canHover = useHoverCapability();
  const shouldUseDesktopMenu = shouldRenderDesktopContextMenu({
    isDesktop,
    canHover,
    isTouchDominant: detectTouchDominant(),
  });
  const sheetMenuRef = useRef<HTMLDivElement>(null);
  const isRendered = open && hasSelectableEntries(items);
  const keyboardContainerRef = shouldUseDesktopMenu ? menuRef : sheetMenuRef;

  useMenuFocusManagement(
    isRendered,
    shouldUseDesktopMenu ? "desktop" : "sheet",
    keyboardContainerRef,
  );

  if (!isRendered) return null;

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    handleMenuNavigationKey(event, keyboardContainerRef.current);
  };

  const content = (desktop: boolean) => (
    <>
      <ContextMenuHeaderView
        header={header}
        renderMediaImage={renderMediaImage}
      />
      <div className="p-1.5">
        <ContextMenuItems
          items={items}
          onClose={onClose}
          desktop={desktop}
          surfaceClassName={surfaceClassName}
        />
      </div>
    </>
  );

  if (!shouldUseDesktopMenu) {
    return (
      <MobileActionSheet
        open={open}
        panelRef={menuRef}
        onClose={onClose}
        ariaLabel={sheetLabel}
        surfaceClassName={surfaceClassName}
      >
        <div
          ref={sheetMenuRef}
          role="menu"
          className="max-h-[calc(100%-5rem)] overflow-y-auto pb-3"
          onKeyDown={handleKeyDown}
        >
          {content(false)}
        </div>
      </MobileActionSheet>
    );
  }

  if (typeof document === "undefined") return null;

  const style: CSSProperties = {
    left: position?.x ?? 12,
    top: position?.y ?? 12,
  };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      onKeyDown={handleKeyDown}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      className={cn(
        surfaceClassName,
        "fixed z-app-context-menu w-72 max-w-[calc(100vw-24px)] max-h-[calc(100vh-24px)] origin-top-left overflow-y-auto overflow-x-hidden rounded-2xl animate-pop-in",
        className,
      )}
      style={style}
    >
      {content(true)}
    </div>,
    document.body,
  );
}
