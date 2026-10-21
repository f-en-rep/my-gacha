// 저장 전에 WebP로 줄인다 (PLAN 4-3). 지원하지 않는 환경이면 원본을 그대로 돌려준다.

export async function toWebp(blob: Blob, quality = 0.9): Promise<Blob> {
  if (blob.type === 'image/webp') return blob;
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') return blob;
  try {
    const bitmap = await createImageBitmap(blob);
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return blob;
      ctx.drawImage(bitmap, 0, 0);
      const out = await canvas.convertToBlob({ type: 'image/webp', quality });
      // Safari 일부 버전은 WebP 인코딩을 못 해서 PNG를 돌려준다 → 원본 유지
      return out.type === 'image/webp' ? out : blob;
    } finally {
      bitmap.close();
    }
  } catch {
    return blob;
  }
}
