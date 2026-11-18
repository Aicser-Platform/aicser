'use client';

import { useParams } from 'next/navigation';
import { WorkspaceBody } from '@/components/aicser-ui/page';
import { RecipePage } from '@/components/prep/RecipePage';

export const dynamic = 'force-dynamic';

/** Full width: the editor (steps · grid · CLEAN panel) fills the page. */
export default function RecipeRoute() {
  const params = useParams<{ id: string }>();
  const recipeId = String(params?.id ?? '');
  return (
    <WorkspaceBody fill>
      <RecipePage key={recipeId} recipeId={recipeId} />
    </WorkspaceBody>
  );
}
