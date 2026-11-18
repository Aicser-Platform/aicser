'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Prepare's components came from aicser-desktop, where text goes through module-level `tPrep('key')` calls. On the
 * web those read next-intl's active messages: <PrepI18n> (in the Prepare layout and anywhere the recipe editor is
 * embedded) hands this module the root translator while it renders, before its children do.
 */
export type Values = Record<string, string | number>;
export type Translate = (key: string, values?: Values) => string;

type Root = ReturnType<typeof useTranslations>;
let root: Root | null = null;

/** Full keys (e.g. server `message_key`s such as prepare.finding.type_as_text); a missing key shows the key. */
export const tRoot: Translate = (key, values) => {
  if (!root || !root.has(key)) return key;
  return root(key, values as Parameters<Root>[1]);
};

/** `t` for one namespace (web `useTranslations('prepare')`). */
export function translator(namespace: string): Translate {
  return (key, values) => tRoot(`${namespace}.${key}`, values);
}

export const tPrep = translator('prepare');
export const tClean = translator('prepare.clean');
export const tRoles = translator('column_roles');

/** Gives the Prepare translators the active language; wrap any tree that renders Prepare components. */
export function PrepI18n({ children }: { children: ReactNode }) {
  root = useTranslations();
  return children;
}
