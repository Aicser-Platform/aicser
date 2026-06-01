import { redirect } from 'next/navigation';

/** Legacy route — canonical hub is /semantic-layer */
export default function ModelLegacyRedirect() {
  redirect('/semantic-layer');
}
