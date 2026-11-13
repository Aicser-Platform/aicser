import type { ReactNode } from 'react';

/** The Aicser UI scope (see README.md): its classes apply only inside this element (`display: contents`). */
export function AicserUi({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="aicser-ui">{children}</div>;
}
