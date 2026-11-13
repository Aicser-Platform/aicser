import QRCode from 'qrcode';

/** A QR code's module matrix for `text` (`size` × `size`, '1' = dark), as the desktop app gets it from Rust. */
export function qrModules(text: string): { size: number; modules: string } {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const { size, data } = qr.modules;
  let modules = '';
  for (let i = 0; i < size * size; i++) modules += data[i] ? '1' : '0';
  return { size, modules };
}
