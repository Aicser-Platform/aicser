import { describe, expect, it } from 'vitest';
import { CHECKLIST, firstOpenStep, GUIDES, isSkipped, nextItem, onStepPage, shouldAutoStart, skipKey, unfinishedGuide, visibleItems, type Journey } from '../guides';

const journey = (steps: Journey['steps'], guides: Journey['guides'] = {}): Journey => ({ steps, guides });

describe('guides', () => {
  it('publishes from a dashboard without sending anyone back to Ask', () => {
    const open = journey({ ask: true, publish: false });
    const start = firstOpenStep(GUIDES.publish, open, 0, '/dashboards');
    expect(GUIDES.publish.steps[start].id).toBe('publish');
    expect(onStepPage(GUIDES.publish.steps[start], '/dashboards')).toBe(true);
    expect(firstOpenStep(GUIDES.publish, open, 0, '/alerts')).toBe(0);
  });

  it('drops a skipped step and moves on', () => {
    const guides = { [skipKey('discuss')]: { status: 'dismissed' as const, step: 0 } };
    const open = journey({ ask: true, discuss: false, alert: false }, guides);
    expect(isSkipped(open, 'discuss')).toBe(true);
    expect(visibleItems(open).map((i) => i.step)).toEqual(['ask', 'alert']);
    expect(nextItem(open)?.step).toBe('alert');
  });

  it('is finished when everything left was done or skipped', () => {
    const guides = { [skipKey('discuss')]: { status: 'dismissed' as const, step: 0 } };
    expect(nextItem(journey({ ask: true, discuss: false }, guides))).toBeUndefined();
  });

  it('keeps every tour short', () => {
    for (const guide of Object.values(GUIDES)) expect(guide.steps.length).toBeLessThanOrEqual(5);
  });

  it('leaves out what this edition cannot do', () => {
    const items = visibleItems(journey({ connect: false, ask: false, alert: null }));
    expect(items.map((i) => i.step)).toEqual(['connect', 'ask']);
  });

  it('points at the first thing not done', () => {
    expect(nextItem(journey({ connect: true, ask: true, save: false, dashboard: false }))?.step).toBe('save');
    expect(nextItem(journey({ connect: true, ask: true }))).toBeUndefined();
  });

  it('starts by itself once, only before the first answer', () => {
    expect(shouldAutoStart(journey({ ask: false }))).toBe(true);
    expect(shouldAutoStart(journey({ ask: true }))).toBe(false);
    expect(shouldAutoStart(journey({ ask: false }, { first_value: { status: 'dismissed', step: 0 } }))).toBe(false);
    expect(shouldAutoStart(journey({ ask: null }))).toBe(false);
  });

  it('skips steps the person already did on their own', () => {
    const guide = GUIDES.first_value;
    expect(firstOpenStep(guide, journey({ connect: true, ask: false }), 1)).toBe(2);
    expect(firstOpenStep(guide, journey({ connect: true, ask: true }), 1)).toBe(guide.steps.length);
    expect(firstOpenStep(guide, journey({ ask: false }), 0)).toBe(0);
  });

  it('has a guided tour for every checklist item, ending in something the person did', () => {
    for (const item of CHECKLIST) {
      const guide = GUIDES[item.guide];
      expect(guide).toBeDefined();
      expect(guide.steps.some((s) => s.waitFor === item.step)).toBe(true);
    }
  });

  it('starts with sample data, because there is nothing to ask about without data', () => {
    const guide = GUIDES.first_value;
    expect(guide.steps[firstOpenStep(guide, journey({ connect: false }), 0, '/chat')].id).toBe('connect');
    expect(guide.steps[firstOpenStep(guide, journey({ connect: true, ask: false }), 0, '/chat')].id).toBe('ask');
    expect(guide.steps[firstOpenStep(guide, journey({ connect: false }), 0, '/dashboards')].id).toBe('open_chat');
  });

  it('carries on with a tour left running, and only that', () => {
    expect(unfinishedGuide(journey({}, { first_value: { status: 'active', step: 2 } }))).toEqual({ id: 'first_value', step: 2 });
    expect(unfinishedGuide(journey({}, { first_value: { status: 'dismissed', step: 2 } }))).toBeUndefined();
    expect(unfinishedGuide(journey({}, { first_value: { status: 'done', step: 3 } }))).toBeUndefined();
  });

  it('waits for a workspace before starting', () => {
    expect(shouldAutoStart({ ...journey({ ask: false }), ready: false })).toBe(false);
    expect(shouldAutoStart({ ...journey({ ask: false }), ready: true })).toBe(true);
  });
});
