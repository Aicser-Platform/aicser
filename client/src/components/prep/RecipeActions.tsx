// Ported from ../aicser/client/src/components/prep/useRecipeActions.tsx @ 749d38d (see PORTING.md). UI rewritten:
// a menu with its own dialogs; delete asks a plain confirm (web's impact list is EE client code).
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@/lib/desktop/router';
import { Copy, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { createRecipe, deleteRecipe, updateRecipe, type Recipe } from '@/api/prep';
import { Button } from '@/components/aicser-ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/aicser-ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/aicser-ui/dropdown-menu';
import { Input } from '@/components/aicser-ui/input';
import { tPrep as t } from '@/lib/prep/i18n';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Rename, duplicate and delete for a recipe: the same menu on the list and on the recipe page. */
export function RecipeActions({
  recipe,
  withRename = true,
  afterDelete,
}: {
  recipe: Recipe;
  withRename?: boolean;
  afterDelete?: () => void;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<'rename' | 'delete' | null>(null);
  const [name, setName] = useState(recipe.name);
  const [busy, setBusy] = useState(false);
  const refresh = () => client.invalidateQueries({ queryKey: ['prep'] });

  const rename = async () => {
    const next = name.trim();
    if (!next || next === recipe.name) {
      setDialog(null);
      return;
    }
    setBusy(true);
    try {
      await updateRecipe(recipe.id, { name: next });
      await refresh();
      setDialog(null);
    } catch (error) {
      toast.error(message(error));
    } finally {
      setBusy(false);
    }
  };

  const duplicate = async () => {
    try {
      const copy = await createRecipe({
        name: t('copy_of', { name: recipe.name }),
        data_source_id: recipe.data_source_id,
        table: recipe.table,
        steps: recipe.steps,
        project_id: recipe.project_id ?? null,
      });
      await refresh();
      void navigate({ to: '/prepare/$recipeId', params: { recipeId: copy.id } });
    } catch (error) {
      toast.error(message(error));
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await deleteRecipe(recipe.id);
      toast.success(t('deleted', { name: recipe.name }));
      await refresh();
      setDialog(null);
      afterDelete?.();
    } catch (error) {
      toast.error(message(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label={t('more_actions')} title={t('more_actions')}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {withRename && (
            <DropdownMenuItem
              onSelect={() => {
                setName(recipe.name);
                setDialog('rename');
              }}
            >
              <Pencil /> {t('rename')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => void duplicate()}>
            <Copy /> {t('duplicate')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDialog('delete')}>
            <Trash2 /> {t('delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialog === 'rename'} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('rename')}</DialogTitle>
            <DialogDescription className="sr-only">{t('field_name')}</DialogDescription>
          </DialogHeader>
          <form
            id="rename-recipe"
            onSubmit={(e) => {
              e.preventDefault();
              void rename();
            }}
          >
            <Input
              value={name}
              maxLength={200}
              aria-label={t('field_name')}
              onChange={(e) => setName(e.target.value)}
            />
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              {t('cancel')}
            </Button>
            <Button type="submit" form="rename-recipe" disabled={busy || !name.trim()}>
              {t('rename')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === 'delete'} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('delete_title', { name: recipe.name })}</DialogTitle>
            <DialogDescription>{t('delete_desc')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              {t('cancel')}
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void remove()}>
              {t('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
