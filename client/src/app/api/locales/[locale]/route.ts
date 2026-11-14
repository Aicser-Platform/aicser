import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import path from 'path';
import { gzipSync } from 'zlib';
import { NextResponse } from 'next/server';
import { isMessageLocale } from '@/config/localeMessages';

export const dynamic = 'force-dynamic';

type Prepared = { raw: string; gzip: Buffer; etag: string };

// Read and compressed once per server start: these files are close to a megabyte each and every
// page load asks for one. In development the file is read each time so edits show up.
const prepared = new Map<string, Prepared>();

async function prepare(code: string): Promise<Prepared | null> {
  const known = prepared.get(code);
  if (known && process.env.NODE_ENV === 'production') return known;
  const raw = await readFile(path.join(process.cwd(), 'src', 'messages', `${code}.json`), 'utf8');
  if (!raw.trim()) return null;
  JSON.parse(raw);
  const entry = {
    raw,
    gzip: gzipSync(raw),
    etag: `"${createHash('sha1').update(raw).digest('hex').slice(0, 16)}"`,
  };
  prepared.set(code, entry);
  return entry;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ locale: string }> },
) {
  const { locale } = await context.params;
  const code = (locale || '').trim().toLowerCase().replace(/\.json$/i, '');
  if (!isMessageLocale(code)) {
    return NextResponse.json({ error: 'Unknown locale' }, { status: 404 });
  }

  try {
    const entry = await prepare(code);
    if (!entry) {
      return NextResponse.json({ error: 'Locale file is empty' }, { status: 500 });
    }
    // Browsers keep a copy and check it each load, so a deploy's new strings still arrive at once.
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache',
      ETag: entry.etag,
      Vary: 'Accept-Encoding',
    };
    if (request.headers.get('if-none-match') === entry.etag) {
      return new NextResponse(null, { status: 304, headers });
    }
    if ((request.headers.get('accept-encoding') || '').includes('gzip')) {
      return new NextResponse(new Uint8Array(entry.gzip), {
        status: 200,
        headers: { ...headers, 'Content-Encoding': 'gzip' },
      });
    }
    return new NextResponse(entry.raw, { status: 200, headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'read failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
