'use client';

import { EditorContent, useEditor, useEditorState, type Editor, type JSONContent } from '@tiptap/react';
import { useRouter } from 'next/navigation';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Code2,
  Download,
  FilePlus2,
  Eraser,
  Highlighter,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Loader2,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Table2,
  Type,
  Underline as UnderlineIcon,
  Undo2,
} from 'lucide-react';
import { useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { toast } from 'sonner';
import { EditorHeader } from '@/components/office/EditorHeader';
import { FontPicker, FontSizePicker } from '@/components/office/FontPicker';
import { ColorPicker, ToolButton, ToolSeparator } from '@/components/office/Toolbar';
import { ZoomControl } from '@/components/office/ZoomControl';
import { Button } from '@/components/aicser-ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/aicser-ui/dropdown-menu';
import { Input } from '@/components/aicser-ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/aicser-ui/native-select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/aicser-ui/popover';
import { PageElementsDialog, type PageElementField } from '@/components/docs/PageElementsDialog';
import { PageSheets } from '@/components/docs/PageSheets';
import { useOfficeFile, type OfficeSaveState } from '@/hooks/useOfficeFile';
import { downloadFile, pickImages } from '@/lib/office/files';
import { documentExtensions, isSafeLink } from '@/lib/docs/extensions';
import {
  PAGE_MARGINS,
  PAGE_SIZES,
  countWords,
  documentStore,
  pageDimensions,
  type DocumentBody,
  type PageSetup,
} from '@/lib/docs/model';
import { Pagination, setPageGeometry } from '@/lib/docs/pagination';
import { SelectionSync } from '@/lib/docs/selectionSync';
import { documentToDocx } from '@/lib/docs/toDocx';
import { OFFICE_FONTS } from '@/lib/office/fonts';
import { clampZoom } from '@/lib/office/zoom';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72];
const DEFAULT_FONT_SIZE = 11;

/** CSS px per mm, and the grey space between two pages. */
const PX_PER_MM = 96 / 25.4;
const PAGE_GAP = 24;

const sameFont = (a: string, b: string) => a.replace(/"/g, "'") === b.replace(/"/g, "'");

type BlockStyle = 'paragraph' | 'h1' | 'h2' | 'h3' | 'h4';
const BLOCK_STYLES: [BlockStyle, string][] = [
  ['paragraph', 'Normal text'],
  ['h1', 'Heading 1'],
  ['h2', 'Heading 2'],
  ['h3', 'Heading 3'],
  ['h4', 'Heading 4'],
];

/** The Docs editor: Word-like toolbar over a page, autosaved to the server, .docx export. */
export function DocumentEditor({ documentId }: Readonly<{ documentId: string }>) {
  const item = useOfficeFile(documentStore, documentId);
  const router = useRouter();
  if (item.state.status === 'loading') {
    return (
      <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Opening document…
      </p>
    );
  }
  if (item.state.status === 'error') {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 p-6 text-sm">
        The document could not be opened: {item.state.error.message}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={item.reload}>
            Retry
          </Button>
          <Button variant="ghost" size="sm" onClick={() => router.push('/docs')}>
            Back to Docs
          </Button>
        </div>
      </div>
    );
  }
  return (
    <LoadedEditor
      documentId={documentId}
      title={item.state.title}
      initial={item.state.body}
      saveState={item.saveState}
      role={item.state.summary.role}
      onRename={item.rename}
      onChange={item.setBody}
      onFlush={item.flush}
      onReload={item.reload}
    />
  );
}

function LoadedEditor({
  documentId,
  title,
  initial,
  saveState,
  role,
  onRename,
  onChange,
  onFlush,
  onReload,
}: Readonly<{
  documentId: string;
  title: string;
  initial: DocumentBody;
  saveState: OfficeSaveState;
  role: 'owner' | 'edit' | 'view';
  onRename: (title: string) => void;
  onChange: (body: DocumentBody, meta: Record<string, unknown>) => void;
  onFlush: () => Promise<void>;
  onReload: () => void;
}>) {
  const router = useRouter();
  const readOnly = saveState === 'readonly';
  const [page, setPage] = useState<PageSetup>(initial.page);
  const [zoom, setZoom] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [pages, setPages] = useState(1);
  const [elements, setElements] = useState<{ open: boolean; focus: PageElementField }>({
    open: false,
    focus: 'header',
  });
  // The editor's onUpdate is created once: it reads the latest page setup and callback through refs.
  const pageRef = useRef(page);
  const onChangeRef = useRef(onChange);
  useLayoutEffect(() => {
    pageRef.current = page;
    onChangeRef.current = onChange;
  });

  const save = (editor: Editor, nextPage = pageRef.current) => {
    const text = editor.getText();
    onChangeRef.current({ content: editor.getJSON(), page: nextPage }, { words: countWords(text) });
  };

  const editor = useEditor({
    extensions: [...documentExtensions(), Pagination, SelectionSync],
    content: initial.content,
    // Our styles live in docs.css (as on desktop, where TipTap's own <style> tag would break the CSP).
    injectCSS: false,
    editable: !readOnly,
    // Next renders on the server first: the editor mounts in the browser.
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { class: 'doc-content', 'aria-label': 'Document', spellcheck: 'true' },
    },
    onUpdate: ({ editor: e }) => save(e),
  });

  const changePage = (next: PageSetup) => {
    setPage(next);
    pageRef.current = next;
    if (editor) save(editor, next);
  };

  const exportDocx = async () => {
    if (!editor) return;
    setExporting(true);
    try {
      const bytes = await documentToDocx(title, editor.getJSON() as JSONContent, page);
      downloadFile(`${title.trim() || 'Document'}.docx`, bytes, 'docx');
    } catch (error) {
      toast.error(`Couldn't export the document: ${message(error)}`);
    } finally {
      setExporting(false);
    }
  };

  const remove = async () => {
    try {
      await onFlush();
      await documentStore.remove(documentId);
      router.push(`/docs?deleted=${encodeURIComponent(documentId)}`);
    } catch (error) {
      toast.error(message(error));
    }
  };

  const copy = async () => {
    try {
      await onFlush();
      const made = await documentStore.duplicate(documentId);
      router.push(`/docs/${encodeURIComponent(made.id)}`);
    } catch (error) {
      toast.error(`Couldn't copy the document: ${message(error)}`);
    }
  };

  const { widthMm, heightMm } = pageDimensions(page);
  const pageHeight = heightMm * PX_PER_MM;
  const margin = PAGE_MARGINS[page.margins].mm * PX_PER_MM;
  const stride = pageHeight + PAGE_GAP;
  useLayoutEffect(() => {
    if (editor) setPageGeometry(editor, { stride, contentHeight: pageHeight - 2 * margin }, setPages);
  }, [editor, stride, pageHeight, margin]);

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
      onKeyDownCapture={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          void onFlush();
        }
      }}
    >
      <EditorHeader
        fileType="doc"
        noun="document"
        listLabel="Docs"
        title={title}
        fileId={documentId}
        role={role}
        saveState={saveState}
        onBack={() => router.push('/docs')}
        onRename={onRename}
        onReload={onReload}
        onCopy={() => void copy()}
        onDelete={() => void remove()}
      >
        {!readOnly && (
          <Button size="sm" variant="outline" onClick={() => setElements({ open: true, focus: 'header' })}>
            Page elements
          </Button>
        )}
        {!readOnly && <PageSetupMenu page={page} onChange={changePage} />}
        <Button size="sm" onClick={() => void exportDocx()} disabled={exporting}>
          {exporting ? <Loader2 className="animate-spin" /> : <Download />} Export .docx
        </Button>
      </EditorHeader>

      {editor && !readOnly && <DocToolbar editor={editor} />}

      <div className="doc-desk min-h-0 flex-1 overflow-auto bg-muted/60 py-8">
        <div style={{ zoom }} className="mx-auto w-fit">
          {/* Separate sheets of paper behind one editor; Pagination keeps each block on one sheet. */}
          <div className="relative" style={{ width: `${widthMm}mm`, height: pages * stride - PAGE_GAP }}>
            <PageSheets page={page} pages={pages} stride={stride} pageHeight={pageHeight} margin={margin} />
            <div
              className="doc-page relative h-full text-black"
              style={{ padding: margin }}
              // As in Word and Google Docs: double-click a page's top or bottom margin to edit its header or footer.
              onDoubleClick={(e) => {
                if (readOnly) return;
                const band = marginBandAt(e, { stride, pageHeight, margin });
                if (band) setElements({ open: true, focus: band });
              }}
            >
              <EditorContent editor={editor} className="h-full" />
            </div>
          </div>
        </div>
      </div>

      <PageElementsDialog
        open={elements.open}
        focus={elements.focus}
        page={page}
        onOpenChange={(open) => setElements((current) => ({ ...current, open }))}
        onChange={changePage}
      />

      <footer className="flex items-center gap-4 border-t bg-background px-4 py-1 text-xs text-muted-foreground">
        {editor && <Counts editor={editor} />}
        <span className="ml-auto" />
        <ZoomControl zoom={zoom} onZoom={(z) => setZoom(clampZoom(z))} />
      </footer>
    </div>
  );
}

/**
 * The header or footer margin under a double-click, if any. Only the page's own margins count (not the text or the
 * grey space between pages). The page is zoomed with CSS `zoom`: compare the box's drawn and layout heights.
 */
function marginBandAt(
  e: ReactMouseEvent<HTMLElement>,
  g: { stride: number; pageHeight: number; margin: number }
): PageElementField | null {
  const target = e.target as HTMLElement;
  // Clicks in the text are the editor's (select a word); margins are the page box itself or a page gap.
  if (target !== e.currentTarget && !target.closest('.doc-page-gap')) return null;
  const box = e.currentTarget.getBoundingClientRect();
  const scale = e.currentTarget.offsetHeight ? box.height / e.currentTarget.offsetHeight : 1;
  const y = (e.clientY - box.top) / (scale || 1);
  const inPage = y - Math.floor(y / g.stride) * g.stride;
  if (inPage < g.margin) return 'header';
  if (inPage > g.pageHeight - g.margin && inPage <= g.pageHeight) return 'footer';
  return null;
}

function Counts({ editor }: Readonly<{ editor: Editor }>) {
  const counts = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      words: countWords(e.getText()),
      characters: e.storage.characterCount.characters(),
    }),
  });
  return (
    <span role="status" aria-label="Word count">
      {counts.words} {counts.words === 1 ? 'word' : 'words'} · {counts.characters} characters
    </span>
  );
}

function PageSetupMenu({ page, onChange }: Readonly<{ page: PageSetup; onChange: (page: PageSetup) => void }>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline">
          Page setup
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Paper size</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={page.size}
          onValueChange={(v) => onChange({ ...page, size: v as PageSetup['size'] })}
        >
          {Object.entries(PAGE_SIZES).map(([key, size]) => (
            <DropdownMenuRadioItem key={key} value={key}>
              {size.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Orientation</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={page.orientation}
          onValueChange={(v) => onChange({ ...page, orientation: v as PageSetup['orientation'] })}
        >
          <DropdownMenuRadioItem value="portrait">Portrait</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="landscape">Landscape</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Margins</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={page.margins}
          onValueChange={(v) => onChange({ ...page, margins: v as PageSetup['margins'] })}
        >
          {Object.entries(PAGE_MARGINS).map(([key, m]) => (
            <DropdownMenuRadioItem key={key} value={key}>
              {m.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DocToolbar({ editor }: Readonly<{ editor: Editor }>) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const style = e.getAttributes('textStyle') as { fontFamily?: string; fontSize?: string; color?: string };
      let block: BlockStyle = 'paragraph';
      for (const level of [1, 2, 3, 4] as const) if (e.isActive('heading', { level })) block = `h${level}`;
      return {
        block,
        fontFamily: style.fontFamily ?? '',
        fontSize: style.fontSize ?? '',
        color: style.color ?? null,
        highlight: (e.getAttributes('highlight') as { color?: string }).color ?? null,
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        underline: e.isActive('underline'),
        strike: e.isActive('strike'),
        subscript: e.isActive('subscript'),
        superscript: e.isActive('superscript'),
        link: e.isActive('link'),
        href: (e.getAttributes('link') as { href?: string }).href ?? '',
        align: (['left', 'center', 'right', 'justify'] as const).find((a) => e.isActive({ textAlign: a })) ?? 'left',
        bullet: e.isActive('bulletList'),
        ordered: e.isActive('orderedList'),
        task: e.isActive('taskList'),
        quote: e.isActive('blockquote'),
        code: e.isActive('codeBlock'),
        table: e.isActive('table'),
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
        canSink: e.can().sinkListItem('listItem') || e.can().sinkListItem('taskItem'),
        canLift: e.can().liftListItem('listItem') || e.can().liftListItem('taskItem'),
      };
    },
  });
  const chain = () => focusedChain(editor);
  const font = OFFICE_FONTS.find((f) => s.fontFamily && sameFont(f.stack, s.fontFamily));
  const pt = /^(\d+(?:\.\d+)?)pt$/.exec(s.fontSize)?.[1];
  const sizePt = pt ? Number(pt) : s.fontSize ? null : DEFAULT_FONT_SIZE;

  const setBlock = (value: BlockStyle) => {
    if (value === 'paragraph') chain().setParagraph().run();
    else
      chain()
        .setHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 | 4 })
        .run();
  };

  const insertImage = async () => {
    try {
      const [image] = await pickImages(1);
      if (image) chain().setImage({ src: image.dataUrl, alt: image.name }).run();
    } catch (error) {
      toast.error(`Couldn't add the image: ${message(error)}`);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b px-3 py-1" role="toolbar" aria-label="Formatting">
      <ToolButton label="Undo" onClick={() => chain().undo().run()} disabled={!s.canUndo}>
        <Undo2 />
      </ToolButton>
      <ToolButton label="Redo" onClick={() => chain().redo().run()} disabled={!s.canRedo}>
        <Redo2 />
      </ToolButton>
      <ToolSeparator />
      <NativeSelect
        size="sm"
        aria-label="Text style"
        className="w-32"
        value={s.block}
        onChange={(e) => setBlock(e.target.value as BlockStyle)}
      >
        {BLOCK_STYLES.map(([value, label]) => (
          <NativeSelectOption key={value} value={value}>
            {label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <FontPicker
        value={font?.name}
        restoreFocus={false}
        onChange={(name) => {
          const next = OFFICE_FONTS.find((f) => f.name === name);
          if (next) chain().setFontFamily(next.stack).run();
          else chain().unsetFontFamily().run();
        }}
      />
      <FontSizePicker
        value={sizePt}
        sizes={FONT_SIZES}
        min={1}
        max={400}
        restoreFocus={false}
        onChange={(size) => chain().setFontSize(`${size}pt`).run()}
      />
      <ToolSeparator />
      <ToolButton label="Bold" pressed={s.bold} onClick={() => chain().toggleBold().run()}>
        <Bold />
      </ToolButton>
      <ToolButton label="Italic" pressed={s.italic} onClick={() => chain().toggleItalic().run()}>
        <Italic />
      </ToolButton>
      <ToolButton label="Underline" pressed={s.underline} onClick={() => chain().toggleUnderline().run()}>
        <UnderlineIcon />
      </ToolButton>
      <ToolButton label="Strikethrough" pressed={s.strike} onClick={() => chain().toggleStrike().run()}>
        <Strikethrough />
      </ToolButton>
      <ToolButton label="Subscript" pressed={s.subscript} onClick={() => chain().toggleSubscript().run()}>
        <SubscriptIcon />
      </ToolButton>
      <ToolButton label="Superscript" pressed={s.superscript} onClick={() => chain().toggleSuperscript().run()}>
        <SuperscriptIcon />
      </ToolButton>
      <ColorPicker
        label="Text color"
        icon={<Type />}
        value={s.color}
        onPick={(c) => (c ? chain().setColor(c).run() : chain().unsetColor().run())}
      />
      <ColorPicker
        label="Highlight"
        icon={<Highlighter />}
        value={s.highlight}
        onPick={(c) => (c ? chain().setHighlight({ color: c }).run() : chain().unsetHighlight().run())}
      />
      <LinkButton editor={editor} active={s.link} href={s.href} />
      <ToolSeparator />
      {(
        [
          ['left', 'Align left', AlignLeft],
          ['center', 'Center', AlignCenter],
          ['right', 'Align right', AlignRight],
          ['justify', 'Justify', AlignJustify],
        ] as const
      ).map(([align, label, Icon]) => (
        <ToolButton
          key={align}
          label={label}
          pressed={s.align === align}
          onClick={() => chain().setTextAlign(align).run()}
        >
          <Icon />
        </ToolButton>
      ))}
      <ToolSeparator />
      <ToolButton label="Bulleted list" pressed={s.bullet} onClick={() => chain().toggleBulletList().run()}>
        <List />
      </ToolButton>
      <ToolButton label="Numbered list" pressed={s.ordered} onClick={() => chain().toggleOrderedList().run()}>
        <ListOrdered />
      </ToolButton>
      <ToolButton label="Checklist" pressed={s.task} onClick={() => chain().toggleTaskList().run()}>
        <ListChecks />
      </ToolButton>
      <ToolButton
        label="Decrease indent"
        disabled={!s.canLift}
        onClick={() =>
          editor.isActive('taskItem') ? chain().liftListItem('taskItem').run() : chain().liftListItem('listItem').run()
        }
      >
        <IndentDecrease />
      </ToolButton>
      <ToolButton
        label="Increase indent"
        disabled={!s.canSink}
        onClick={() =>
          editor.isActive('taskItem') ? chain().sinkListItem('taskItem').run() : chain().sinkListItem('listItem').run()
        }
      >
        <IndentIncrease />
      </ToolButton>
      <ToolSeparator />
      <ToolButton label="Quote" pressed={s.quote} onClick={() => chain().toggleBlockquote().run()}>
        <Quote />
      </ToolButton>
      <ToolButton label="Code block" pressed={s.code} onClick={() => chain().toggleCodeBlock().run()}>
        <Code2 />
      </ToolButton>
      <ToolButton label="Horizontal line" onClick={() => chain().setHorizontalRule().run()}>
        <Minus />
      </ToolButton>
      <ToolButton label="Page break (⌘Enter)" onClick={() => chain().setPageBreak().run()}>
        <FilePlus2 />
      </ToolButton>
      <ToolButton label="Insert image" onClick={() => void insertImage()}>
        <ImagePlus />
      </ToolButton>
      <TableMenu editor={editor} inTable={s.table} />
      <ToolSeparator />
      <ToolButton label="Clear formatting" onClick={() => chain().unsetAllMarks().clearNodes().run()}>
        <Eraser />
      </ToolButton>
    </div>
  );
}

function LinkButton({ editor, active, href }: Readonly<{ editor: Editor; active: boolean; href: string }>) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const apply = () => {
    const url = value.trim();
    if (!url) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    } else {
      const full = /^[a-z]+:/i.test(url) ? url : `https://${url}`;
      if (!isSafeLink(full)) {
        toast.error('Links must start with https://, http:// or mailto:.');
        return;
      }
      editor.chain().focus().extendMarkRange('link').setLink({ href: full }).run();
    }
    setOpen(false);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setValue(href);
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant={active ? 'secondary' : 'ghost'}
          size="icon-sm"
          aria-label="Link"
          aria-pressed={active}
          onMouseDown={(e) => e.preventDefault()}
        >
          <Link2 />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          <Input
            aria-label="Link address"
            placeholder="https://example.com"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <Button type="submit" size="sm">
            {value.trim() || !active ? 'Apply' : 'Remove'}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/**
 * A command chain with the editor focused at once. TipTap's own `focus()` waits a frame when the editor isn't
 * focused (after a menu pick such as the font), and a key typed in that frame would be lost.
 */
function focusedChain(editor: Editor) {
  if (!editor.view.hasFocus()) editor.view.focus();
  return editor.chain().focus();
}

/** The table size grid's columns and rows (Google Docs offers up to 20 × 20; more rows can be added later). */
const GRID_COLS = 10;
const GRID_ROWS = 8;

function TableMenu({ editor, inTable }: Readonly<{ editor: Editor; inTable: boolean }>) {
  const [open, setOpen] = useState(false);
  const chain = () => focusedChain(editor);
  const insert = (rows: number, cols: number) => {
    setOpen(false);
    chain().insertTable({ rows, cols, withHeaderRow: true }).run();
  };
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant={inTable ? 'secondary' : 'ghost'}
          size="icon-sm"
          aria-label="Table"
          onMouseDown={(e) => e.preventDefault()}
        >
          <Table2 />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DropdownMenuLabel>Insert table</DropdownMenuLabel>
        <TableSizeGrid onPick={insert} />
        {inTable && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => chain().addRowBefore().run()}>Insert row above</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => chain().addRowAfter().run()}>Insert row below</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => chain().addColumnBefore().run()}>Insert column left</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => chain().addColumnAfter().run()}>Insert column right</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => chain().mergeCells().run()} disabled={!editor.can().mergeCells()}>
              Merge cells
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => chain().splitCell().run()} disabled={!editor.can().splitCell()}>
              Split cell
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => chain().toggleHeaderRow().run()}>Header row on / off</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => chain().deleteRow().run()}>Delete row</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => chain().deleteColumn().run()}>Delete column</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => chain().deleteTable().run()}>
              Delete table
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Pick a table's size by pointing at a grid (as in Google Docs and Word): the cells up to the pointer light up and
 * the label reads "columns × rows" (as in Word). Arrow keys move the size, Enter inserts.
 */
function TableSizeGrid({ onPick }: Readonly<{ onPick: (rows: number, cols: number) => void }>) {
  const [size, setSize] = useState({ rows: 1, cols: 1 });
  const clamp = (n: number, max: number) => Math.min(max, Math.max(1, n));
  return (
    <div className="px-2 pb-2">
      <div
        role="group"
        aria-label="Table size"
        tabIndex={0}
        className="grid w-fit gap-0.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ gridTemplateColumns: `repeat(${GRID_COLS}, 1rem)` }}
        onKeyDown={(e) => {
          const step: Record<string, [number, number]> = {
            ArrowRight: [0, 1],
            ArrowLeft: [0, -1],
            ArrowDown: [1, 0],
            ArrowUp: [-1, 0],
          };
          const move = step[e.key];
          if (move) {
            e.preventDefault();
            e.stopPropagation();
            setSize((s) => ({ rows: clamp(s.rows + move[0], GRID_ROWS), cols: clamp(s.cols + move[1], GRID_COLS) }));
          } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onPick(size.rows, size.cols);
          }
        }}
      >
        {Array.from({ length: GRID_ROWS }, (_, r) =>
          Array.from({ length: GRID_COLS }, (_, c) => {
            const lit = r < size.rows && c < size.cols;
            return (
              <button
                key={`${r}-${c}`}
                type="button"
                tabIndex={-1}
                aria-label={`Insert table, ${c + 1} columns by ${r + 1} rows`}
                className={`size-4 rounded-[3px] border transition-colors ${
                  lit ? 'border-primary bg-primary/25' : 'border-border bg-background'
                }`}
                onMouseEnter={() => setSize({ rows: r + 1, cols: c + 1 })}
                onFocus={() => setSize({ rows: r + 1, cols: c + 1 })}
                onClick={() => onPick(r + 1, c + 1)}
              />
            );
          })
        )}
      </div>
      <p className="mt-1.5 text-center text-xs text-muted-foreground" aria-live="polite">
        {size.cols} × {size.rows}
      </p>
    </div>
  );
}
