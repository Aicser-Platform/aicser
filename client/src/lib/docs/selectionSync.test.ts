import { Editor } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import { documentExtensions } from './extensions';
import { pendingSelection, selectionPending, SelectionSync } from './selectionSync';

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
  document.body.replaceChildren();
});

const open = () => {
  const element = document.createElement('div');
  document.body.append(element);
  editor = new Editor({
    element,
    extensions: [...documentExtensions({ placeholder: false }), SelectionSync],
    content: '<p>Line 1</p><p>Line 2</p><p>Line 3</p>',
  });
  editor.commands.setTextSelection(1);
  return editor;
};
/** A click at the end of "Line 2": the browser's cursor moves; ProseMirror's stays at the start. */
const clickEndOfLine2 = (ed: Editor) => {
  const text = ed.view.dom.querySelectorAll('p')[1]!.firstChild!;
  document.getSelection()!.collapse(text, 6);
};

describe('pendingSelection', () => {
  it('is the browser cursor while ProseMirror has not read it yet, then nothing', () => {
    const ed = open();
    clickEndOfLine2(ed);
    expect(selectionPending(ed.view)).toBe(true);
    const pending = pendingSelection(ed.view)!;
    expect(pending.$from.parent.textContent).toBe('Line 2');
    expect(pending.$from.parentOffset).toBe(6);
    ed.view.dispatch(ed.state.tr.setSelection(pending));
    clickEndOfLine2(ed);
    expect(selectionPending(ed.view)).toBe(false);
  });

  it('ignores a cursor outside the editor', () => {
    const ed = open();
    const outside = document.createElement('p');
    outside.textContent = 'elsewhere';
    document.body.append(outside);
    document.getSelection()!.collapse(outside.firstChild!, 2);
    expect(pendingSelection(ed.view)).toBeNull();
  });

  it('leaves a selected node (page break, image) as it is', () => {
    const ed = open();
    ed.commands.setTextSelection(1);
    ed.commands.setPageBreak();
    const breakPos = ed.state.doc.firstChild!.nodeSize;
    ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, breakPos)));
    clickEndOfLine2(ed);
    expect(pendingSelection(ed.view)).toBeNull();
  });
});

describe('SelectionSync', () => {
  it('a key right after a click acts at the clicked spot', () => {
    const ed = open();
    clickEndOfLine2(ed);
    // Enter before "selectionchange" reached ProseMirror: the paragraph splits after "Line 2", not at the start.
    ed.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(ed.state.doc.childCount).toBe(4);
    expect(ed.state.doc.child(0).textContent).toBe('Line 1');
    expect(ed.state.doc.child(1).textContent).toBe('Line 2');
    expect(ed.state.doc.child(2).textContent).toBe('');
    expect(ed.state.selection).toBeInstanceOf(TextSelection);
  });
});
