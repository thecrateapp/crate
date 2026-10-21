import type { Meta, StoryObj } from "@storybook/react-vite";
import { FontPairingReview } from "../reviews/FontPairingReview";
const meta = {
  id: "reviews-1be-font-pairings",
  title: "Reviews/1BE/Typography pairings",
  component: FontPairingReview,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Review-only font comparison using actual PageHeader, SectionHeader, EntityCard, EntityRow, TrackRow views, StatNumber and form/action primitives. Two rounds: Tektur/Golos, Chakra/Plex, Oxanium/Hanken and Unbounded/Onest, alongside previous Bricolage/Poppins, Hubot/Mona, Saira and Anybody/Spline. New alternatives are review-only; the app uses the approved Bricolage/IBM Plex pairing. JetBrains Mono, component geometry, weights and tracking stay unchanged. Candidate WOFF2 latin/latin-ext files are self-hosted alongside their OFL notices and provenance; CSS aliases and variables are limited to the sample container. Bricolage Grotesque (display) and IBM Plex Sans (body) are the approved shared production faces; the previous pairing and other candidates stay scoped to this comparison. Local fixture actions and shared editable text keep comparisons consistent.",
      },
    },
  },
} satisfies Meta<typeof FontPairingReview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Complete: Story = { args: { initialPairing: "all" } };
export const NewAlternatives: Story = { args: { initialPairing: "new" } };
export const TekturGolos: Story = { args: { initialPairing: "tektur-golos" } };
export const ChakraPlex: Story = { args: { initialPairing: "chakra-plex" } };
export const OxaniumHanken: Story = {
  args: { initialPairing: "oxanium-hanken" },
};
export const UnboundedOnest: Story = {
  args: { initialPairing: "unbounded-onest" },
};
export const BricolagePlex: Story = {
  args: { initialPairing: "bricolage-plex" },
};
export const Current: Story = { args: { initialPairing: "current" } };
export const HubotMona: Story = { args: { initialPairing: "hubot-mona" } };
export const Saira: Story = { args: { initialPairing: "saira" } };
export const AnybodySpline: Story = {
  args: { initialPairing: "anybody-spline" },
};
