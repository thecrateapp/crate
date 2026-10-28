import type { Meta, StoryObj } from "@storybook/react-vite";
import { RadioPathsReview } from "../reviews/RadioPathsReview";
const meta = {
  id: "listen-radio-paths",
  title: "Listen/Radio and Paths",
  component: RadioPathsReview,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Actual Listen-local Radio/Page/Seed/Station views, Paths builder/endpoint/detail header and ordered cover journey. Existing controllers own 300 ms search, real IDs, radio start, path create/save, regenerate/delete and managed artwork. The approved pixelate-blur cover stage follows actual track changes or explicit play; keyboard inspection only moves focus through the 48 px step strip. No automatic tour or sound-map projection. The lazy WebGL2 renderer animates only during a transition, with a bounded bitmap cache and authenticated artwork loader. Unsupported WebGL or missing textures uses HTML/CSS fallback; hidden/reduced motion swaps instantly. No player-progress subscription. Full track rows remain the accessible alternative, preserving per-track source quality, BPM/key and duration through the common adapter. Saved Paths read current metadata without rebuilding the route. Acoustic-distance debug readouts are omitted. Shared primitives own typography, 8 px captions, solid surfaces and 44 px actions. Fixture actions are local: no API/audio/preference writes. Full H3 maps remain pending.",
      },
    },
  },
} satisfies Meta<typeof RadioPathsReview>;
export default meta;
export const Complete: StoryObj<typeof meta> = {};
