/**
 * Generate PWA icons from public/icons/icon.svg (or aiser-logo.png if present).
 * Run: node scripts/generate-pwa-icons.mjs
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../public');
const iconsDir = path.join(publicDir, 'icons');
const svgPath = path.join(iconsDir, 'icon.svg');
const logoPath = path.join(publicDir, 'aiser-logo.png');

mkdirSync(iconsDir, { recursive: true });

const BRAND = '#00c2cb';
const BG = '#0d1117';

const fallbackSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="${BG}"/>
  <path d="M128 160h256v64H192v224h-64V160zm128 128h128v128H256V288z" fill="${BRAND}"/>
  <circle cx="352" cy="160" r="32" fill="${BRAND}" opacity="0.85"/>
</svg>`;

async function sourceBuffer() {
  if (existsSync(logoPath)) {
    return readFileSync(logoPath);
  }
  const svg = existsSync(svgPath) ? readFileSync(svgPath) : Buffer.from(fallbackSvg);
  if (!existsSync(svgPath)) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(svgPath, fallbackSvg);
  }
  return sharp(svg).resize(512, 512).png().toBuffer();
}

async function writeIcon(size, name, padding = 0) {
  const src = await sourceBuffer();
  const inner = size - padding * 2;
  const resized = await sharp(src)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: name.includes('maskable') ? BG : { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: resized, top: padding, left: padding }])
    .png()
    .toFile(path.join(iconsDir, name));
}

async function main() {
  await writeIcon(192, 'icon-192.png', 0);
  await writeIcon(512, 'icon-512.png', 0);
  await writeIcon(192, 'icon-192-maskable.png', 24);
  await writeIcon(512, 'icon-512-maskable.png', 64);

  // Apple touch icon alias
  await sharp(path.join(iconsDir, 'icon-192.png')).toFile(path.join(publicDir, 'apple-touch-icon.png'));

  console.log('PWA icons generated in public/icons/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
