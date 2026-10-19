/** ⌘J / Ctrl+J asks the assistant about what is selected (a notebook cell, sheet cells, a widget).
 * ⌘K stays the app's command palette; Ctrl+I would be italic in sheets. */
export function isInlineAskShortcut(e: KeyboardEvent | { metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; key: string }): boolean {
  return (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'j';
}

/** The shortcut as this platform writes it, for tooltips. */
export function inlineAskShortcutLabel(): string {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘J' : 'Ctrl+J';
}

/** A question for the assistant panel to send as soon as it is ready (id makes a repeat distinct). */
export type PendingSurfaceQuestion = { id: number; text: string };
