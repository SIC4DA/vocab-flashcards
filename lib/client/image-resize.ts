"use client";
import { MAX_IMAGE_BYTES } from "../validation";

const MAX_SIDE = 512;

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Resize in the browser to ≤ 512 px on the longest side and encode as WebP (~0.8 quality).
 * Falls back to JPEG where WebP encoding isn't supported. Rejects if still > 150 KB.
 */
export async function resizeImage(file: Blob): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("Please choose an image file.");
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("This image couldn't be read. Try a JPEG, PNG or WebP file.");
  });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image processing isn't supported in this browser.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  for (const q of [0.8, 0.7, 0.6]) {
    let blob = await toBlob(canvas, "image/webp", q);
    if (!blob || blob.type !== "image/webp") blob = await toBlob(canvas, "image/jpeg", q);
    if (blob && blob.size <= MAX_IMAGE_BYTES) return blob;
  }
  throw new Error("The image is still larger than 150 KB after compression. Try a simpler image.");
}
