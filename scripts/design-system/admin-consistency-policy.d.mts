export interface AdoptionDebt {
  path: string;
  owner: string;
  phase: string;
  reason: string;
  tokens: Record<string, number>;
}
export interface ConsistencyIssue {
  path: string;
  line: number;
  rule: string;
  detail: string;
}
export function analyzeAdminConsistency(
  path: string,
  source: string,
  debt?: AdoptionDebt[],
): ConsistencyIssue[];
export function buildAdminConsistencyInventory(root?: string): {
  filesScanned: number;
  violations: ConsistencyIssue[];
  pending: AdoptionDebt[];
};
