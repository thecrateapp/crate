import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingsReview } from "../reviews/SettingsReview";
const meta = {
  id: "listen-settings",
  title: "Listen/Settings",
  component: SettingsReview,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Actual Listen settings compositions: InstrumentPanel Section, canonical SelectRow/ToggleRow/RangeRow, interface/language/playback views, profile/password/linked accounts and Connect devices. Timezone is automatically detected by the app shell and has no Settings control. MonoLabel accent tone distinguishes section captions; ordinary field labels retain subtle. Motion/effects/density share one row when the container fits, with two/single-column fallbacks. FormField owns uppercase MonoLabel captions and 8 px gaps; shared controls own typography, geometry, native disabled and focus behavior. Scalar values use stable-width Select. Production adapters retain persistence, OAuth ownership, native capability gates, read retry and confirmed revoke. SettingsPageView composes five URL-backed canonical Tabs: Preferences (interface/language/show location), Playback (player/sleep timer), Account (profile/access/quick links), Connections (Connect/external services/native servers) and Offline. Panels remain mounted but hidden to preserve drafts and in-flight operations. The selected tab stays visible when selecting or resizing the horizontally scrolling mobile strip. Inactive panels close transient menus/confirmations while retaining drafts and in-flight controllers. Account separates Profile, Listening preferences, Connected accounts and Security; Email is the first readonly Input, fields use responsive columns, and provider rows use existing brand glyphs, StatusDot and nearby borderless actions. The fixture uses the same grouping and actual OfflineSettingsView with local callbacks; pending location/external integrations/quick-link controls are explicitly annotated rather than replicated. Fixture actions only change local state; no preference, credential, audio or API writes. Offline, servers, location, external credentials, scrobbling and Bandcamp retain their current behavior for later 1BD cuts. Full H3 device instruments and native certification remain outside this cut.",
      },
    },
  },
} satisfies Meta<typeof SettingsReview>;
export default meta;
export const Complete: StoryObj<typeof meta> = {};

export const Account: StoryObj<typeof meta> = {
  args: { initialTab: "account" },
};
