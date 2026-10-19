import catalogue from "../catalogue.json";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { Unstyled } from "@storybook/addon-docs/blocks";
export function EntryDetails({ id }: { id: string }) {
  const entry = catalogue.entries.find((e) => e.id === id);
  if (!entry) return <p>Missing entry: {id}</p>;
  return (
    <section aria-label={`Entry: ${entry.name}`} className="showcase-stack">
      <Unstyled>
        <div className="showcase-line">
          <InfoBadge>
            {entry.coverage === "documented" ? "Documented" : "Pending"}
          </InfoBadge>
          <InfoBadge>Visual reference approved · 1AQ</InfoBadge>
          <InfoBadge>{entry.category}</InfoBadge>
        </div>
      </Unstyled>
      <p>{entry.purpose}</p>
      <p>
        Adoption: {entry.adoption}. Documentation does not certify every
        consumer.
      </p>
      <details>
        <summary>Source files ({entry.sources.length})</summary>
        <ul>
          {entry.sources.map((p) => (
            <li key={p}>
              <code className="showcase-code">{p}</code>
            </li>
          ))}
        </ul>
      </details>
      {entry.knownIssues.length ? (
        <div>
          <h3>Known issues</h3>
          <ul>
            {entry.knownIssues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
export function CatalogueTable() {
  const documented = catalogue.entries.filter(
    (e) => e.coverage === "documented",
  ).length;
  return (
    <div className="showcase-stack">
      <h2 className="showcase-heading">Crate UI inventory</h2>
      <p>
        {documented} documented entries ·{" "}
        {catalogue.entries.length - documented} pending. Coverage is tracked by
        family, not by rendered instance.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table className="showcase-table" aria-label="Component inventory">
          <caption>Entries linked to actual source, docs and stories.</caption>
          <thead>
            <tr>
              <th>Component / family</th>
              <th>Category</th>
              <th>Coverage</th>
              <th>Contract and examples</th>
            </tr>
          </thead>
          <tbody>
            {catalogue.entries.map((e) => (
              <tr key={e.id}>
                <td>{e.name}</td>
                <td>{e.category}</td>
                <td>
                  {e.coverage === "documented" ? "Documented" : "Pending"}
                </td>
                <td>
                  {e.coverage === "documented" ? (
                    <a href={`/?path=/docs/${e.storyId}--docs`} target="_top">
                      Open entry
                    </a>
                  ) : (
                    <span>Adoption and contract pending reconciliation</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
