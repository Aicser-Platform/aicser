/**
 * Wrap a ReadableStream so that abort/termination (client disconnect or backend closed)
 * does not throw "failed to pipe response" and cause 500. Next.js pipes the response
 * asynchronously; when the client aborts or the backend closes the socket we get
 * terminated / UND_ERR_SOCKET / "other side closed".
 */
export function pipeTolerantStream(
  backendBody: ReadableStream<Uint8Array>
): ReadableStream<Uint8Array> {
  const reader = backendBody.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        if (value) controller.enqueue(value);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const cause = e instanceof Error && (e as Error & { cause?: Error }).cause;
        const causeMsg = cause instanceof Error ? cause.message : String(cause ?? '');
        if (
          msg === 'terminated' ||
          msg.includes('abort') ||
          causeMsg.includes('closed') ||
          causeMsg.includes('UND_ERR_SOCKET')
        ) {
          controller.close();
          return;
        }
        throw e;
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });
}
