/**
 * Shared SSE line parser — used by chat analyze streams and dashboard build streams.
 */

export function parseSSEDataLine(line: string): unknown | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data: ')) return null;
  const jsonStr = trimmed.slice(6).trim();
  if (!jsonStr) return null;
  try {
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

export function splitSSEBuffer(buffer: string): { lines: string[]; remainder: string } {
  const parts = buffer.split('\n');
  const remainder = parts.pop() || '';
  return { lines: parts, remainder };
}

export function drainSSEBuffer(buffer: string, onEvent: (data: unknown) => void): string {
  const { lines, remainder } = splitSSEBuffer(buffer);
  for (const line of lines) {
    const data = parseSSEDataLine(line);
    if (data !== null) onEvent(data);
  }
  return remainder;
}
