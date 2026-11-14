'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from 'antd';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CHECKLIST, firstOpenStep, GUIDES, isSkipped, nextItem, onStepPage, shouldAutoStart, skipKey, unfinishedGuide, visibleItems, type ChecklistItem, type Journey, type Guide, type GuideStep } from './guides';
import { GuideCoach, type CoachState } from './GuideCoach';
import { COMMUNITY_URL, showCommunity } from '@/constants/community';
import { onGuideStart } from './guideEvents';
import { useJourney, useSaveGuide } from './useJourney';
import './guide.css';

const TARGET_WAIT_MS = 4_000;
/** Long enough to register the tick before the guide moves on. */
const DONE_PAUSE_MS = 900;
const ALL_SET_MS = 8_000;

function anyDialogOpen(): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>('.ant-modal')).some((el) => el.offsetParent !== null);
}

/** The latest match: the newest answer's button, not the first one on the page. */
function findTarget(name: string): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>(`[data-guide="${name}"]`);
  return all.length ? all[all.length - 1] : null;
}

/** Pages load late and re-render often, so the step's element is looked up again and again. */
function useStepTarget(name: string | undefined, orName: string | undefined, key: string): { element: HTMLElement | null; settled: boolean } {
  const [state, setState] = useState<{ element: HTMLElement | null; settled: boolean }>({ element: null, settled: false });
  useEffect(() => {
    setState({ element: null, settled: !name });
    if (!name) return undefined;
    const started = Date.now();
    const check = () => {
      // A chat with someone's AI agent isn't the place for product tips.
      const away = Boolean(document.querySelector('.chat-panel--agent'));
      const element = away ? null : findTarget(name) ?? (orName ? findTarget(orName) : null);
      const settled = !away && (Boolean(element) || Date.now() - started >= TARGET_WAIT_MS);
      setState((current) => (current.element === element && current.settled === settled ? current : { element, settled }));
    };
    check();
    const timer = window.setInterval(check, 400);
    return () => window.clearInterval(timer);
  }, [name, orName, key]);
  return state;
}

/** The button that finishes the dialog on top, so the guide can follow someone into it. */
function dialogAction(): HTMLElement | null {
  const open = Array.from(document.querySelectorAll<HTMLElement>('.ant-modal, .ant-drawer-content'))
    .filter((el) => el.getClientRects().length > 0);
  const buttons = open.at(-1)?.querySelectorAll<HTMLElement>('.ant-btn-primary');
  return buttons?.length ? buttons[buttons.length - 1] : null;
}

/** After the highlighted control opens a dialog, the guide moves to the button that completes it. */
function useDialogStep(target: HTMLElement | null, key: string): { action: HTMLElement | null; engaged: boolean } {
  const [engaged, setEngaged] = useState(false);
  const [action, setAction] = useState<HTMLElement | null>(null);
  useEffect(() => setEngaged(false), [key]);
  useEffect(() => {
    if (!target) return undefined;
    const onClick = () => setEngaged(true);
    target.addEventListener('click', onClick);
    return () => target.removeEventListener('click', onClick);
  }, [target]);
  useEffect(() => {
    setAction(null);
    if (!engaged) return undefined;
    const timer = window.setInterval(() => setAction(dialogAction()), 300);
    return () => window.clearInterval(timer);
  }, [engaged]);
  return { action, engaged };
}

/** What someone is doing in a step's input: typing leaves them to it, and a field that locks means it was sent. */
function useFieldActivity(target: HTMLElement | null, key: string): { typing: boolean; busy: boolean } {
  const [typing, setTyping] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setTyping(false);
    setBusy(false);
  }, [key]);
  useEffect(() => {
    if (!target) return undefined;
    const check = () => {
      const field = target.querySelector<HTMLTextAreaElement | HTMLInputElement>('textarea, input[type="text"]');
      if (!field) return;
      setTyping(field.value.trim().length > 0);
      if (field.disabled) setBusy(true);
    };
    check();
    const timer = window.setInterval(check, 250);
    return () => window.clearInterval(timer);
  }, [target]);
  return { typing, busy };
}

const isNavStep = (step?: GuideStep) => Boolean(step?.target?.startsWith('nav-'));

/**
 * Runs one tour at a time, mounted once for the whole app. It only moves someone
 * when they asked it to (starting a tour, or finishing a step). If they walk off to another page the
 * tour steps aside until they come back, because the app must stay theirs to use.
 */
export function GuideHost() {
  const t = useTranslations('guide');
  const router = useRouter();
  const pathname = usePathname();
  const [guide, setGuide] = useState<Guide | null>(null);
  const [index, setIndex] = useState(0);
  const step = guide?.steps[index];
  const [acted, setActed] = useState(false);
  const [doneStep, setDoneStep] = useState<string | null>(null);
  const [upNext, setUpNext] = useState<ChecklistItem | null>(null);
  const [allSet, setAllSet] = useState(false);
  const { data: journey } = useJourney(Boolean(guide), acted);
  const save = useSaveGuide();
  const autoStarted = useRef(false);
  const goThere = useRef(false);

  const begin = useCallback((id: string, from = 0, go = true) => {
    const next = GUIDES[id];
    if (!next) return;
    const start = firstOpenStep(next, journey, from, pathname ?? '');
    if (start >= next.steps.length) return;
    goThere.current = go;
    setUpNext(null);
    setGuide(next);
    setIndex(start);
  }, [journey, pathname]);

  useEffect(() => onGuideStart((id) => begin(id)), [begin]);

  // Never behind a dialog: the one automatic start would be spent where nobody can see it.
  useEffect(() => {
    const unfinished = unfinishedGuide(journey);
    if (autoStarted.current || guide || !journey?.ready || !(shouldAutoStart(journey) || unfinished)) return undefined;
    const timer = window.setInterval(() => {
      if (autoStarted.current || anyDialogOpen()) return;
      autoStarted.current = true;
      window.clearInterval(timer);
      if (unfinished) {
        begin(unfinished.id, unfinished.step, false);
      } else {
        save('first_value', 'active', 0);
        begin('first_value', 0, false);
      }
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [journey, guide, begin, save]);

  const finish = useCallback((status: 'done' | 'dismissed') => {
    if (guide) save(guide.id, status, index);
    setGuide(null);
  }, [guide, index, save]);

  // A tour ended. The next one runs here and now if it belongs on this page; otherwise it's
  // offered, because only the person decides to go somewhere else.
  const carryOn = useCallback((progress: Journey | undefined, finished: string) => {
    const following = nextItem(progress);
    if (!following) {
      if (visibleItems(progress).length) setAllSet(true);
      return;
    }
    if (following.guide === finished) return;
    const upcoming = GUIDES[following.guide];
    const first = upcoming.steps[firstOpenStep(upcoming, progress, 0, pathname ?? '')];
    if (first && (!first.route || onStepPage(first, pathname ?? ''))) begin(following.guide);
    else setUpNext(following);
  }, [pathname, begin]);

  const advance = useCallback((from: number) => {
    if (!guide) return;
    const next = firstOpenStep(guide, journey, from + 1, pathname ?? '');
    if (next < guide.steps.length) {
      save(guide.id, 'active', next);
      goThere.current = true;
      setIndex(next);
      return;
    }
    save(guide.id, 'done', next);
    setGuide(null);
    carryOn(journey, guide.id);
  }, [guide, journey, pathname, save, carryOn]);

  const skip = useCallback(() => {
    if (!guide || !journey) return;
    const item = step?.waitFor ?? CHECKLIST.find((entry) => entry.guide === guide.id)?.step;
    if (!item) return;
    save(skipKey(item), 'dismissed');
    save(guide.id, 'dismissed', index);
    setGuide(null);
    carryOn({ ...journey, guides: { ...journey.guides, [skipKey(item)]: { status: 'dismissed', step: 0 } } }, '');
  }, [guide, journey, step, index, save, carryOn]);

  useEffect(() => {
    if (!allSet) return undefined;
    const timer = window.setTimeout(() => setAllSet(false), ALL_SET_MS);
    return () => window.clearTimeout(timer);
  }, [allSet]);

  // The person did the thing: show it landed, then move on by itself.
  const stepDone = Boolean(step?.waitFor && (journey?.steps[step.waitFor] || isSkipped(journey, step.waitFor)));
  useEffect(() => {
    if (!step) return undefined;
    if (step.skipOnRoute && onStepPage(step, pathname ?? '')) {
      advance(index);
      return undefined;
    }
    if (!stepDone) return undefined;
    setDoneStep(step.id);
    const timer = window.setTimeout(() => {
      setDoneStep(null);
      advance(index);
    }, DONE_PAUSE_MS);
    return () => window.clearTimeout(timer);
  }, [step, stepDone, index, pathname, advance]);

  // Going to a step's page happens once, as part of moving to that step.
  useEffect(() => {
    if (!goThere.current || !step) return;
    goThere.current = false;
    if (step.route && !onStepPage(step, pathname ?? '') && !isNavStep(step)) router.push(step.href ?? step.route);
  }, [step, pathname, router]);

  // Sidebar links are on every page, so a step pointing at one can run before its page is open.
  const here = !step?.route || onStepPage(step, pathname ?? '') || isNavStep(step);
  // Landed elsewhere mid-tour: point at the menu item that leads back, without moving anyone.
  useEffect(() => {
    if (!guide || !step || here || index === 0) return;
    const before = guide.steps[index - 1];
    if (isNavStep(before) && before.route === step.route) setIndex(index - 1);
  }, [guide, step, here, index]);

  // A menu step only leads to the next one. Once that's done, it has nothing left to lead to: acting
  // can move someone to a new page before the result is known, which lands them back on this step.
  useEffect(() => {
    const following = guide?.steps[index + 1];
    if (!isNavStep(step) || !following?.waitFor) return;
    if (journey?.steps[following.waitFor] || isSkipped(journey, following.waitFor)) advance(index);
  }, [guide, step, index, journey, advance]);

  const stepKey = `${guide?.id}:${index}:${pathname}`;
  const { element: stepElement, settled } = useStepTarget(here ? step?.target : undefined, step?.orTarget, stepKey);
  const { action: dialogButton, engaged } = useDialogStep(step?.waitFor ? stepElement : null, stepKey);
  const { typing, busy } = useFieldActivity(step?.waitFor ? stepElement : null, stepKey);
  const element = dialogButton ?? stepElement;

  useEffect(() => setActed(engaged || busy), [engaged, busy]);

  if (allSet) {
    return (
      <GuideCoach
        target={null}
        stepKey="all-set"
        state="done"
        title={t('all_set')}
        closeLabel={t('later')}
        onClose={() => setAllSet(false)}
        actions={showCommunity ? <Button size="small" href={COMMUNITY_URL} target="_blank" rel="noopener noreferrer">{t('community')}</Button> : undefined}
      />
    );
  }

  if (upNext) {
    return (
      <GuideCoach
        target={null}
        stepKey={`next:${upNext.guide}`}
        state="point"
        title={t('nice_work')}
        body={t('up_next', { item: t(`checklist.${upNext.step}`) })}
        closeLabel={t('later')}
        onClose={() => setUpNext(null)}
        actions={<Button size="small" type="primary" onClick={() => begin(upNext.guide)}>{t('continue')}</Button>}
      />
    );
  }

  if (!guide || !step || !here || (!settled && Boolean(step.target))) return null;

  // The most specific words for where the person is: this page, then "it's in view", then general.
  const hereKey = (id: string) => {
    const page = `steps.${id}.here_${(pathname ?? '').split('/')[1]}`;
    if (element && t.has(page)) return page;
    return element && t.has(`steps.${id}.here`) ? `steps.${id}.here` : `steps.${id}.body`;
  };
  const state: CoachState = doneStep === step.id ? 'done' : busy ? 'working' : typing ? 'typing' : 'point';
  // No answer to work with yet, so the guide leads to one first.
  const needsAnswer = Boolean(element && step.orTarget && element.dataset.guide === step.orTarget);
  const stepTitle = dialogButton
    ? t('steps.finish_dialog.title')
    : needsAnswer ? t('steps.pick_question.title') : t(`steps.${step.id}.title`);
  const stepBody = dialogButton
    ? t('steps.finish_dialog.body')
    : needsAnswer ? t('steps.pick_question.body')
    : t(hereKey(step.id));
  const titles: Record<CoachState, string> = {
    point: stepTitle,
    typing: stepTitle,
    working: t('working'),
    done: t('done'),
  };

  const onNext = () => {
    if (isNavStep(step) && step.route) router.push(step.route);
    else advance(index);
  };

  // Counted on the same list as Getting started, so the two never disagree.
  const items = visibleItems(journey);
  const position = items.filter((item) => journey?.steps[item.step]).length + 1;
  const progress = items.length ? t('progress', { current: Math.min(position, items.length), total: items.length }) : undefined;

  return (
    <GuideCoach
      target={element}
      stepKey={stepKey}
      state={state}
      title={titles[state]}
      body={state === 'point' ? stepBody : undefined}
      progress={state === 'point' ? progress : undefined}
      checklistLabel={t('title')}
      closeLabel={t('later')}
      onClose={() => finish('dismissed')}
      actions={state === 'point'
        ? step.waitFor
          ? <Button size="small" type="text" onClick={skip}>{t('skip')}</Button>
          : <Button size="small" type="primary" onClick={onNext}>{t('next')}</Button>
        : undefined}
    />
  );
}
