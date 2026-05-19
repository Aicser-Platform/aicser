/**
 * Deep-merge locale message JSON with English defaults so missing or partial
 * namespaces (e.g. alerts_page, header.activity_inbox) never show raw next-intl keys.
 *
 * Rules: plain objects merge recursively; leaves (strings, numbers, arrays) from
 * the locale file override English. Keys only in English are kept; keys only in
 * locale are kept.
 */

function isPlainMessageObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function mergeMessagesWithEnglishFallback(
  english: Record<string, unknown>,
  locale: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...english };

  for (const key of Object.keys(locale)) {
    const enVal = english[key];
    const locVal = locale[key];

    if (isPlainMessageObject(enVal) && isPlainMessageObject(locVal)) {
      result[key] = mergeMessagesWithEnglishFallback(enVal, locVal);
    } else {
      result[key] = locVal;
    }
  }

  return result;
}
