import { redirect } from 'next/navigation';

/** Legacy route — consolidated under Semantic layer workbench. */
export default function ModelLegacyRedirect() {
  redirect('/semantic-layer');
}
