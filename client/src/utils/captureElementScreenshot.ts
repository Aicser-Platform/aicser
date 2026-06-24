export interface CaptureElementScreenshotOptions {
  backgroundColor?: string;
  /** CSS class names to skip when walking the DOM (toolbars, panels, overlays). */
  ignoreClassNames?: string[];
  /** Class toggled on the element for the duration of capture (e.g. forces light theme). */
  toggleClassName?: string;
}

function supportsWebpToBlob(canvas: HTMLCanvasElement): boolean {
  return canvas.toDataURL('image/webp').startsWith('data:image/webp');
}

/**
 * Best-effort screenshot of a DOM element for use as a feed card thumbnail.
 * Never throws — any failure (missing element, tainted canvas, html2canvas
 * import failure) resolves to `null` so callers can proceed with publishing
 * without a thumbnail.
 */
export async function captureElementScreenshot(
  selector: string,
  options: CaptureElementScreenshotOptions = {},
): Promise<Blob | null> {
  const element = document.querySelector(selector) as HTMLElement | null;
  if (!element) {
    console.warn('[captureElementScreenshot] no element matched selector', selector);
    return null;
  }

  if (options.toggleClassName) element.classList.add(options.toggleClassName);
  try {
    const html2canvasMod = await import('html2canvas');
    const html2canvas = html2canvasMod.default ?? html2canvasMod;
    if (typeof html2canvas !== 'function') return null;

    const ignoreClassNames = options.ignoreClassNames ?? [];
    const canvas = await html2canvas(element, {
      backgroundColor: options.backgroundColor ?? '#ffffff',
      scale: 1.5,
      useCORS: true,
      logging: false,
      ignoreElements: ignoreClassNames.length
        ? (el) => ignoreClassNames.some((name) => el.classList?.contains(name))
        : undefined,
    });

    const mimeType = supportsWebpToBlob(canvas) ? 'image/webp' : 'image/png';
    const quality = mimeType === 'image/webp' ? 0.85 : undefined;

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob ?? null), mimeType, quality);
    });
  } catch (error) {
    // Best-effort capture: never block the caller, but surface the reason in
    // devtools — silent failures here were impossible to diagnose remotely.
    console.warn('[captureElementScreenshot] capture failed', error);
    return null;
  } finally {
    if (options.toggleClassName) element.classList.remove(options.toggleClassName);
  }
}

export default captureElementScreenshot;
