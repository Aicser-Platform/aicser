import { useMemo } from 'react';

/**
 * A QR code from Rust's module matrix (web: from the `qrcode` package, lib/office/qr.ts) (`size` × `size`, `1` = dark), drawn as one SVG path on a white quiet zone
 * (phones need the light border and dark-on-light, also in dark mode).
 */
export function QrCode({
  size,
  modules,
  label,
  className,
}: Readonly<{ size: number; modules: string; label: string; className?: string }>) {
  const path = useMemo(() => {
    let d = '';
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (modules[y * size + x] === '1') d += `M${x + 4} ${y + 4}h1v1h-1z`;
      }
    }
    return d;
  }, [size, modules]);
  const full = size + 8;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${full} ${full}`}
      shapeRendering="crispEdges"
      className={className}
    >
      <rect width={full} height={full} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
