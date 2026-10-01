import { redirect } from 'next/navigation';

/** Maps is switched off until it's ready (NEXT_PUBLIC_FEATURE_MAPS=true turns it back on). */
export default function SpatialLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NEXT_PUBLIC_FEATURE_MAPS !== 'true') redirect('/');
  return children;
}
