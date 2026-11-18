// Ported from ../aicser/client/src/components/prep/ColumnHeader.tsx @ 749d38d (see PORTING.md). UI rewritten.
import {
  Calendar,
  CalendarClock,
  ChevronDown,
  CircleDollarSign,
  CircleHelp,
  Hash,
  SquareCheck,
  Tags,
  Type,
  type LucideIcon,
} from 'lucide-react';
import type { ColumnDistribution, ColumnMeaning } from '@/api/prep';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/aicser-ui/dropdown-menu';
import { tPrep as t, tRoles as tr } from '@/lib/prep/i18n';
import { friendlyType } from '@/lib/prep/recipeSteps';
import { cn } from '@/lib/ui/utils';
import { MenuItems, type MenuEntry } from './menu';

const TYPE_ICON: Record<string, LucideIcon> = {
  text: Type,
  integer: Hash,
  number: Hash,
  decimal: CircleDollarSign,
  boolean: SquareCheck,
  date: Calendar,
  datetime: CalendarClock,
  other: CircleHelp,
};

function MiniChart({ dist }: { dist: ColumnDistribution }) {
  if (dist.histogram?.length) {
    const max = Math.max(...dist.histogram.map((b) => b.count), 1);
    return (
      <svg className="h-5 w-full fill-primary/60" viewBox="0 0 120 22" preserveAspectRatio="none" aria-hidden="true">
        {dist.histogram.map((b, i) => {
          const h = Math.max(1, (b.count / max) * 20);
          return <rect key={i} x={i * 10 + 1} y={22 - h} width={8} height={h} rx={1} />;
        })}
      </svg>
    );
  }
  const top = (dist.top ?? []).slice(0, 3);
  const max = Math.max(...top.map((x) => x.count), 1);
  return (
    <div className="flex flex-col gap-px" aria-hidden="true">
      {top.map((x) => (
        <div key={x.value} className="relative h-1.5 overflow-hidden">
          <span
            className="absolute inset-y-0 left-0 rounded-sm bg-primary/50"
            style={{ width: `${(x.count / max) * 100}%` }}
          />
        </div>
      ))}
    </div>
  );
}

/** Column header: type in plain words, a data-quality bar, and the shape of the values. */
export function ColumnHeader({
  name,
  engineType,
  dist,
  selected,
  isNew,
  meaning,
  readOnly,
  menu,
  onSelect,
}: {
  name: string;
  engineType: string;
  dist?: ColumnDistribution;
  selected: boolean;
  isNew: boolean;
  /** What the column means, when someone described it. */
  meaning?: ColumnMeaning;
  readOnly: boolean;
  menu: MenuEntry[];
  onSelect: (additive: boolean) => void;
}) {
  const kind = friendlyType(engineType);
  // A category keeps its storage type; the icon shows how it is used.
  const asCategory = meaning?.role === 'category';
  const Icon = asCategory ? Tags : (TYPE_ICON[kind] ?? CircleHelp);
  const typeLabel = asCategory ? `${t(`type_${kind}`)} · ${tr('role_category')}` : t(`type_${kind}`);
  const filled = dist ? dist.rows - dist.empty : 0;
  const filledPct = dist && dist.rows ? (filled / dist.rows) * 100 : 0;
  const quality = dist ? t('quality_tooltip', { filled, empty: dist.empty, distinct: dist.distinct }) : '';
  const meaningText =
    meaning && (meaning.description || meaning.role || meaning.personal)
      ? [
          meaning.description,
          meaning.role ? tr(`role_${meaning.role}`) : null,
          meaning.personal ? t('meaning_personal_short') : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : null;

  return (
    <div className={cn('flex w-40 flex-col gap-1 py-1', selected && 'text-primary-active')}>
      <div className="flex items-center gap-1">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-label={typeLabel} />
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left font-semibold"
          onClick={(e) => onSelect(e.shiftKey || e.metaKey || e.ctrlKey)}
          aria-pressed={selected}
          title={t('select_column_hint')}
        >
          {name}
        </button>
        {isNew && (
          <span className="rounded bg-(--status-good)/15 px-1 text-[10px] font-medium text-(--status-good)">
            {t('new_badge')}
          </span>
        )}
        {meaningText && (
          <span
            title={meaningText}
            aria-label={t('action_meaning')}
            className={cn('size-2 shrink-0 rounded-full', meaning?.personal ? 'bg-destructive' : 'bg-primary')}
          />
        )}
        {!readOnly && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={t('column_menu', { column: name })}
              >
                <ChevronDown className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <MenuItems items={menu} />
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {dist ? (
        <div
          className="h-1 overflow-hidden rounded-full bg-destructive/40"
          role="img"
          aria-label={quality}
          title={quality}
        >
          <span className="block h-full bg-(--status-good)" style={{ width: `${filledPct}%` }} />
        </div>
      ) : (
        <div className="h-1 animate-pulse rounded-full bg-muted" />
      )}
      {dist ? <MiniChart dist={dist} /> : <div className="h-5" />}
    </div>
  );
}
