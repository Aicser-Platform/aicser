'use client';

import type { ReactNode } from 'react';
import { Gem, Loader2 } from 'lucide-react';
import { cn } from '@/lib/ui/utils';
import { Button } from './button';

/* Page building blocks shared by the desktop's data pages (aicser-desktop components/lakehouse/common.tsx). */

/** A page heading: icon tile, title, one-line description and the page's actions. */
export function PageTitle({
  title,
  description,
  icon,
  actions,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary-hover dark:text-primary [&_svg]:size-5">
          {icon}
        </span>
        <div>
          <h1 className="m-0 text-xl font-semibold">{title}</h1>
          <p className="m-0 max-w-2xl text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** Every page's padding, so lists and editors line up (the desktop's main area). */
const PAGE_PADDING = 'p-4 sm:p-6';

/** List pages (Prepare, Semantic models, Pipelines…): the full width, like every other page, and scrolls. */
export function PageBody({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className="h-full min-h-0 overflow-y-auto bg-background text-foreground">
      <div className={cn('flex w-full flex-col gap-6', PAGE_PADDING, className)}>{children}</div>
    </div>
  );
}

/**
 * Editors and studios (a recipe, a semantic model, a pipeline): the full width, same padding as lists. `fill` keeps
 * the page to the window (the editor scrolls inside); otherwise the page scrolls.
 */
export function WorkspaceBody({
  className,
  children,
  fill = false,
}: {
  className?: string;
  children: ReactNode;
  fill?: boolean;
}) {
  return (
    <div
      className={cn(
        'h-full min-h-0 bg-background text-foreground',
        fill ? 'flex flex-col overflow-hidden' : 'overflow-y-auto'
      )}
    >
      <div className={cn('flex w-full flex-col gap-4', fill && 'min-h-0 flex-1', PAGE_PADDING, className)}>
        {children}
      </div>
    </div>
  );
}

export type Tone = 'good' | 'bad' | 'busy' | 'neutral';

const TONE_DOT: Record<Tone, string> = {
  good: 'bg-green-600 dark:bg-green-400',
  bad: 'bg-destructive',
  busy: 'bg-blue-600 animate-pulse dark:bg-blue-400',
  neutral: 'bg-muted-foreground',
};

/** A run or item state: a coloured dot and its word (never colour alone). */
export function StatusBadge({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className={cn('size-2 shrink-0 rounded-full', TONE_DOT[tone])} aria-hidden="true" />
      {label}
    </span>
  );
}

/** A plan feature this workspace doesn't have: what it is and where to get it. */
export function UpgradeRequired({ feature, onShowPlans }: { feature: string; onShowPlans?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center">
      <Gem className="size-8 text-primary" aria-hidden="true" />
      <h3 className="m-0 text-base font-semibold">{feature}</h3>
      <Button
        variant="outline"
        onClick={onShowPlans ?? (() => window.dispatchEvent(new CustomEvent('open-pricing-modal')))}
      >
        <Gem /> View plans
      </Button>
    </div>
  );
}

/** Loading and error states for a query; children when there is data. */
export function QueryState({
  query,
  children,
  loadingLabel = 'Loading…',
  errorLabel = 'Could not load',
  retryLabel = 'Retry',
}: {
  query: { isLoading: boolean; error: Error | null; refetch: () => unknown };
  children: ReactNode;
  /** What's loading (desktop pages name it; kept for parity, the text comes from the labels). */
  feature?: string;
  loadingLabel?: string;
  errorLabel?: string;
  retryLabel?: string;
}) {
  if (query.isLoading) {
    return (
      <p role="status" className="m-0 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" /> {loadingLabel}
      </p>
    );
  }
  if (query.error) {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 text-sm">
        {errorLabel}: {query.error.message}
        <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
          {retryLabel}
        </Button>
      </div>
    );
  }
  return <>{children}</>;
}
