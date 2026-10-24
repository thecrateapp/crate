import type { Meta, StoryObj } from "@storybook/react-vite";
import { PlayerChromeRefinementsExample } from "../reviews/ArtistPlayerReview";
import { PlayerSourceLabelExample } from "../reviews/ActionLabelsReview";
import { PlayerMixExample } from "../reviews/PlayerMixReview";
import {
  PlayerTransportStory,
  PlayerPanelsStory,
} from "../reviews/PlayerReview";
import {
  DiscMotionExample,
  PlayerSurfaceModeExamples,
} from "../reviews/PlayerMotionReview";
const meta = {
  id: "listen-player",
  title: "Listen/Player",
  component: PlayerTransportStory,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "1AZ with 1BA amendments. These are actual Listen player pieces composed with @crate/ui; app-local playback, authentication and output authority stay in Listen. DiscMotion uses the production disc frame, play control and continuous compositor rotation hook with a local clock, buffering, coarse corrections and interface load. DisplayModes uses unboxed 44px ActionButton radios: accent selection, white alternatives, keyboard and renderer capability gates. SuggestedTab uses TrackList and actual TrackRow, retaining API identity, available source metadata, score and its radio playback callback. Enabled track rows regain fine-pointer hover; selected/current surfaces share the Hairline gradient. The 5186 mockup and approved changes remain the reference. Seek/head share one moving edge; compact fine-pointer dock uses a 24px seek row, full/coarse seek uses 44px. No synthetic audio data.",
      },
    },
  },
} satisfies Meta<typeof PlayerTransportStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Transport: Story = {};
export const PanelsQueueLyricsAndResume: Story = {
  render: () => <PlayerPanelsStory />,
};

export const DiscMotion: Story = { render: () => <DiscMotionExample /> };
export const ActualTransition: Story = {
  render: () => <PlayerMixExample />,
  parameters: {
    docs: {
      description: {
        story:
          "Actual native execution only: blue Crossfade, yellow Beatmatch with applied bass swap, neutral Gapless. The existing 1px disc ring and MonoLabel/StatusDot share one semantic color map. Pause and missing telemetry clear the ring. This isolated fixture uses production player pieces with simulated native state, without audio or network.",
      },
    },
  },
};
export const DisplayModes: Story = {
  render: () => <PlayerSurfaceModeExamples />,
};
export const ChromeRefinements: Story = {
  render: () => <PlayerChromeRefinementsExample />,
};
export const SourceLabel: Story = {
  render: () => <PlayerSourceLabelExample />,
  parameters: {
    docs: {
      description: {
        story:
          "The actual PlayerBarTrackCopy uses uppercase MonoLabel for Playing from; the source name keeps its original case and navigation. The desktop-only row retains its existing responsive visibility. Playback sessions persist the source alongside queue/cursor/shuffle and restore it without autoplay; legacy sessions without a saved source remain unknown.",
      },
    },
  },
};
