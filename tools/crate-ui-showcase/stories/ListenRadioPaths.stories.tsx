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
          "Actual Listen-local Radio/Page/Seed/Station views, Paths builder/endpoint/detail header and ordered cover journey. Existing controllers own 300 ms search, real IDs, radio start, path create/save, regenerate/delete and managed artwork. The approved coverflow follows actual track changes; manual inspection does not play. No automatic tour or sound-map projection. Native cover/keyboard controls inspect or play actual steps. At most 7 covers mount; no RAF/progress subscription; motion freezes when hidden/reduced. Full track rows remain the accessible alternative. Shared primitives own typography, 8 px captions, solid surfaces and 44 px actions. Fixture actions are local: no API/audio/preference writes. Full H3 maps remain pending.",
      },
    },
  },
} satisfies Meta<typeof RadioPathsReview>;
export default meta;
export const Complete: StoryObj<typeof meta> = {};
