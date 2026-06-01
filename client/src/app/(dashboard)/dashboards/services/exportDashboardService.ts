const sanitizeFilename = (name: string) =>
  (name || 'dashboard')
    .trim()
    .replace(/[^a-z0-9]/gi, '_')
    .toLowerCase();

const downloadDataUrl = (dataUrl: string, filename: string) => {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  link.click();
};

type ExportOptions = {
  filename?: string;
  /** CSS selector for the region to capture (default: studio canvas area). */
  selector?: string;
};

/**
 * Capture the visible dashboard canvas as PNG or PDF (client-side).
 */
export async function exportDashboardCanvas(format: 'png' | 'pdf', opts: ExportOptions = {}) {
  const selector = opts.selector ?? '.studio-canvas-area';
  const root = document.querySelector(selector) as HTMLElement | null;
  if (!root) {
    throw new Error('Dashboard canvas not found');
  }

  const html2canvasMod = await import('html2canvas');
  const html2canvas = html2canvasMod.default ?? html2canvasMod;
  if (typeof html2canvas !== 'function') {
    throw new Error('html2canvas not loaded');
  }

  root.classList.add('dashboard-export-light');
  try {
    const canvas = await html2canvas(root, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      logging: false,
      ignoreElements: (el) =>
        el.classList?.contains('dashboard-studio-toolbar') ||
        el.classList?.contains('studio-context-bar') ||
        el.classList?.contains('properties-panel') ||
        el.classList?.contains('fullscreen-exit-overlay'),
    });

    const filename = sanitizeFilename(opts.filename ?? 'dashboard');

    if (format === 'png') {
      downloadDataUrl(canvas.toDataURL('image/png'), `${filename}.png`);
      return;
    }

    const jsPDFMod = await import('jspdf');
    const jsPDF = jsPDFMod.default ?? jsPDFMod;
    const orientation = canvas.width >= canvas.height ? 'landscape' : 'portrait';
    const pdf = new jsPDF({
      orientation,
      unit: 'px',
      format: [canvas.width, canvas.height],
    });
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height);
    pdf.save(`${filename}.pdf`);
  } finally {
    root.classList.remove('dashboard-export-light');
  }
}
