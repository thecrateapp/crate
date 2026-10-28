import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import {
  Bot,
  ArrowLeft,
  Play,
  Tag,
  GripVertical,
  ArrowDownToLineBold,
  CRATE_ICON_SIZE,
} from "@crate/ui/icons";
import { ActionButton, ActionGroup } from "@crate/ui/primitives/ActionGroup";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
function TokenTable({ tokens }: { tokens: string[] }) {
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const s = getComputedStyle(document.documentElement);
    setValues(
      Object.fromEntries(tokens.map((t) => [t, s.getPropertyValue(t).trim()])),
    );
  }, [tokens]);
  return (
    <table className="showcase-table">
      <caption>Computed CSS values from the loaded system</caption>
      <thead>
        <tr>
          <th>Token</th>
          <th>Actual value</th>
        </tr>
      </thead>
      <tbody>
        {tokens.map((t) => (
          <tr key={t}>
            <td>{t}</td>
            <td>{values[t] ?? "Loading"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
const colors = [
  "--surface-canvas",
  "--surface-container",
  "--surface-control",
  "--text-primary",
  "--text-secondary",
  "--text-subtle",
  "--accent-action",
  "--accent-action-hi",
  "--state-warning-text",
  "--border-quiet",
];
function ColorSamples() {
  return (
    <div className="showcase-stack">
      <h2 className="showcase-heading">Crate colors</h2>
      <p>
        One identity. Samples read the actual variables instead of copying hex
        values. The fullscreen player uses one continuous canvas; its
        transparent header shares the body surface.
      </p>
      <div className="showcase-line">
        {colors.map((token) => (
          <div className="showcase-swatch" key={token}>
            <span
              aria-hidden="true"
              style={{
                display: "block",
                height: 32,
                background: `var(${token})`,
                border: "1px solid var(--border-quiet)",
              }}
            />
            <code>{token}</code>
          </div>
        ))}
      </div>
      <TokenTable tokens={colors} />
    </div>
  );
}
const meta = {
  id: "system-foundations",
  title: "System/Foundations",
  component: ColorSamples,
  parameters: { controls: { disable: true } },
} satisfies Meta<typeof ColorSamples>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Colors: Story = {};
export const Typography: Story = {
  render: () => (
    <div className="showcase-stack">
      <h2 className="showcase-heading">Typography by role</h2>
      <p className="font-display text-4xl">
        Bricolage Grotesque · headings and display numerals
      </p>
      <p className="text-base">Roboto · body and controls</p>
      <MonoLabel>JetBrains Mono · labels and metadata</MonoLabel>
      <p className="font-mono font-normal tabular-nums">
        1,024 · technical count
      </p>
      <p className="font-mono text-meta font-normal">
        FLAC · 44.1 kHz · 16 bit
      </p>
      <p>
        The same packaged faces serve web and native. Each component contract
        defines weight, size and role.
      </p>
      <TokenTable
        tokens={[
          "--font-display-stack",
          "--font-brand",
          "--font-mono-stack",
          "--text-label",
          "--text-info-badge",
          "--text-filter-chip",
          "--type-meta-size",
          "--text-meta",
        ]}
      />
    </div>
  ),
};
export const Spacing: Story = {
  render: () => (
    <div className="showcase-stack">
      <h2 className="showcase-heading">Spacing, geometry and surfaces</h2>
      <p>
        Fields use an actual 8 px label gap through crate-form-field.
        Informative badges are 24 px high; filters use 32 px fine-pointer / 44
        px coarse-pointer minimums. Track rows reserve metadata columns even
        when values are missing; responsive visibility follows the row's actual
        container. Track selection shares the HairlineRow gradient; enabled
        track rows restore a fine-pointer hover wash. Scene layout does not
        redefine components.
      </p>
      <TokenTable
        tokens={[
          "--content-row-gap",
          "--content-row-padding-y",
          "--info-badge-height",
          "--info-badge-padding-x",
          "--radius-md",
          "--radius-lg",
        ]}
      />
    </div>
  ),
};
export const Layers: Story = {
  render: () => (
    <div className="showcase-stack">
      <h2 className="showcase-heading">Layers and accessibility</h2>
      <p>
        Use shared portals and layer tokens. Visual order does not replace
        focus, Escape dismissal or return to the trigger. Automated checks alone
        do not certify assistive technology or native runtimes.
      </p>
      <TokenTable
        tokens={[
          "--z-header",
          "--z-sidebar",
          "--z-modal",
          "--z-popover",
          "--z-dropdown",
          "--z-context-menu",
        ]}
      />
    </div>
  ),
};
export const Icons: Story = {
  render: () => (
    <div className="showcase-stack">
      <h2 className="showcase-heading">Solar icons</h2>
      <div className="showcase-line">
        <Bot aria-hidden="true" size={CRATE_ICON_SIZE.lg} />
        <ArrowLeft aria-hidden="true" size={CRATE_ICON_SIZE.lg} />
        <Play aria-hidden="true" size={CRATE_ICON_SIZE.lg} />
      </div>
      <ActionGroup label="Catalogue action glyphs">
        <ActionButton label="Mark as facet">
          <Tag aria-hidden="true" />
        </ActionButton>
        <ActionButton label="Reorder items">
          <GripVertical aria-hidden="true" />
        </ActionButton>
        <ActionButton label="Download available files">
          <ArrowDownToLineBold aria-hidden="true" />
        </ActionButton>
      </ActionGroup>
      <p>
        Tag, GripVertical and ArrowDownToLineBold expose the actual Solar
        aliases used for taxonomy, reorder and available-download actions.
        Import from @crate/ui/icons. Decorative glyphs are aria-hidden; controls
        retain accessible names. Use conventional action and UX glyphs, with
        recorded domain exceptions.
      </p>
    </div>
  ),
};
export const Motion: Story = {
  render: () => (
    <div className="showcase-stack">
      <h2 className="showcase-heading">Motion and effects</h2>
      <p>
        Respect prefers-reduced-motion, visibility and existing functional
        preferences. State never relies on motion or color alone. Enabled track
        rows retain the approved fine-pointer accent wash; other row families
        keep foreground-only feedback. Active state, selection and focus have
        separate roles. Indeterminate ProgressHairline moves only while visible
        and motion is allowed; Meter and determinate progress use a fixed
        one-pixel rail.
      </p>
    </div>
  ),
};

export const Links: Story = {
  render: () => (
    <div className="showcase-stack">
      <h2 className="showcase-heading">Link feedback</h2>
      <p>
        Links use foreground color and keyboard focus, without animated beams or
        generated hover underlines.
      </p>
      <div className="showcase-line">
        <a className="link-meta" href="#link-feedback-target">
          Metadata link
        </a>
        <a className="link-accent" href="#link-feedback-target">
          Accent link
        </a>
        <div className="w-48 truncate">
          <a className="link-meta link-inset" href="#link-feedback-target">
            Inset focus link inside clipped text
          </a>
        </div>
      </div>
      <p id="link-feedback-target">
        Native link navigation and accessible names remain intact.
      </p>
    </div>
  ),
};
