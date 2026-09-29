import '@/app/globals.css';

/**
 * A report shown inside the chat's side panel: the report itself, without the app's header,
 * sidebar or mobile navigation (the panel around it belongs to the app already).
 */
export default function ReportViewLayout({ children }: { children: React.ReactNode }) {
  return <div style={{ minHeight: '100vh', background: 'var(--ant-color-bg-layout)' }}>{children}</div>;
}
