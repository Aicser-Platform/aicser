import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection, type Selection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

// ProseMirror learns about a click from the browser's "selectionchange" event, which can come after the next key
// (a busy machine). Until then its own cursor is the old one: a shortcut pressed right after a click (⌘Enter for a
// page break, Enter, ⌘B…) would act there — a page break meant for "Line 2" went to the top of the document.

/**
 * The browser's cursor as a ProseMirror selection when ProseMirror hasn't read it yet, else null. Only text
 * cursors: a selected node (page break, image) is drawn differently in the page and must stay as it is.
 */
export function pendingSelection(view: EditorView): Selection | null {
  if (view.composing || !(view.state.selection instanceof TextSelection)) return null;
  const sel = view.dom.ownerDocument.getSelection();
  if (!sel?.anchorNode || !sel.focusNode || !view.dom.contains(sel.anchorNode) || !view.dom.contains(sel.focusNode))
    return null;
  try {
    const anchor = view.posAtDOM(sel.anchorNode, sel.anchorOffset);
    const head = view.posAtDOM(sel.focusNode, sel.focusOffset);
    const { selection, doc } = view.state;
    if (anchor === selection.anchor && head === selection.head) return null;
    return TextSelection.between(doc.resolve(anchor), doc.resolve(head));
  } catch {
    // A spot ProseMirror can't map (inside a page gap widget): keep ProseMirror's own.
    return null;
  }
}

/** True while a click hasn't reached ProseMirror yet (see `pendingSelection`). */
export const selectionPending = (view: EditorView) => pendingSelection(view) !== null;

/** Before any key is handled, take the browser's cursor if ProseMirror is still behind it. */
export const SelectionSync = Extension.create({
  name: 'selectionSync',
  // Before the keymaps (higher priority = earlier), so they see the synced cursor.
  priority: 1000,
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('selectionSync'),
        props: {
          handleKeyDown: (view) => {
            const selection = pendingSelection(view);
            if (selection) view.dispatch(view.state.tr.setSelection(selection));
            return false;
          },
        },
      }),
    ];
  },
});
