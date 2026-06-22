/**
 * Edition-aware AI model list paths.
 * CE uses /api/nl2sql/models; EE chat may still use /api/ai/models.
 */

const IS_EE = ['enterprise', 'ee'].includes(
  (process.env.NEXT_PUBLIC_EDITION || '').toLowerCase(),
);

export function getAiModelsApiPath(): string {
  return IS_EE ? 'ai/models' : 'nl2sql/models';
}

export function getAiModelStatusApiPath(modelId: string): string {
  const encoded = encodeURIComponent(modelId);
  return IS_EE ? `ai/model-status?model_id=${encoded}` : `nl2sql/model-status?model_id=${encoded}`;
}

/** Query Editor NL2SQL — always CE module (AGPL). */
export const NL2SQL_GENERATE = '/api/nl2sql/generate';
export const NL2SQL_EXPLAIN = '/api/nl2sql/explain';
export const NL2SQL_OPTIMIZE = '/api/nl2sql/optimize';
export const NL2SQL_PATTERNS = '/api/nl2sql/patterns';
