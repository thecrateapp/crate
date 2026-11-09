---
title: "Making two apps look and behave like one Crate"
description: "Admin and Listen needed different workflows and the same UI foundations. Sharing components led to build fixes, behaviour contracts and one V3 identity."
date: 2026-11-10
series:
  id: how-to-forget-spotify
  title: "How to dismantle Spotify. Building Crate from the ground."
  part: 30
related: [taking-playback-over-from-navidrome, taking-crate-out-of-the-browser, a-desktop-app-has-a-life-outside-its-window]
tags: [How to dismantle Spotify, frontend, design systems, history]
sources:
  - app/shared/ui/package.json
  - app/shared/ui/domain/auth/OAuthButtons.tsx
  - app/shared/ui/lib/crate-identity.ts
  - app/shared/ui/lib/interface-preferences.ts
  - app/shared/ui/lib/crate-identity.test.ts
  - app/shared/ui/primitives/FormField.tsx
  - app/shared/ui/primitives/FormField.test.tsx
  - app/shared/ui/primitives/AppModal.test.tsx
  - app/shared/ui/export-usage-policy.test.ts
  - app/shared/ui/design-token-policy.test.ts
  - tools/crate-ui-showcase/README.md
  - docs/plans/2026-10-14-crate-v3-design-system.md
---

_Part 30. Shared UI foundations, April to October 2026._

Admin and Listen both needed to show an album, confirm a destructive action and explain why a form
could not be submitted. They did not need the same application. Admin coordinated library work;
Listen had a queue, a player and mobile navigation. Keeping those workflows separate made sense.
Maintaining separate implementations of their basic controls was harder to justify.

The equalizer gave us an early, concrete example. Listen exposed gain controls to a listener. Admin
needed to edit genre EQ presets. The controls used the same bands and represented the same decibel
values, but lived in different parts of the codebase. We tried to share their visual component. Our first extraction into `shared/web` ran into Tailwind class detection and
TypeScript resolution across the app boundaries. The ten-column utility was missing from generated
CSS. We briefly went back to local copies before putting the shared UI behind a workspace package.
[The shared-UI change and its build fixes](https://github.com/thecrateapp/crate/commit/bfbae59e05e5ec459b58eb7df0ea03a78f5c3b29).

That was the beginning of `@crate/ui`. It solved the immediate duplication problem, but a package
name did not settle how the apps should look, which behaviour belonged in a component, or what to do
with visual preferences already saved in someone's browser. Those questions became much more
explicit when we moved both apps to Crate V3.

## Make the shared import work in each application

The shared package exported its TypeScript and TSX source to workspace consumers. Admin and Listen
compiled that source with their own application builds. A separate publish configuration described
built JavaScript and declaration files. We could edit a shared component and see the change in both
apps without building and publishing a new package first.
[The original source exports](https://github.com/thecrateapp/crate/blob/bfbae59e05e5ec459b58eb7df0ea03a78f5c3b29/app/shared/ui/package.json).

The CSS pipeline still needed to find the classes inside those files. Tailwind scans source text to
decide which utilities to generate; resolving a JavaScript import does not, by itself, establish
that every external source will be scanned. Its explicit `@source` directive covers this case.
[Tailwind's source detection](https://tailwindcss.com/docs/detecting-classes-in-source-files).

Listen's stylesheet made both dependencies visible:

```css source="app/listen/src/index.css#L4-L6" commit="bfbae59e05e5ec459b58eb7df0ea03a78f5c3b29" "@source"
@import "@crate/ui/tokens/index.css";
@import "tailwindcss";
@source "../../shared/ui";
```

The token import supplied Crate's shared CSS variables. The source directive told Tailwind where
to find utility classes used by the shared components. Leaving either out could produce a
component that compiled but did not render correctly. Admin had the same shared source registration.
[Admin's stylesheet](https://github.com/thecrateapp/crate/blob/bfbae59e05e5ec459b58eb7df0ea03a78f5c3b29/app/ui/src/index.css).

We also kept React and the UI runtime libraries as peer dependencies. A workspace package was a
useful boundary for exports and build configuration; it did not need to bring a second independent
React runtime into each application.

The package contained several kinds of code: curated shadcn/Radix controls, small primitives,
compositions such as confirmation dialogs, and music-specific components such as genre pills and
playlist artwork. Reusing Radix let us build on its keyboard and focus behaviour for the controls
that used it. Radix still leaves meaningful labels and correct application composition to the
consumer. We had work to do above that layer.
[Radix accessibility responsibilities](https://www.radix-ui.com/primitives/docs/overview/accessibility).

### Share the control without importing the application

A shared login button is a useful test of the boundary. Admin can redirect the browser to an OAuth
provider. Listen may need to open the native browser, preserve an invitation or return to a selected
server. Putting either application's API client or navigation context inside the shared component
would make the other application inherit the wrong assumptions.

The first shared OAuth component accepted those operations as callbacks:

```typescript source="app/shared/ui/domain/auth/OAuthButtons.tsx#L30-L41" commit="bfbae59e05e5ec459b58eb7df0ea03a78f5c3b29" "onOAuthNavigate"
interface OAuthButtonsProps {
  /** Where to redirect after successful auth */
  returnTo?: string | null;
  /** Invite token to append to OAuth URL (listen registration flow) */
  inviteToken?: string;
  /** Fetcher for /api/auth/providers — injected so the shared component
   *  doesn't depend on any app-specific API client */
  fetchProviders: () => Promise<Record<string, ProviderConfig>>;
  /** Build the full OAuth redirect URL. Receives the provider's login_url
   *  and returnTo. The app handles platform-specific logic (Capacitor
   *  native browser, invite tokens, etc.) */
  onOAuthNavigate: (loginUrl: string, returnTo: string | null, inviteToken?: string) => void;
```

The component fetched provider availability through the injected function and rendered the
provider controls. Its caller supplied the actual navigation. Admin's wrapper built the return URL
and assigned `window.location.href`; Listen's wrapper retained its own platform handling. Sharing
the button did not require sharing the entire authentication flow.
[Admin adapter](https://github.com/thecrateapp/crate/blob/bfbae59e05e5ec459b58eb7df0ea03a78f5c3b29/app/ui/src/components/auth/OAuthButtons.tsx),
[Listen adapter](https://github.com/thecrateapp/crate/blob/bfbae59e05e5ec459b58eb7df0ea03a78f5c3b29/app/listen/src/components/auth/OAuthButtons.tsx).

The same division works for album artwork and playback controls. A shared component can own the
frame, fallback and accessible name while an app supplies its authenticated image renderer or
`onPlay` action. It should not need access to Listen's queue just to draw an album cover.
[Current media composition boundary](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/shared/ui/domain/media/MediaCover.tsx).

We did not move every reusable-looking component into the package. Our rule is to share a domain
component when both apps actually need it. The current
export test only checks part of that rule: the test detects exports unused by either app, with documented
exceptions for foundations and migration work. It does not establish that every export has two
consumers. Unused shared Ops and show components were eventually removed instead of keeping a
second implementation ready for a hypothetical caller.
[Export policy](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/shared/ui/export-usage-policy.test.ts),
[removing unused shared components](https://github.com/thecrateapp/crate/commit/2c90a6f21b8e12657dc191d44d51fd5651255e36).

![Admin and Listen each retain their workflows and adapters. Both compile the same shared controls and fixed identity tokens. Stories import the actual components, while behaviour and policy tests check the shared implementation and its consumers.](/blog/making-two-apps-look-and-behave-like-one-crate/shared-foundations.svg)

## An upgraded browser must behave like the new design too

The early shared system allowed app differences in presentation. The OAuth wrapper above even
supplied a different corner-radius class. Listen also grew appearance settings, including visual
modes and surface choices. Shared code made those variants possible; it did not make the result
consistent.

The V3 decision was to give Admin and Listen one fixed identity: the same foundational surfaces,
colour roles, typography and interaction rules. Application workflows could differ. A basic field
or popover should not change its visual language because it happened to live in Admin.
[The V3 design decisions](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/plans/2026-10-14-crate-v3-design-system.md).

That change could not be implemented by deleting a settings screen. Old preferences had already
written attributes and inline CSS variables onto the document. Inline overrides could continue
winning over the new stylesheet, leaving an upgraded browser with a mixture of identities.

The startup migration removed the inventoried visual attributes and overrides before applying V3:

```typescript source="app/shared/ui/lib/crate-identity.ts#L29-L40" commit="21873d24997ca53ca3218c891a8d70fae296cc78" "removeProperty"
export function applyCrateIdentity(
  root: HTMLElement = document.documentElement,
): void {
  for (const name of LEGACY_VISUAL_ATTRIBUTES) root.removeAttribute(name);
  for (const name of [
    ...Object.keys(CRATE_IDENTITY_VARIABLES),
    ...LEGACY_GLASS_VARIABLES,
  ])
    root.style.removeProperty(name);
  root.dataset.crateIdentity = "v3";
  root.style.colorScheme = "dark";
}
```

`CRATE_IDENTITY_VARIABLES` defines the fixed identity; generated token CSS supplies those values.
Removing the corresponding inline properties lets the stylesheet take over again. The explicit
legacy list handles glass-surface variables that no longer belong to the identity. This is a
bounded cleanup, not a blanket removal of every custom property on the document.
[Identity registry](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/shared/ui/lib/appearance-token-registry.ts).

The distinction matters for artwork colours and player progress, which also use CSS variables. The
identity tests seed both and verify that cleanup preserves them. They also check that applying the
migration twice leaves the same result.
[Identity migration tests](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/shared/ui/lib/crate-identity.test.ts).

Functional preferences survived separately. Density, reduced motion and effects remained useful
choices even after alternate visual skins were retired. The preferences migration writes the new
store before removing known legacy keys. If the destination write fails, it leaves the source
intact. It also avoids overwriting a payload from a future schema version. Changing the visual
system did not justify losing an accessibility preference when storage was unavailable.
[Preference migration](https://github.com/thecrateapp/crate/blob/21873d24997ca53ca3218c891a8d70fae296cc78/app/shared/ui/lib/interface-preferences.ts#L139-L165),
[migration failure tests](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/shared/ui/lib/interface-preferences.test.ts).

## Shared behaviour at the field and dialog

Matching colours and corners would not fix a label that named the wrong element or a dialog that
closed the wrong layer. Those behaviours had to become part of the shared contracts too.

`FormField` is a small example with consequences across both apps. It owns stable IDs for the
control, caption, hint and error. It associates descriptions with the actual input and marks an
error through `aria-invalid`. It can clone a simple child or pass those attributes to a composite
control through a render function:

```typescript source="app/shared/ui/primitives/FormField.tsx#L72-L83" commit="6b53412a6602c1d7fb34c1ef14498f8263b11243" "aria-describedby"
  const describedBy =
    [showHint ? hintId : null, showError ? errorId : null]
      .filter(Boolean)
      .join(" ") || undefined;

  const control: FormFieldControlProps = {
    id: controlId,
    ...(hasContent(label) ? { "aria-labelledby": labelId } : {}),
    ...(describedBy ? { "aria-describedby": describedBy } : {}),
    ...(showError ? { "aria-invalid": true as const } : {}),
    ...(required ? { "aria-required": true as const } : {}),
  };
```

When cloning a child, the implementation preserves its existing descriptions and invalid state.
A grouped control gets a group caption instead of a native label pointing at a non-labelable
container. The tests exercise label activation, changing hints and errors, existing IDs and
composite controls. The shared spacing recipe also owns the gap between a stacked caption and its
control, so callers do not each add a slightly different margin.
[FormField implementation and tests](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/shared/ui/primitives/FormField.test.tsx).

### The same field in two real consumers

These are the running Admin and Listen login pages, captured locally with the email field focused
by keyboard. Both import `FormField` and `Input` from `@crate/ui`; the surrounding form, notice and
registration route belong to the application. The label stays above the control and keyboard focus
uses the same accent ring in both.

![Admin login: the shared email field has keyboard focus, with the surrounding Admin invitation notice and sign-in form visible.](/blog/making-two-apps-look-and-behave-like-one-crate/admin-form-field-focus.png)

_Admin: the actual login form, with no credentials entered._

![Listen login: the same shared email field has keyboard focus, within Listen's authentication frame and registration route.](/blog/making-two-apps-look-and-behave-like-one-crate/listen-form-field-focus.png)

_Listen: the actual credentials form, at the same 1280 × 720 viewport._

The [Admin login](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/ui/src/pages/Login.tsx) and
[Listen credentials form](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen/src/components/auth/CredentialsForm.tsx)
use the same field without sharing their authentication flow. These captures exercise one focus
state in the current applications. Error descriptions and composite controls need the separate
component cases above, and each application still needs its own accessibility review.

### Dismissal and input modality

Modals exposed a different class of mismatch. With nested dialogs, only the top custom modal should
consume Escape, and closing one layer should not unlock document scrolling while another modal
still owns the lock. A pointer dismissal also produces a later click; letting that click reach the
newly exposed page can activate something the user never intended to press. Shared modal and
outside-dismiss tests cover those cases.
[Modal behaviour tests](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/shared/ui/primitives/AppModal.test.tsx),
[outside-dismiss tests](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/shared/ui/lib/use-dismissible-layer.test.ts).

We also had to distinguish touch-driven focus changes from keyboard navigation. Moving focus after
a tap should not create the same visual treatment as tabbing through controls, while a keyboard
attached to a touch device must still work. A shared input-modality helper now informs scripted
focus changes, with callers in dialogs, navigation and the player. The fix needed both the shared
helper and the application call sites; changing a global focus style alone would not cover them.
[Shared modality handling](https://github.com/thecrateapp/crate/commit/296e14692fce67e340e96b0cbcd67c0dd3ec98d9),
[Listen integration](https://github.com/thecrateapp/crate/commit/9d135bcb08fbc546840402074570b6ed2fabda50).

## A shared export still needs a real consumer

A polished example can conceal a broken shared component if the example supplies corrective CSS.
Then the catalogue looks right and the application does not. Our review setup explicitly forbids
that repair: stories and standalone review scenes import the actual components, and their styling
handles the scene layout rather than altering component internals.

The approved visual reference and the implementation catalogue have different jobs. The reference
records the intended design. The catalogue demonstrates the current component, its states and
known limits. Its registry tracks source files and the stories or documentation that explain them.
A source change must update the corresponding entry; the staged check reads the Git index so an
unstaged documentation fix cannot hide stale material in the proposed change.
[Showcase maintenance and review rules](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/tools/crate-ui-showcase/README.md).

Automated checks cover different parts of that work. Export checks catch abandoned shared modules.
Token checks constrain new arbitrary radii, stacking levels, typography and icon sizes. Component
tests check interactions. Storybook's accessibility checks can inspect rendered stories for known
DOM violations. None of them establishes that every page has adopted the component correctly, or
that a native screen reader and every supported WebView behave identically.
[Token policy](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/shared/ui/design-token-policy.test.ts),
[Storybook accessibility checks](https://storybook.js.org/docs/writing-tests/accessibility-testing).

The migration is therefore explicit about the difference between a documented component, an
adopted component and a validated consumer. Some local duplicates and compatibility adapters remain.
A green package test does not make those disappear. Each replacement still needs to preserve the
application's navigation, authentication and playback behaviour.
