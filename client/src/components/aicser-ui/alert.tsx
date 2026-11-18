import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/ui/utils';

/* A callout (shadcn Alert): an icon, a title, an optional description and an action on the right. */

const alertVariants = cva('flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-sm [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0', {
  variants: {
    variant: {
      info: 'border-primary/30 bg-primary/10 [&>svg]:text-primary-hover dark:[&>svg]:text-primary',
      success: 'border-green-600/30 bg-green-600/10 [&>svg]:text-green-700 dark:[&>svg]:text-green-400',
      warning: 'border-amber-500/40 bg-amber-500/10 [&>svg]:text-amber-700 dark:[&>svg]:text-amber-400',
      destructive: 'border-destructive/40 bg-destructive/10 [&>svg]:text-destructive',
    },
  },
  defaultVariants: { variant: 'info' },
});

const ICONS = { info: Info, success: CircleCheck, warning: TriangleAlert, destructive: CircleAlert } as const;

function Alert({
  className,
  variant = 'info',
  title,
  action,
  children,
  ...props
}: Omit<React.ComponentProps<'div'>, 'title'> &
  VariantProps<typeof alertVariants> & { title?: React.ReactNode; action?: React.ReactNode }) {
  const Icon = ICONS[variant ?? 'info'];
  return (
    <div
      role={variant === 'destructive' || variant === 'warning' ? 'alert' : 'status'}
      data-slot="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      <Icon aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {title ? <div className="font-medium">{title}</div> : null}
        {children ? <div className="text-muted-foreground">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export { Alert };
