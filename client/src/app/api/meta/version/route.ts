import { NextResponse } from 'next/server';
import { formatAiserVersion, normalizeAiserVersion } from '@/utils/appVersion';

export const dynamic = 'force-dynamic';

export async function GET() {
  const version = normalizeAiserVersion(
    process.env.AISER_VERSION ||
      process.env.NEXT_PUBLIC_AISER_VERSION ||
      process.env.APP_VERSION
  );

  return NextResponse.json(
    {
      version,
      label: formatAiserVersion(version),
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}
