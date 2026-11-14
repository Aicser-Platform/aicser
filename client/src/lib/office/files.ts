// Files in the browser: pick with a hidden <input type="file">, save as a download. (The desktop app uses native
// dialogs through Rust; the checks are the same: Office files ≤ 25 MB and really ZIP archives.)

export const MAX_OFFICE_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const MIME: Record<'docx' | 'pptx', string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** Opens the browser's file picker; resolves with the chosen files (empty when cancelled). */
export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    let settled = false;
    const done = (files: File[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => done(Array.from(input.files ?? [])));
    input.addEventListener('cancel', () => done([]));
    document.body.appendChild(input);
    input.click();
  });
}

/** A Word or PowerPoint file chosen by the user: its name without the extension and its bytes (null = cancelled). */
export async function pickOfficeFile(kind: 'docx' | 'pptx'): Promise<{ title: string; bytes: Uint8Array } | null> {
  const [file] = await pickFiles(`.${kind},${MIME[kind]}`);
  if (!file) return null;
  return readOfficeFile(file, kind);
}

export async function readOfficeFile(file: File, kind: 'docx' | 'pptx'): Promise<{ title: string; bytes: Uint8Array }> {
  if (!file.name.toLowerCase().endsWith(`.${kind}`)) throw new Error(`Choose a .${kind} file.`);
  if (file.size > MAX_OFFICE_FILE_BYTES) throw new Error('That file is larger than 25 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  // .docx and .pptx are ZIP archives ("PK\x03\x04").
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    throw new Error(`That isn't a valid .${kind} file.`);
  }
  return { title: file.name.replace(/\.[^.]+$/, '').trim(), bytes };
}

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/** Pictures chosen by the user as inline `data:` URLs (PNG, JPEG, GIF, WebP; ≤ 10 MB each). */
export async function pickImages(max = 1): Promise<{ name: string; dataUrl: string }[]> {
  const files = (await pickFiles(IMAGE_TYPES.join(','), max > 1)).slice(0, max);
  return Promise.all(
    files.map(async (file) => {
      if (!IMAGE_TYPES.includes(file.type)) throw new Error('Pictures must be PNG, JPEG, GIF or WebP.');
      if (file.size > MAX_IMAGE_BYTES) throw new Error('That picture is larger than 10 MB.');
      return { name: file.name, dataUrl: await readDataUrl(file) };
    })
  );
}

function readDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.readAsDataURL(file);
  });
}

/** Saves bytes as a download named `name`. */
export function downloadFile(name: string, bytes: Uint8Array, kind: 'docx' | 'pptx'): void {
  const blob = new Blob([bytes as BlobPart], { type: MIME[kind] });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name.replace(/[\\/:*?"<>|]+/g, '-');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
