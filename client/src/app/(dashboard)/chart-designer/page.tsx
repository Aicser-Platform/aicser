import dynamic from 'next/dynamic';

const ChartDesignerStudio = dynamic(() => import('./components/ChartDesignerStudio'), { ssr: false });

export default function ChartDesignerPage() {
  return <ChartDesignerStudio />;
}
