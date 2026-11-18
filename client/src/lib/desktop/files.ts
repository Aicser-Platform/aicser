/** The desktop's `saveFile` (a native save dialog) on the web: downloads the bytes under that name. */
export async function saveFile(name: string, bytes: Uint8Array, type = 'application/octet-stream'): Promise<boolean> {
  const blob = new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
