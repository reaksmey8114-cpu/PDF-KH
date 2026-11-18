import { PDFDocument } from 'pdf-lib';
import { toPng } from 'html-to-image';
import { saveAs } from 'file-saver';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  NumberFormat,
  Packer,
  PageNumber,
  PageOrientation,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  convertMillimetersToTwip,
} from 'docx';
import {
  CompilationResult,
  CompiledPage,
  Project,
  ProjectDocument,
  getEffectivePaperMm,
} from '@/types/document';
import { mmToPt } from '@/lib/pagination-engine';

function sanitizeFileName(title: string, ext: string): string {
  const clean = (title || 'document_master_export')
    .replace(/[<>:"/\\|?*]+/g, '_')
    .trim()
    .slice(0, 80);
  return `${clean || 'document_master_export'}.${ext}`;
}

const URL_REGEX = /url\((['"]?)([^'")]+)\1\)/g;

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error || new Error('Failed to read font blob'));
    reader.readAsDataURL(blob);
  });
}

async function getSafeFontEmbedCSS(): Promise<string> {
  if (typeof document === 'undefined') return '';
  try {
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }
  } catch {
    // Continue gracefully if document.fonts.ready rejects
  }

  const fontFaceRules: Array<{ cssText: string; baseUrl: string | null }> = [];
  const sheets = Array.from(document.styleSheets || []);

  for (const sheet of sheets) {
    try {
      const rules = sheet.cssRules;
      if (!rules) continue;
      for (const rule of Array.from(rules)) {
        if (rule.type === CSSRule.FONT_FACE_RULE) {
          fontFaceRules.push({
            cssText: rule.cssText,
            baseUrl: sheet.href || null,
          });
        }
      }
    } catch {
      // Silently skip cross-origin or browser-extension stylesheets without CORS
      if (sheet.href && sheet.href.startsWith('https://fonts.googleapis.com/')) {
        try {
          const res = await fetch(sheet.href);
          if (res.ok) {
            const rawCss = await res.text();
            const matches = rawCss.match(/@font-face\s*\{[^}]+\}/g) || [];
            for (const block of matches) {
              fontFaceRules.push({ cssText: block, baseUrl: sheet.href });
            }
          }
        } catch {
          // Ignore network failures cleanly
        }
      }
    }
  }

  if (fontFaceRules.length === 0) return '';

  const assetCache = new Map<string, string>();
  const resolvedBlocks = await Promise.all(
    fontFaceRules.map(async ({ cssText, baseUrl }) => {
      const matches = Array.from(cssText.matchAll(URL_REGEX));
      let nextCss = cssText;
      for (const match of matches) {
        const rawUrl = match[2];
        if (!rawUrl || rawUrl.startsWith('data:')) continue;
        try {
          const absoluteUrl = baseUrl ? new URL(rawUrl, baseUrl).href : rawUrl;
          let dataUrl = assetCache.get(absoluteUrl);
          if (!dataUrl) {
            const resp = await fetch(absoluteUrl);
            if (!resp.ok) continue;
            dataUrl = await blobToDataUrl(await resp.blob());
            if (dataUrl) assetCache.set(absoluteUrl, dataUrl);
          }
          if (dataUrl) {
            nextCss = nextCss.replace(match[0], `url("${dataUrl}")`);
          }
        } catch {
          // Keep original rule if font asset fetch is blocked
        }
      }
      return nextCss;
    })
  );

  return resolvedBlocks.join('\n');
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

async function renderPdfPageOverlayPng(
  project: Project,
  page: CompiledPage,
  widthPt: number,
  heightPt: number
): Promise<ArrayBuffer | null> {
  const numCfg = project.numberingConfig;
  const wm = project.watermarkConfig;
  const hasNumber = Boolean(numCfg.enabled && !page.numberHidden && page.pageNumberFormatted);
  const hasWatermark = Boolean(wm.enabled && wm.text);
  const hasSignature = Boolean(page.signatureText);

  if (!hasNumber && !hasWatermark && !hasSignature) {
    return null;
  }

  try {
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }
  } catch {
    // Ignore if font loading check fails
  }

  const widthPx = Math.max(1, Math.round((widthPt * 96) / 72));
  const heightPx = Math.max(1, Math.round((heightPt * 96) / 72));
  const scale = 3;

  const canvas = document.createElement('canvas');
  canvas.width = widthPx * scale;
  canvas.height = heightPx * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.scale(scale, scale);
  ctx.clearRect(0, 0, widthPx, heightPx);

  if (hasWatermark) {
    ctx.save();
    ctx.translate(widthPx / 2, heightPx / 2);
    ctx.rotate((wm.angle * Math.PI) / 180);
    ctx.globalAlpha = Math.max(0.02, Math.min(1, wm.opacity));
    ctx.fillStyle = wm.color || '#64748b';
    ctx.font = `700 56px ${project.pageSetup.defaultFontFamily || 'sans-serif'}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(wm.text, 0, 0);
    ctx.restore();
  }

  const padTop = 16;
  const padBottom = 16;
  const padX = 24;
  const barHeight = 30;

  if (hasNumber) {
    const effectivePos = page.numberPosition || numCfg.position;
    const offsetX = page.numberOffsetXPx || 0;
    const offsetY = page.numberOffsetYPx || 0;
    const fontSizePx = (numCfg.fontSizePt * 96) / 72;
    const fontSpec = `500 ${fontSizePx}px ${numCfg.fontFamily || 'Battambang, sans-serif'}`;
    ctx.save();
    ctx.font = fontSpec;
    ctx.textBaseline = 'middle';

    const label = page.pageNumberFormatted;
    const metrics = ctx.measureText(label);
    const textW = metrics.width;
    const boxPadX = 8;
    const boxPadY = 3;
    const boxH = Math.max(fontSizePx * 1.45, fontSizePx + boxPadY * 2);

    const isTop = effectivePos.startsWith('top');
    const centerY = (isTop ? padTop + barHeight / 2 : heightPx - padBottom - barHeight / 2) + offsetY;

    let textX = widthPx / 2 + offsetX;
    if (effectivePos.endsWith('left')) {
      ctx.textAlign = 'left';
      textX = padX + (numCfg.maskBackground !== false ? boxPadX : 0) + offsetX;
    } else if (effectivePos.endsWith('right')) {
      ctx.textAlign = 'right';
      textX = widthPx - padX - (numCfg.maskBackground !== false ? boxPadX : 0) + offsetX;
    } else {
      ctx.textAlign = 'center';
      textX = widthPx / 2 + offsetX;
    }

    if (numCfg.maskBackground !== false) {
      let rectX = textX - textW / 2 - boxPadX;
      if (effectivePos.endsWith('left')) {
        rectX = padX + offsetX;
      } else if (effectivePos.endsWith('right')) {
        rectX = widthPx - padX - textW - boxPadX * 2 + offsetX;
      }
      const rectY = centerY - boxH / 2;
      ctx.fillStyle = project.pageSetup.backgroundColor || '#ffffff';
      drawRoundedRect(ctx, rectX, rectY, textW + boxPadX * 2, boxH, 3);
      ctx.fill();
    }

    ctx.fillStyle = numCfg.color || '#334155';
    ctx.fillText(label, textX, centerY);
    ctx.restore();
  }

  if (hasSignature && page.signatureText) {
    ctx.save();
    const sigFont = `600 11px ${project.pageSetup.defaultFontFamily || 'sans-serif'}`;
    const subFont = `400 10px sans-serif`;
    const subLabel = 'Verified Digital Signature';

    ctx.font = sigFont;
    const sigW = ctx.measureText(page.signatureText).width;
    ctx.font = subFont;
    const subW = ctx.measureText(subLabel).width;

    const boxW = Math.max(sigW, subW) + 24;
    const boxH = 42;
    const boxX = widthPx - padX - boxW;
    const boxY = heightPx - padBottom - barHeight - 12 - boxH;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    drawRoundedRect(ctx, boxX, boxY, boxW, boxH, 4);
    ctx.fill();

    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(boxX, boxY);
    ctx.lineTo(boxX + boxW, boxY);
    ctx.stroke();

    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#1e293b';
    ctx.font = sigFont;
    ctx.fillText(page.signatureText, boxX + boxW - 12, boxY + 8);

    ctx.fillStyle = '#64748b';
    ctx.font = subFont;
    ctx.fillText(subLabel, boxX + boxW - 12, boxY + 24);
    ctx.restore();
  }

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/png');
  });
  if (!blob) return null;
  return await blob.arrayBuffer();
}

export async function exportCompiledPagesToPdf(
  project: Project,
  pageElements: Array<HTMLElement | null>,
  onProgress?: (current: number, total: number) => void,
  compiledPages?: CompiledPage[],
  getPdfBytes?: (docId: string) => Promise<ArrayBuffer | undefined>,
  getCleanedPdfPageImage?: (docId: string, pageNumber: number) => Promise<string | undefined>
): Promise<void> {
  const totalCount = compiledPages?.length || pageElements.length;
  if (totalCount === 0) {
    throw new Error('No pages available to export.');
  }

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(project.title);
  pdfDoc.setCreator('Document Master');

  const { widthMm, heightMm } = getEffectivePaperMm(project.pageSetup);
  const defaultWidthPt = mmToPt(widthMm);
  const defaultHeightPt = mmToPt(heightMm);
  const loadedSourcePdfs = new Map<string, PDFDocument | null>();
  let cachedFontEmbedCSS: string | null = null;

  for (let i = 0; i < totalCount; i++) {
    onProgress?.(i + 1, totalCount);
    const compiled = compiledPages?.[i];

    if (compiled?.pdfDocId && compiled.pdfPageNumber && getCleanedPdfPageImage) {
      const cleanedUrl = await getCleanedPdfPageImage(compiled.pdfDocId, compiled.pdfPageNumber);
      if (cleanedUrl && cleanedUrl.startsWith('data:image/')) {
        try {
          const imgBytes = await fetch(cleanedUrl).then((res) => res.arrayBuffer());
          const embeddedClean = cleanedUrl.startsWith('data:image/png')
            ? await pdfDoc.embedPng(imgBytes)
            : await pdfDoc.embedJpg(imgBytes);
          const pageWidthPt = compiled.pdfPageWidthPt || defaultWidthPt;
          const pageHeightPt = compiled.pdfPageHeightPt || defaultHeightPt;
          const page = pdfDoc.addPage([pageWidthPt, pageHeightPt]);
          page.drawImage(embeddedClean, {
            x: 0,
            y: 0,
            width: pageWidthPt,
            height: pageHeightPt,
          });
          const overlayPngBytes = await renderPdfPageOverlayPng(
            project,
            compiled,
            pageWidthPt,
            pageHeightPt
          );
          if (overlayPngBytes) {
            const embeddedOverlay = await pdfDoc.embedPng(overlayPngBytes);
            page.drawImage(embeddedOverlay, {
              x: 0,
              y: 0,
              width: pageWidthPt,
              height: pageHeightPt,
            });
          }
          continue;
        } catch (cleanPdfErr) {
          console.warn('Could not embed cleaned PDF image directly, falling back:', cleanPdfErr);
        }
      }
    }

    if (compiled?.pdfDocId && compiled.pdfPageNumber && getPdfBytes) {
      let srcPdf = loadedSourcePdfs.get(compiled.pdfDocId);
      if (srcPdf === undefined) {
        try {
          const bytes = await getPdfBytes(compiled.pdfDocId);
          if (bytes) {
            const loaded = await PDFDocument.load(bytes.slice(0), { ignoreEncryption: true });
            srcPdf = loaded.isEncrypted ? null : loaded;
          } else {
            srcPdf = null;
          }
        } catch (pdfErr) {
          console.warn('Could not load source PDF vector bytes, using visual page fallback:', pdfErr);
          srcPdf = null;
        }
        loadedSourcePdfs.set(compiled.pdfDocId, srcPdf);
      }

      if (srcPdf && compiled.pdfPageNumber >= 1 && compiled.pdfPageNumber <= srcPdf.getPageCount()) {
        const [copiedPage] = await pdfDoc.copyPages(srcPdf, [compiled.pdfPageNumber - 1]);
        pdfDoc.addPage(copiedPage);
        const { width, height } = copiedPage.getSize();
        const overlayPngBytes = await renderPdfPageOverlayPng(project, compiled, width, height);
        if (overlayPngBytes) {
          const embeddedOverlay = await pdfDoc.embedPng(overlayPngBytes);
          copiedPage.drawImage(embeddedOverlay, {
            x: 0,
            y: 0,
            width,
            height,
          });
        }
        continue;
      }
    }

    const el = pageElements[i];
    if (!el) continue;

    if (cachedFontEmbedCSS === null) {
      cachedFontEmbedCSS = await getSafeFontEmbedCSS();
    }

    const pngDataUrl = await toPng(el, {
      pixelRatio: 2,
      cacheBust: true,
      backgroundColor: project.pageSetup.backgroundColor || '#ffffff',
      fontEmbedCSS: cachedFontEmbedCSS,
      skipFonts: !cachedFontEmbedCSS,
    });

    const pngBytes = await fetch(pngDataUrl).then((res) => res.arrayBuffer());
    const embeddedImage = await pdfDoc.embedPng(pngBytes);
    const pageWidthPt =
      compiled?.pdfDocId && compiled.pdfPageWidthPt ? compiled.pdfPageWidthPt : defaultWidthPt;
    const pageHeightPt =
      compiled?.pdfDocId && compiled.pdfPageHeightPt ? compiled.pdfPageHeightPt : defaultHeightPt;
    const page = pdfDoc.addPage([pageWidthPt, pageHeightPt]);
    page.drawImage(embeddedImage, {
      x: 0,
      y: 0,
      width: pageWidthPt,
      height: pageHeightPt,
    });
  }

  const pdfBytes = await pdfDoc.save();
  const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
  saveAs(blob, sanitizeFileName(project.title, 'pdf'));
}

function resolveDocxFontName(cssFont: string): string {
  if (cssFont.includes('Moul')) return 'Khmer OS Muol';
  if (cssFont.includes('Siemreap')) return 'Khmer OS Siemreap';
  if (cssFont.includes('Battambang')) return 'Khmer OS Battambang';
  if (cssFont.includes('Noto Serif Khmer')) return 'Noto Serif Khmer';
  if (cssFont.includes('Georgia')) return 'Georgia';
  if (cssFont.includes('Times')) return 'Times New Roman';
  if (cssFont.includes('Mono')) return 'Courier New';
  return 'Plus Jakarta Sans';
}

function cssColorToDocxHex(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed === 'transparent' || trimmed === 'inherit' || trimmed === 'auto') {
    return undefined;
  }
  const hex6 = trimmed.match(/^#([0-9a-f]{6})$/);
  if (hex6) return hex6[1].toUpperCase();
  const hex3 = trimmed.match(/^#([0-9a-f]{3})$/);
  if (hex3) {
    const [r, g, b] = hex3[1].split('');
    return `${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  const rgbMatch = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    const toHex = (n: string) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0');
    return `${toHex(rgbMatch[1])}${toHex(rgbMatch[2])}${toHex(rgbMatch[3])}`.toUpperCase();
  }
  return undefined;
}

function cssLengthToPt(raw?: string | null): number | undefined {
  if (!raw) return undefined;
  const m = raw.trim().match(/^(-?\d+(?:\.\d+)?)(pt|px|em|rem)?$/i);
  if (!m) return undefined;
  const val = Number(m[1]);
  if (Number.isNaN(val)) return undefined;
  const unit = (m[2] || 'px').toLowerCase();
  if (unit === 'pt') return val;
  if (unit === 'px') return (val * 72) / 96;
  return val * 11;
}

interface DocxRunStyleState {
  bold?: boolean;
  italics?: boolean;
  underline?: boolean;
  strike?: boolean;
  superScript?: boolean;
  subScript?: boolean;
  color?: string;
  bgColor?: string;
  font?: string;
  sizeHalfPt?: number;
  allCaps?: boolean;
  smallCaps?: boolean;
}

function htmlElementToDocxRuns(el: Node, defaultFontName: string, defaultHalfPt: number): TextRun[] {
  const runs: TextRun[] = [];

  const walk = (node: Node, style: DocxRunStyleState) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || '';
      if (text) {
        runs.push(
          new TextRun({
            text,
            font: style.font || defaultFontName,
            size: style.sizeHalfPt || defaultHalfPt,
            bold: style.bold,
            italics: style.italics,
            underline: style.underline ? {} : undefined,
            strike: style.strike,
            superScript: style.superScript,
            subScript: style.subScript,
            color: style.color,
            shading: style.bgColor ? { fill: style.bgColor } : undefined,
            allCaps: style.allCaps,
            smallCaps: style.smallCaps,
          })
        );
      }
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const elem = node as HTMLElement;
    const tag = elem.tagName.toLowerCase();
    if (tag === 'img') return;
    if (tag === 'br') {
      runs.push(new TextRun({ break: 1 }));
      return;
    }

    const nextStyle: DocxRunStyleState = { ...style };
    if (tag === 'strong' || tag === 'b') nextStyle.bold = true;
    if (tag === 'em' || tag === 'i') nextStyle.italics = true;
    if (tag === 'u') nextStyle.underline = true;
    if (tag === 's' || tag === 'del' || tag === 'strike') nextStyle.strike = true;
    if (tag === 'sup') nextStyle.superScript = true;
    if (tag === 'sub') nextStyle.subScript = true;

    const dataColor = elem.getAttribute('data-color');
    if (tag === 'mark' && dataColor) {
      const hex = cssColorToDocxHex(dataColor);
      if (hex) nextStyle.bgColor = hex;
    }

    if (elem.style) {
      if (elem.style.fontWeight === 'bold' || Number(elem.style.fontWeight) >= 600) {
        nextStyle.bold = true;
      }
      if (elem.style.fontStyle === 'italic') nextStyle.italics = true;
      if (elem.style.textDecoration.includes('underline')) nextStyle.underline = true;
      if (elem.style.textDecoration.includes('line-through')) nextStyle.strike = true;
      const colorHex = cssColorToDocxHex(elem.style.color);
      if (colorHex) nextStyle.color = colorHex;
      const bgHex = cssColorToDocxHex(elem.style.backgroundColor);
      if (bgHex && bgHex !== 'FFFFFF') nextStyle.bgColor = bgHex;
      if (elem.style.fontFamily) nextStyle.font = resolveDocxFontName(elem.style.fontFamily);
      const pt = cssLengthToPt(elem.style.fontSize);
      if (pt && pt >= 5 && pt <= 120) nextStyle.sizeHalfPt = Math.round(pt * 2);
      if (elem.style.textTransform === 'uppercase') nextStyle.allCaps = true;
      if (elem.style.fontVariant === 'small-caps') nextStyle.smallCaps = true;
    }

    Array.from(elem.childNodes).forEach((child) => walk(child, nextStyle));
  };

  walk(el, {});
  return runs;
}

function getAlignmentFromStyle(el: HTMLElement): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
  const align = el.style.textAlign || '';
  if (align === 'center') return AlignmentType.CENTER;
  if (align === 'right') return AlignmentType.RIGHT;
  if (align === 'justify') return AlignmentType.JUSTIFIED;
  return AlignmentType.LEFT;
}

function getParagraphLayoutProps(el: HTMLElement, project: Project) {
  const leftPt = cssLengthToPt(el.style.marginLeft) ?? 0;
  const rightPt = cssLengthToPt(el.style.marginRight) ?? 0;
  const firstLinePt =
    cssLengthToPt(el.style.textIndent) ??
    (project.pageSetup.firstLineIndentMm ? (project.pageSetup.firstLineIndentMm * 72) / 25.4 : 0);
  const beforePt = cssLengthToPt(el.style.marginTop);
  const afterPt = cssLengthToPt(el.style.marginBottom);
  const lineRaw = el.style.lineHeight ? Number(el.style.lineHeight) : NaN;
  const lineTwips =
    !Number.isNaN(lineRaw) && lineRaw > 0.5 && lineRaw < 5
      ? Math.round(lineRaw * 240)
      : Math.round((project.pageSetup.lineHeight || 1.5) * 240);

  return {
    indent:
      leftPt > 0 || rightPt > 0 || firstLinePt !== 0
        ? {
            left: leftPt > 0 ? Math.round(leftPt * 20) : undefined,
            right: rightPt > 0 ? Math.round(rightPt * 20) : undefined,
            firstLine: firstLinePt > 0 ? Math.round(firstLinePt * 20) : undefined,
            hanging: firstLinePt < 0 ? Math.round(Math.abs(firstLinePt) * 20) : undefined,
          }
        : undefined,
    spacing: {
      before: beforePt !== undefined && beforePt >= 0 ? Math.round(beforePt * 20) : undefined,
      after:
        afterPt !== undefined && afterPt >= 0
          ? Math.round(afterPt * 20)
          : (project.pageSetup.paragraphSpacingPt || 8) * 20,
      line: lineTwips,
    },
  };
}

function getDirectTableRowsForDocx(tableEl: HTMLElement): HTMLTableRowElement[] {
  const rows: HTMLTableRowElement[] = [];
  for (const child of Array.from(tableEl.children)) {
    const tag = child.tagName.toLowerCase();
    if (tag === 'tr') {
      rows.push(child as HTMLTableRowElement);
    } else if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot') {
      for (const r of Array.from(child.children)) {
        if (r.tagName.toLowerCase() === 'tr') {
          rows.push(r as HTMLTableRowElement);
        }
      }
    }
  }
  return rows;
}

function dataUrlToDocxImage(
  imgEl: HTMLImageElement
): { type: 'png' | 'jpg' | 'gif' | 'bmp'; data: Uint8Array; width: number; height: number } | null {
  const src = imgEl.getAttribute('src') || '';
  const match = src.match(/^data:image\/(png|jpeg|jpg|gif|bmp);base64,(.+)$/i);
  if (!match) return null;
  const rawExt = match[1].toLowerCase();
  const type: 'png' | 'jpg' | 'gif' | 'bmp' = rawExt === 'jpeg' ? 'jpg' : (rawExt as 'png' | 'jpg' | 'gif' | 'bmp');
  try {
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const rawW = Number(imgEl.getAttribute('width')) || imgEl.naturalWidth || 480;
    const rawH = Number(imgEl.getAttribute('height')) || imgEl.naturalHeight || 320;
    const maxW = 540;
    const scale = rawW > maxW ? maxW / rawW : 1;
    return {
      type,
      data: bytes,
      width: Math.max(24, Math.round(rawW * scale)),
      height: Math.max(24, Math.round(rawH * scale)),
    };
  } catch {
    return null;
  }
}

const DOCX_CONTAINER_TAGS = new Set([
  'div',
  'section',
  'article',
  'main',
  'figure',
  'header',
  'footer',
  'aside',
]);

function rawDataUrlToDocxImage(
  src: string,
  targetWidthPt = 595,
  targetHeightPt = 842
): { type: 'png' | 'jpg' | 'gif' | 'bmp'; data: Uint8Array; width: number; height: number } | null {
  const match = src.match(/^data:image\/(png|jpeg|jpg|gif|bmp);base64,(.+)$/i);
  if (!match) return null;
  const rawExt = match[1].toLowerCase();
  const type: 'png' | 'jpg' | 'gif' | 'bmp' =
    rawExt === 'jpeg' ? 'jpg' : (rawExt as 'png' | 'jpg' | 'gif' | 'bmp');
  try {
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const maxW = 540;
    const maxH = 740;
    const scale = Math.min(maxW / Math.max(1, targetWidthPt), maxH / Math.max(1, targetHeightPt), 1);
    return {
      type,
      data: bytes,
      width: Math.max(24, Math.round(targetWidthPt * scale)),
      height: Math.max(24, Math.round(targetHeightPt * scale)),
    };
  } catch {
    return null;
  }
}

export async function exportProjectToDocx(
  project: Project,
  documents: ProjectDocument[],
  compilation: CompilationResult,
  getPdfPageImages?: (docId: string) => Promise<string[] | undefined>
): Promise<void> {
  const selectedDocs = documents
    .filter((d) => d.selected)
    .sort((a, b) => a.order - b.order);

  const fontName = resolveDocxFontName(project.pageSetup.defaultFontFamily);
  const baseFontHalfPt = Math.round((project.pageSetup.defaultFontSizePt || 11) * 2);
  const { widthMm, heightMm } = getEffectivePaperMm(project.pageSetup);

  const children: Array<Paragraph | Table> = [];

  if (project.tocConfig.enabled && compilation.tocEntries.length > 0) {
    children.push(
      new Paragraph({
        text: project.tocConfig.title || 'Table of Contents',
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 200 },
      })
    );
    compilation.tocEntries.forEach((entry) => {
      children.push(
        new Paragraph({
          indent: { left: (entry.level - 1) * 360 },
          spacing: { after: 80 },
          children: [
            new TextRun({
              text: `${entry.text}  —  ${entry.pageLabel}`,
              font: fontName,
              size: baseFontHalfPt,
              bold: entry.level === 1,
            }),
          ],
        })
      );
    });
    children.push(new Paragraph({ pageBreakBefore: true, text: '' }));
  }

  const appendHtmlNodeToDocx = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const txt = (node.textContent || '').trim();
      if (txt) {
        children.push(
          new Paragraph({
            spacing: {
              after: (project.pageSetup.paragraphSpacingPt || 8) * 20,
              line: Math.round((project.pageSetup.lineHeight || 1.5) * 240),
            },
            children: [new TextRun({ text: txt, font: fontName, size: baseFontHalfPt })],
          })
        );
      }
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    if (el.classList.contains('dm-pdf-page-marker')) {
      return;
    }

    if (DOCX_CONTAINER_TAGS.has(tag)) {
      Array.from(el.childNodes).forEach((child) => appendHtmlNodeToDocx(child));
      return;
    }

    if (tag === 'img') {
      const imgData = dataUrlToDocxImage(el as HTMLImageElement);
      if (imgData) {
        children.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 120, after: 120 },
            children: [
              new ImageRun({
                type: imgData.type,
                data: imgData.data,
                transformation: { width: imgData.width, height: imgData.height },
              }),
            ],
          })
        );
      }
      return;
    }

    const alignment = getAlignmentFromStyle(el);
    const layoutProps = getParagraphLayoutProps(el, project);

    if (tag === 'h1') {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          alignment,
          indent: layoutProps.indent,
          spacing: { before: layoutProps.spacing.before ?? 240, after: layoutProps.spacing.after ?? 120 },
          children: htmlElementToDocxRuns(el, fontName, baseFontHalfPt + 10),
        })
      );
    } else if (tag === 'h2') {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          alignment,
          indent: layoutProps.indent,
          spacing: { before: layoutProps.spacing.before ?? 200, after: layoutProps.spacing.after ?? 100 },
          children: htmlElementToDocxRuns(el, fontName, baseFontHalfPt + 6),
        })
      );
    } else if (tag === 'h3') {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          alignment,
          indent: layoutProps.indent,
          spacing: { before: layoutProps.spacing.before ?? 160, after: layoutProps.spacing.after ?? 80 },
          children: htmlElementToDocxRuns(el, fontName, baseFontHalfPt + 2),
        })
      );
    } else if (tag === 'ul' || tag === 'ol') {
      const listItems = Array.from(el.children).filter((c) => c.tagName.toLowerCase() === 'li');
      const itemsToRender = listItems.length > 0 ? listItems : Array.from(el.querySelectorAll('li'));
      const startNum = tag === 'ol' ? Number(el.getAttribute('start')) || 1 : 1;
      const listLeftPt = cssLengthToPt(el.style.marginLeft) ?? 0;
      itemsToRender.forEach((li, liIdx) => {
        const prefix = tag === 'ol' ? `${startNum + liIdx}. ` : '• ';
        children.push(
          new Paragraph({
            indent: { left: 420 + Math.round(listLeftPt * 20) },
            spacing: { after: 80 },
            children: [
              new TextRun({ text: prefix, font: fontName, size: baseFontHalfPt }),
              ...htmlElementToDocxRuns(li, fontName, baseFontHalfPt),
            ],
          })
        );
      });
    } else if (tag === 'table') {
      const rows = getDirectTableRowsForDocx(el).map((tr) => {
        const cells = Array.from(tr.children)
          .filter((c) => {
            const cTag = c.tagName.toLowerCase();
            return cTag === 'th' || cTag === 'td';
          })
          .map((rawCell) => {
            const cell = rawCell as HTMLElement;
            const colspan = Math.max(1, Number(cell.getAttribute('colspan')) || 1);
            const rowspan = Math.max(1, Number(cell.getAttribute('rowspan')) || 1);
            const bgHex = cssColorToDocxHex(cell.style.backgroundColor);

            const directBlockChildren = Array.from(cell.children).filter((c) => {
              const t = c.tagName.toLowerCase();
              return t === 'p' || t === 'h1' || t === 'h2' || t === 'h3' || t === 'blockquote';
            });

            const cellParagraphs =
              directBlockChildren.length > 0
                ? directBlockChildren.map((blockEl) => {
                    const bHtmlEl = blockEl as HTMLElement;
                    return new Paragraph({
                      alignment: getAlignmentFromStyle(bHtmlEl),
                      children: htmlElementToDocxRuns(bHtmlEl, fontName, baseFontHalfPt),
                    });
                  })
                : [
                    new Paragraph({
                      alignment: getAlignmentFromStyle(cell),
                      children: htmlElementToDocxRuns(cell, fontName, baseFontHalfPt),
                    }),
                  ];

            const resolveCellBorder = (side: 'borderTop' | 'borderBottom' | 'borderLeft' | 'borderRight') => {
              const bVal = cell.style[side] || cell.style.border || '';
              if (bVal.includes('none')) {
                return { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
              }
              return { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' };
            };

            return new TableCell({
              columnSpan: colspan > 1 ? colspan : undefined,
              rowSpan: rowspan > 1 ? rowspan : undefined,
              shading: bgHex ? { fill: bgHex } : undefined,
              children: cellParagraphs,
              borders: {
                top: resolveCellBorder('borderTop'),
                bottom: resolveCellBorder('borderBottom'),
                left: resolveCellBorder('borderLeft'),
                right: resolveCellBorder('borderRight'),
              },
            });
          });
        return new TableRow({
          children:
            cells.length > 0
              ? cells
              : [new TableCell({ children: [new Paragraph({ text: '' })] })],
        });
      });
      if (rows.length > 0) {
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows,
          })
        );
      }
    } else if (tag === 'hr') {
      children.push(new Paragraph({ pageBreakBefore: true, text: '' }));
    } else {
      const embeddedImgs = Array.from(el.querySelectorAll('img'));
      for (const imgEl of embeddedImgs) {
        const imgData = dataUrlToDocxImage(imgEl);
        if (imgData) {
          children.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 100, after: 100 },
              children: [
                new ImageRun({
                  type: imgData.type,
                  data: imgData.data,
                  transformation: { width: imgData.width, height: imgData.height },
                }),
              ],
            })
          );
        }
      }
      const runs = htmlElementToDocxRuns(el, fontName, baseFontHalfPt);
      if (runs.length > 0 || embeddedImgs.length === 0) {
        children.push(
          new Paragraph({
            alignment,
            spacing: layoutProps.spacing,
            indent: layoutProps.indent,
            children: runs,
          })
        );
      }
    }
  };

  for (let dIdx = 0; dIdx < selectedDocs.length; dIdx++) {
    const docItem = selectedDocs[dIdx];
    if (dIdx > 0) {
      children.push(new Paragraph({ pageBreakBefore: true, text: '' }));
    }

    if (docItem.sourceType === 'blank') {
      children.push(new Paragraph({ text: '' }));
      continue;
    }

    const container = document.createElement('div');
    container.innerHTML = docItem.contentHtml || '<p></p>';

    const pdfMarkers = Array.from(container.querySelectorAll('.dm-pdf-page-marker'));
    const hasOnlyPdfMarkers =
      pdfMarkers.length > 0 && (container.textContent || '').trim().length === 0;

    if (hasOnlyPdfMarkers) {
      const rawPlain = (docItem.plainText || '').trim();
      const hasExtractedText = Boolean(rawPlain && !/^\[PDF Document:/i.test(rawPlain));
      let embeddedImages = false;

      if (!hasExtractedText && getPdfPageImages) {
        const allPageUrls = await getPdfPageImages(docItem.id);
        if (allPageUrls && allPageUrls.length > 0) {
          let emittedPages = 0;
          pdfMarkers.forEach((markerEl, mIdx) => {
            const pageNum = Number(markerEl.getAttribute('data-pdf-page')) || mIdx + 1;
            const wPt = Number(markerEl.getAttribute('data-width-pt')) || 595;
            const hPt = Number(markerEl.getAttribute('data-height-pt')) || 842;
            const pageUrl = allPageUrls[pageNum - 1];
            const imgData = pageUrl ? rawDataUrlToDocxImage(pageUrl, wPt, hPt) : null;
            if (imgData) {
              children.push(
                new Paragraph({
                  pageBreakBefore: emittedPages > 0,
                  alignment: AlignmentType.CENTER,
                  children: [
                    new ImageRun({
                      type: imgData.type,
                      data: imgData.data,
                      transformation: { width: imgData.width, height: imgData.height },
                    }),
                  ],
                })
              );
              emittedPages++;
              embeddedImages = true;
            }
          });
        }
      }

      if (!embeddedImages && rawPlain) {
        const blocks = rawPlain.split(/\n{2,}/);
        for (const blk of blocks) {
          const trimmed = blk.trim();
          if (!trimmed) continue;
          children.push(
            new Paragraph({
              spacing: {
                after: (project.pageSetup.paragraphSpacingPt || 8) * 20,
                line: Math.round((project.pageSetup.lineHeight || 1.5) * 240),
              },
              children: [new TextRun({ text: trimmed, font: fontName, size: baseFontHalfPt })],
            })
          );
        }
      }
    } else {
      Array.from(container.childNodes).forEach((child) => appendHtmlNodeToDocx(child));
    }

    if (docItem.signatureText) {
      children.push(
        new Paragraph({
          spacing: { before: 320 },
          alignment: AlignmentType.RIGHT,
          children: [
            new TextRun({
              text: docItem.signatureText,
              font: fontName,
              size: baseFontHalfPt,
              italics: true,
              bold: true,
            }),
          ],
        })
      );
    }
  }

  const hf = project.headerFooterConfig;
  const headerText = [hf.headerLeft, hf.headerCenter, hf.headerRight]
    .filter(Boolean)
    .join('   |   ')
    .replace(/\{title\}/gi, project.title)
    .replace(/\{org\}/gi, hf.organizationName || '');

  const footerText = [hf.footerLeft, hf.footerCenter, hf.footerRight]
    .filter(Boolean)
    .join('   |   ')
    .replace(/\{title\}/gi, project.title)
    .replace(/\{org\}/gi, hf.organizationName || '');

  const isKhmerNum =
    project.numberingConfig.format === 'km' || project.numberingConfig.format === 'km-alpha';
  const numberingFontName = resolveDocxFontName(
    project.numberingConfig.fontFamily || project.pageSetup.defaultFontFamily
  );
  const docxPageFormat =
    project.numberingConfig.format === 'i'
      ? NumberFormat.LOWER_ROMAN
      : project.numberingConfig.format === 'I'
      ? NumberFormat.UPPER_ROMAN
      : project.numberingConfig.format === 'A'
      ? NumberFormat.UPPER_LETTER
      : NumberFormat.DECIMAL;

  const doc = new Document({
    title: project.title,
    creator: 'Document Master',
    sections: [
      {
        properties: {
          page: {
            size: {
              width: convertMillimetersToTwip(widthMm),
              height: convertMillimetersToTwip(heightMm),
              orientation:
                project.pageSetup.orientation === 'landscape'
                  ? PageOrientation.LANDSCAPE
                  : PageOrientation.PORTRAIT,
            },
            margin: {
              top: convertMillimetersToTwip(project.pageSetup.marginTopMm),
              bottom: convertMillimetersToTwip(project.pageSetup.marginBottomMm),
              left: convertMillimetersToTwip(project.pageSetup.marginLeftMm),
              right: convertMillimetersToTwip(project.pageSetup.marginRightMm),
            },
            pageNumbers: {
              start: project.numberingConfig.startPage || 1,
              formatType: docxPageFormat,
            },
          },
        },
        headers: hf.headerEnabled
          ? {
              default: new Header({
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [new TextRun({ text: headerText, font: fontName, size: 18, color: '64748B' })],
                  }),
                ],
              }),
            }
          : undefined,
        footers:
          hf.footerEnabled || project.numberingConfig.enabled
            ? {
                default: new Footer({
                  children: [
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      children: [
                        ...(footerText
                          ? [new TextRun({ text: `${footerText}   •   `, font: fontName, size: 18, color: '64748B' })]
                          : []),
                        ...(project.numberingConfig.enabled
                          ? [
                              ...(project.numberingConfig.prefixText
                                ? [
                                    new TextRun({
                                      text: project.numberingConfig.prefixText,
                                      font: numberingFontName,
                                      size: 18,
                                      color: '475569',
                                    }),
                                  ]
                                : []),
                              ...(project.numberingConfig.displayPattern === 'page-x-of-y'
                                ? [
                                    new TextRun({
                                      text: isKhmerNum ? 'ទំព័រ ' : 'Page ',
                                      font: numberingFontName,
                                      size: 18,
                                      color: '475569',
                                    }),
                                    new TextRun({ children: [PageNumber.CURRENT], font: numberingFontName, size: 18 }),
                                    new TextRun({
                                      text: isKhmerNum ? ' នៃ ' : ' of ',
                                      font: numberingFontName,
                                      size: 18,
                                      color: '475569',
                                    }),
                                    new TextRun({ children: [PageNumber.TOTAL_PAGES], font: numberingFontName, size: 18 }),
                                  ]
                                : [new TextRun({ children: [PageNumber.CURRENT], font: numberingFontName, size: 18 })]),
                              ...(project.numberingConfig.suffixText
                                ? [
                                    new TextRun({
                                      text: project.numberingConfig.suffixText,
                                      font: numberingFontName,
                                      size: 18,
                                      color: '475569',
                                    }),
                                  ]
                                : []),
                            ]
                          : []),
                      ],
                    }),
                  ],
                }),
              }
            : undefined,
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, sanitizeFileName(project.title, 'docx'));
}

export function exportProjectToTxt(
  project: Project,
  compilation: CompilationResult
): void {
  const lines: string[] = [
    project.title,
    '='.repeat(Math.max(20, project.title.length)),
    '',
  ];

  if (project.tocConfig.enabled && compilation.tocEntries.length > 0) {
    lines.push(project.tocConfig.title || 'Table of Contents');
    lines.push('-'.repeat(32));
    compilation.tocEntries.forEach((entry) => {
      const indent = '  '.repeat(entry.level - 1);
      lines.push(`${indent}${entry.text} ........ ${entry.pageLabel}`);
    });
    lines.push('', '');
  }

  compilation.pages.forEach((page, idx) => {
    const tmp = document.createElement('div');
    tmp.innerHTML = page.html;
    const text = (tmp.textContent || tmp.innerText || '').trim();
    lines.push(`--- Page ${idx + 1} (${page.pageNumberFormatted || 'Unnumbered'}) : ${page.docTitle} ---`);
    lines.push(text);
    if (page.signatureText) {
      lines.push(`[Signature: ${page.signatureText}]`);
    }
    lines.push('');
  });

  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  saveAs(blob, sanitizeFileName(project.title, 'txt'));
}
