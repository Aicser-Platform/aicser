import { Node } from '@tiptap/core';
import { Selection, TextSelection } from '@tiptap/pm/state';

// A page break (Word's Ctrl+Enter): what follows starts on a new page. Saved in the document, written to .docx
// as a page break and read back from Word files (fromDocx maps Word's page breaks to `hr.page-break`).

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageBreak: {
      /** Inserts a page break at the cursor (splitting the paragraph) and puts the cursor after it. */
      setPageBreak: () => ReturnType;
    };
  }
}

export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  parseHTML() {
    // Before the horizontal rule's plain `hr` rule.
    return [{ tag: 'div[data-page-break]' }, { tag: 'hr.page-break', priority: 60 }];
  },

  renderHTML() {
    return ['div', { 'data-page-break': '', class: 'doc-page-break', contenteditable: 'false' }, 'Page break'];
  },

  addCommands() {
    return {
      setPageBreak:
        () =>
        ({ chain }) =>
          chain()
            .insertContent({ type: this.name })
            .command(({ tr, dispatch }) => {
              if (!dispatch) return true;
              // Always leave a paragraph after the break to type into.
              const last = tr.doc.lastChild;
              if (last?.type.name === this.name) {
                const paragraph = tr.doc.type.schema.nodes.paragraph;
                if (paragraph) tr.insert(tr.doc.content.size, paragraph.create());
              }
              const { selection } = tr;
              if (!(selection instanceof TextSelection) || selection.$from.parent.type.name === 'doc') {
                const after = tr.doc.resolve(Math.min(tr.doc.content.size, selection.to));
                tr.setSelection(Selection.near(after, 1));
              }
              tr.scrollIntoView();
              return true;
            })
            .run(),
    };
  },

  addKeyboardShortcuts() {
    return { 'Mod-Enter': () => this.editor.commands.setPageBreak() };
  },
});
