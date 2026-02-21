/**
 * Image Auto-Trim Utility
 *
 * Strips uniform-colour borders (white, light grey, etc.) from screenshots
 * and crops tight around the subject. No heavy dependencies — pure canvas.
 */

/**
 * Auto-trim an image: remove uniform-coloured borders, crop tight,
 * and output a square JPEG ready for eBay listing upload.
 */
export async function enhanceMinifigPhoto(imageBlob: Blob): Promise<Blob> {
  const img = await loadImage(imageBlob);

  // Draw onto a canvas so we can read pixels
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);

  // Find the content bounding box by trimming uniform borders
  const bounds = findContentBounds(ctx, canvas.width, canvas.height);

  const cropW = bounds.right - bounds.left;
  const cropH = bounds.bottom - bounds.top;

  // Add 5% padding around the content (clamped to image edges)
  const padX = Math.round(cropW * 0.05);
  const padY = Math.round(cropH * 0.05);
  const padLeft = Math.max(0, bounds.left - padX);
  const padTop = Math.max(0, bounds.top - padY);
  const padRight = Math.min(canvas.width, bounds.right + padX);
  const padBottom = Math.min(canvas.height, bounds.bottom + padY);

  const finalW = padRight - padLeft;
  const finalH = padBottom - padTop;

  // Make it square by centering the content in a square canvas
  const side = Math.max(finalW, finalH);
  const outCanvas = document.createElement('canvas');
  outCanvas.width = side;
  outCanvas.height = side;
  const outCtx = outCanvas.getContext('2d')!;

  // Fill with white so letterboxing is clean
  outCtx.fillStyle = '#ffffff';
  outCtx.fillRect(0, 0, side, side);

  // Center the cropped region
  const offsetX = Math.round((side - finalW) / 2);
  const offsetY = Math.round((side - finalH) / 2);
  outCtx.drawImage(
    canvas,
    padLeft,
    padTop,
    finalW,
    finalH,
    offsetX,
    offsetY,
    finalW,
    finalH
  );

  return new Promise<Blob>((resolve, reject) => {
    outCanvas.toBlob(
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

/** Tolerance for considering a pixel "same as the border colour". */
const COLOUR_TOLERANCE = 30;

/**
 * Fraction of pixels in a row/column that must match the border colour
 * for that row/column to be considered part of the border.
 * 0.92 means rows with up to 8% non-background pixels (e.g. watermark text)
 * are still treated as border and trimmed.
 */
const BORDER_ROW_THRESHOLD = 0.92;

/**
 * Find the bounding box of the actual content by trimming uniform-coloured
 * borders inward from each edge. Uses a threshold so rows/columns with
 * small amounts of text (watermarks, captions) are still treated as border.
 */
function findContentBounds(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): { left: number; top: number; right: number; bottom: number } {
  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;

  const px = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return [data[i], data[i + 1], data[i + 2]] as [number, number, number];
  };

  const similar = (a: [number, number, number], b: [number, number, number]) =>
    Math.abs(a[0] - b[0]) < COLOUR_TOLERANCE &&
    Math.abs(a[1] - b[1]) < COLOUR_TOLERANCE &&
    Math.abs(a[2] - b[2]) < COLOUR_TOLERANCE;

  /** Check if a row is mostly the reference colour (above threshold). */
  const isRowBorder = (y: number, ref: [number, number, number]): boolean => {
    let matchCount = 0;
    for (let x = 0; x < width; x++) {
      if (similar(px(x, y), ref)) matchCount++;
    }
    return matchCount / width >= BORDER_ROW_THRESHOLD;
  };

  /** Check if a column (between top..bottom) is mostly the reference colour. */
  const isColBorder = (
    x: number,
    ref: [number, number, number],
    yStart: number,
    yEnd: number
  ): boolean => {
    const span = yEnd - yStart;
    if (span <= 0) return true;
    let matchCount = 0;
    for (let y = yStart; y < yEnd; y++) {
      if (similar(px(x, y), ref)) matchCount++;
    }
    return matchCount / span >= BORDER_ROW_THRESHOLD;
  };

  // Scan from top — sample top-left corner as reference colour
  const topRef = px(0, 0);
  let top = 0;
  for (let y = 0; y < height; y++) {
    if (!isRowBorder(y, topRef)) break;
    top = y + 1;
  }

  // Scan from bottom
  const botRef = px(0, height - 1);
  let bottom = height;
  for (let y = height - 1; y >= top; y--) {
    if (!isRowBorder(y, botRef)) break;
    bottom = y;
  }

  // Scan from left
  const leftRef = px(0, Math.floor(height / 2));
  let left = 0;
  for (let x = 0; x < width; x++) {
    if (!isColBorder(x, leftRef, top, bottom)) break;
    left = x + 1;
  }

  // Scan from right
  const rightRef = px(width - 1, Math.floor(height / 2));
  let right = width;
  for (let x = width - 1; x >= left; x--) {
    if (!isColBorder(x, rightRef, top, bottom)) break;
    right = x;
  }

  // If nothing was trimmed (or image is all one colour), return full image
  if (right <= left || bottom <= top) {
    return { left: 0, top: 0, right: width, bottom: height };
  }

  return { left, top, right, bottom };
}
