export type SheetVisualEmbed = {
  id: string;
  kind: 'chart' | 'image';
  sheet_index: number;
  row: number;
  column: number;
  width: number;
  height: number;
  payload: Record<string, unknown>;
};

export function newVisualEmbedId(): string {
  return `ve-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
