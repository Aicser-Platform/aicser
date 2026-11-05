'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, theme } from 'antd';
import { CheckCircleFilled, CloseOutlined, CompassOutlined, LoadingOutlined } from '@ant-design/icons';
import { openChecklist } from './guideEvents';
import { placeCard } from './guidePlacement';

/** What the person is up to, which decides how much of the guide they need to see. */
export type CoachState = 'point' | 'typing' | 'working' | 'done';

interface GuideCoachProps {
  target: HTMLElement | null;
  /** Changes with each step, so the content fades in and the ring glides over. */
  stepKey: string;
  title: string;
  body?: string;
  progress?: string;
  /** Names the button that opens the Getting started list. */
  checklistLabel?: string;
  state: CoachState;
  actions?: React.ReactNode;
  closeLabel: string;
  onClose: () => void;
}

const GLIDE_MS = 420;

/** Whether a dialog that the target isn't part of is on top: the guide then waits behind it. */
function coveredByDialog(target: HTMLElement | null): boolean {
  if (target?.closest('.ant-modal, .ant-drawer')) return false;
  return Array.from(document.querySelectorAll<HTMLElement>('.ant-modal, .ant-drawer-content'))
    .some((el) => el.getClientRects().length > 0);
}

/** Whether the target can actually be seen: not scrolled out of the page or of its own panel. */
function inView(target: HTMLElement, rect: DOMRect): boolean {
  if (rect.width <= 0 || rect.height <= 0) return false;
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;
  const top = document.elementFromPoint(x, y);
  return Boolean(top && (target.contains(top) || top.contains(target)));
}

/**
 * A soft glow on the next thing to click and a small card beside it. Both float above the page and the
 * glow lets every click through, so nothing is blocked. They follow the target frame by frame and
 * only animate when the step changes, so scrolling never makes them lag behind.
 */
export function GuideCoach({ target, stepKey, title, body, progress, checklistLabel, state, actions, closeLabel, onClose }: GuideCoachProps) {
  const { token } = theme.useToken();
  const ringRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    target?.setAttribute('data-guide-active', '');
    target?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const parts = [ringRef.current, cardRef.current];
    parts.forEach((part) => part?.classList.add('guide-gliding'));
    const timer = window.setTimeout(() => parts.forEach((part) => part?.classList.remove('guide-gliding')), GLIDE_MS);
    return () => {
      window.clearTimeout(timer);
      target?.removeAttribute('data-guide-active');
    };
  }, [target, stepKey]);

  useEffect(() => {
    if (!mounted) return undefined;
    let frame = 0;
    let tick = 0;
    let covered = false;
    let reachable = false;
    let last = '';
    const follow = () => {
      frame = window.requestAnimationFrame(follow);
      const ring = ringRef.current;
      const card = cardRef.current;
      if (!ring || !card) return;
      tick += 1;
      const rect = target?.getBoundingClientRect();
      if (tick % 15 === 1) {
        covered = coveredByDialog(target);
        reachable = Boolean(target && rect && inView(target, rect));
        // Inside a dialog it has to sit above that dialog and its overlay.
        const host = target?.closest<HTMLElement>('.ant-modal-wrap, .ant-drawer');
        const layer = host ? String((Number(getComputedStyle(host).zIndex) || 1000) + 1) : '';
        ring.style.zIndex = layer;
        card.style.zIndex = layer;
      }
      const shown = rect && reachable ? rect : null;
      const place = placeCard(
        shown && { left: shown.left, top: shown.top, width: shown.width, height: shown.height },
        { width: card.offsetWidth, height: card.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      );
      const now = [shown?.left, shown?.top, shown?.width, shown?.height, place.x, place.y, place.side, covered, card.offsetHeight].join();
      if (now === last) return;
      last = now;
      if (shown) {
        ring.style.transform = `translate(${shown.left}px, ${shown.top}px)`;
        ring.style.width = `${shown.width}px`;
        ring.style.height = `${shown.height}px`;
        ring.style.borderRadius = getComputedStyle(target as HTMLElement).borderTopLeftRadius;
      }
      ring.dataset.visible = String(Boolean(shown) && !covered);
      card.style.transform = `translate(${place.x}px, ${place.y}px)`;
      card.style.setProperty('--guide-arrow', `${place.arrow}px`);
      card.dataset.side = place.side;
      card.dataset.visible = String(!covered);
    };
    follow();
    return () => window.cancelAnimationFrame(frame);
  }, [target, mounted]);

  if (!mounted) return null;

  const colours = {
    '--guide-primary': state === 'done' ? token.colorSuccess : token.colorPrimary,
    '--guide-bg': token.colorBgElevated,
    '--guide-border': token.colorBorder,
    '--guide-text': token.colorText,
    '--guide-muted': token.colorTextSecondary,
    '--guide-shadow': token.boxShadowSecondary,
  } as React.CSSProperties;

  return createPortal(
    <>
      <div ref={ringRef} className="guide-ring" data-state={state} data-visible="false" style={colours} aria-hidden />
      <div ref={cardRef} className="guide-card" data-state={state} data-visible="false" style={colours} role="status">
        <span className="guide-card__arrow" aria-hidden />
        <div key={stepKey} className="guide-card__content">
          <div className="guide-card__head">
            {state === 'done' && <CheckCircleFilled className="guide-card__tick" aria-hidden />}
            {state === 'working' && <LoadingOutlined className="guide-card__busy" aria-hidden />}
            <span className="guide-card__title">{title}</span>
            <Button type="text" size="small" className="guide-card__close" icon={<CloseOutlined />} aria-label={closeLabel} onClick={onClose} />
          </div>
          {body && <p className="guide-card__body">{body}</p>}
          {(progress || actions) && (
            <div className="guide-card__foot">
              {progress && (
                <Button type="text" size="small" className="guide-card__progress" icon={<CompassOutlined />} aria-label={checklistLabel} title={checklistLabel} onClick={openChecklist}>
                  {progress}
                </Button>
              )}
              <span className="guide-card__actions">{actions}</span>
            </div>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
