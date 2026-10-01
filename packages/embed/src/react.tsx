import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { CSSProperties } from 'react';
import {
  embedChart,
  embedChat,
  embedDashboard,
  embedReport,
  type EmbedFilter,
  type EmbedHandle,
  type EmbedOptions,
} from './index.js';

type SharedProps = Omit<EmbedOptions, 'style' | 'className' | 'filters' | 'pageId'> & {
  className?: string;
  /** Styles for the wrapping element; the iframe fills it. */
  style?: CSSProperties;
  /** Initial height before the embed reports its own (default 600px). */
  height?: number | string;
};

type Mount = (container: HTMLElement, options: EmbedOptions) => EmbedHandle;

function useEmbed(
  mount: Mount,
  props: SharedProps & { filters?: EmbedFilter[]; pageId?: string },
  remountKey: string,
  ref: React.ForwardedRef<EmbedHandle | null>,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<EmbedHandle | null>(null);
  // Latest callbacks without remounting the iframe when a parent re-renders.
  const propsRef = useRef(props);
  propsRef.current = props;

  useImperativeHandle(ref, () => handleRef.current as EmbedHandle, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const p = propsRef.current;
    const handle = mount(containerRef.current, {
      baseUrl: p.baseUrl,
      token: p.token,
      getToken: p.getToken ? () => propsRef.current.getToken!() : undefined,
      pageId: p.pageId,
      filters: p.filters,
      autoResize: p.autoResize,
      targetOrigin: p.targetOrigin,
      observability: p.observability,
      style: { height: typeof p.height === 'number' ? `${p.height}px` : p.height || '600px' },
      onReady: (m) => propsRef.current.onReady?.(m),
      onResize: (h, w) => propsRef.current.onResize?.(h, w),
      onFilterChange: (f) => propsRef.current.onFilterChange?.(f),
      onError: (m, c) => propsRef.current.onError?.(m, c),
      onTokenExpired: () => propsRef.current.onTokenExpired?.(),
    });
    handleRef.current = handle;
    return () => {
      handle.destroy();
      handleRef.current = null;
    };
    // A new resource or base URL is a new embed; tokens renew in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remountKey]);

  // Filters and page are controlled: changing the prop updates the embed without a reload.
  const filtersKey = JSON.stringify(props.filters ?? null);
  const firstFilters = useRef(true);
  useEffect(() => {
    if (firstFilters.current) {
      firstFilters.current = false;
      return;
    }
    void handleRef.current?.setFilters(props.filters ?? []).catch((e) => props.onError?.(String(e?.message || e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey]);

  const firstPage = useRef(true);
  useEffect(() => {
    if (firstPage.current) {
      firstPage.current = false;
      return;
    }
    if (props.pageId) {
      void handleRef.current?.setPage(props.pageId).catch((e) => props.onError?.(String(e?.message || e)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.pageId]);

  return containerRef;
}

export type AicserDashboardProps = SharedProps & {
  dashboardId: string;
  filters?: EmbedFilter[];
  pageId?: string;
};

/** A dashboard. `ref` gives the handle: refresh(), exportImage(), setFilters(), … */
export const AicserDashboard = forwardRef<EmbedHandle | null, AicserDashboardProps>(function AicserDashboard(
  props,
  ref,
) {
  const containerRef = useEmbed(
    (el, o) => embedDashboard(el, props.dashboardId, o),
    props,
    `${props.baseUrl}|dashboard|${props.dashboardId}`,
    ref,
  );
  return <div ref={containerRef} className={props.className} style={props.style} />;
});

export type AicserChartProps = SharedProps & { chartId: string };

export const AicserChart = forwardRef<EmbedHandle | null, AicserChartProps>(function AicserChart(props, ref) {
  const containerRef = useEmbed(
    (el, o) => embedChart(el, props.chartId, o),
    props,
    `${props.baseUrl}|chart|${props.chartId}`,
    ref,
  );
  return <div ref={containerRef} className={props.className} style={props.style} />;
});

export type AicserChatProps = SharedProps;

/** The AI assistant (Enterprise Edition). */
export const AicserChat = forwardRef<EmbedHandle | null, AicserChatProps>(function AicserChat(props, ref) {
  const containerRef = useEmbed((el, o) => embedChat(el, o), props, `${props.baseUrl}|chat`, ref);
  return <div ref={containerRef} className={props.className} style={props.style} />;
});

export type AicserReportProps = SharedProps & {
  /** `${conversationId}:${messageId}` — same id Settings → Embed and signEmbedUrl use. */
  reportId: string;
};

/** A read-only executive report (Enterprise Edition). */
export const AicserReport = forwardRef<EmbedHandle | null, AicserReportProps>(function AicserReport(
  props,
  ref,
) {
  const containerRef = useEmbed(
    (el, o) => embedReport(el, props.reportId, o),
    props,
    `${props.baseUrl}|report|${props.reportId}`,
    ref,
  );
  return <div ref={containerRef} className={props.className} style={props.style} />;
});

export type { EmbedFilter, EmbedHandle, EmbedOptions };
