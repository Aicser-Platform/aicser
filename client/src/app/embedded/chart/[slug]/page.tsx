import React from 'react';

export const dynamic = 'force-dynamic';

export default function EmbeddedChartPage({ params }: { params: { slug: string } }) {
  const { slug } = params || { slug: '' };
  return (
    <div style={{ padding: 24 }}>
      <h2>Embedded Chart</h2>
      <p>Chart slug: {slug}</p>
    </div>
  );
}
