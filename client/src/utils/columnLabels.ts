/**
 * Human-readable table column header from a result/schema key.
 * Industry-standard BI tables (Metabase, Looker, Tableau) show Title Case,
 * not raw snake_case — e.g. total_principal_amount → "Total Principal Amount".
 */
export function columnHeaderFromKey(key: string): string {
  if (!key) return key;

  // Already human-spaced (or multi-word) — keep as authored
  if (/\s/.test(key)) return key;

  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase / PascalCase
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // HTMLParser → HTML Parser
    .replace(/[_\-.]+/g, ' ')
    .trim();

  if (!spaced) return key;

  return spaced
    .split(/\s+/)
    .map((word) => {
      // Preserve short acronyms (ID, URL, KPI) when already all-caps
      if (/^[A-Z0-9]{2,5}$/.test(word) && /[A-Z]/.test(word) && /\d|[A-Z]{2}/.test(word)) {
        return word;
      }
      // Common id suffix
      if (/^id$/i.test(word)) return 'ID';
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}
