import { toast } from 'sonner';
import { docxToDocument } from '@/lib/docs/fromDocx';
import { blankDocument, countWords, documentText } from '@/lib/docs/model';
import { pptxToPresentation } from '@/lib/slides/fromPptx';
import { pickOfficeFile, readOfficeFile } from './files';

/** A Word file (picked, or dropped on the list) as a new Docs document; null when the picker was cancelled. */
export async function importDocx(dropped?: File) {
  const file = dropped ? await readOfficeFile(dropped, 'docx') : await pickOfficeFile('docx');
  if (!file) return null;
  const { content, warnings } = await docxToDocument(file.bytes);
  if (warnings) toast.warning(`Some Word formatting couldn't be kept (${warnings}).`);
  const blank = blankDocument();
  return {
    title: file.title || 'Imported document',
    body: { ...blank.body, content },
    meta: { words: countWords(documentText(content)) },
  };
}

/** A PowerPoint file (picked, or dropped on the list) as a new presentation; null when the picker was cancelled. */
export async function importPptx(dropped?: File) {
  const file = dropped ? await readOfficeFile(dropped, 'pptx') : await pickOfficeFile('pptx');
  if (!file) return null;
  const { body, skipped } = await pptxToPresentation(file.bytes);
  if (skipped) {
    toast.warning(
      `${skipped} item${skipped === 1 ? '' : 's'} (charts, tables, SmartArt or unsupported pictures) couldn't be brought over.`
    );
  }
  return { title: file.title || 'Imported presentation', body, meta: { slides: body.slides.length } };
}
