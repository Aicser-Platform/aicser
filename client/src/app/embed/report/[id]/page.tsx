'use client';

import React, { Suspense, useEffect, useMemo, useRef } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { notifyEmbedError, notifyEmbedReady, notifyEmbedResize } from '@/utils/embedMessaging';
import { useEmbedTheme } from '@/hooks/useEmbedTheme';
import { useReportEmbedState } from '@/ee/app/(dashboard)/report/hooks/useReportEmbedState';
import { ReportDocument, NarrativeContent, type ReportData } from '@/ee/app/(dashboard)/report/components/ReportDocument';
import { ReportBrandLogo } from '@/ee/app/(dashboard)/report/components/ReportBrandLogo';
import { resolveReportTemplateConfig } from '@/ee/app/(dashboard)/report/utils/reportTemplateCatalog';
import '@/ee/app/(dashboard)/chat/components/ChatPanel/ExecutiveReport.css';

/** `[id]` is `${conversationId}:${messageId}` - see _build_embed_urls on the
 * backend, which mints this exact shape (server/src/modules/embed/service.py). */
function splitReportResourceId(id: string): { conversationId: string; messageId: string } {
  const idx = id.indexOf(':');
  if (idx === -1) return { conversationId: id, messageId: '' };
  return { conversationId: id.slice(0, idx), messageId: id.slice(idx + 1) };
}

function useNotifyEmbedHost(report: ReportData | null, error: string | null) {
  useEffect(() => {
    if (error) notifyEmbedError(error, 'report_load_failed');
    else if (report) notifyEmbedReady({ kind: 'report' });
  }, [report, error]);
}

function EmbedReportContent({ conversationId, messageId }: { conversationId: string; messageId: string }) {
  const searchParams = useSearchParams();
  const token = searchParams?.get('token') || '';
  const { themeStyle, dataTheme } = useEmbedTheme(token);
  const isDark = dataTheme === 'dark';
  const { report, isLoading, error } = useReportEmbedState(conversationId, messageId, token);
  useNotifyEmbedHost(report, error);
  const templateConfig = useMemo(
    () => resolveReportTemplateConfig(report?.templateId, null, null),
    [report?.templateId],
  );

  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!rootRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect?.height;
      if (h) notifyEmbedResize(h);
    });
    ro.observe(rootRef.current);
    return () => ro.disconnect();
  }, []);

  if (isLoading) {
    return (
      <div style={themeStyle} data-theme={dataTheme} className="executive-report executive-report-fullpage">
        <div className="report-loading-screen">
          <div className="report-loading-content">Loading report…</div>
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div style={themeStyle} data-theme={dataTheme} className="executive-report executive-report-fullpage">
        <div className="report-loading-screen">
          <div className="report-loading-content">{error || 'Report not found'}</div>
        </div>
      </div>
    );
  }

  const genDate = report.generatedAt
    ? new Date(report.generatedAt).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : '';

  return (
    <div
      ref={rootRef}
      style={{ ...themeStyle, ...(templateConfig.vars as React.CSSProperties) }}
      data-theme={dataTheme}
      className="executive-report executive-report-fullpage"
    >
      <header className="report-header">
        <h1 className="report-title">{report.title}</h1>
        {(report.preparedFor || report.organizationName) && (
          <div className="report-meta" style={{ marginBottom: 4, opacity: 0.85 }}>
            {report.preparedFor && <span className="report-meta-item">Prepared for {report.preparedFor}</span>}
            {report.organizationName && (
              <span className="report-meta-item">
                {report.organizationLogoUrl && (
                  <ReportBrandLogo logoUrl={report.organizationLogoUrl} name={report.organizationName} size={16} />
                )}
                {report.organizationName}
              </span>
            )}
          </div>
        )}
        <div className="report-meta">
          {genDate && <span className="report-meta-item">{genDate}</span>}
          {report.dataSourceName && <span className="report-meta-item">{report.dataSourceName}</span>}
          <span className="report-tier-badge">{report.tierLabel || report.tier?.toUpperCase()}</span>
        </div>
      </header>

      {report.executiveSummary ? (
        <div className="report-executive-summary">
          <h2>Summary</h2>
          <NarrativeContent text={report.executiveSummary} />
        </div>
      ) : null}

      <ReportDocument
        report={report}
        isDark={isDark}
        conversationId={conversationId}
        interactive={false}
        template={templateConfig}
      />

      <footer className="report-footer">
        <span>Generated report</span>
        {genDate && (
          <>
            <span className="report-footer-sep">·</span>
            <span>{genDate}</span>
          </>
        )}
      </footer>
    </div>
  );
}

export default function EmbedReportPage() {
  const routeParams = useParams();
  const idParam = typeof routeParams?.id === 'string' ? routeParams.id : '';
  const { conversationId, messageId } = splitReportResourceId(decodeURIComponent(idParam));
  return (
    <Suspense fallback={<div className="executive-report executive-report-fullpage" />}>
      <EmbedReportContent conversationId={conversationId} messageId={messageId} />
    </Suspense>
  );
}
