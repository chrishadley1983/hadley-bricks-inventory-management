/**
 * Background Removal + Wood Surface Composite
 *
 * Uses @imgly/background-removal (browser WASM, free, no API costs)
 * to remove background, auto-trim, and composite onto a wood surface.
 */

import { removeBackground } from '@imgly/background-removal';

export type EnhanceStage = 'removing-background' | 'compositing';

export interface EnhanceProgress {
  stage: EnhanceStage;
  progress?: number; // 0-1 for background removal
}

/**
 * Remove background from an image, auto-trim, and composite onto a wood surface.
 * Returns a JPEG blob ready for upload.
 */
export async function enhanceMinifigPhoto(
  imageBlob: Blob,
  onProgress?: (p: EnhanceProgress) => void
): Promise<Blob> {
  // 1. Remove background via @imgly/background-removal (browser WASM)
  onProgress?.({ stage: 'removing-background', progress: 0 });

  const transparentBlob = await removeBackground(imageBlob, {
    progress: (key: string, current: number, total: number) => {
      if (key === 'compute:inference') {
        onProgress?.({ stage: 'removing-background', progress: current / total });
      }
    },
    output: { format: 'image/png' },
  });

  // 2. Load transparent image onto canvas
  onProgress?.({ stage: 'compositing' });
  const transparentImg = await loadImage(transparentBlob);

  // 3. Auto-trim: find bounding box of non-transparent pixels
  const trimCanvas = document.createElement('canvas');
  trimCanvas.width = transparentImg.width;
  trimCanvas.height = transparentImg.height;
  const trimCtx = trimCanvas.getContext('2d')!;
  trimCtx.drawImage(transparentImg, 0, 0);

  const bounds = findBounds(trimCtx, trimCanvas.width, trimCanvas.height);

  // 4. Create output canvas with wood background
  const outputSize = 1200;
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = outputSize;
  outputCanvas.height = outputSize;
  const outCtx = outputCanvas.getContext('2d')!;

  // Draw procedural wood background
  drawWoodBackground(outCtx, outputSize, outputSize);

  // 5. Center the trimmed cutout with padding
  const padding = outputSize * 0.1;
  const availableSize = outputSize - padding * 2;

  const cropW = bounds.right - bounds.left;
  const cropH = bounds.bottom - bounds.top;
  const scale = Math.min(availableSize / cropW, availableSize / cropH);
  const drawW = cropW * scale;
  const drawH = cropH * scale;
  const drawX = (outputSize - drawW) / 2;
  const drawY = (outputSize - drawH) / 2;

  outCtx.drawImage(
    trimCanvas,
    bounds.left,
    bounds.top,
    cropW,
    cropH,
    drawX,
    drawY,
    drawW,
    drawH
  );

  // 6. Export as JPEG
  return new Promise<Blob>((resolve, reject) => {
    outputCanvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to export canvas to JPEG'));
      },
      'image/jpeg',
      0.92
    );
  });
}

/**
 * Load a blob as an HTMLImageElement.
 */
function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });
}

/**
 * Find the bounding box of non-transparent pixels.
 */
function findBounds(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): { left: number; top: number; right: number; bottom: number } {
  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;

  let top = height;
  let left = width;
  let right = 0;
  let bottom = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha > 10) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }

  // Handle edge case where image is fully transparent
  if (right <= left || bottom <= top) {
    return { left: 0, top: 0, right: width, bottom: height };
  }

  return { left, top, right: right + 1, bottom: bottom + 1 };
}

/**
 * Simple seeded PRNG (mulberry32) for deterministic wood background.
 * Same seed always produces the same texture.
 */
function seededRandom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Draw a procedural light wood surface background.
 * Uses a seeded PRNG so the same background is generated every time.
 */
function drawWoodBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): void {
  const rand = seededRandom(42);

  // Base warm wood color
  ctx.fillStyle = '#d4a574';
  ctx.fillRect(0, 0, width, height);

  // Add wood grain lines
  ctx.globalAlpha = 0.08;
  for (let i = 0; i < 60; i++) {
    const y = rand() * height;
    const thickness = 1 + rand() * 3;
    const waviness = 2 + rand() * 4;

    ctx.beginPath();
    ctx.strokeStyle = rand() > 0.5 ? '#8b6914' : '#c4955a';
    ctx.lineWidth = thickness;

    ctx.moveTo(0, y);
    for (let x = 0; x < width; x += 10) {
      const offset = Math.sin(x * 0.01 + i) * waviness;
      ctx.lineTo(x, y + offset);
    }
    ctx.stroke();
  }

  // Add subtle color variation
  ctx.globalAlpha = 0.04;
  for (let i = 0; i < 20; i++) {
    const x = rand() * width;
    const y = rand() * height;
    const r = 50 + rand() * 200;

    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, rand() > 0.5 ? '#c4955a' : '#e8c99b');
    gradient.addColorStop(1, 'transparent');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  // Add slight vignette for depth
  ctx.globalAlpha = 0.15;
  const vignette = ctx.createRadialGradient(
    width / 2, height / 2, width * 0.3,
    width / 2, height / 2, width * 0.7
  );
  vignette.addColorStop(0, 'transparent');
  vignette.addColorStop(1, '#6b4226');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  ctx.globalAlpha = 1;
}
