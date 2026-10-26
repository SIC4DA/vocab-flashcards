/** Detect image type from magic bytes (pure). */
export function sniffImageType(bytes: Uint8Array): "image/webp" | "image/jpeg" | "image/png" | null {
  if (bytes.length >= 12) {
    const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
    if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
    return "image/png";
  return null;
}
