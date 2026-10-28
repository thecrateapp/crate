import { StatNumber } from "@crate/ui/primitives/StatNumber";
export function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <StatNumber
      as="div"
      size="sm"
      value={value}
      label={label}
      labelPosition="above"
    />
  );
}
