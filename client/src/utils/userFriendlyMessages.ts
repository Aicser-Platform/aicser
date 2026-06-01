/**
 * Utility to convert technical backend messages to user-friendly messages
 */

export function makeMessageUserFriendly(message: string): string {
  if (!message) return 'Processing your request...';

  // Convert technical terms to user-friendly language
  const replacements: Array<[RegExp, string]> = [
    // Technical process names - make them conversational
    [/nl2sql/gi, 'query preparation'],
    [/via LLM/gi, ''],
    [/Chart and insights generated via LLM/gi, 'Chart and insights ready'],
    [/generated via LLM/gi, 'created'],
    [/SQL generation/gi, 'Preparing your data request'],
    [/SQL validated/gi, 'Request verified'],
    [/SQL execution/gi, 'Getting your data'],
    [/query execution/gi, 'Getting your data'],
    [/query executed/gi, 'Data ready'],
    [/results validated/gi, 'Results checked'],
    [/generate_chart/gi, 'Drawing chart'],
    [/generate_insights/gi, 'Finding insights'],
    [/unified_chart_insights/gi, 'Creating visuals'],
    [/route_query/gi, 'Understanding your question'],
    [/sql_validated/gi, 'Request verified'],
    [/execute_query/gi, 'Getting data'],
    [/Executing SQL query/gi, 'Getting your data'],
    [/validate_results/gi, 'Checking results'],
    [/SQL query/gi, 'query'],
    [/\bSQL\b/g, 'query'],
    [/\bDB\b/g, 'database'],
    [/\bLLM\b/g, 'AI'],
    [/\bworkflow\b/gi, 'process'],
    [/\bnode\b/gi, 'step'],

    // Error messages - make them friendlier
    [/rate limit|rate_limit|429/gi, 'Request limit reached — please wait a moment and try again'],
    [/timeout|timed out|deadline exceeded/gi, 'The request took too long — try again or a simpler question'],
    [/ClickHouse HTTP query failed/gi, 'Could not get data'],
    [/Syntax error/gi, 'Request format issue'],
    [/DB::Exception/gi, 'Data error'],
    [/SYNTAX_ERROR/gi, 'Format error'],
    [/Unmatched parentheses/gi, 'Request formatting issue'],
    [/failed at position/gi, 'issue at position'],
    [/Query execution failed/gi, 'Could not get data'],
    [/NameError/gi, 'Configuration issue'],
    [/is not defined/gi, 'setup issue'],
    [/Workflow failed/gi, 'Something went wrong'],
    [/Node error/gi, 'Step error'],
    [/No SQL query to validate/gi, 'Waiting for a query to validate'],
    [/No query to validate/gi, 'Waiting for a query to validate'],

    // Progress messages - more conversational
    [/Initializing workflow/gi, 'Getting started'],
    [/Starting workflow/gi, 'Getting started'],
    [/Processing\.\.\./gi, 'Working on it'],
    [/Completed/gi, 'Done'],
  ];

  let friendlyMessage = message;

  // Apply replacements
  for (const [pattern, replacement] of replacements) {
    friendlyMessage = friendlyMessage.replace(pattern, replacement);
  }

  // Clean up extra horizontal spaces but PRESERVE newlines (critical for markdown formatting)
  friendlyMessage = friendlyMessage
    .replace(/[^\S\n]+/g, ' ')           // Collapse only horizontal whitespace (spaces/tabs), keep \n
    .replace(/\n{3,}/g, '\n\n')          // Limit consecutive blank lines to max 2
    .replace(/[ \t]*:[ \t]*/g, ': ')     // Normalize spacing around colons (horizontal only)
    .trim();

  // Capitalize first letter
  if (friendlyMessage.length > 0) {
    friendlyMessage = friendlyMessage.charAt(0).toUpperCase() + friendlyMessage.slice(1);
  }

  return friendlyMessage || 'Processing your request...';
}

export function makeProgressMessageUserFriendly(
  stage: string,
  message?: string
): string {
  const stageMessages: Record<string, string> = {
    'start': 'Getting started...',
    'initializing': 'Getting ready...',
    'route_query': 'Reading your question...',
    'nl2sql': 'Preparing your query...',
    'nl2sql_complete': 'Query ready!',
    'validate_sql': 'Double-checking...',
    'sql_validated': 'All good!',
    'execute_query': 'Fetching your data...',
    'query_executed': 'Data retrieved!',
    'validate_results': 'Reviewing results...',
    'results_validated': 'Results look great!',
    'generate_chart': 'Drawing your chart...',
    'generate_insights': 'Finding key insights...',
    'unified_chart_insights': 'Creating visuals and insights...',
    'deep_file_analysis': 'Analyzing in detail...',
    'deep_analysis_profiling': 'Understanding your data structure...',
    'deep_analysis_planning': 'Planning the best approach...',
    'deep_analysis_execution': 'Running analysis...',
    'deep_analysis_synthesis': 'Putting it all together...',
    'deep_analysis_complete': 'All done!',
    'dashboard_schema_analysis': 'Analyzing your data schema…',
    'dashboard_llm_planning': 'Designing dashboard layout…',
    'dashboard_create_shell': 'Creating dashboard…',
    'dashboard_create_widgets': 'Building widgets…',
    'dashboard_prefetch_data': 'Loading chart data…',
    'dashboard_generation_complete': 'Dashboard ready!',
    'report_planning': 'Planning report sections…',
    'report_execution': 'Building report sections…',
    'rag_retrieval': 'Searching your documents…',
    'complete': 'Complete!',
  };

  // If message is provided and not a duplicate of stage message, use it
  if (message && message.trim()) {
    const friendlyMessage = makeMessageUserFriendly(message);
    // Avoid duplicate: if message is same as stage message, use stage message only
    const stageMessage = stageMessages[stage] || 'Working on it...';
    if (friendlyMessage.toLowerCase() === stageMessage.toLowerCase()) {
      return stageMessage;
    }
    return friendlyMessage;
  }

  return stageMessages[stage] || 'Working on it...';
}

/** Get actionable guidance based on error code; optional analyticsType for mode-specific suggestions */
export function getErrorGuidance(
  errorCode: string | null | undefined,
  query?: string,
  analyticsType?: string | null
): { message: string; suggestions: string[] } {
  const errorGuidance: Record<string, { message: string; suggestions: string[] }> = {
    'SQL_EMPTY': {
      message: "I couldn't generate a query from your question.",
      suggestions: [
        'Try being more specific, e.g., "Show total sales by month"',
        'Include a metric (count, sum, average) and a dimension (by region, by date)',
        'Check that your data source is connected'
      ]
    },
    'QUERY_EMPTY': {
      message: "The query ran but returned no results.",
      suggestions: [
        'Try broadening your filters or date range',
        'Check if the data exists for the criteria you specified',
        'Ask "What data is available?" to explore'
      ]
    },
    'LLM_TIMEOUT': {
      message: "The AI took too long to respond.",
      suggestions: [
        'Try a simpler question first',
        'Break complex questions into smaller parts',
        'Try again in a moment'
      ]
    },
    'LLM_PARSE_FAILURE': {
      message: "I had trouble processing the AI response.",
      suggestions: [
        'Your data is still available below',
        'Try asking a follow-up question for more details',
        'The visualization may be limited'
      ]
    },
    'LLM_API_ERROR': {
      message: "The AI service encountered an issue.",
      suggestions: [
        'Your analysis is still available using rule-based methods',
        'Try again for more detailed insights',
        'Check the visualization below'
      ]
    },
    'ANALYSIS_FAILED': {
      message: "I couldn't complete the full analysis.",
      suggestions: [
        'Rephrase your question with clearer intent',
        'Specify what metric you want to see',
        'Try: "Show me [metric] by [dimension]"'
      ]
    },
    'PARTIAL_SUCCESS': {
      message: "Analysis completed with some limitations.",
      suggestions: [
        'The main results are available below',
        'Ask a follow-up question for more details',
        'Check the insights section'
      ]
    },
    'RECOVERED_WITH_FALLBACK': {
      message: "I completed the analysis using an alternative approach.",
      suggestions: [
        'Your results are ready below',
        'Ask follow-up questions for more insight',
        'The visualization is generated from your data'
      ]
    },
    'CONNECTION_ERROR': {
      message: "Could not connect to your data source.",
      suggestions: [
        'Check your data source connection settings',
        'Verify the database is accessible',
        'Try reconnecting the data source'
      ]
    },
    'CRITICAL_FAILURE': {
      message: "I encountered an issue processing your request.",
      suggestions: [
        'Try rephrasing your question',
        'Check your data source connection',
        'Contact support if this persists'
      ]
    },
    'UNIFIED_NODE_CRITICAL': {
      message: "Analysis encountered an unexpected issue.",
      suggestions: [
        'Your data may still be available',
        'Try a simpler question first',
        'Contact support if this continues'
      ]
    },
    'PREP_PHASE_FAILURE': {
      message: "I couldn't prepare the analysis.",
      suggestions: [
        'Check that your data source is connected',
        'Try asking about specific data you want to see',
        'Refresh and try again'
      ]
    },
    'rate_limit_exceeded': {
      message: "Request limit reached — please wait a moment before trying again.",
      suggestions: [
        'Wait about a minute and try again',
        'If you need many analyses, run them one at a time'
      ]
    },
    'TIMEOUT': {
      message: "The request took too long to complete.",
      suggestions: [
        'Try a simpler or more specific question',
        'Try again in a moment',
        'Check your connection'
      ]
    },
    'llm_timeout': {
      message: "The AI took too long to respond.",
      suggestions: [
        'Try a simpler question first',
        'Break complex questions into smaller parts',
        'Try again in a moment'
      ]
    },
    'connection_timeout': {
      message: "The connection took too long.",
      suggestions: [
        'Check your network and try again',
        'Try again in a moment'
      ]
    }
  };

  let guidance = errorGuidance[errorCode || ''] || {
    message: "I ran into an unexpected issue — but your data is safe.",
    suggestions: ['Try rephrasing your question', 'Check your data source connection', 'Try a simpler question first']
  };

  // Mode-specific hints only for analysis/query-related failures (not connection, timeout, etc.)
  const analysisRelatedCodes = ['PREDICTIVE_INSUFFICIENT_DATA', 'ANALYSIS_FAILED', 'QUERY_EMPTY', 'SQL_EMPTY', ''];
  const isAnalysisRelated = !errorCode || analysisRelatedCodes.includes(errorCode || '');
  const mode = (analyticsType || '').toLowerCase();
  if (isAnalysisRelated && mode === 'predictive') {
    guidance = {
      message: guidance.message,
      suggestions: [
        'Try a question with a clear time dimension (e.g. daily or monthly)',
        'Include at least several periods of history for forecasting',
        'Ask for a metric that has enough historical data'
      ]
    };
  } else if (isAnalysisRelated && mode === 'diagnostic') {
    guidance = {
      message: guidance.message,
      suggestions: [
        'Ensure your data has categorical breakdown columns (region, product, etc.)',
        'Ask "why did [metric] change?" with a clear metric and time range',
        'Include a dimension to compare (e.g. by segment or period)'
      ]
    };
  } else if (isAnalysisRelated && mode === 'prescriptive') {
    guidance = {
      message: guidance.message,
      suggestions: [
        'Specify a metric to optimize (e.g. revenue, cost) and a lever (e.g. by channel)',
        'Ask "how can I improve [metric]?" with clear objectives',
        'Include at least one dimension you can adjust (budget, allocation)'
      ]
    };
  }

  return guidance;
}

/** 
 * Generate adaptive AI response message based on execution metadata 
 * Hides technical details while showing contextual, user-friendly responses
 */
export function generateAdaptiveAIMessage(
  executionMetadata: Record<string, any> | null | undefined,
  query: string,
  hasChart: boolean,
  hasInsights: boolean,
  hasResults: boolean,
  hasSql: boolean
): { message: string; showNotice: boolean; noticeType: 'info' | 'warning' | 'success' } {
  const errorCode = executionMetadata?.error_code;
  const generationMethod = executionMetadata?.generation_method;
  const executiveSummary = executionMetadata?.executive_summary;
  const execStatus = executionMetadata?.status;
  const warnings = executionMetadata?.warnings;
  const zeroRowWarning =
    Array.isArray(warnings) &&
    warnings.some((w: unknown) => typeof w === 'string' && /0\s+rows/i.test(w));

  // Start with executive summary if available
  let message = executiveSummary ? String(executiveSummary).trim() : '';
  let showNotice = false;
  let noticeType: 'info' | 'warning' | 'success' = 'info';

  // Empty result sets: surface clearly instead of generic "Process complete"
  if (
    !message &&
    !errorCode &&
    (execStatus === 'degraded_zero_rows' || zeroRowWarning)
  ) {
    message =
      'The query ran successfully but returned no matching rows for that question (empty result). Try widening the date range or relaxing filters, or ask what tables and columns are available.';
    return { message, showNotice: true, noticeType: 'warning' };
  }

  // Check for success conditions first
  if (!errorCode && generationMethod !== 'rule_based_fallback' && generationMethod !== 'critical_fallback') {
    // Full LLM success - use the message as-is (prefer executive summary)
    if (!message) {
      // Build a dynamic summary based on what was produced
      const parts: string[] = [];
      if (hasChart) parts.push('a visualization');
      if (hasInsights) parts.push('key insights');
      if (hasResults && !hasChart && !hasInsights) parts.push('the data');
      if (parts.length > 0) {
        message = `Here's ${parts.join(' and ')} for your question.`;
      } else if (hasSql) {
        message =
          'I generated a query from your question — review the SQL and outcome below. If results look wrong, rephrase the question or check dates and filters.';
      } else {
        message = `Process complete — take a look.`;
      }
    }
    noticeType = 'success';
    return { message, showNotice: false, noticeType };
  }

  // Handle partial success and recovery scenarios
  if (errorCode === 'PARTIAL_SUCCESS' || errorCode === 'RECOVERED_WITH_FALLBACK') {
    if (!message) {
      if (hasChart || hasInsights || hasResults) {
        const parts: string[] = [];
        if (hasChart) parts.push('visualization');
        if (hasInsights) parts.push('insights');
        if (hasResults && !hasChart && !hasInsights) parts.push('data');
        message = `Here's what I found — your ${parts.join(' and ')} ${parts.length === 1 ? 'is' : 'are'} ready below.`;
      } else {
        message = `I completed the analysis, though some parts were limited. Try refining your question for richer results.`;
      }
    }
    showNotice = !hasChart && !hasInsights && !hasResults;
    noticeType = hasChart || hasInsights || hasResults ? 'info' : 'warning';
    return { message, showNotice, noticeType };
  }

  // Handle rule-based fallback (LLM failed but we have content)
  if (generationMethod === 'rule_based_fallback' || generationMethod === 'llm_lite_fallback') {
    if (!message) {
      if (hasChart || hasInsights || hasResults) {
        const parts: string[] = [];
        if (hasChart) parts.push('chart');
        if (hasInsights) parts.push('insights');
        if (hasResults && !hasChart && !hasInsights) parts.push('query results');
        message = `Your ${parts.join(' and ')} ${parts.length === 1 ? 'is' : 'are'} ready — take a look below.`;
      } else {
        message = `Analysis complete. Try adding more detail to your question for richer visualizations and insights.`;
      }
    }
    showNotice = false;
    noticeType = 'info';
    return { message, showNotice, noticeType };
  }

  // Handle critical failures
  if (generationMethod === 'critical_fallback' || errorCode === 'CRITICAL_FAILURE' || errorCode === 'UNIFIED_NODE_CRITICAL') {
    const guidance = getErrorGuidance(errorCode, query);
    if (!message) {
      message = guidance.message;
      // Add context about what is available
      if (hasResults || hasSql) {
        message += ' However, I was able to retrieve some data for you.';
      }
    }
    showNotice = true;
    noticeType = 'warning';
    return { message, showNotice, noticeType };
  }

  // Handle specific error codes
  if (errorCode) {
    const guidance = getErrorGuidance(errorCode, query);
    if (!message) {
      // Full content (chart + insights or results): show success, not "minor hurdle"
      const hasFullContent = hasChart && (hasInsights || hasResults);
      if (hasFullContent) {
        message = `Here are your results — explore the chart and findings below.`;
      } else if (hasChart || hasInsights || hasResults) {
        message = `Your results are ready below — some optional steps were skipped.`;
      } else {
        message = guidance.message;
      }
    }
    showNotice = !hasChart && !hasInsights && !hasResults;  // Only show notice if no content
    noticeType = (hasChart || hasInsights || hasResults) ? 'info' : 'warning';
    return { message, showNotice, noticeType };
  }

  // Default case - no error, no specific generation method
  if (!message) {
    if (hasChart || hasInsights || hasResults) {
      message = `Here are your results — scroll down to explore.`;
    } else {
      message = `Analysis complete. Ask a follow-up question to dig deeper.`;
    }
  }

  return { message, showNotice: false, noticeType: 'success' };
}

export function makeErrorMessageUserFriendly(error: string, context?: {
  stage?: string;
  query?: string;
  errorCode?: string;
}): string {
  if (!error) return 'Something went wrong — try again, or rephrase your question.';

  // If we have an error code, provide actionable guidance
  if (context?.errorCode) {
    const guidance = getErrorGuidance(context.errorCode, context.query);
    return `${guidance.message} ${guidance.suggestions[0] || ''}`;
  }

  // Handle JSON error responses
  let errorMessage = error;
  try {
    // Try to parse if it's a JSON string
    if (error.startsWith('{') || error.includes('"error"') || error.includes('"message"')) {
      const parsed = typeof error === 'string' ? JSON.parse(error) : error;
      if (parsed.error || parsed.message) {
        errorMessage = parsed.message || parsed.error || error;

        // Handle validation errors specifically
        if (parsed.error === 'validation_error' && parsed.details && Array.isArray(parsed.details)) {
          const validationIssues = parsed.details.map((d: any) => {
            if (d.loc && Array.isArray(d.loc)) {
              const field = d.loc[d.loc.length - 1];
              return `${field}: ${d.msg || 'Invalid value'}`;
            }
            return d.msg || 'Invalid input';
          }).join(', ');
          return `Please check your input: ${validationIssues}. Please try again with valid information.`;
        }
      }
    }
  } catch (e) {
    // Not JSON, use as-is
  }

  // Handle HTTP error format: "Backend error: 422 - {...}"
  if (errorMessage.includes('Backend error:')) {
    const match = errorMessage.match(/Backend error:\s*\d+\s*-\s*(.+)/);
    if (match && match[1]) {
      try {
        const parsed = JSON.parse(match[1]);
        if (parsed.error === 'validation_error' && parsed.details) {
          const validationIssues = parsed.details.map((d: any) => {
            if (d.loc && Array.isArray(d.loc)) {
              const field = d.loc[d.loc.length - 1];
              return `${field}: ${d.msg || 'Invalid value'}`;
            }
            return d.msg || 'Invalid input';
          }).join(', ');
          return `Please check your input: ${validationIssues}. Please try again with valid information.`;
        }
        if (parsed.message) {
          errorMessage = parsed.message;
        }
      } catch (e) {
        // Continue with original error
      }
    }
  }

  // Extract user-friendly error message
  let friendlyError = makeMessageUserFriendly(errorMessage);

  // Add context if available
  if (context?.stage) {
    const stageName = makeProgressMessageUserFriendly(context.stage);
    friendlyError = `Error during ${stageName.toLowerCase()}: ${friendlyError}`;
  }

  // Remove technical details that users don't need
  friendlyError = friendlyError
    .replace(/File ".*?"/g, '')
    .replace(/line \d+/gi, '')
    .replace(/\(version.*?\)/gi, '')
    .replace(/\(official build\)/gi, '')
    .replace(/Backend error:\s*\d+\s*-\s*/gi, '')
    .replace(/validation_error/gi, 'Input validation')
    .replace(/string_type/gi, 'text field')
    .replace(/Input should be a valid string/gi, 'Please provide valid text')
    .replace(/url.*?pydantic/gi, '')
    .trim();

  // Ensure it's a complete sentence
  if (!friendlyError.endsWith('.') && !friendlyError.endsWith('!') && !friendlyError.endsWith('?')) {
    friendlyError += '.';
  }

  return friendlyError || 'Something went wrong on my end — try again, or rephrase your question.';
}

/** Resolve SQL from a message. Canonical: sql_query/sqlQuery or execution_metadata.sql_query. Fallback: extract from ```sql blocks in content (legacy). */
export function getResolvedSql(msg: any): string {
  if (!msg) return '';
  const looksTruncated = (s: string): boolean => {
    const t = (s || '').trim();
    if (!t) return true;
    const u = t.toUpperCase();
    if (u.includes('SELECT') && !u.includes('FROM')) return true;
    if ((t.match(/\(/g) || []).length !== (t.match(/\)/g) || []).length) return true;
    if ((t.match(/'/g) || []).length % 2 !== 0 || (t.match(/"/g) || []).length % 2 !== 0) return true;
    if (/[,(=+\-/*]\s*$/.test(t)) return true;
    if (/\bdate_trunc\s*\(\s*'[^']+'\s*\)/i.test(t)) return true;
    if (/\bdate_trunc\s*\(\s*'[^']+'\s*,\s*\)/i.test(t)) return true;
    return false;
  };
  const meta = getExecutionMetadata(msg);
  const sql =
    msg.sqlQuery ??
    msg.sql_query ??
    meta?.sql_query ??
    msg.partial_results?.sql_query ??
    '';
  const trimmed = typeof sql === 'string' ? sql.trim() : (sql != null ? String(sql).trim() : '');
  if (trimmed && !looksTruncated(trimmed)) return trimmed;
  // Fallback: extract from message content when backend stored SQL in text (e.g. history or legacy)
  const contentSources = [msg.answer, msg.content, msg.message, msg.narration, msg.analysis].filter(Boolean) as string[];
  for (const content of contentSources) {
    if (typeof content === 'string' && content.includes('```sql')) {
      const match = content.match(/```sql\s*([\s\S]*?)```/i);
      if (match?.[1]) {
        const candidate = match[1].trim();
        if (candidate && !looksTruncated(candidate)) return candidate;
      }
    }
  }
  return '';
}

/** Resolve execution metadata from a message. Canonical: execution_metadata/executionMetadata. */
export function getExecutionMetadata(msg: any): Record<string, any> | null {
  if (!msg) return null;
  const meta =
    msg.executionMetadata ??
    msg.execution_metadata ??
    msg.partial_results?.execution_metadata ??
    msg.ai_metadata?.execution_metadata ??
    null;
  return meta && typeof meta === 'object' ? meta : null;
}

const INSIGHT_TITLE_GENERIC = /^Insight\s+\d+$/i;
const REC_TITLE_GENERIC = /^Recommendation\s+\d+$/i;
/** Hardcoded non-answer titles to replace with a neutral summary label */
const INSIGHT_TITLE_HARDCODED = /^(Data\s+Analysis\s+Complete|Analysis\s+Complete)$/i;

/** Fallback only: derive display label from description when backend sent generic title (e.g. "Insight 1"). */
function deriveShortTitle(text: string, maxLen: number = 56): string {
  if (!text || typeof text !== 'string') return '';
  const t = text.trim();
  if (!t) return '';
  const firstSentence = t.match(new RegExp(`^[^.!?\\n]{1,${maxLen + 10}}[.!?]?`));
  if (firstSentence) {
    const s = firstSentence[0].trim().replace(/[.!?]+$/, '').trim();
    if (s.length <= maxLen + 5) return s || t.slice(0, maxLen).trim();
  }
  return t.length <= maxLen ? t : t.slice(0, maxLen).trim() + '…';
}

/** True when two text blocks say the same thing (avoid duplicate narrative + insight blocks). */
export function narrativesAreDuplicate(main: string, secondary: string): boolean {
  const x = (main || '').replace(/\s+/g, ' ').trim();
  const y = (secondary || '').replace(/\s+/g, ' ').trim();
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length >= 60 && y.length >= 60 && (x.includes(y) || y.includes(x))) return true;
  return false;
}

function tryParseLooseObject(input: string): Record<string, unknown> | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('{') && !trimmed.includes("'type'") && !trimmed.includes('"type"')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    try {
      const jsonish = trimmed
        .replace(/'/g, '"')
        .replace(/\bNone\b/g, 'null')
        .replace(/\bTrue\b/g, 'true')
        .replace(/\bFalse\b/g, 'false');
      const parsed = JSON.parse(jsonish);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
}

/** Normalize backend insight payloads (stringified dicts, snake_case, generic titles). */
export function normalizeInsightInput(insight: unknown): Record<string, unknown> {
  if (insight == null) return {};
  if (typeof insight === 'string') {
    const parsed = tryParseLooseObject(insight);
    if (parsed) return normalizeInsightInput(parsed);
    return { title: insight };
  }
  if (typeof insight !== 'object' || Array.isArray(insight)) {
    return { title: String(insight) };
  }
  const o = { ...(insight as Record<string, unknown>) };
  for (const key of ['title', 'description', 'content', 'text', 'message'] as const) {
    const val = o[key];
    if (typeof val === 'string') {
      const parsed = tryParseLooseObject(val);
      if (parsed) return { ...o, ...parsed };
    }
  }
  return o;
}

const INSIGHT_TITLE_ITEM = /^Item\s+\d+$/i;

/** Format query table cells for human-readable numbers (avoid float noise). */
export function formatTableCellValue(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return String(value);
    if (Number.isInteger(value)) return value.toLocaleString();
    const abs = Math.abs(value);
    if (abs >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (abs >= 1) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
    return value.toLocaleString(undefined, { maximumSignificantDigits: 4 });
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export type ChartConfidenceLevel = 'high' | 'medium' | 'low';

export function chartConfidenceLevel(overall: number): ChartConfidenceLevel {
  if (overall >= 0.8) return 'high';
  if (overall >= 0.5) return 'medium';
  return 'low';
}

/** Insight: use LLM title + WHAT/SO WHAT/NOW WHAT structure; fallback to description. */
export function makeInsightFriendly(insight: string | { title?: string; description?: string; what?: string; so_what?: string; now_what?: string; business_value?: string; confidence?: number }): { title: string; description: string | null; what: string | null; soWhat: string | null; nowWhat: string | null; businessValue: string | null; confidencePct: number | null } {
  const normalized = normalizeInsightInput(insight);
  const rawTitle = String(normalized.title || normalized.what || normalized.description || '').trim();
  const desc = normalized.description ? String(normalized.description).trim() : '';
  const what = normalized.what ? String(normalized.what).trim() : null;
  const soWhat = normalized.so_what ? String(normalized.so_what).trim() : null;
  const nowWhat = normalized.now_what ? String(normalized.now_what).trim() : null;
  const businessValue = normalized.business_value ? String(normalized.business_value).trim() : null;
  const confidence = normalized.confidence != null ? normalized.confidence : null;
  const confidencePctRaw = normalized.confidence_pct != null ? normalized.confidence_pct : null;
  const confidencePct =
    confidence != null && typeof confidence === 'number'
      ? Math.min(100, Math.max(0, Math.round(confidence * 100)))
      : confidencePctRaw != null && typeof confidencePctRaw === 'number'
        ? Math.min(100, Math.max(0, Math.round(Number(confidencePctRaw))))
        : null;

  // Build description: prefer structured what/so_what/now_what, fallback to flat description
  let description: string | null = null;
  if (what || soWhat || nowWhat) {
    const parts: string[] = [];
    if (what) parts.push(what);
    if (soWhat) parts.push(soWhat);
    if (nowWhat) parts.push(nowWhat);
    description = parts.join('. ') + '.';
  } else if (desc) {
    description = desc;
  }

  let title = rawTitle || 'Key finding';
  if ((INSIGHT_TITLE_GENERIC.test(title) || INSIGHT_TITLE_ITEM.test(title)) && (what || desc)) {
    title = deriveShortTitle(what || desc) || title;
  }
  if (INSIGHT_TITLE_HARDCODED.test(title)) {
    title = (what || desc) ? deriveShortTitle(what || desc) || 'Results summary' : 'Results summary';
  }
  if (title.startsWith('{') || title.includes("'type'")) {
    title = deriveShortTitle(what || soWhat || nowWhat || desc) || 'Key finding';
  }
  return {
    title,
    description: description?.trim() || null,
    what,
    soWhat,
    nowWhat,
    businessValue,
    confidencePct
  };
}

/** Sort insights for display: highest confidence first; missing confidence last. */
export function sortInsightsByConfidence<T extends Record<string, unknown>>(insights: T[]): T[] {
  const score = (x: T): number => {
    if (typeof x !== 'object' || x == null) return -1;
    const o = x as { confidence?: number; confidence_pct?: number };
    if (o.confidence_pct != null && typeof o.confidence_pct === 'number') return o.confidence_pct;
    if (o.confidence != null && typeof o.confidence === 'number') {
      return o.confidence <= 1 ? o.confidence * 100 : o.confidence;
    }
    return -1;
  };
  return [...insights].sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    if (sa < 0 && sb < 0) return 0;
    if (sa < 0) return 1;
    if (sb < 0) return -1;
    return sb - sa;
  });
}

/**
 * Chart "Explain" modal: one primary narrative, avoid repeating methodology already embedded in prose.
 */
export function buildChartExplanationModalContent(args: {
  narration?: string | null;
  analysis?: string | null;
  message?: string | null;
  firstInsight?: string | { title?: string; description?: string; what?: string; so_what?: string; now_what?: string } | null;
  methodology?: string | null;
  sqlPreview?: string | null;
  stagesCompleted?: string[] | null;
}): {
  primaryText: string;
  showMethodology: boolean;
  methodology?: string;
  sqlPreview?: string;
  stagesCompleted?: string[];
} {
  const { firstInsight } = args;
  let insightText = '';
  if (firstInsight) {
    if (typeof firstInsight === 'string') {
      insightText = firstInsight.trim();
    } else {
      const f = makeInsightFriendly(firstInsight);
      insightText =
        [f.what, f.soWhat, f.nowWhat].filter(Boolean).join(' ').trim() ||
        f.description ||
        f.title ||
        '';
    }
  }
  const candidates = [
    args.narration?.trim(),
    args.analysis?.trim(),
    insightText,
    args.message?.trim(),
  ].filter((s): s is string => !!s && s.length > 0);

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const c of candidates) {
    const key = c.replace(/\s+/g, ' ').slice(0, 220).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(c);
  }
  const primaryText = unique[0] || '';

  const meth = args.methodology?.trim();
  let showMethodology = false;
  if (meth) {
    if (!primaryText) {
      showMethodology = true;
    } else if (meth.length >= 20) {
      const snippet = meth.slice(0, Math.min(100, meth.length)).toLowerCase();
      showMethodology = !primaryText.toLowerCase().includes(snippet);
    }
  }

  return {
    primaryText:
      primaryText ||
      (args.sqlPreview
        ? 'This chart reflects the results of your query. Use the SQL preview below for the exact retrieval logic.'
        : 'This chart visualizes the results of your query against the connected data source.'),
    showMethodology,
    methodology: meth || undefined,
    sqlPreview: args.sqlPreview || undefined,
    stagesCompleted: args.stagesCompleted?.length ? args.stagesCompleted : undefined,
  };
}

export function normalizeRecommendationInput(rec: unknown): Record<string, unknown> {
  if (rec == null) return {};
  if (typeof rec === 'string') {
    const parsed = tryParseLooseObject(rec);
    if (parsed) return normalizeRecommendationInput(parsed);
    return { title: rec };
  }
  if (typeof rec !== 'object' || Array.isArray(rec)) {
    return { title: String(rec) };
  }
  const o = { ...(rec as Record<string, unknown>) };
  for (const key of ['title', 'description', 'content', 'text', 'message'] as const) {
    const val = o[key];
    if (typeof val === 'string') {
      const parsed = tryParseLooseObject(val);
      if (parsed) return { ...o, ...parsed };
    }
  }
  return o;
}

const REC_TITLE_ITEM = /^Item\s+\d+$/i;

/** Recommendation: use LLM title + action/rationale/business_value; fallback from description. */
export function makeRecommendationFriendly(rec: string | { title?: string; description?: string; action?: string; rationale?: string; business_value?: string; effort?: string; priority?: string }): { title: string; description: string | null; action: string | null; rationale: string | null; businessValue: string | null; effort: string | null; priority: string | null } {
  const normalized = normalizeRecommendationInput(rec);
  const rawTitle = String(normalized.title || normalized.action || normalized.description || '').trim();
  const desc = normalized.description ? String(normalized.description).trim() : '';
  const action = normalized.action ? String(normalized.action).trim() : null;
  const rationale = normalized.rationale ? String(normalized.rationale).trim() : null;
  const businessValue = normalized.business_value ? String(normalized.business_value).trim() : null;
  const effort = normalized.effort ? String(normalized.effort).trim() : null;
  const priority = normalized.priority ? String(normalized.priority).toLowerCase() : null;
  const normalizedPriority =
    priority === 'high' || priority === 'medium' || priority === 'low' ? priority : priority || null;

  // Build description: prefer action + rationale, fallback to flat description
  let description: string | null = null;
  if (action || rationale) {
    const parts: string[] = [];
    if (action) parts.push(action);
    if (rationale) parts.push(rationale);
    description = parts.join('. ') + '.';
  } else if (desc) {
    description = desc;
  }

  let title = rawTitle || 'Recommendation';
  if ((REC_TITLE_GENERIC.test(title) || REC_TITLE_ITEM.test(title)) && (action || desc)) {
    title = deriveShortTitle(action || desc) || title;
  }
  if (title.startsWith('{') || title.includes("'type'")) {
    title = deriveShortTitle(action || rationale || desc) || 'Recommendation';
  }
  return {
    title,
    description: description?.trim() || null,
    action,
    rationale,
    businessValue,
    effort,
    priority: normalizedPriority
  };
}

/** Sort recommendations: high priority first, then medium, then low. */
export function sortRecommendationsByPriority<T extends Record<string, unknown>>(recs: T[]): T[] {
  const rank = (x: T): number => {
    const p = String((x as { priority?: string }).priority || '').toLowerCase();
    if (p === 'high') return 0;
    if (p === 'medium') return 1;
    if (p === 'low') return 2;
    return 3;
  };
  return [...recs].sort((a, b) => rank(a) - rank(b));
}

/** Make executive summary / narration more conversational and fix common LLM formatting issues. */
export function makeExecutiveSummaryFriendly(text: string): string {
  if (!text || typeof text !== 'string') return '';
  let t = text.trim();
  // Fix number+unit concatenation: "15.3millionpermonth" -> "15.3 million per month"
  t = t.replace(/(\d+(?:\.\d+)?)(million)/gi, '$1 $2');
  t = t.replace(/(\d+(?:\.\d+)?)(billion|thousand)/gi, '$1 $2');
  t = t.replace(/(\d+(?:\.\d+)?)(percent)/gi, '$1 $2');
  t = t.replace(/(\d+(?:\.\d+)?)(per\s*month|per\s*year|per\s*period)/gi, (_, n, w) => `${n} ${w.replace(/\s+/g, ' ')}`);
  t = t.replace(/permonth/gi, 'per month').replace(/peryear/gi, 'per year').replace(/perperiod/gi, 'per period');
  // Fix word concatenation: "forecastaccuracyislow" -> "forecast accuracy is low"
  t = t.replace(/forecastaccuracy/gi, 'forecast accuracy');
  t = t.replace(/accuracyislow/gi, 'accuracy is low').replace(/accuracyishigh/gi, 'accuracy is high');
  t = t.replace(/forecastconfidence/gi, 'forecast confidence');
  // Fix acronym+number: "MAPE38.54" -> "MAPE 38.54%"
  t = t.replace(/\bMAPE(\d+(?:\.\d+)?)/g, (_, num) => `MAPE ${num}%`);
  t = t.replace(/\bMAPE\s+(\d+(?:\.\d+)?)(?!%)/g, 'MAPE $1%');
  // Fix malformed MAPE from formatting bug: "MAPE 1%3%.3%" -> "MAPE 13.3%"
  t = t.replace(/\bMAPE\s+(\d)%(\d)%\.(\d)%/g, (_, a, b, c) => `MAPE ${a}${b}.${c}%`);
  t = t.replace(/\bMAPE\s+(\d)%(\d)%\.(\d)(\d)%/g, (_, a, b, c, d) => `MAPE ${a}${b}.${c}${d}%`);
  // Soften overly formal openings
  t = t.replace(/^In summary,?\s*/i, 'In short, ');
  t = t.replace(/^To summarize,?\s*/i, 'In short, ');
  t = t.replace(/^The (data|analysis|results?) (show|indicate|suggest)s?\s*/i, 'What we see: ');
  t = t.replace(/\b(metrics?|query|SQL|dataset)\b/gi, (m) => (m.toLowerCase() === 'sql' ? 'the query' : m.toLowerCase().startsWith('metric') ? 'the numbers' : m));
  return t;
}