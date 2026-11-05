/** The guided journey, as data. Tours stay short and each one ends in something the person did. */

export type JourneyStepId =
  | 'connect' | 'ask' | 'save' | 'dashboard' | 'publish' | 'invite' | 'discuss' | 'alert';

export interface Journey {
  /** true/false from what the person really did; null when this edition can't do the step. */
  steps: Partial<Record<JourneyStepId, boolean | null>>;
  guides: Record<string, { status: 'active' | 'done' | 'dismissed'; step: number }>;
  /** False until the person has a workspace for a tour to run in. */
  ready?: boolean;
}

export interface GuideStep {
  /** i18n key under guide.steps, with .title and .body. */
  id: string;
  /** Page the step lives on (path only). Leaving it pauses the tour; it never pulls someone back. */
  route?: string;
  /** Other pages the step works on just as well, so nobody is sent away from them. */
  alsoOn?: string[];
  /** Where to go for this step, when that needs more than the path. */
  href?: string;
  /** Value of the data-guide attribute to highlight. No target = a centred note. */
  target?: string;
  /** Highlighted until `target` exists: what gets someone to the point where it does. */
  orTarget?: string;
  /** Finish the step when this journey step is done, not with a Next button. */
  waitFor?: JourneyStepId;
  /** Done as soon as the person is on this step's page. */
  skipOnRoute?: boolean;
}

export interface Guide {
  id: string;
  steps: GuideStep[];
}

const openPage = (id: string, nav: string, route: string, alsoOn?: string[]): GuideStep =>
  ({ id, target: `nav-${nav}`, route, alsoOn, skipOnRoute: true });

export const onStepPage = (step: GuideStep, pathname: string): boolean =>
  pathname === step.route || Boolean(step.alsoOn?.includes(pathname));

/** One short tour per checklist item. Each highlights the thing to click and waits for it. */
export const GUIDES: Record<string, Guide> = {
  connect: { id: 'connect', steps: [{ id: 'connect_data', target: 'connect-data', waitFor: 'connect' }] },
  first_value: {
    id: 'first_value',
    steps: [
      openPage('open_chat', 'chat', '/chat'),
      { id: 'connect', route: '/chat', target: 'try-sample', waitFor: 'connect' },
      { id: 'ask', route: '/chat', target: 'chat-composer', waitFor: 'ask' },
    ],
  },
  save: {
    id: 'save',
    steps: [openPage('open_chat_save', 'chat', '/chat'), { id: 'save', route: '/chat', target: 'pin-chart', orTarget: 'suggested-question', waitFor: 'save' }],
  },
  dashboard: {
    id: 'dashboard',
    steps: [openPage('open_dashboards', 'dashboards', '/dashboards'), { id: 'dashboard', route: '/dashboards', target: 'new-dashboard', waitFor: 'dashboard' }],
  },
  publish: {
    id: 'publish',
    steps: [
      openPage('open_chat_publish', 'chat', '/chat', ['/dashboards']),
      { id: 'publish', route: '/chat', alsoOn: ['/dashboards'], target: 'publish-insight', orTarget: 'suggested-question', waitFor: 'publish' },
    ],
  },
  invite: {
    id: 'invite',
    steps: [{ id: 'invite', route: '/settings', href: '/settings?tab=team', target: 'invite-member', waitFor: 'invite' }],
  },
  team: {
    id: 'team',
    steps: [openPage('shared_insights', 'feed', '/feed'), { id: 'discuss', route: '/feed', waitFor: 'discuss' }],
  },
  alert: {
    id: 'alert',
    steps: [openPage('open_alerts', 'alerts', '/alerts'), { id: 'alert', route: '/alerts', target: 'new-alert', waitFor: 'alert' }],
  },
};

export interface ChecklistItem {
  step: JourneyStepId;
  guide: string;
}

/** In the order they pay off: first answer, then keeping it, sharing it, and being told when it moves. */
export const CHECKLIST: ChecklistItem[] = [
  { step: 'connect', guide: 'connect' },
  { step: 'ask', guide: 'first_value' },
  { step: 'save', guide: 'save' },
  { step: 'dashboard', guide: 'dashboard' },
  { step: 'publish', guide: 'publish' },
  { step: 'invite', guide: 'invite' },
  { step: 'discuss', guide: 'team' },
  { step: 'alert', guide: 'alert' },
];

/** Skipping is kept on the account with the tours, under this name. */
export const skipKey = (step: JourneyStepId): string => `skip_${step}`;

export const isSkipped = (journey: Journey | undefined, step: JourneyStepId): boolean =>
  journey?.guides[skipKey(step)]?.status === 'dismissed';

export function visibleItems(journey?: Journey): ChecklistItem[] {
  if (!journey) return [];
  return CHECKLIST.filter((item) =>
    journey.steps[item.step] !== null && journey.steps[item.step] !== undefined && !isSkipped(journey, item.step));
}

export function nextItem(journey?: Journey): ChecklistItem | undefined {
  return visibleItems(journey).find((item) => !journey?.steps[item.step]);
}

/** A tour runs by itself once, for someone who hasn't asked anything yet, and never again. */
export function shouldAutoStart(journey?: Journey): boolean {
  return Boolean(journey && journey.ready !== false && journey.steps.ask === false && !journey.guides.first_value);
}

/** A tour left running: it carries on after a reload, and on another browser. */
export function unfinishedGuide(journey?: Journey): { id: string; step: number } | undefined {
  return Object.entries(journey?.guides ?? {})
    .filter(([id, state]) => state.status === 'active' && GUIDES[id])
    .map(([id, state]) => ({ id, step: state.step }))[0];
}

/** Where a tour resumes: past any step the person has already done on their own. */
export function firstOpenStep(guide: Guide, journey: Journey | undefined, from = 0, pathname = ''): number {
  let index = from;
  while (index < guide.steps.length) {
    const step = guide.steps[index];
    const done = step.waitFor
      ? journey?.steps[step.waitFor] || isSkipped(journey, step.waitFor)
      : step.skipOnRoute && onStepPage(step, pathname);
    if (!done) break;
    index += 1;
  }
  return index;
}
