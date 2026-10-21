import { useCallback, useState, type ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import { useEntityMenu } from "@crate/ui/domain/entity/useEntityMenu";
import { ItemActionMenuButton } from "@crate/ui/domain/actions/ItemActionMenu";
import { MobileActionSheet } from "@crate/ui/domain/actions/MobileActionSheet";
import { OAuthButtons } from "@crate/ui/domain/auth/OAuthButtons";
import { CrateLoader } from "@crate/ui/domain/brand/CrateLoader";
import { EmptyState } from "@crate/ui/domain/lists/EmptyState";
import { PlayButton } from "@crate/ui/domain/media/PlayButton";
import { FollowHeartButton } from "@crate/ui/primitives/FollowHeartButton";
import { ProgressHairline } from "@crate/ui/primitives/ProgressHairline";
import { PullIndicator } from "@crate/ui/primitives/PullIndicator";
import { VtNavLink } from "@crate/ui/primitives/VtNavLink";
import { FormField } from "@crate/ui/primitives/FormField";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { Slider } from "@crate/ui/primitives/Slider";
import { OverlayCloseButton } from "@crate/ui/shadcn/overlay-close-button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@crate/ui/shadcn/tooltip";
import { Button } from "@crate/ui/shadcn/button";

export function ClosureSample({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <FormField kind="group" label={label}>
      {(props) => (
        <div {...props} role="group" className="grid min-w-0 gap-4">
          {children}
        </div>
      )}
    </FormField>
  );
}

export function ConfirmationExample({
  typed = false,
  fail = false,
}: {
  typed?: boolean;
  fail?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("No change made");
  return (
    <div className="grid gap-4">
      <Button variant="outline" onClick={() => setOpen(true)}>
        Review removal
      </Button>
      <output aria-label="Confirmation result" aria-live="polite">
        {notice}
      </output>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        tone="danger"
        title="Remove from this collection?"
        description="This example changes local state only."
        confirmLabel="Remove item"
        cancelLabel="Keep item"
        closeLabel="Close confirmation"
        confirmation={
          typed
            ? { value: "REMOVE", label: "Type REMOVE to confirm" }
            : undefined
        }
        onConfirm={async () => {
          await new Promise((resolve) => setTimeout(resolve, 250));
          if (fail) throw new Error("Example failure");
          setNotice("Item removed in this example");
        }}
        onError={() => setNotice("Example could not complete. Try again.")}
      />
    </div>
  );
}

export function EntityMenuExample({
  longLabel = false,
  disabled = false,
}: {
  longLabel?: boolean;
  disabled?: boolean;
}) {
  const [notice, setNotice] = useState("No action selected");
  const menu = useEntityMenu({
    disabled,
    actionMenu: {
      getActions: () => [
        {
          key: "queue",
          label: longLabel
            ? "Add this recording with a very long translated name to the end of the current queue"
            : "Add to queue",
          onSelect: () => setNotice("Added to queue in this example"),
        },
        {
          key: "unavailable",
          label: "Unavailable action",
          disabled: true,
          onSelect: () => {},
        },
        {
          key: "remove",
          label: "Remove from collection",
          danger: true,
          onSelect: () => setNotice("Removed in this example"),
        },
      ],
    },
    getFallbackHeader: () => ({
      type: "media",
      title: "Everything in Its Right Place",
      subtitle: "Radiohead",
      imageShape: "square",
    }),
  });
  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-3" {...menu.targetProps}>
        <MonoLabel>Collection item</MonoLabel>
        <ItemActionMenuButton
          buttonRef={menu.controller.triggerRef}
          expanded={menu.controller.open}
          hasActions={menu.controller.hasActions}
          title="Item actions"
          onClick={menu.controller.openFromTrigger}
        />
      </div>
      <output aria-label="Entity action" aria-live="polite">
        {notice}
      </output>
      {menu.menu}
    </div>
  );
}

export function TouchSheetExample() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Open action sheet
      </Button>
      <MobileActionSheet
        open={open}
        onClose={() => setOpen(false)}
        ariaLabel="Example actions"
      >
        <div className="grid gap-4 p-5">
          <MonoLabel>Example actions</MonoLabel>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Close action sheet
          </Button>
        </div>
      </MobileActionSheet>
    </>
  );
}

export function OAuthExample({
  unavailable = false,
  empty = false,
}: {
  unavailable?: boolean;
  empty?: boolean;
}) {
  const [notice, setNotice] = useState("No sign-in started");
  const fetchProviders = useCallback(
    async () => ({
      google: {
        enabled: !empty,
        configured: true,
        login_url: "/example/google",
      },
      apple: {
        enabled: !empty,
        configured: !unavailable,
        login_url: unavailable ? null : "/example/apple",
      },
    }),
    [empty, unavailable],
  );
  return (
    <div className="grid gap-4">
      <OAuthButtons
        fetchProviders={fetchProviders}
        onOAuthNavigate={(url) =>
          setNotice(
            url.endsWith("google")
              ? "Google selected locally"
              : "Apple selected locally",
          )
        }
      />
      <output aria-label="OAuth result" aria-live="polite">
        {notice}
      </output>
    </div>
  );
}

export function BrandLoadingExample() {
  return (
    <CrateLoader
      variant="compact"
      label="Loading the library"
      phrases={["Loading Crate"]}
    />
  );
}
export function CollectionEmptyExample({ long = false }: { long?: boolean }) {
  const [created, setCreated] = useState(false);
  return (
    <EmptyState
      title={created ? "Collection created locally" : "Nothing saved yet"}
      description={
        long
          ? "A long explanation remains readable at narrow widths, preserves its original case and does not add decorative artwork or invent a count while content is unavailable."
          : "Save music to find it here."
      }
      action={
        <Button variant="outline" onClick={() => setCreated(true)}>
          Create collection
        </Button>
      }
    />
  );
}
export function PlaybackButtonExample({
  loading = false,
  disabled = false,
}: {
  loading?: boolean;
  disabled?: boolean;
}) {
  const [playing, setPlaying] = useState(false);
  return (
    <PlayButton
      playing={playing}
      loading={loading}
      disabled={disabled}
      onClick={() => setPlaying(!playing)}
      label="Play example"
      pauseLabel="Pause example"
    />
  );
}
export function FollowExample({
  loading = false,
  disabled = false,
}: {
  loading?: boolean;
  disabled?: boolean;
}) {
  const [following, setFollowing] = useState(false);
  return (
    <FollowHeartButton
      following={following}
      loading={loading}
      disabled={disabled}
      label="Follow example"
      labelActive="Unfollow example"
      onClick={() => setFollowing(!following)}
    />
  );
}
export function HairlineProgressExample({
  indeterminate = false,
  complete = false,
}: {
  indeterminate?: boolean;
  complete?: boolean;
}) {
  const [value, setValue] = useState(complete ? 100 : 0);
  return (
    <div className="grid gap-4">
      <ProgressHairline
        value={indeterminate ? undefined : value / 100}
        label="Download progress"
        valueText={indeterminate ? "Waiting for a known total" : `${value}%`}
      />
      {!indeterminate ? (
        <FormField label="Example progress">
          <Slider
            value={value}
            min={0}
            max={100}
            step={1}
            onChange={(e) => setValue(Number(e.target.value))}
          />
        </FormField>
      ) : null}
    </div>
  );
}
export function PullExample({ refreshing = false }: { refreshing?: boolean }) {
  const [distance, setDistance] = useState(32);
  return (
    <div className="grid gap-4">
      <PullIndicator distance={distance} refreshing={refreshing} />
      <FormField label="Pull distance">
        <Slider
          min={0}
          max={80}
          value={distance}
          onChange={(e) => setDistance(Number(e.target.value))}
        />
      </FormField>
    </div>
  );
}
function NavigationContent() {
  const location = useLocation();
  return (
    <div className="grid gap-4">
      <nav aria-label="Example navigation" className="flex flex-wrap gap-4">
        <VtNavLink to="/music" end>
          <MonoLabel>Music</MonoLabel>
        </VtNavLink>
        <VtNavLink to="/collection">
          <MonoLabel>Collection</MonoLabel>
        </VtNavLink>
      </nav>
      <output aria-label="Current example route">{location.pathname}</output>
    </div>
  );
}
export function NavigationExample() {
  return (
    <MemoryRouter initialEntries={["/music"]}>
      <NavigationContent />
    </MemoryRouter>
  );
}
export function CloseControlExample({
  disabled = false,
}: {
  disabled?: boolean;
}) {
  const [count, setCount] = useState(0);
  return (
    <div className="flex flex-wrap items-center gap-4">
      <OverlayCloseButton
        aria-label="Close example"
        disabled={disabled}
        onClick={() => setCount(count + 1)}
      />
      <output aria-label="Close count">{count}</output>
    </div>
  );
}
export function TooltipExample() {
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline">Keyboard shortcut</Button>
        </TooltipTrigger>
        <TooltipContent>Press Space to play or pause</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
