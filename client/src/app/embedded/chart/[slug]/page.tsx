import React from 'react';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

export default async function EmbeddedChartPage({ params }: Props) {
  const { slug } = await params;
  return (
    <div style={{ padding: 24 }}>
      <h2>Embedded Chart</h2>
      <p>Chart slug: {slug || ''}</p>
    </div>
  );
}
