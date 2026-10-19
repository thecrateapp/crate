import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
const config: StorybookConfig = {
  framework: "@storybook/react-vite",
  stories: ["../docs/**/*.mdx", "../stories/**/*.stories.tsx"],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y"],
  core: { disableTelemetry: true },
  features: { sidebarOnboardingChecklist: false },
  staticDirs: [{ from: "../../../app/shared/fonts", to: "/crate-fonts" }],
  managerHead: (head) => `${head}
    <link rel="stylesheet" href="./crate-fonts/poppins.css">
    <link rel="stylesheet" href="./crate-fonts/jetbrains-mono.css">
    <link rel="stylesheet" href="./crate-fonts/bricolage-grotesque.css">`,
  async viteFinal(config) {
    config.plugins = [...(config.plugins ?? []), tailwindcss()];
    // Storybook already supplies all story/annotation entries; release cold-start deps
    // without waiting on the virtual preview import crawl (Vite8 middleware mode).
    config.optimizeDeps = { ...config.optimizeDeps, holdUntilCrawlEnd: false };
    config.server = {
      ...config.server,
      fs: { allow: [fileURLToPath(new URL("../../..", import.meta.url))] },
    };
    return config;
  },
};
export default config;
