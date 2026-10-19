import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { Bot, ArrowLeft, Play, CRATE_ICON_SIZE } from "@crate/ui/icons";
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
        values.
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
        Bricolage Grotesque · headings and numerals
      </p>
      <p className="text-base">Poppins · body and controls</p>
      <MonoLabel>JetBrains Mono · labels and metadata</MonoLabel>
      <p>
        Existing native exceptions are preserved. Each component contract
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
        px coarse-pointer minimums. Scene layout does not redefine components.
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
      <p>
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
        preferences. State never relies on motion or color alone. Rows do not
        brighten on hover; active state, selection and focus have separate
        roles.
      </p>
    </div>
  ),
};
