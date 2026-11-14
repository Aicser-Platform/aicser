import { NextRequest } from 'next/server';

// Fixed so a newer manifest replaces the add-in instead of adding a second one.
const ADDIN_ID = '7f3c2a61-5a2e-4d0b-9c1e-a1c5e0ff1ce1';

/** The Excel add-in manifest, pointing at whichever address this app is served from. */
export function GET(request: NextRequest) {
  // Behind the proxy nextUrl.origin is the container's own address; use the one the browser asked for.
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(':', '');
  const base = (process.env.NEXT_PUBLIC_APP_URL || (host ? `${proto}://${host}` : request.nextUrl.origin)).replace(/\/$/, '');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="TaskPaneApp">
  <Id>${ADDIN_ID}</Id>
  <Version>1.0.0.0</Version>
  <ProviderName>Aicser</ProviderName>
  <DefaultLocale>en-US</DefaultLocale>
  <DisplayName DefaultValue="Aicser"/>
  <Description DefaultValue="Ask your company's data in plain words and put the answer in the sheet."/>
  <IconUrl DefaultValue="${base}/icons/icon-192.png"/>
  <HighResolutionIconUrl DefaultValue="${base}/icons/icon-512.png"/>
  <SupportUrl DefaultValue="${base}/"/>
  <AppDomains><AppDomain>${base}</AppDomain></AppDomains>
  <Hosts><Host Name="Workbook"/></Hosts>
  <DefaultSettings><SourceLocation DefaultValue="${base}/office/excel"/></DefaultSettings>
  <Permissions>ReadWriteDocument</Permissions>
</OfficeApp>
`;
  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': 'attachment; filename="aicser-excel-manifest.xml"' },
  });
}
