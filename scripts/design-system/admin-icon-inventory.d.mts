export interface IconEntry {
  id: string;
  path: string;
  line: number;
  column: number;
  kind: string;
  name: string;
  source?: string;
  origin?: string;
  component?: string;
  via?: string[];
  control: string;
  label: string;
  snippet: string;
}
export interface IconImport {
  local: string;
  imported: string;
  source: string;
  glyph: boolean;
}
export function analyzeSource(
  path: string,
  source: string,
): { imports: IconImport[]; entries: IconEntry[] };
export function buildInventory(root?: string): {
  entries: IconEntry[];
  totals: {
    filesScanned: number;
    filesWithEntries: number;
    filesWithGlyphImports: number;
    glyphBindings: number;
    counts: Record<string, number>;
  };
};
