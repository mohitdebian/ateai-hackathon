export interface DocumentSummary {
  title: string;
  chunks: number;
  created_at: string;
}

export function groupDocumentsByTitle(
  rows: { title: string; created_at: string }[],
): DocumentSummary[] {
  const byTitle = new Map<string, DocumentSummary>();
  for (const row of rows) {
    const existing = byTitle.get(row.title);
    if (existing) existing.chunks += 1;
    else byTitle.set(row.title, { title: row.title, chunks: 1, created_at: row.created_at });
  }
  return [...byTitle.values()];
}
