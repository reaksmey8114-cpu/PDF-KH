export type StainCleanPreset = 'auto' | 'white-doc' | 'gentle' | 'text-boost' | 'custom';

export interface StainCleanOptions {
  whiten: number; // 0..100: paper white threshold
  shadowRemoval: number; // 0..100: uneven illumination & stain flattening
  despeckle: number; // 0..100: isolated dust/speckle removal
  contrast: number; // 0..100: ink darkening & clarity
  preserveColorInk: boolean; // keep red stamps & blue signatures vibrant
  cleanMarginPct: number; // 0..8: percentage of outer margin borders to whiten
}

export interface BrushPoint {
  x: number; // normalized 0..1
  y: number; // normalized 0..1
}

export interface BrushStroke {
  mode: 'erase' | 'restore';
  sizeNorm: number; // fraction of canvas min(width, height), e.g. 0.03
  points: BrushPoint[];
}

export const STAIN_CLEAN_PRESETS: Record<
  Exclude<StainCleanPreset, 'custom'>,
  StainCleanOptions
> = {
  auto: {
    whiten: 68,
    shadowRemoval: 82,
    despeckle: 45,
    contrast: 48,
    preserveColorInk: true,
    cleanMarginPct: 0,
  },
  'white-doc': {
    whiten: 86,
    shadowRemoval: 95,
    despeckle: 65,
    contrast: 68,
    preserveColorInk: true,
    cleanMarginPct: 1.5,
  },
  gentle: {
    whiten: 45,
    shadowRemoval: 58,
    despeckle: 25,
    contrast: 24,
    preserveColorInk: true,
    cleanMarginPct: 0,
  },
  'text-boost': {
    whiten: 72,
    shadowRemoval: 78,
    despeckle: 40,
    contrast: 85,
    preserveColorInk: true,
    cleanMarginPct: 0,
  },
};

export function loadImageElementFromDataUrl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode document image for cleaning.'));
    img.src = src;
  });
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/**
 * Compute separable 1D max dilation on a downsampled float/uint8 buffer per RGB channel.
 */
function dilateSeparable(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  radius: number
): Uint8ClampedArray {
  const horiz = new Uint8ClampedArray(w * h * 3);
  const out = new Uint8ClampedArray(w * h * 3);

  for (let y = 0; y < h; y++) {
    const rowOff = y * w;
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(w - 1, x + radius);
      let maxR = 0;
      let maxG = 0;
      let maxB = 0;
      for (let kx = x0; kx <= x1; kx++) {
        const idx = (rowOff + kx) * 4;
        if (src[idx] > maxR) maxR = src[idx];
        if (src[idx + 1] > maxG) maxG = src[idx + 1];
        if (src[idx + 2] > maxB) maxB = src[idx + 2];
      }
      const dIdx = (rowOff + x) * 3;
      horiz[dIdx] = maxR;
      horiz[dIdx + 1] = maxG;
      horiz[dIdx + 2] = maxB;
    }
  }

  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(h - 1, y + radius);
      let maxR = 0;
      let maxG = 0;
      let maxB = 0;
      for (let ky = y0; ky <= y1; ky++) {
        const idx = (ky * w + x) * 3;
        if (horiz[idx] > maxR) maxR = horiz[idx];
        if (horiz[idx + 1] > maxG) maxG = horiz[idx + 1];
        if (horiz[idx + 2] > maxB) maxB = horiz[idx + 2];
      }
      const dIdx = (y * w + x) * 3;
      out[dIdx] = maxR;
      out[dIdx + 1] = maxG;
      out[dIdx + 2] = maxB;
    }
  }

  return out;
}

/**
 * Separable box blur on 3-channel uint8 array for smooth local illumination surface.
 */
function boxBlur3(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  radius: number
): Uint8ClampedArray {
  const horiz = new Uint8ClampedArray(w * h * 3);
  const out = new Uint8ClampedArray(w * h * 3);

  for (let y = 0; y < h; y++) {
    const rowOff = y * w;
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(w - 1, x + radius);
      const count = x1 - x0 + 1;
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      for (let kx = x0; kx <= x1; kx++) {
        const idx = (rowOff + kx) * 3;
        sumR += src[idx];
        sumG += src[idx + 1];
        sumB += src[idx + 2];
      }
      const dIdx = (rowOff + x) * 3;
      horiz[dIdx] = Math.round(sumR / count);
      horiz[dIdx + 1] = Math.round(sumG / count);
      horiz[dIdx + 2] = Math.round(sumB / count);
    }
  }

  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(h - 1, y + radius);
      const count = y1 - y0 + 1;
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      for (let ky = y0; ky <= y1; ky++) {
        const idx = (ky * w + x) * 3;
        sumR += horiz[idx];
        sumG += horiz[idx + 1];
        sumB += horiz[idx + 2];
      }
      const dIdx = (y * w + x) * 3;
      out[dIdx] = Math.round(sumR / count);
      out[dIdx + 1] = Math.round(sumG / count);
      out[dIdx + 2] = Math.round(sumB / count);
    }
  }

  return out;
}

/**
 * Runs adaptive stain & shadow removal, paper whitening, ink clarity enhancement,
 * isolated dust despeckling, and scanner border cleaning on a source image.
 */
export function renderAutoCleanedCanvas(
  sourceImg: HTMLImageElement,
  options: StainCleanOptions,
  targetCanvas?: HTMLCanvasElement,
  maxDim = 1800
): HTMLCanvasElement {
  const natW = sourceImg.naturalWidth || sourceImg.width || 1;
  const natH = sourceImg.naturalHeight || sourceImg.height || 1;
  const scale = Math.min(1, maxDim / Math.max(natW, natH));
  const w = Math.max(1, Math.round(natW * scale));
  const h = Math.max(1, Math.round(natH * scale));

  const canvas = targetCanvas || document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return canvas;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(sourceImg, 0, 0, w, h);

  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  // Step 1: Estimate local background illumination on a fast downsampled grid
  const shadowMix = Math.max(0, Math.min(1, options.shadowRemoval / 100));
  let bgMap: Uint8ClampedArray | null = null;
  let gw = 1;
  let gh = 1;

  if (shadowMix > 0.01) {
    const gridMax = 150;
    const gScale = Math.min(1, gridMax / Math.max(w, h));
    gw = Math.max(8, Math.round(w * gScale));
    gh = Math.max(8, Math.round(h * gScale));

    const smallCanvas = document.createElement('canvas');
    smallCanvas.width = gw;
    smallCanvas.height = gh;
    const sCtx = smallCanvas.getContext('2d');
    if (sCtx) {
      sCtx.drawImage(canvas, 0, 0, gw, gh);
      const smallPixels = sCtx.getImageData(0, 0, gw, gh).data;
      const morphRadius = Math.max(3, Math.round(4 + shadowMix * 7));
      const dilated = dilateSeparable(smallPixels, gw, gh, morphRadius);
      bgMap = boxBlur3(dilated, gw, gh, Math.max(2, Math.round(morphRadius * 0.75)));
    }
  }

  // Step 2: Adaptive stain/shadow normalization + paper whitening + contrast + color stamp protection
  const whiteThreshold = 252 - (Math.max(0, Math.min(100, options.whiten)) / 100) * 68;
  const softKnee = 26;
  const contrastFactor = 1 + (Math.max(0, Math.min(100, options.contrast)) / 100) * 1.15;
  const marginRatio = Math.max(0, Math.min(10, options.cleanMarginPct)) / 100;
  const marginX = Math.round(w * marginRatio);
  const marginY = Math.round(h * marginRatio);

  for (let y = 0; y < h; y++) {
    const isTopBottomBorder = marginY > 0 && (y < marginY || y >= h - marginY);
    const gy = (y / Math.max(1, h - 1)) * (gh - 1);
    const gy0 = Math.floor(gy);
    const gy1 = Math.min(gh - 1, gy0 + 1);
    const fy = gy - gy0;

    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;

      if (isTopBottomBorder || (marginX > 0 && (x < marginX || x >= w - marginX))) {
        data[idx] = 255;
        data[idx + 1] = 255;
        data[idx + 2] = 255;
        data[idx + 3] = 255;
        continue;
      }

      const r0 = data[idx];
      const g0 = data[idx + 1];
      const b0 = data[idx + 2];

      const maxC = r0 > g0 ? (r0 > b0 ? r0 : b0) : g0 > b0 ? g0 : b0;
      const minC = r0 < g0 ? (r0 < b0 ? r0 : b0) : g0 < b0 ? g0 : b0;
      const chroma = maxC - minC;
      // Protect vivid ink colors (official red seals, blue pen signatures) from turning monochrome
      const colorProtect = options.preserveColorInk
        ? Math.max(0, Math.min(1, (chroma - 24) / 48))
        : 0;

      let nr = r0;
      let ng = g0;
      let nb = b0;

      if (bgMap) {
        const gx = (x / Math.max(1, w - 1)) * (gw - 1);
        const gx0 = Math.floor(gx);
        const gx1 = Math.min(gw - 1, gx0 + 1);
        const fx = gx - gx0;

        const i00 = (gy0 * gw + gx0) * 3;
        const i10 = (gy0 * gw + gx1) * 3;
        const i01 = (gy1 * gw + gx0) * 3;
        const i11 = (gy1 * gw + gx1) * 3;

        const bgR =
          (bgMap[i00] * (1 - fx) + bgMap[i10] * fx) * (1 - fy) +
          (bgMap[i01] * (1 - fx) + bgMap[i11] * fx) * fy;
        const bgG =
          (bgMap[i00 + 1] * (1 - fx) + bgMap[i10 + 1] * fx) * (1 - fy) +
          (bgMap[i01 + 1] * (1 - fx) + bgMap[i11 + 1] * fx) * fy;
        const bgB =
          (bgMap[i00 + 2] * (1 - fx) + bgMap[i10 + 2] * fx) * (1 - fy) +
          (bgMap[i01 + 2] * (1 - fx) + bgMap[i11 + 2] * fx) * fy;

        const bgLum = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB;
        const effectiveShadow = shadowMix * (1 - colorProtect * 0.45);

        if (colorProtect > 0.25) {
          // Scale uniformly by background luminance so red stamps & blue signatures keep true hue
          const gain = Math.min(2.4, 255 / Math.max(55, bgLum));
          const lr = Math.min(255, r0 * gain);
          const lg = Math.min(255, g0 * gain);
          const lb = Math.min(255, b0 * gain);
          nr = r0 + (lr - r0) * effectiveShadow;
          ng = g0 + (lg - g0) * effectiveShadow;
          nb = b0 + (lb - b0) * effectiveShadow;
        } else {
          // Per-channel division flattens yellow/brown coffee stains and gray shadows cleanly
          const divR = Math.min(255, (r0 / Math.max(48, bgR)) * 255);
          const divG = Math.min(255, (g0 / Math.max(48, bgG)) * 255);
          const divB = Math.min(255, (b0 / Math.max(48, bgB)) * 255);
          nr = r0 + (divR - r0) * effectiveShadow;
          ng = g0 + (divG - g0) * effectiveShadow;
          nb = b0 + (divB - b0) * effectiveShadow;
        }
      }

      const lum = 0.299 * nr + 0.587 * ng + 0.114 * nb;

      // Soft paper whitening for background & residual faint stains
      const effWhiteThreshold = whiteThreshold + colorProtect * 32;
      if (lum >= effWhiteThreshold) {
        nr = 255;
        ng = 255;
        nb = 255;
      } else {
        if (lum > effWhiteThreshold - softKnee) {
          const t = (lum - (effWhiteThreshold - softKnee)) / softKnee;
          const smooth = t * t * (3 - 2 * t);
          nr += (255 - nr) * smooth;
          ng += (255 - ng) * smooth;
          nb += (255 - nb) * smooth;
        }

        // Ink clarity contrast boost on non-background strokes
        if (contrastFactor > 1.01) {
          const pivot = 178;
          const adj = 1 + (contrastFactor - 1) * (1 - colorProtect * 0.4);
          nr = pivot - (pivot - nr) * adj;
          ng = pivot - (pivot - ng) * adj;
          nb = pivot - (pivot - nb) * adj;
        }
      }

      data[idx] = clampByte(nr);
      data[idx + 1] = clampByte(ng);
      data[idx + 2] = clampByte(nb);
      data[idx + 3] = 255;
    }
  }

  // Step 3: Isolated dust & speckle removal without harming deep-black punctuation/Khmer diacritics
  const despeckleNorm = Math.max(0, Math.min(1, options.despeckle / 100));
  if (despeckleNorm > 0.05 && w > 4 && h > 4) {
    const copy = new Uint8ClampedArray(data);
    const maxDarkToClean = despeckleNorm > 0.65 ? 20 : 62;
    const whiteNeighborCutoff = 236;

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = (y * w + x) * 4;
        const lum = 0.299 * copy[idx] + 0.587 * copy[idx + 1] + 0.114 * copy[idx + 2];
        if (lum >= 242 || lum < maxDarkToClean) continue;

        let brightNeighbors = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nIdx = ((y + dy) * w + (x + dx)) * 4;
            const nLum =
              0.299 * copy[nIdx] + 0.587 * copy[nIdx + 1] + 0.114 * copy[nIdx + 2];
            if (nLum >= whiteNeighborCutoff) brightNeighbors++;
          }
        }

        const minNeighbors = despeckleNorm > 0.6 ? 6 : 7;
        if (brightNeighbors >= minNeighbors) {
          data[idx] = 255;
          data[idx + 1] = 255;
          data[idx + 2] = 255;
        }
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

function traceStrokePath(
  ctx: CanvasRenderingContext2D,
  points: BrushPoint[],
  w: number,
  h: number
) {
  if (points.length === 0) return;
  ctx.beginPath();
  if (points.length === 1) {
    const px = points[0].x * w;
    const py = points[0].y * h;
    ctx.moveTo(px, py);
    ctx.lineTo(px + 0.01, py + 0.01);
    return;
  }
  ctx.moveTo(points[0].x * w, points[0].y * h);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x * w, points[i].y * h);
  }
}

/**
 * Composites the auto-cleaned canvas with manual erase/restore brush strokes.
 */
export function compositeStainCleanResult(
  autoCanvas: HTMLCanvasElement,
  originalImg: HTMLImageElement,
  strokes: BrushStroke[],
  outCanvas?: HTMLCanvasElement
): HTMLCanvasElement {
  const w = autoCanvas.width;
  const h = autoCanvas.height;
  const minDim = Math.max(1, Math.min(w, h));

  const canvas = outCanvas || document.createElement('canvas');
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(autoCanvas, 0, 0, w, h);

  if (strokes.length === 0) return canvas;

  let scratchCanvas: HTMLCanvasElement | null = null;
  let scratchCtx: CanvasRenderingContext2D | null = null;

  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue;
    const lineWidth = Math.max(2, stroke.sizeNorm * minDim);

    if (stroke.mode === 'erase') {
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      traceStrokePath(ctx, stroke.points, w, h);
      ctx.stroke();
      ctx.restore();
    } else {
      if (!scratchCanvas) {
        scratchCanvas = document.createElement('canvas');
        scratchCanvas.width = w;
        scratchCanvas.height = h;
        scratchCtx = scratchCanvas.getContext('2d');
      }
      if (!scratchCanvas || !scratchCtx) continue;

      scratchCtx.clearRect(0, 0, w, h);
      scratchCtx.save();
      scratchCtx.strokeStyle = '#000000';
      scratchCtx.lineWidth = lineWidth;
      scratchCtx.lineCap = 'round';
      scratchCtx.lineJoin = 'round';
      traceStrokePath(scratchCtx, stroke.points, w, h);
      scratchCtx.stroke();
      scratchCtx.globalCompositeOperation = 'source-in';
      scratchCtx.drawImage(originalImg, 0, 0, w, h);
      scratchCtx.restore();

      ctx.drawImage(scratchCanvas, 0, 0, w, h);
    }
  }

  return canvas;
}

export function encodeCanvasWithinByteLimit(
  canvas: HTMLCanvasElement,
  maxBytes?: number
): string {
  const pngUrl = canvas.toDataURL('image/png');
  if (!maxBytes || pngUrl.length <= maxBytes) {
    return pngUrl;
  }

  for (const q of [0.92, 0.85, 0.78, 0.7]) {
    const jpgUrl = canvas.toDataURL('image/jpeg', q);
    if (jpgUrl.length <= maxBytes) {
      return jpgUrl;
    }
  }

  // Downscale slightly if still over byte budget
  const scale = Math.sqrt(maxBytes / Math.max(maxBytes, pngUrl.length)) * 0.92;
  const scaledCanvas = document.createElement('canvas');
  scaledCanvas.width = Math.max(240, Math.round(canvas.width * scale));
  scaledCanvas.height = Math.max(240, Math.round(canvas.height * scale));
  const sCtx = scaledCanvas.getContext('2d');
  if (sCtx) {
    sCtx.fillStyle = '#ffffff';
    sCtx.fillRect(0, 0, scaledCanvas.width, scaledCanvas.height);
    sCtx.drawImage(canvas, 0, 0, scaledCanvas.width, scaledCanvas.height);
    return scaledCanvas.toDataURL('image/jpeg', 0.85);
  }
  return canvas.toDataURL('image/jpeg', 0.78);
}

export async function cleanImageDataUrl(
  dataUrl: string,
  options: StainCleanOptions,
  strokes: BrushStroke[] = [],
  outputMaxBytes?: number,
  maxDim = 1800
): Promise<string> {
  const img = await loadImageElementFromDataUrl(dataUrl);
  const autoCanvas = renderAutoCleanedCanvas(img, options, undefined, maxDim);
  const finalCanvas = compositeStainCleanResult(autoCanvas, img, strokes);
  return encodeCanvasWithinByteLimit(finalCanvas, outputMaxBytes);
}

export function extractFirstImageSrcFromHtml(html: string): string | null {
  if (!html || !html.includes('<img')) return null;
  if (typeof document !== 'undefined') {
    const div = document.createElement('div');
    div.innerHTML = html;
    const img = div.querySelector('img');
    return img?.getAttribute('src') || null;
  }
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m?.[1] || null;
}

export function replaceImageSrcInHtml(html: string, oldSrc: string, newSrc: string): string {
  if (!html) return html;
  if (typeof document !== 'undefined') {
    const div = document.createElement('div');
    div.innerHTML = html;
    let replaced = false;
    const imgs = Array.from(div.querySelectorAll('img'));
    for (const img of imgs) {
      if (img.getAttribute('src') === oldSrc) {
        img.setAttribute('src', newSrc);
        replaced = true;
        break;
      }
    }
    if (!replaced && imgs[0]) {
      imgs[0].setAttribute('src', newSrc);
    }
    return div.innerHTML;
  }
  return html.replace(oldSrc, newSrc);
}
