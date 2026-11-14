/** Lets the checklist start a tour without the two knowing about each other. */
const START = 'aicser:guide-start';

export function startGuide(id: string): void {
  window.dispatchEvent(new CustomEvent(START, { detail: id }));
}

export function onGuideStart(listener: (id: string) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<string>).detail);
  window.addEventListener(START, handler);
  return () => window.removeEventListener(START, handler);
}

/** Lets a step's card open the checklist that lives in the header. */
const OPEN_CHECKLIST = 'aicser:guide-checklist';

export function openChecklist(): void {
  window.dispatchEvent(new Event(OPEN_CHECKLIST));
}

export function onOpenChecklist(listener: () => void): () => void {
  window.addEventListener(OPEN_CHECKLIST, listener);
  return () => window.removeEventListener(OPEN_CHECKLIST, listener);
}
