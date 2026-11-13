// Fonts offered in Docs and Slides (same list as the desktop app). The name is what the file stores (and Word /
// PowerPoint show); the stack is how the page draws it. Bundled fonts (OFL, @fontsource, styles/office-fonts.css)
// look the same on every computer; system fonts need no download but may fall back. Every stack ends with Noto
// Sans Khmer, so Khmer text in an English font still renders in a Khmer face.

export type FontGroup = 'English' | 'Khmer';

export interface OfficeFont {
  /** Stored in the file, as Word / PowerPoint name the font. */
  name: string;
  group: FontGroup;
  /** CSS font-family list. */
  stack: string;
  /** Shipped with the app (else a system font). */
  bundled: boolean;
}

const KHMER_FALLBACK = "'Noto Sans Khmer Variable'";
const font = (name: string, group: FontGroup, families: string[], generic: string, bundled = true): OfficeFont => ({
  name,
  group,
  bundled,
  stack: [...families.map((f) => `'${f}'`), KHMER_FALLBACK, generic].join(', '),
});

export const OFFICE_FONTS: OfficeFont[] = [
  font('Inter', 'English', ['Inter Variable', 'Inter'], 'sans-serif'),
  font('Roboto', 'English', ['Roboto Variable', 'Roboto'], 'sans-serif'),
  font('Merriweather', 'English', ['Merriweather Variable', 'Merriweather'], 'serif'),
  font('Roboto Mono', 'English', ['Roboto Mono Variable', 'Roboto Mono'], 'monospace'),
  font('Arial', 'English', ['Arial', 'Helvetica'], 'sans-serif', false),
  font('Calibri', 'English', ['Calibri', 'Carlito'], 'sans-serif', false),
  font('Times New Roman', 'English', ['Times New Roman', 'Times'], 'serif', false),
  font('Georgia', 'English', ['Georgia'], 'serif', false),
  font('Verdana', 'English', ['Verdana'], 'sans-serif', false),
  font('Courier New', 'English', ['Courier New', 'Courier'], 'monospace', false),
  font('Kantumruy Pro', 'Khmer', ['Kantumruy Pro Variable', 'Kantumruy Pro'], 'sans-serif'),
  font('Noto Sans Khmer', 'Khmer', ['Noto Sans Khmer Variable', 'Noto Sans Khmer'], 'sans-serif'),
  font('Noto Serif Khmer', 'Khmer', ['Noto Serif Khmer Variable', 'Noto Serif Khmer'], 'serif'),
  font('Battambang', 'Khmer', ['Battambang'], 'serif'),
  font('Hanuman', 'Khmer', ['Hanuman'], 'serif'),
  font('Siemreap', 'Khmer', ['Siemreap'], 'sans-serif'),
  font('Moul', 'Khmer', ['Moul'], 'serif'),
  font('Koulen', 'Khmer', ['Koulen'], 'sans-serif'),
];

const BY_NAME = new Map(OFFICE_FONTS.map((f) => [f.name.toLowerCase(), f]));

/**
 * The CSS font-family for a font name: a known font's stack; another name from a file (e.g. one the
 * user has installed) is tried by name first. Undefined = the sheet's default font.
 */
export function fontStack(name: string | null | undefined): string | undefined {
  if (!name) return undefined;
  const known = BY_NAME.get(name.toLowerCase());
  if (known) return known.stack;
  // Only names of letters, digits, spaces, '-', '_' and '.', so quoting is safe.
  return /^[\p{L}\p{N} ._-]{1,64}$/u.test(name) ? `'${name}', ${KHMER_FALLBACK}, sans-serif` : undefined;
}

export const isKnownFont = (name: string | null | undefined) => !!name && BY_NAME.has(name.toLowerCase());
