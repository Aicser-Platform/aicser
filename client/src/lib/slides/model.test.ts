import { describe, expect, it } from 'vitest';
import { commit, redo, startHistory, undo } from './history';
import {
  ElementSchema,
  PresentationBodySchema,
  clampBox,
  copyElement,
  elementColor,
  elementFont,
  layoutElements,
  newSlide,
  resizeBox,
  snapMove,
  slideTitle,
  themeById,
} from './model';

describe('slides model', () => {
  it('layouts start with placeholder boxes', () => {
    expect(layoutElements('title').map((e) => e.placeholder)).toEqual(['title', 'subtitle']);
    expect(layoutElements('two-content').map((e) => e.placeholder)).toEqual(['title', 'body', 'body']);
    expect(layoutElements('blank')).toEqual([]);
    expect(layoutElements('title-content')[1]?.style.bullets).toBe(true);
  });

  it('fills defaults for stored bodies and refuses remote pictures', () => {
    const body = PresentationBodySchema.parse({
      slides: [{ id: 's1', elements: [{ id: 'e', kind: 'text', x: 0, y: 0, w: 10, h: 10 }] }],
    });
    expect(body.themeId).toBe('office');
    expect(body.slides[0]?.elements[0]?.style).toMatchObject({ fontSize: 18, align: 'left', valign: 'top' });
    expect(
      ElementSchema.safeParse({ id: 'i', kind: 'image', x: 0, y: 0, w: 1, h: 1, src: 'https://evil/x.png' }).success
    ).toBe(false);
  });

  it('uses the theme for unset fonts and colours', () => {
    const theme = themeById('angkor');
    const [title, sub] = layoutElements('title');
    expect(elementFont(title!, theme)).toBe('Moul');
    expect(elementFont(sub!, theme)).toBe('Kantumruy Pro');
    expect(elementColor(title!, theme)).toBe('#fbbf24');
    expect(themeById('nope').id).toBe('office');
  });

  it('resizes from any handle, keeping the ratio from corners when asked', () => {
    const box = { x: 100, y: 100, w: 200, h: 100 };
    expect(resizeBox(box, 'e', 50, 0, false)).toEqual({ x: 100, y: 100, w: 250, h: 100 });
    expect(resizeBox(box, 'nw', 20, 10, false)).toEqual({ x: 120, y: 110, w: 180, h: 90 });
    expect(resizeBox(box, 'se', 200, 0, true)).toEqual({ x: 100, y: 100, w: 400, h: 200 });
    expect(resizeBox(box, 'w', 500, 0, false).w).toBe(8);
  });

  it('snaps to the slide centre and other elements, and keeps boxes reachable', () => {
    const snapped = snapMove({ x: 377, y: 10, w: 200, h: 50 }, []);
    expect(snapped.x).toBe(380);
    expect(snapped.guides.v).toEqual([480]);
    const toOther = snapMove({ x: 503, y: 300, w: 50, h: 50 }, [{ x: 100, y: 100, w: 400, h: 100 }]);
    expect(toOther.x).toBe(500);
    expect(clampBox({ x: 5000, y: -5000, w: 50, h: 50 })).toMatchObject({ x: 950, y: -40 });
  });

  it('copies elements and slides with new ids', () => {
    const slide = newSlide('title');
    slide.elements[0]!.text = 'Hello\nworld';
    const copy = copyElement(slide.elements[0]!, 16);
    expect(copy.id).not.toBe(slide.elements[0]!.id);
    expect(copy.x).toBe(slide.elements[0]!.x + 16);
    expect(slideTitle(slide)).toBe('Hello');
  });
});

describe('slides history', () => {
  it('undoes, redoes and merges typing into one step', () => {
    let h = startHistory(1);
    h = commit(h, 2);
    h = commit(h, 3, 'notes', 1000);
    h = commit(h, 4, 'notes', 1500);
    expect(h.past).toEqual([1, 2]);
    h = undo(h);
    expect(h.present).toBe(2);
    h = redo(h);
    expect(h.present).toBe(4);
    h = commit(h, 5, 'notes', 5000);
    expect(h.past).toEqual([1, 2, 4]);
    expect(undo(startHistory(1))).toEqual(startHistory(1));
  });
});
