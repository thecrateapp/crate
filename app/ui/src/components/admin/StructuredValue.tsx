import { humanizeKey } from "@/lib/humanize";

type Primitive = string | number | boolean | null | undefined;

function isPrimitive(value: unknown): value is Primitive {
  return (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function primitiveText(value: Primitive): string {
  if (value === null || value === undefined) return "Empty";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return `${value}`;
}

/**
 * Renders arbitrary plan payload data (targets, changes, impact) as readable
 * prose instead of raw JSON. Never calls JSON.stringify or String() on an
 * object or array; those branches always recurse into StructuredValue.
 */
export function StructuredValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <>Empty</>;
  if (typeof value === "boolean") return <>{value ? "Yes" : "No"}</>;
  if (typeof value === "string" || typeof value === "number")
    return <span className="whitespace-pre-wrap break-words">{value}</span>;

  if (Array.isArray(value)) {
    if (value.every(isPrimitive)) {
      if (value.length === 0) return <>None</>;
      return (
        <span className="whitespace-pre-wrap break-words">
          {value.map(primitiveText).join(", ")}
        </span>
      );
    }
    return (
      <ol className="list-inside list-decimal space-y-1">
        {value.map((item, index) => (
          <li key={index}>
            <StructuredValue value={item} />
          </li>
        ))}
      </ol>
    );
  }

  if (typeof value === "object") {
    return (
      <dl className="space-y-1">
        {Object.entries(value).map(([key, entryValue]) => (
          <div key={key}>
            <dt className="text-xs text-muted-foreground">
              {humanizeKey(key)}
            </dt>
            <dd>
              <StructuredValue value={entryValue} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  return null;
}
