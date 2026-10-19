import { readFile } from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';
import { isMessageLocale } from '@/config/localeMessages';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ locale: string }> },
) {
  const { locale } = await context.params;
  const code = (locale || '').trim().toLowerCase().replace(/\.json$/i, '');
  if (!isMessageLocale(code)) {
    return NextResponse.json({ error: 'Unknown locale' }, { status: 404 });
  }

  const filePath = path.join(process.cwd(), 'src', 'messages', `${code}.json`);
  try {
    const raw = await readFile(filePath, 'utf8');
    if (!raw.trim()) {
      return NextResponse.json({ error: 'Locale file is empty' }, { status: 500 });
    }
    JSON.parse(raw);
    return new NextResponse(raw, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'read failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
