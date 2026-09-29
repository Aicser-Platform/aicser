'use client';

import React, { useMemo, useState } from 'react';
import { App, Button, Card, Segmented, Space, Typography } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { getBackendUrl } from '@/utils/backendUrl';

const { Paragraph, Text } = Typography;

/**
 * "Embed for your customers": the server-side signing flow (Power BI embed tokens / Looker signed
 * embed / Metabase locked parameters). The host app's backend calls /api/embed/sign with an Aicser
 * API key and the customer's locked filters, then renders the returned URL in an iframe. Every
 * query made with that token is pinned to those filters on Aicser's side.
 */
export function EmbedDeveloperGuide() {
  const t = useTranslations('embed_guide');
  const { message } = App.useApp();
  const [lang, setLang] = useState<'curl' | 'node' | 'python'>('node');
  const [client, setClient] = useState<'react' | 'js' | 'iframe'>('react');
  const api = useMemo(() => {
    try {
      return getBackendUrl().replace(/\/$/, '');
    } catch {
      return 'https://your-aicser-server';
    }
  }, []);

  const body = `{"resource_id": "<DASHBOARD_ID>", "locked_filters": [{"field": "tenant_id", "value": "<CUSTOMER_ID>"}], "expires_in_minutes": 60, "allowed_domains": ["app.example.com"]}`;
  const snippets: Record<typeof lang, string> = {
    curl: `curl -X POST ${api}/api/embed/sign \\
  -H "Authorization: Bearer $AICSER_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${body}'`,
    node: `// npm install @aicser/embed — on your server: the API key must stay secret.
import { signEmbedUrl } from "@aicser/embed/server";

app.get("/analytics-token", async (req, res) => {
  const { token } = await signEmbedUrl({
    baseUrl: "${api}",
    apiKey: process.env.AICSER_API_KEY,
    dashboardId: "<DASHBOARD_ID>",
    lockedFilters: [{ field: "tenant_id", value: req.user.tenantId }],
    allowedDomains: ["app.example.com"],
  });
  res.json({ token });
});`,
    python: `# pip install aicser-embed — on your server: the API key must stay secret.
import os
from aicser_embed import sign_embed_url

embed = sign_embed_url(
    base_url="${api}",
    api_key=os.environ["AICSER_API_KEY"],
    dashboard_id="<DASHBOARD_ID>",
    locked_filters=[{"field": "tenant_id", "value": customer.id}],
    allowed_domains=["app.example.com"],
)
return {"token": embed.token}`,
  };
  const appUrl = typeof window !== 'undefined' ? window.location.origin : 'https://app.aicser.com';
  const clientSnippets: Record<typeof client, string> = {
    react: `import { AicserDashboard } from "@aicser/embed/react";

<AicserDashboard
  baseUrl="${appUrl}"
  dashboardId="<DASHBOARD_ID>"
  getToken={() => fetch("/analytics-token").then((r) => r.json()).then((d) => d.token)}
/>`,
    js: `import { embedDashboard } from "@aicser/embed";

const dashboard = embedDashboard(document.getElementById("analytics"), "<DASHBOARD_ID>", {
  baseUrl: "${appUrl}",
  getToken: () => fetch("/analytics-token").then((r) => r.json()).then((d) => d.token),
});
// dashboard.setFilters([...]), dashboard.refresh(), dashboard.exportImage("pdf")`,
    iframe: `<!-- The url from step 2 opens once: create a new one for every page view. -->
<iframe src="{url}" width="100%" height="720" style="border:0" allow="fullscreen"></iframe>`,
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success(t('copied'));
    } catch {
      message.info(t('copy_manually'));
    }
  };

  const code = (text: string) => (
    <div style={{ position: 'relative' }}>
      <pre
        style={{
          margin: 0,
          padding: '10px 12px',
          paddingRight: 40,
          background: 'var(--ant-color-fill-quaternary)',
          borderRadius: 6,
          fontSize: 12,
          overflowX: 'auto',
          whiteSpace: 'pre',
        }}
      >
        {text}
      </pre>
      <Button
        size="small"
        type="text"
        icon={<CopyOutlined />}
        aria-label={t('copy')}
        onClick={() => void copy(text)}
        style={{ position: 'absolute', top: 6, right: 6 }}
      />
    </div>
  );

  return (
    <Card size="small" title={t('title')}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Paragraph type="secondary" style={{ margin: 0 }}>
          {t('intro')}
        </Paragraph>
        <div>
          <Text strong>{t('step1')}</Text>
          <Paragraph type="secondary" style={{ margin: '2px 0 0' }}>{t('step1_desc')}</Paragraph>
        </div>
        <div>
          <Space style={{ justifyContent: 'space-between', width: '100%' }} wrap>
            <Text strong>{t('step2')}</Text>
            <Segmented
              size="small"
              value={lang}
              onChange={(v) => setLang(v as typeof lang)}
              options={[
                { value: 'node', label: 'Node.js' },
                { value: 'python', label: 'Python' },
                { value: 'curl', label: 'curl' },
              ]}
            />
          </Space>
          <Paragraph type="secondary" style={{ margin: '2px 0 6px' }}>{t('step2_desc')}</Paragraph>
          {code(snippets[lang])}
        </div>
        <div>
          <Space style={{ justifyContent: 'space-between', width: '100%' }} wrap>
            <Text strong>{t('step3')}</Text>
            <Segmented
              size="small"
              value={client}
              onChange={(v) => setClient(v as typeof client)}
              options={[
                { value: 'react', label: 'React' },
                { value: 'js', label: 'JavaScript' },
                { value: 'iframe', label: 'iframe' },
              ]}
            />
          </Space>
          <Paragraph type="secondary" style={{ margin: '2px 0 6px' }}>{t('step3_desc')}</Paragraph>
          {code(clientSnippets[client])}
        </div>
        <Paragraph type="secondary" style={{ margin: 0, fontSize: 12 }}>
          {t('security_note')}
        </Paragraph>
      </Space>
    </Card>
  );
}
