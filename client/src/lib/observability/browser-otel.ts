let initialized = false;

/** Optional browser trace export to the platform OTel collector (dev/staging). */
export function initBrowserOtel(): void {
  if (initialized || typeof window === 'undefined') return;
  if (process.env.NEXT_PUBLIC_OTEL_ENABLED !== 'true') return;

  const endpoint = process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!endpoint) return;

  void (async () => {
    try {
      const { WebTracerProvider } = await import('@opentelemetry/sdk-trace-web');
      const { BatchSpanProcessor } = await import('@opentelemetry/sdk-trace-base');
      const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
      const { registerInstrumentations } = await import('@opentelemetry/instrumentation');
      const { FetchInstrumentation } = await import('@opentelemetry/instrumentation-fetch');
      const { resourceFromAttributes } = await import('@opentelemetry/resources');
      const { ATTR_SERVICE_NAME } = await import('@opentelemetry/semantic-conventions');

      const serviceName =
        process.env.NEXT_PUBLIC_OTEL_SERVICE_NAME || 'aicser-client';

      const provider = new WebTracerProvider({
        resource: resourceFromAttributes({
          [ATTR_SERVICE_NAME]: serviceName,
        }),
        spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: endpoint }))],
      });

      provider.register();

      registerInstrumentations({
        instrumentations: [
          new FetchInstrumentation({
            propagateTraceHeaderCorsUrls: [
              process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
            ],
          }),
        ],
      });

      initialized = true;
    } catch (error) {
      console.debug('[otel] browser tracing unavailable', error);
    }
  })();
}
