import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { VtNavLink } from "@crate/ui/primitives/VtNavLink";
import { HairlineList, HairlineRow } from "@crate/ui/primitives/HairlineList";
import { AppPopover } from "@crate/ui/primitives/AppPopover";
import { AppModal, ModalBody } from "@crate/ui/primitives/AppModal";
import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import { useDismissibleLayer } from "@crate/ui/lib/use-dismissible-layer";
import {
  ChevronRight,
  Collection,
  CRATE_ICON_SIZE,
  PanelLeftOpen,
} from "@crate/ui/icons";

export interface ListenNavItem {
  to: string;
  label: string;
  icon: ReactNode;
  active?: boolean;
}

function CollectionLinks({
  items,
  label,
  onSelect,
}: {
  items: ListenNavItem[];
  label: string;
  onSelect: () => void;
}) {
  return (
    <HairlineList label={label}>
      {items.map((item) => (
        <HairlineRow key={item.to} active={item.active} asChild>
          <Link
            to={item.to}
            aria-current={item.active ? "page" : undefined}
            onClick={onSelect}
          >
            <span className="flex items-center gap-3">
              {item.icon}
              <span>{item.label}</span>
            </span>
          </Link>
        </HairlineRow>
      ))}
    </HairlineList>
  );
}

export function SidebarNavigationView({
  expanded,
  items,
  sections,
  collectionLabel,
  expandLabel,
  collectionActive,
  onToggleExpanded,
}: {
  expanded: boolean;
  items: ListenNavItem[];
  sections: ListenNavItem[];
  collectionLabel: string;
  expandLabel: string;
  collectionActive: boolean;
  onToggleExpanded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 56, top: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const id = useId();
  useDismissibleLayer({
    active: open && !expanded,
    refs: [trigger, popover],
    onDismiss: () => {
      setOpen(false);
      trigger.current?.focus();
    },
  });
  useLayoutEffect(() => {
    if (!open || expanded) return;
    const reposition = (event?: Event) => {
      if (
        event?.target instanceof Node &&
        popover.current?.contains(event.target)
      )
        return;
      const box = trigger.current?.getBoundingClientRect();
      if (box)
        setPosition({
          left: box.right + 8,
          top: Math.max(
            8,
            Math.min(
              box.top,
              window.innerHeight - (popover.current?.scrollHeight ?? 0) - 8,
            ),
          ),
        });
    };
    reposition();
    window.addEventListener("resize", reposition);
    document.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      document.removeEventListener("scroll", reposition, true);
    };
  }, [open, expanded]);
  useEffect(() => {
    if (open && !expanded)
      popover.current
        ?.querySelector<HTMLAnchorElement>("a[href]")
        ?.focus({ preventScroll: true });
  }, [open, expanded]);
  return (
    <>
      <nav aria-label={collectionLabel} className={expanded ? "px-3" : "px-1"}>
        {items.map((item) => (
          <VtNavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            title={item.label}
            aria-label={item.label}
            className="listen-nav-item"
            data-collapsed={!expanded || undefined}
          >
            {item.icon}
            {expanded && <span>{item.label}</span>}
          </VtNavLink>
        ))}
        <button
          ref={trigger}
          type="button"
          className="listen-nav-item w-full"
          data-collapsed={!expanded || undefined}
          data-active={collectionActive || undefined}
          aria-label={collectionLabel}
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={() => setOpen(!open)}
        >
          <Collection size={CRATE_ICON_SIZE.navMobile} />
          {expanded && (
            <>
              <span className="flex-1 text-left">{collectionLabel}</span>
              <ChevronRight
                size={CRATE_ICON_SIZE.sm}
                className={open ? "rotate-90" : undefined}
              />
            </>
          )}
        </button>
        {open && expanded && (
          <div id={id} className="ml-3">
            <CollectionLinks
              items={sections}
              label={collectionLabel}
              onSelect={() => setOpen(false)}
            />
          </div>
        )}
      </nav>
      {open &&
        !expanded &&
        createPortal(
          <AppPopover
            id={id}
            ref={popover}
            className="fixed w-52 p-2"
            style={{
              ...position,
              maxHeight: `calc(100dvh - ${position.top + 8}px)`,
              overflowY: "auto",
            }}
          >
            <CollectionLinks
              items={sections}
              label={collectionLabel}
              onSelect={() => setOpen(false)}
            />
          </AppPopover>,
          document.body,
        )}
      {!expanded && (
        <div className="mt-auto flex justify-center pb-4">
          <ActionButton onClick={onToggleExpanded} label={expandLabel}>
            <PanelLeftOpen size={CRATE_ICON_SIZE.md} />
          </ActionButton>
        </div>
      )}
    </>
  );
}

export function MobileNavigationView({
  items,
  sections,
  collectionLabel,
  closeLabel,
  collectionActive,
  hasTrack,
}: {
  items: ListenNavItem[];
  sections: ListenNavItem[];
  collectionLabel: string;
  closeLabel: string;
  collectionActive: boolean;
  hasTrack: boolean;
}) {
  const [open, setOpen] = useState(false);
  const link = (item: ListenNavItem) => (
    <VtNavLink
      key={item.to}
      to={item.to}
      end={item.to === "/"}
      className="listen-mobile-nav-item"
    >
      {item.icon}
      <span>{item.label}</span>
    </VtNavLink>
  );
  return (
    <>
      <nav
        aria-label={collectionLabel}
        className={`listen-mobile-nav z-app-player fixed isolate flex items-center bg-transparent px-1.5 ${hasTrack ? "rounded-b-panel" : "rounded-panel"}`}
        style={{
          bottom:
            "calc(var(--listen-safe-bottom) + var(--listen-mobile-bottom-dock-inset))",
          left: "max(1rem, var(--listen-safe-left))",
          right: "max(1rem, var(--listen-safe-right))",
          height: "var(--listen-mobile-bottom-nav-content-height)",
        }}
      >
        {items.slice(0, 2).map(link)}
        <button
          type="button"
          className="listen-mobile-nav-item"
          data-active={collectionActive || undefined}
          aria-label={collectionLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <Collection size={CRATE_ICON_SIZE.navMobile} />
          <span>{collectionLabel}</span>
        </button>
        {items.slice(2).map(link)}
      </nav>
      <AppModal
        open={open}
        onClose={() => setOpen(false)}
        title={collectionLabel}
        closeLabel={closeLabel}
        size="sm"
        mobileSafeArea
      >
        <ModalBody className="p-4">
          <CollectionLinks
            items={sections}
            label={collectionLabel}
            onSelect={() => setOpen(false)}
          />
        </ModalBody>
      </AppModal>
    </>
  );
}
