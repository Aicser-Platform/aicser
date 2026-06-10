import dynamic from 'next/dynamic';
import { DashboardPageShell } from '@/components/layout/DashboardPageShell';

const ChartDesignerStudio = dynamic(() => import('./components/ChartDesignerStudio'), { ssr: false });

export default function ChartDesignerPage() {
  return (
    <DashboardPageShell fullBleed>
      <ChartDesignerStudio />
    </DashboardPageShell>
  );
}
