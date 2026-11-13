'use client';

import { useRouter } from 'next/navigation';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  ArrowDown,
  ArrowUp,
  BringToFront,
  Bold,
  Copy,
  Download,
  ImagePlus,
  Italic,
  List,
  Loader2,
  NotebookText,
  PaintBucket,
  Palette,
  Pen,
  Play,
  Plus,
  Redo2,
  SendToBack,
  Shapes,
  Trash2,
  Type,
  Underline,
  Undo2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { EditorHeader } from '@/components/office/EditorHeader';
import { FontPicker, FontSizePicker } from '@/components/office/FontPicker';
import { ColorPicker, ToolButton, ToolSeparator } from '@/components/office/Toolbar';
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
import { Textarea } from '@/components/aicser-ui/textarea';
import { useOfficeFile, type OfficeSaveState } from '@/hooks/useOfficeFile';
import { downloadFile, pickImages } from '@/lib/office/files';
import { commit, redo, startHistory, undo, type History } from '@/lib/slides/history';
import {
  LAYOUTS,
  LAYOUT_LABELS,
  SHAPES,
  SHAPE_LABELS,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  THEMES,
  TextStyleSchema,
  copyElement,
  cloneSlide,
  elementFont,
  newSlide,
  presentationStore,
  slideTitle,
  textElement,
  themeById,
  type LayoutKind,
  type PresentationBody,
  type ShapeKind,
  type Slide,
  type SlideElement,
  type TextStyle,
} from '@/lib/slides/model';
import { presentationToPptx } from '@/lib/slides/toPptx';
import { cn } from '@/lib/ui/utils';
import { PresentMode } from './PresentMode';
import { SlideCanvas } from './SlideCanvas';
import { SlideView } from './SlideView';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const FONT_SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 54, 60, 72, 96];

/** The Slides editor: thumbnails, the slide canvas, toolbar, speaker notes, present full screen, .pptx export. */
export function PresentationEditor({ presentationId }: Readonly<{ presentationId: string }>) {
  const item = useOfficeFile(presentationStore, presentationId);
  const router = useRouter();
  if (item.state.status === 'loading') {
    return (
      <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Opening presentation…
      </p>
    );
  }
  if (item.state.status === 'error') {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 p-6 text-sm">
        The presentation could not be opened: {item.state.error.message}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={item.reload}>
            Retry
          </Button>
          <Button variant="ghost" size="sm" onClick={() => router.push('/slides')}>
            Back to Slides
          </Button>
        </div>
      </div>
    );
  }
  return (
    <LoadedEditor
      presentationId={presentationId}
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
  presentationId,
  title,
  initial,
  saveState,
  role,
  onRename,
  onChange,
  onFlush,
  onReload,
}: Readonly<{
  presentationId: string;
  title: string;
  initial: PresentationBody;
  saveState: OfficeSaveState;
  role: 'owner' | 'edit' | 'view';
  onRename: (title: string) => void;
  onChange: (body: PresentationBody, meta: Record<string, unknown>) => void;
  onFlush: () => Promise<void>;
  onReload: () => void;
}>) {
  const router = useRouter();
  // Shared with this person to view: look and present, no changes.
  const readOnly = saveState === 'readonly';
  const [history, setHistory] = useState<History<PresentationBody>>(() =>
    startHistory(initial.slides.length ? initial : { ...initial, slides: [newSlide('title')] })
  );
  const body = history.present;
  const [currentId, setCurrentId] = useState(() => body.slides[0]?.id ?? '');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [presenting, setPresenting] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const clipboardRef = useRef<SlideElement | null>(null);
  const historyRef = useRef(history);

  const theme = themeById(body.themeId);
  const index = Math.max(
    0,
    body.slides.findIndex((s) => s.id === currentId)
  );
  const slide = body.slides[index] ?? body.slides[0]!;
  const selected = slide.elements.find((e) => e.id === selectedId) ?? null;

  const apply = useCallback(
    (next: History<PresentationBody>) => {
      if (next === historyRef.current || readOnly) return;
      historyRef.current = next;
      setHistory(next);
      onChange(next.present, { slides: next.present.slides.length });
    },
    [onChange, readOnly]
  );

  const update = (fn: (b: PresentationBody) => PresentationBody, merge?: string) =>
    apply(commit(historyRef.current, fn(historyRef.current.present), merge));

  const updateSlide = (id: string, fn: (s: Slide) => Slide, merge?: string) =>
    update((b) => ({ ...b, slides: b.slides.map((s) => (s.id === id ? fn(s) : s)) }), merge);

  const updateElement = (elId: string, patch: Partial<SlideElement>, merge?: string) =>
    updateSlide(
      slide.id,
      (s) => ({ ...s, elements: s.elements.map((e) => (e.id === elId ? { ...e, ...patch } : e)) }),
      merge
    );

  const updateStyle = (patch: Partial<TextStyle>) => {
    if (selected) updateElement(selected.id, { style: { ...selected.style, ...patch } });
  };

  const addElement = (el: SlideElement) => {
    updateSlide(slide.id, (s) => ({ ...s, elements: [...s.elements, el] }));
    setSelectedId(el.id);
  };

  const removeElement = (elId: string) => {
    updateSlide(slide.id, (s) => ({ ...s, elements: s.elements.filter((e) => e.id !== elId) }));
    setSelectedId(null);
    setEditingId(null);
  };

  const reorder = (elId: string, where: 'front' | 'back' | 'forward' | 'backward') =>
    updateSlide(slide.id, (s) => {
      const els = [...s.elements];
      const i = els.findIndex((e) => e.id === elId);
      if (i < 0) return s;
      const [el] = els.splice(i, 1);
      const to = { front: els.length, back: 0, forward: Math.min(els.length, i + 1), backward: Math.max(0, i - 1) }[
        where
      ];
      els.splice(to, 0, el!);
      return { ...s, elements: els };
    });

  const addSlide = (layout: LayoutKind) => {
    const s = newSlide(layout);
    update((b) => {
      const slides = [...b.slides];
      slides.splice(index + 1, 0, s);
      return { ...b, slides };
    });
    setCurrentId(s.id);
    setSelectedId(null);
  };

  const duplicateSlide = () => {
    const copy = cloneSlide(slide);
    update((b) => {
      const slides = [...b.slides];
      slides.splice(index + 1, 0, copy);
      return { ...b, slides };
    });
    setCurrentId(copy.id);
  };

  const deleteSlide = () => {
    if (body.slides.length <= 1) {
      toast.error('A presentation needs at least one slide.');
      return;
    }
    const next = body.slides[index + 1] ?? body.slides[index - 1];
    update((b) => ({ ...b, slides: b.slides.filter((s) => s.id !== slide.id) }));
    if (next) setCurrentId(next.id);
    setSelectedId(null);
  };

  const moveSlide = (from: number, to: number) => {
    if (to < 0 || to >= body.slides.length || from === to) return;
    update((b) => {
      const slides = [...b.slides];
      const [s] = slides.splice(from, 1);
      slides.splice(to, 0, s!);
      return { ...b, slides };
    });
  };

  const insertText = () =>
    addElement(
      textElement({ x: 280, y: 220, w: 400, h: 80, text: '', style: TextStyleSchema.parse({ fontSize: 24 }) })
    );

  const insertShape = (shape: ShapeKind) =>
    addElement({
      ...textElement({ x: 380, y: 190, w: shape === 'line' ? 200 : 200, h: shape === 'line' ? 0 : 160 }),
      kind: 'shape',
      shape,
      fill: shape === 'line' ? null : theme.accent,
      stroke: shape === 'line' ? theme.text : null,
      strokeWidth: shape === 'line' ? 2 : 0,
      style: TextStyleSchema.parse({ fontSize: 18, align: 'center', valign: 'middle', color: '#ffffff' }),
    });

  const insertImage = async () => {
    try {
      const [image] = await pickImages(1);
      if (!image) return;
      const src = image.dataUrl;
      const size = await naturalSize(src);
      const fit = Math.min(1, (SLIDE_WIDTH * 0.6) / size.width, (SLIDE_HEIGHT * 0.6) / size.height);
      const w = size.width * fit;
      const h = size.height * fit;
      addElement({ ...textElement({ x: (SLIDE_WIDTH - w) / 2, y: (SLIDE_HEIGHT - h) / 2, w, h }), kind: 'image', src });
    } catch (error) {
      toast.error(`Couldn't add the picture: ${message(error)}`);
    }
  };

  const paste = () => {
    const el = clipboardRef.current;
    if (!el) return;
    const copy = copyElement(el, 16);
    clipboardRef.current = copy;
    addElement(copy);
  };

  const exportPptx = async () => {
    setExporting(true);
    try {
      const bytes = await presentationToPptx(title, body);
      downloadFile(`${title.trim() || 'Presentation'}.pptx`, bytes, 'pptx');
    } catch (error) {
      toast.error(`Couldn't export the presentation: ${message(error)}`);
    } finally {
      setExporting(false);
    }
  };

  const remove = async () => {
    try {
      await onFlush();
      await presentationStore.remove(presentationId);
      router.push(`/slides?deleted=${encodeURIComponent(presentationId)}`);
    } catch (error) {
      toast.error(message(error));
    }
  };

  const copy = async () => {
    try {
      await onFlush();
      const made = await presentationStore.duplicate(presentationId);
      router.push(`/slides/${encodeURIComponent(made.id)}`);
    } catch (error) {
      toast.error(`Couldn't copy the presentation: ${message(error)}`);
    }
  };

  // Undo / redo / present anywhere in the editor, except while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === 'F5') {
        e.preventDefault();
        setPresenting(e.shiftKey ? index : 0);
        return;
      }
      if (typing || !mod) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        apply(undo(historyRef.current));
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        apply(redo(historyRef.current));
      } else if (key === 's') {
        e.preventDefault();
        void onFlush();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [apply, index, onFlush]);

  const onCanvasKey = (e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key;
    if (!selected) {
      if (mod && key.toLowerCase() === 'v') paste();
      return;
    }
    const nudge = e.shiftKey ? 10 : 1;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-nudge, 0],
      ArrowRight: [nudge, 0],
      ArrowUp: [0, -nudge],
      ArrowDown: [0, nudge],
    };
    const move = moves[key];
    if (move) {
      e.preventDefault();
      updateElement(selected.id, { x: selected.x + move[0], y: selected.y + move[1] }, `nudge:${selected.id}`);
    } else if (key === 'Delete' || key === 'Backspace') {
      e.preventDefault();
      removeElement(selected.id);
    } else if ((key === 'Enter' || key === 'F2') && selected.kind !== 'image' && selected.h > 0) {
      e.preventDefault();
      setEditingId(selected.id);
    } else if (key === 'Escape') {
      setSelectedId(null);
    } else if (mod && key.toLowerCase() === 'd') {
      e.preventDefault();
      addElement(copyElement(selected, 16));
    } else if (mod && key.toLowerCase() === 'c') {
      clipboardRef.current = selected;
    } else if (mod && key.toLowerCase() === 'x') {
      clipboardRef.current = selected;
      removeElement(selected.id);
    } else if (mod && key.toLowerCase() === 'v') {
      paste();
    }
  };

  const hasText =
    selected !== null && selected.kind !== 'image' && !(selected.kind === 'shape' && selected.shape === 'line');

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <EditorHeader
        fileType="slides"
        noun="presentation"
        listLabel="Slides"
        title={title}
        fileId={presentationId}
        role={role}
        saveState={saveState}
        onBack={() => router.push('/slides')}
        onRename={onRename}
        onReload={onReload}
        onCopy={() => void copy()}
        onDelete={() => void remove()}
        menu={
          <>
            <DropdownMenuItem onSelect={() => setPresenting(index)}>
              <Play /> Present from this slide
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        }
      >
        <Button size="sm" variant="outline" onClick={() => void exportPptx()} disabled={exporting}>
          {exporting ? <Loader2 className="animate-spin" /> : <Download />} Export .pptx
        </Button>
        <Button size="sm" onClick={() => setPresenting(0)}>
          <Play /> Present
        </Button>
      </EditorHeader>

      <div
        className="flex flex-wrap items-center gap-0.5 border-b px-3 py-1"
        role="toolbar"
        aria-label="Slide tools"
        hidden={readOnly}
      >
        <ToolButton label="Undo" onClick={() => apply(undo(historyRef.current))} disabled={!history.past.length}>
          <Undo2 />
        </ToolButton>
        <ToolButton label="Redo" onClick={() => apply(redo(historyRef.current))} disabled={!history.future.length}>
          <Redo2 />
        </ToolButton>
        <ToolSeparator />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost">
              <Plus /> New slide
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Layout</DropdownMenuLabel>
            {LAYOUTS.map((layout) => (
              <DropdownMenuItem key={layout} onSelect={() => addSlide(layout)}>
                {LAYOUT_LABELS[layout]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <ToolButton label="Text box" onClick={insertText}>
          <Type />
        </ToolButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label="Shape">
              <Shapes />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {SHAPES.map((shape) => (
              <DropdownMenuItem key={shape} onSelect={() => insertShape(shape)}>
                {SHAPE_LABELS[shape]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <ToolButton label="Picture" onClick={() => void insertImage()}>
          <ImagePlus />
        </ToolButton>
        <ToolSeparator />
        <FontPicker
          value={selected?.style.fontFamily}
          defaultLabel="Theme font"
          defaultFont={selected ? elementFont(selected, theme) : undefined}
          disabled={!hasText}
          onChange={(name) => updateStyle({ fontFamily: name ?? undefined })}
        />
        <FontSizePicker
          value={hasText ? (selected?.style.fontSize ?? 18) : null}
          sizes={FONT_SIZES}
          min={4}
          max={400}
          disabled={!hasText}
          onChange={(fontSize) => updateStyle({ fontSize })}
        />
        <ToolButton
          label="Bold"
          disabled={!hasText}
          pressed={selected?.style.bold}
          onClick={() => updateStyle({ bold: !selected?.style.bold })}
        >
          <Bold />
        </ToolButton>
        <ToolButton
          label="Italic"
          disabled={!hasText}
          pressed={selected?.style.italic}
          onClick={() => updateStyle({ italic: !selected?.style.italic })}
        >
          <Italic />
        </ToolButton>
        <ToolButton
          label="Underline"
          disabled={!hasText}
          pressed={selected?.style.underline}
          onClick={() => updateStyle({ underline: !selected?.style.underline })}
        >
          <Underline />
        </ToolButton>
        <ColorPicker
          label="Text color"
          icon={<Pen />}
          disabled={!hasText}
          value={selected?.style.color ?? null}
          onPick={(c) => updateStyle({ color: c ?? undefined })}
        />
        <ToolButton
          label="Bullets"
          disabled={!hasText}
          pressed={selected?.style.bullets}
          onClick={() => updateStyle({ bullets: !selected?.style.bullets })}
        >
          <List />
        </ToolButton>
        {(
          [
            ['left', 'Align left', AlignLeft],
            ['center', 'Center', AlignCenter],
            ['right', 'Align right', AlignRight],
          ] as const
        ).map(([align, label, Icon]) => (
          <ToolButton
            key={align}
            label={label}
            disabled={!hasText}
            pressed={hasText && selected.style.align === align}
            onClick={() => updateStyle({ align })}
          >
            <Icon />
          </ToolButton>
        ))}
        {(
          [
            ['top', 'Align top', AlignVerticalJustifyStart],
            ['middle', 'Align middle', AlignVerticalJustifyCenter],
            ['bottom', 'Align bottom', AlignVerticalJustifyEnd],
          ] as const
        ).map(([valign, label, Icon]) => (
          <ToolButton
            key={valign}
            label={label}
            disabled={!hasText}
            pressed={hasText && selected.style.valign === valign}
            onClick={() => updateStyle({ valign })}
          >
            <Icon />
          </ToolButton>
        ))}
        <ToolSeparator />
        <ColorPicker
          label="Fill"
          icon={<PaintBucket />}
          disabled={!selected || selected.kind === 'image' || selected.shape === 'line'}
          value={selected?.fill ?? null}
          onPick={(c) => selected && updateElement(selected.id, { fill: c })}
        />
        <ColorPicker
          label="Outline"
          icon={<Shapes />}
          disabled={!selected}
          value={selected?.stroke ?? null}
          onPick={(c) =>
            selected &&
            updateElement(selected.id, { stroke: c, strokeWidth: c ? Math.max(1, selected.strokeWidth) : 0 })
          }
        />
        <ToolButton
          label="Bring to front"
          disabled={!selected}
          onClick={() => selected && reorder(selected.id, 'front')}
        >
          <BringToFront />
        </ToolButton>
        <ToolButton label="Send to back" disabled={!selected} onClick={() => selected && reorder(selected.id, 'back')}>
          <SendToBack />
        </ToolButton>
        <Input
          aria-label="Rotation (degrees)"
          type="number"
          className="h-7 w-16 px-1.5 text-xs"
          disabled={!selected}
          value={selected ? Math.round(selected.rotation) : ''}
          onChange={(e) =>
            selected &&
            updateElement(selected.id, { rotation: Number(e.target.value) % 360 || 0 }, `rotate:${selected.id}`)
          }
        />
        <ToolButton label="Delete" disabled={!selected} onClick={() => selected && removeElement(selected.id)}>
          <Trash2 />
        </ToolButton>
        <ToolSeparator />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" aria-label="Presentation theme">
              <Palette /> Theme
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup
              value={body.themeId}
              onValueChange={(themeId) => update((b) => ({ ...b, themeId }))}
            >
              {THEMES.map((t) => (
                <DropdownMenuRadioItem key={t.id} value={t.id}>
                  <span
                    aria-hidden="true"
                    className="mr-1 inline-block size-4 rounded-sm border"
                    style={{ background: t.background, boxShadow: `inset -6px 0 0 ${t.accent}` }}
                  />
                  {t.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <ColorPicker
          label="Slide background"
          icon={<PaintBucket />}
          value={slide.background}
          onPick={(c) => updateSlide(slide.id, (s) => ({ ...s, background: c }))}
        />
      </div>

      <div className="flex min-h-0 flex-1">
        <SlideList
          slides={body.slides}
          theme={theme}
          currentId={slide.id}
          onSelect={(id) => {
            setCurrentId(id);
            setSelectedId(null);
            setEditingId(null);
          }}
          onMove={moveSlide}
          onDuplicate={duplicateSlide}
          onDelete={deleteSlide}
          onAdd={() => addSlide('title-content')}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <SlideCanvas
            slide={slide}
            theme={theme}
            selectedId={selectedId}
            editingId={editingId}
            onSelect={(id) => {
              setSelectedId(id);
              if (id !== editingId) setEditingId(null);
            }}
            onBox={(id, box) => updateElement(id, box)}
            onStartEdit={setEditingId}
            onEndEdit={(id, text) => {
              setEditingId(null);
              const el = slide.elements.find((e) => e.id === id);
              if (el && el.text !== text) updateElement(id, { text });
            }}
            onKeyDown={onCanvasKey}
          />
          <div className="border-t p-2">
            <p id="notes-hint" className="mb-1 flex items-center gap-1 px-1 text-xs text-muted-foreground">
              <NotebookText className="size-3.5" aria-hidden="true" />
              Speaker notes: what to say on this slide. Not shown on the slide; press S while presenting to see them, or
              R for the phone remote. Saved in .pptx (PowerPoint's Notes).
            </p>
            <Textarea
              aria-label="Speaker notes"
              aria-describedby="notes-hint"
              placeholder="Click to add speaker notes"
              className="h-20 resize-none text-sm"
              value={slide.notes}
              readOnly={readOnly}
              onChange={(e) => updateSlide(slide.id, (s) => ({ ...s, notes: e.target.value }), `notes:${slide.id}`)}
            />
          </div>
        </div>
      </div>

      {presenting !== null && (
        <PresentMode
          slides={body.slides}
          theme={theme}
          fileId={presentationId}
          start={presenting}
          onExit={(at) => {
            setPresenting(null);
            const s = body.slides[at];
            if (s) setCurrentId(s.id);
          }}
        />
      )}
    </div>
  );
}

function SlideList({
  slides,
  theme,
  currentId,
  onSelect,
  onMove,
  onDuplicate,
  onDelete,
  onAdd,
}: Readonly<{
  slides: Slide[];
  theme: ReturnType<typeof themeById>;
  currentId: string;
  onSelect: (id: string) => void;
  onMove: (from: number, to: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onAdd: () => void;
}>) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const current = slides.findIndex((s) => s.id === currentId);
  return (
    <aside className="flex w-52 shrink-0 flex-col border-r" aria-label="Slides">
      <ol
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3"
        aria-label="Slide thumbnails"
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const next = slides[current + (e.key === 'ArrowDown' ? 1 : -1)];
            if (!next) return;
            if (e.altKey) onMove(current, current + (e.key === 'ArrowDown' ? 1 : -1));
            else onSelect(next.id);
          } else if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            onDelete();
          }
        }}
      >
        {slides.map((s, i) => (
          <li
            key={s.id}
            className="flex gap-1.5"
            draggable
            onDragStart={() => setDragFrom(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragFrom !== null) onMove(dragFrom, i);
              setDragFrom(null);
            }}
          >
            <span className="w-4 pt-1 text-right text-xs text-muted-foreground">{i + 1}</span>
            <button
              type="button"
              aria-label={`Slide ${i + 1}${slideTitle(s) ? `: ${slideTitle(s)}` : ''}`}
              aria-current={s.id === currentId ? 'true' : undefined}
              className={cn(
                'overflow-hidden rounded-sm border outline-offset-2',
                s.id === currentId ? 'border-ring ring-2 ring-ring' : 'hover:border-ring/60'
              )}
              onClick={() => onSelect(s.id)}
            >
              <SlideView slide={s} theme={theme} scale={160 / SLIDE_WIDTH} className="pointer-events-none" />
            </button>
          </li>
        ))}
      </ol>
      <div className="flex items-center justify-center gap-0.5 border-t p-1">
        <ToolButton label="New slide" onClick={onAdd}>
          <Plus />
        </ToolButton>
        <ToolButton label="Duplicate slide" onClick={onDuplicate}>
          <Copy />
        </ToolButton>
        <ToolButton label="Move slide up" disabled={current <= 0} onClick={() => onMove(current, current - 1)}>
          <ArrowUp />
        </ToolButton>
        <ToolButton
          label="Move slide down"
          disabled={current >= slides.length - 1}
          onClick={() => onMove(current, current + 1)}
        >
          <ArrowDown />
        </ToolButton>
        <ToolButton label="Delete slide" disabled={slides.length <= 1} onClick={onDelete}>
          <Trash2 />
        </ToolButton>
      </div>
    </aside>
  );
}

/** A picture's pixel size (falls back to 4:3 when it can't be decoded). */
async function naturalSize(src: string): Promise<{ width: number; height: number }> {
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    if (img.naturalWidth && img.naturalHeight) return { width: img.naturalWidth, height: img.naturalHeight };
  } catch {
    // Fall through to the default.
  }
  return { width: 400, height: 300 };
}
