import { redirect } from 'next/navigation';

/** Legacy route — the semantic-layer hub is hidden from navigation, so this
 * redirects straight to /data instead of bouncing through it. */
export default function ModelLegacyRedirect() {
  redirect('/data');
}
