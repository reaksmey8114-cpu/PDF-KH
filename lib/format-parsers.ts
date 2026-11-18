import JSZip from 'jszip';

export const PAGE_BREAK_SENTINEL = '<<<DM_PAGE_BREAK_MARKER>>>';

export interface InspectedImageResult {
  dataUrl: string;
  width?: number;
  height?: number;
  renderable: boolean;
}

export type ImageInspector = (
  rawDataUrl: string,
  mimeType: string
) => Promise<InspectedImageResult>;

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(val: string): string {
  return val
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function normalizeCssColor(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === 'auto' || trimmed.toLowerCase() === 'none') {
    return undefined;
  }
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) {
    return `#${trimmed.toLowerCase()}`;
  }
  if (/^[0-9a-fA-F]{3}$/.test(trimmed)) {
    return `#${trimmed.toLowerCase()}`;
  }
  if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  if (/^rgb\(/i.test(trimmed) || /^rgba\(/i.test(trimmed)) {
    return trimmed;
  }
  const named: Record<string, string> = {
    black: '#000000',
    white: '#ffffff',
    red: '#dc2626',
    green: '#16a34a',
    blue: '#2563eb',
    darkblue: '#1e3a8a',
    darkcyan: '#0e7490',
    darkgreen: '#15803d',
    darkmagenta: '#86198f',
    darkred: '#991b1b',
    darkyellow: '#ca8a04',
    yellow: '#fef08a',
    cyan: '#67e8f9',
    magenta: '#f0abfc',
    gray: '#64748b',
    lightgray: '#cbd5e1',
    darkgray: '#475569',
    orange: '#f97316',
    purple: '#9333ea',
  };
  return named[trimmed.toLowerCase()];
}

const DOCX_HIGHLIGHT_MAP: Record<string, string> = {
  yellow: '#fef08a',
  green: '#86efac',
  cyan: '#67e8f9',
  magenta: '#f0abfc',
  blue: '#93c5fd',
  red: '#fca5a5',
  darkblue: '#1e3a8a',
  darkcyan: '#155e75',
  darkgreen: '#166534',
  darkmagenta: '#6b21a8',
  darkred: '#991b1b',
  darkyellow: '#a16207',
  darkgray: '#64748b',
  lightgray: '#e2e8f0',
  black: '#0f172a',
  white: '#ffffff',
};

function twipsToPt(twipsStr?: string | null): number | undefined {
  if (!twipsStr) return undefined;
  const n = Number(twipsStr);
  if (Number.isNaN(n)) return undefined;
  return Math.round((n / 20) * 10) / 10;
}

function getDirectChildrenByLocalName(parent: Element, localName: string): Element[] {
  return Array.from(parent.children).filter((c) => c.localName === localName);
}

function getFirstDirectChildByLocalName(parent: Element, localName: string): Element | undefined {
  return Array.from(parent.children).find((c) => c.localName === localName);
}

function getAttrByLocalName(el: Element | undefined, name: string): string | undefined {
  if (!el) return undefined;
  const direct = el.getAttribute(`w:${name}`) ?? el.getAttribute(name);
  if (direct !== null) return direct;
  const attrs = el.attributes;
  for (let i = 0; i < attrs.length; i++) {
    if (attrs[i].localName === name) return attrs[i].value;
  }
  return undefined;
}

function getWAttr(el: Element | undefined, name: string): string | undefined {
  return getAttrByLocalName(el, name);
}

export function hasMeaningfulHtmlContent(html: string): boolean {
  if (!html) return false;
  if (/<img\b|<svg\b/i.test(html)) return true;
  const stripped = html
    .replace(/<hr[^>]*>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;|\u00A0|\s+/g, '');
  return stripped.length > 0;
}

function findZipEntry(zip: JSZip, targetPath: string): JSZip.JSZipObject | null {
  const clean = targetPath.replace(/^\/+/, '');
  const exact = zip.file(clean);
  if (exact) return exact;
  const lower = clean.toLowerCase();
  for (const [key, obj] of Object.entries(zip.files)) {
    if (!obj.dir && key.replace(/^\/+/, '').toLowerCase() === lower) {
      return obj;
    }
  }
  return null;
}

interface ResolvedRunStyle {
  fontFamily?: string;
  fontSizePt?: number;
  color?: string;
  highlightColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  caps?: boolean;
  smallCaps?: boolean;
  vertAlign?: 'superscript' | 'subscript';
}

interface ResolvedParaStyle {
  align?: 'left' | 'center' | 'right' | 'justify';
  marginLeftPt?: number;
  marginRightPt?: number;
  textIndentPt?: number;
  marginTopPt?: number;
  marginBottomPt?: number;
  lineHeight?: string;
  backgroundColor?: string;
  borderTop?: string;
  borderBottom?: string;
  borderLeft?: string;
  borderRight?: string;
  outlineLevel?: number;
  headingLevel?: 1 | 2 | 3;
  numId?: string;
  ilvl?: number;
  pageBreakBefore?: boolean;
}

interface StyleDefinition {
  id: string;
  type: string;
  name: string;
  basedOn?: string;
  pPrEl?: Element;
  rPrEl?: Element;
}

interface NumberingLevelDef {
  numFmt: string;
  start: number;
  leftPt?: number;
  hangingPt?: number;
}

function mapDocxBorderCss(bdrEl: Element | undefined): string | undefined {
  if (!bdrEl) return undefined;
  const val = getWAttr(bdrEl, 'val');
  if (!val || val === 'none' || val === 'nil') return 'none';
  const szEighthPt = Number(getWAttr(bdrEl, 'sz')) || 4;
  const px = Math.max(1, Math.min(6, Math.round((szEighthPt / 8) * 1.33)));
  const color = normalizeCssColor(getWAttr(bdrEl, 'color')) || '#334155';
  const style =
    val === 'dashed' || val === 'dashSmallGap'
      ? 'dashed'
      : val === 'dotted'
      ? 'dotted'
      : val === 'double'
      ? 'double'
      : 'solid';
  return `${px}px ${style} ${color}`;
}

function parseBoolToggle(el: Element | undefined): boolean | undefined {
  if (!el) return undefined;
  const val = getWAttr(el, 'val');
  if (val === '0' || val === 'false' || val === 'off' || val === 'none') return false;
  return true;
}

function parseRPrElement(rPr: Element | undefined, target: ResolvedRunStyle): void {
  if (!rPr) return;

  const rFonts = getFirstDirectChildByLocalName(rPr, 'rFonts');
  if (rFonts) {
    const csFont = getWAttr(rFonts, 'cs');
    const asciiFont = getWAttr(rFonts, 'ascii') || getWAttr(rFonts, 'hAnsi') || getWAttr(rFonts, 'eastAsia');
    const fonts = [csFont, asciiFont].filter((f): f is string => Boolean(f && f.trim()));
    if (fonts.length > 0) {
      const unique = Array.from(new Set(fonts));
      target.fontFamily = unique.map((f) => `"${f.replace(/"/g, '')}"`).join(', ') + ', sans-serif';
    }
  }

  const szEl = getFirstDirectChildByLocalName(rPr, 'sz') || getFirstDirectChildByLocalName(rPr, 'szCs');
  const szVal = getWAttr(szEl, 'val');
  if (szVal) {
    const halfPt = Number(szVal);
    if (!Number.isNaN(halfPt) && halfPt > 0) {
      target.fontSizePt = Math.round((halfPt / 2) * 10) / 10;
    }
  }

  const colorEl = getFirstDirectChildByLocalName(rPr, 'color');
  const colorVal = getWAttr(colorEl, 'val');
  if (colorVal) {
    if (colorVal.toLowerCase() === 'auto') {
      target.color = undefined;
    } else {
      const hex = normalizeCssColor(colorVal);
      if (hex) target.color = hex;
    }
  }

  const hlEl = getFirstDirectChildByLocalName(rPr, 'highlight');
  const hlVal = getWAttr(hlEl, 'val');
  if (hlVal) {
    if (hlVal.toLowerCase() === 'none') {
      target.highlightColor = undefined;
    } else {
      target.highlightColor = DOCX_HIGHLIGHT_MAP[hlVal.toLowerCase()] || normalizeCssColor(hlVal);
    }
  }

  const shdEl = getFirstDirectChildByLocalName(rPr, 'shd');
  const shdFill = getWAttr(shdEl, 'fill');
  if (shdFill && shdFill.toLowerCase() !== 'auto' && !target.highlightColor) {
    const hex = normalizeCssColor(shdFill);
    if (hex && hex !== '#ffffff') target.highlightColor = hex;
  }

  const bEl = getFirstDirectChildByLocalName(rPr, 'b') || getFirstDirectChildByLocalName(rPr, 'bCs');
  const bVal = parseBoolToggle(bEl);
  if (bVal !== undefined) target.bold = bVal;

  const iEl = getFirstDirectChildByLocalName(rPr, 'i') || getFirstDirectChildByLocalName(rPr, 'iCs');
  const iVal = parseBoolToggle(iEl);
  if (iVal !== undefined) target.italic = iVal;

  const uEl = getFirstDirectChildByLocalName(rPr, 'u');
  if (uEl) {
    const uVal = getWAttr(uEl, 'val');
    target.underline = uVal !== 'none';
  }

  const strikeEl =
    getFirstDirectChildByLocalName(rPr, 'strike') ||
    getFirstDirectChildByLocalName(rPr, 'dstrike');
  const strikeVal = parseBoolToggle(strikeEl);
  if (strikeVal !== undefined) target.strike = strikeVal;

  const capsVal = parseBoolToggle(getFirstDirectChildByLocalName(rPr, 'caps'));
  if (capsVal !== undefined) target.caps = capsVal;

  const smallCapsVal = parseBoolToggle(getFirstDirectChildByLocalName(rPr, 'smallCaps'));
  if (smallCapsVal !== undefined) target.smallCaps = smallCapsVal;

  const vaEl = getFirstDirectChildByLocalName(rPr, 'vertAlign');
  const vaVal = getWAttr(vaEl, 'val');
  if (vaVal === 'superscript' || vaVal === 'subscript') {
    target.vertAlign = vaVal;
  } else if (vaVal === 'baseline') {
    target.vertAlign = undefined;
  }
}

function parsePPrElement(pPr: Element | undefined, target: ResolvedParaStyle): void {
  if (!pPr) return;

  const jcEl = getFirstDirectChildByLocalName(pPr, 'jc');
  const jcVal = getWAttr(jcEl, 'val');
  if (jcVal) {
    if (jcVal === 'center') target.align = 'center';
    else if (jcVal === 'right' || jcVal === 'end') target.align = 'right';
    else if (jcVal === 'both' || jcVal === 'distribute') target.align = 'justify';
    else if (jcVal === 'left' || jcVal === 'start') target.align = 'left';
  }

  const indEl = getFirstDirectChildByLocalName(pPr, 'ind');
  if (indEl) {
    const leftPt = twipsToPt(getWAttr(indEl, 'left') || getWAttr(indEl, 'start'));
    const rightPt = twipsToPt(getWAttr(indEl, 'right') || getWAttr(indEl, 'end'));
    const firstPt = twipsToPt(getWAttr(indEl, 'firstLine'));
    const hangingPt = twipsToPt(getWAttr(indEl, 'hanging'));
    if (leftPt !== undefined) target.marginLeftPt = leftPt;
    if (rightPt !== undefined) target.marginRightPt = rightPt;
    if (firstPt !== undefined) target.textIndentPt = firstPt;
    else if (hangingPt !== undefined && hangingPt > 0) target.textIndentPt = -hangingPt;
  }

  const spacingEl = getFirstDirectChildByLocalName(pPr, 'spacing');
  if (spacingEl) {
    const beforePt = twipsToPt(getWAttr(spacingEl, 'before'));
    const afterPt = twipsToPt(getWAttr(spacingEl, 'after'));
    const lineRaw = getWAttr(spacingEl, 'line');
    const lineRule = getWAttr(spacingEl, 'lineRule') || 'auto';
    if (beforePt !== undefined) target.marginTopPt = beforePt;
    if (afterPt !== undefined) target.marginBottomPt = afterPt;
    if (lineRaw) {
      const lineNum = Number(lineRaw);
      if (!Number.isNaN(lineNum) && lineNum > 0) {
        if (lineRule === 'exact' || lineRule === 'atLeast') {
          target.lineHeight = `${Math.round((lineNum / 20) * 10) / 10}pt`;
        } else {
          const ratio = Math.round((lineNum / 240) * 100) / 100;
          if (ratio >= 0.8 && ratio <= 4) {
            target.lineHeight = String(ratio);
          }
        }
      }
    }
  }

  const shdEl = getFirstDirectChildByLocalName(pPr, 'shd');
  const shdFill = getWAttr(shdEl, 'fill');
  if (shdFill && shdFill.toLowerCase() !== 'auto') {
    const hex = normalizeCssColor(shdFill);
    if (hex) target.backgroundColor = hex;
  }

  const pBdrEl = getFirstDirectChildByLocalName(pPr, 'pBdr');
  if (pBdrEl) {
    const bt = mapDocxBorderCss(getFirstDirectChildByLocalName(pBdrEl, 'top'));
    const bb = mapDocxBorderCss(getFirstDirectChildByLocalName(pBdrEl, 'bottom'));
    const bl = mapDocxBorderCss(getFirstDirectChildByLocalName(pBdrEl, 'left'));
    const br = mapDocxBorderCss(getFirstDirectChildByLocalName(pBdrEl, 'right'));
    if (bt && bt !== 'none') target.borderTop = bt;
    if (bb && bb !== 'none') target.borderBottom = bb;
    if (bl && bl !== 'none') target.borderLeft = bl;
    if (br && br !== 'none') target.borderRight = br;
  }

  const outlineEl = getFirstDirectChildByLocalName(pPr, 'outlineLvl');
  const outlineVal = getWAttr(outlineEl, 'val');
  if (outlineVal !== undefined) {
    const lvl = Number(outlineVal);
    if (lvl >= 0 && lvl <= 2) {
      target.outlineLevel = lvl;
      target.headingLevel = (lvl + 1) as 1 | 2 | 3;
    }
  }

  const pbbEl = getFirstDirectChildByLocalName(pPr, 'pageBreakBefore');
  const pbbVal = parseBoolToggle(pbbEl);
  if (pbbVal !== undefined) target.pageBreakBefore = pbbVal;

  const numPrEl = getFirstDirectChildByLocalName(pPr, 'numPr');
  if (numPrEl) {
    const numIdEl = getFirstDirectChildByLocalName(numPrEl, 'numId');
    const ilvlEl = getFirstDirectChildByLocalName(numPrEl, 'ilvl');
    const numIdVal = getWAttr(numIdEl, 'val');
    if (numIdVal !== undefined) {
      target.numId = numIdVal === '0' ? undefined : numIdVal;
    }
    const ilvlVal = getWAttr(ilvlEl, 'val');
    if (ilvlVal !== undefined && !Number.isNaN(Number(ilvlVal))) {
      target.ilvl = Number(ilvlVal);
    }
  }
}

function getMimeTypeForZipPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'bmp') return 'image/bmp';
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'tif' || ext === 'tiff') return 'image/tiff';
  if (ext === 'emf') return 'image/emf';
  if (ext === 'wmf') return 'image/wmf';
  return 'image/png';
}

function resolveZipMediaPath(target: string, baseDir = 'word'): string {
  const clean = target.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!baseDir || clean.startsWith('word/')) return clean;
  const parts = baseDir.split('/').filter(Boolean);
  for (const seg of clean.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return parts.join('/');
}

function buildInlineSpanStyleCss(r: ResolvedRunStyle): string {
  const parts: string[] = [];
  if (r.color) parts.push(`color: ${r.color}`);
  if (r.fontFamily) parts.push(`font-family: ${r.fontFamily}`);
  if (r.fontSizePt) parts.push(`font-size: ${r.fontSizePt}pt`);
  if (r.caps) parts.push('text-transform: uppercase');
  else if (r.smallCaps) parts.push('font-variant: small-caps');
  return parts.join('; ');
}

function runStyleKey(r: ResolvedRunStyle): string {
  return JSON.stringify([
    r.fontFamily || '',
    r.fontSizePt || '',
    r.color || '',
    r.highlightColor || '',
    Boolean(r.bold),
    Boolean(r.italic),
    Boolean(r.underline),
    Boolean(r.strike),
    Boolean(r.caps),
    Boolean(r.smallCaps),
    r.vertAlign || '',
  ]);
}

function renderStyledRunText(text: string, r: ResolvedRunStyle): string {
  if (!text) return '';
  const spacePreserved = text
    .replace(/^ +/g, (m) => '\u00A0'.repeat(m.length))
    .replace(/ {2,}/g, (m) => '\u00A0'.repeat(m.length - 1) + ' ');
  let out = escapeHtml(spacePreserved);

  const spanCss = buildInlineSpanStyleCss(r);
  if (spanCss) {
    out = `<span style="${escapeAttr(spanCss)}">${out}</span>`;
  }
  if (r.highlightColor) {
    out = `<mark data-color="${escapeAttr(r.highlightColor)}" style="background-color: ${escapeAttr(r.highlightColor)}">${out}</mark>`;
  }
  if (r.bold) out = `<strong>${out}</strong>`;
  if (r.italic) out = `<em>${out}</em>`;
  if (r.underline) out = `<u>${out}</u>`;
  if (r.strike) out = `<s>${out}</s>`;
  if (r.vertAlign === 'superscript') out = `<sup>${out}</sup>`;
  else if (r.vertAlign === 'subscript') out = `<sub>${out}</sub>`;
  return out;
}

function buildParaStyleCss(p: ResolvedParaStyle, includeMargins = true): string {
  const parts: string[] = [];
  if (p.align) parts.push(`text-align: ${p.align}`);
  if (p.marginLeftPt && p.marginLeftPt > 0) parts.push(`margin-left: ${p.marginLeftPt}pt`);
  if (p.marginRightPt && p.marginRightPt > 0) parts.push(`margin-right: ${p.marginRightPt}pt`);
  if (p.textIndentPt && p.textIndentPt !== 0) parts.push(`text-indent: ${p.textIndentPt}pt`);
  if (includeMargins) {
    if (p.marginTopPt !== undefined && p.marginTopPt > 0) parts.push(`margin-top: ${p.marginTopPt}pt`);
    if (p.marginBottomPt !== undefined && p.marginBottomPt >= 0) {
      parts.push(`margin-bottom: ${p.marginBottomPt}pt`);
    }
  }
  if (p.lineHeight) parts.push(`line-height: ${p.lineHeight}`);
  if (p.backgroundColor) parts.push(`background-color: ${p.backgroundColor}; padding: 4px 8px`);
  if (p.borderTop) parts.push(`border-top: ${p.borderTop}`);
  if (p.borderBottom) parts.push(`border-bottom: ${p.borderBottom}`);
  if (p.borderLeft) parts.push(`border-left: ${p.borderLeft}; padding-left: 8px`);
  if (p.borderRight) parts.push(`border-right: ${p.borderRight}`);
  return parts.join('; ');
}

function mapNumFmtToListTag(numFmt: string): { tag: 'ul' | 'ol'; listStyleType?: string } {
  if (numFmt === 'bullet' || numFmt === 'none') {
    return { tag: 'ul' };
  }
  if (numFmt === 'lowerLetter') return { tag: 'ol', listStyleType: 'lower-alpha' };
  if (numFmt === 'upperLetter') return { tag: 'ol', listStyleType: 'upper-alpha' };
  if (numFmt === 'lowerRoman') return { tag: 'ol', listStyleType: 'lower-roman' };
  if (numFmt === 'upperRoman') return { tag: 'ol', listStyleType: 'upper-roman' };
  if (numFmt === 'decimalZero') return { tag: 'ol', listStyleType: 'decimal-leading-zero' };
  if (numFmt.toLowerCase().includes('khmer') || numFmt === 'cambodian') {
    return { tag: 'ol', listStyleType: 'khmer' };
  }
  return { tag: 'ol', listStyleType: 'decimal' };
}

function extractMathTextWithBasicStructure(mathEl: Element): string {
  const walkMath = (node: Element): string => {
    const name = node.localName;
    if (name === 't') return node.textContent || '';
    if (name === 'f') {
      const num = getFirstDirectChildByLocalName(node, 'num');
      const den = getFirstDirectChildByLocalName(node, 'den');
      const numStr = num ? walkMath(num) : '';
      const denStr = den ? walkMath(den) : '';
      return `(${numStr})/(${denStr})`;
    }
    if (name === 'sSup') {
      const e = getFirstDirectChildByLocalName(node, 'e');
      const sup = getFirstDirectChildByLocalName(node, 'sup');
      return `${e ? walkMath(e) : ''}^(${sup ? walkMath(sup) : ''})`;
    }
    if (name === 'sSub') {
      const e = getFirstDirectChildByLocalName(node, 'e');
      const sub = getFirstDirectChildByLocalName(node, 'sub');
      return `${e ? walkMath(e) : ''}_(${sub ? walkMath(sub) : ''})`;
    }
    if (name === 'rad') {
      const e = getFirstDirectChildByLocalName(node, 'e');
      return `sqrt(${e ? walkMath(e) : ''})`;
    }
    let acc = '';
    for (const child of Array.from(node.children)) {
      acc += walkMath(child);
    }
    return acc;
  };
  return walkMath(mathEl).trim();
}

export async function convertDocxZipToHtml(
  zip: JSZip,
  inspectImage: ImageInspector
): Promise<{ html: string; fallbackText: string } | null> {
  if (typeof DOMParser === 'undefined') return null;

  const parser = new DOMParser();

  // Resolve primary document XML path from _rels/.rels (falling back to word/document.xml)
  let mainDocPath = 'word/document.xml';
  const rootRelsFile = findZipEntry(zip, '_rels/.rels');
  if (rootRelsFile) {
    try {
      const rootRelsXml = parser.parseFromString(await rootRelsFile.async('string'), 'application/xml');
      const officeRel = Array.from(rootRelsXml.getElementsByTagName('*')).find((el) => {
        if (el.localName !== 'Relationship') return false;
        const type = (el.getAttribute('Type') || '').toLowerCase();
        return type.endsWith('/officedocument') || type.includes('officedocument.wordprocessingml');
      });
      const target = officeRel?.getAttribute('Target');
      if (target) {
        mainDocPath = target.replace(/\\/g, '/').replace(/^\/+/, '');
      }
    } catch {
      // Ignore malformed _rels/.rels
    }
  }

  let docFile = findZipEntry(zip, mainDocPath) || findZipEntry(zip, 'word/document.xml');
  if (!docFile) {
    const anyDocKey = Object.keys(zip.files).find(
      (k) => !zip.files[k].dir && /^word\/document[^/]*\.xml$/i.test(k.replace(/^\/+/, ''))
    );
    if (anyDocKey) {
      mainDocPath = anyDocKey;
      docFile = zip.files[anyDocKey];
    }
  }
  if (!docFile) return null;

  const docBaseDir = mainDocPath.includes('/')
    ? mainDocPath.slice(0, mainDocPath.lastIndexOf('/'))
    : '';
  const docFileName = mainDocPath.includes('/')
    ? mainDocPath.slice(mainDocPath.lastIndexOf('/') + 1)
    : mainDocPath;
  const docRelsPath = docBaseDir
    ? `${docBaseDir}/_rels/${docFileName}.rels`
    : `_rels/${docFileName}.rels`;

  const rawDocXml = await docFile.async('string');
  const docXml = parser.parseFromString(rawDocXml, 'application/xml');
  if (docXml.getElementsByTagName('parsererror').length > 0) return null;

  const bodyEl =
    Array.from(docXml.getElementsByTagName('*')).find((e) => e.localName === 'body') || null;
  if (!bodyEl) return null;

  const fallbackText = Array.from(docXml.getElementsByTagName('*'))
    .filter((e) => e.localName === 't')
    .map((n) => n.textContent || '')
    .join(' ')
    .trim();

  // 1. Relationships map
  const relsMap = new Map<string, { target: string; type: string; external: boolean }>();
  const relsFile =
    findZipEntry(zip, docRelsPath) || findZipEntry(zip, 'word/_rels/document.xml.rels');
  if (relsFile) {
    const relsXml = parser.parseFromString(await relsFile.async('string'), 'application/xml');
    for (const rel of Array.from(relsXml.getElementsByTagName('*')).filter(
      (e) => e.localName === 'Relationship'
    )) {
      const id = rel.getAttribute('Id');
      const target = rel.getAttribute('Target');
      const type = rel.getAttribute('Type') || '';
      const mode = rel.getAttribute('TargetMode');
      if (id && target) {
        relsMap.set(id, { target, type, external: mode === 'External' });
      }
    }
  }

  const isLikelyRenderableImageRel = (relId: string): boolean => {
    const rel = relsMap.get(relId);
    if (!rel || rel.external) return false;
    const ext = rel.target.split('.').pop()?.toLowerCase() || '';
    return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext);
  };

  // 2. Image cache
  const imageCache = new Map<string, { dataUrl: string; width?: number; height?: number; renderable: boolean }>();
  const resolveImageByRelId = async (relId: string, wPx?: number, hPx?: number): Promise<string> => {
    let cached = imageCache.get(relId);
    if (!cached) {
      const rel = relsMap.get(relId);
      if (!rel || rel.external) return '';
      const zipPath = resolveZipMediaPath(rel.target, docBaseDir || 'word');
      const mediaFile = findZipEntry(zip, zipPath);
      if (!mediaFile) return '';
      const base64 = await mediaFile.async('base64');
      const mime = getMimeTypeForZipPath(zipPath);
      const rawUrl = `data:${mime};base64,${base64}`;
      cached = await inspectImage(rawUrl, mime);
      imageCache.set(relId, cached);
    }

    if (!cached.renderable) {
      return '';
    }
    const finalW = wPx || cached.width;
    const finalH = hPx || cached.height;
    const dimAttrs =
      finalW && finalH
        ? ` width="${Math.round(finalW)}" height="${Math.round(finalH)}"`
        : '';
    return `<img src="${cached.dataUrl}" alt="Embedded image"${dimAttrs} />`;
  };

  // 3. Styles map
  let defaultRunStyle: ResolvedRunStyle = {};
  let defaultParaStyle: ResolvedParaStyle = {};
  const styleDefs = new Map<string, StyleDefinition>();
  let defaultParagraphStyleId: string | undefined;

  const stylesFile = findZipEntry(zip, 'word/styles.xml');
  if (stylesFile) {
    const stylesXml = parser.parseFromString(await stylesFile.async('string'), 'application/xml');
    const docDefaults = Array.from(stylesXml.getElementsByTagName('*')).find(
      (e) => e.localName === 'docDefaults'
    );
    if (docDefaults) {
      const rDef = Array.from(docDefaults.getElementsByTagName('*')).find(
        (e) => e.localName === 'rPr'
      );
      const pDef = Array.from(docDefaults.getElementsByTagName('*')).find(
        (e) => e.localName === 'pPr'
      );
      parseRPrElement(rDef, defaultRunStyle);
      parsePPrElement(pDef, defaultParaStyle);
    }

    for (const sEl of Array.from(stylesXml.getElementsByTagName('*')).filter(
      (e) => e.localName === 'style'
    )) {
      const id = getWAttr(sEl, 'styleId');
      const type = getWAttr(sEl, 'type') || 'paragraph';
      if (!id) continue;
      const nameEl = getFirstDirectChildByLocalName(sEl, 'name');
      const basedOnEl = getFirstDirectChildByLocalName(sEl, 'basedOn');
      const pPrEl = getFirstDirectChildByLocalName(sEl, 'pPr');
      const rPrEl = getFirstDirectChildByLocalName(sEl, 'rPr');
      const isDefault = getWAttr(sEl, 'default') === '1';
      if (isDefault && type === 'paragraph') {
        defaultParagraphStyleId = id;
      }
      styleDefs.set(id, {
        id,
        type,
        name: getWAttr(nameEl, 'val') || id,
        basedOn: getWAttr(basedOnEl, 'val'),
        pPrEl,
        rPrEl,
      });
    }
  }

  const resolveStyleChain = (styleId?: string): StyleDefinition[] => {
    const chain: StyleDefinition[] = [];
    const seen = new Set<string>();
    let cur = styleId;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const def = styleDefs.get(cur);
      if (!def) break;
      chain.unshift(def);
      cur = def.basedOn;
    }
    return chain;
  };

  // 4. Numbering map
  const abstractNums = new Map<string, Map<number, NumberingLevelDef>>();
  const numIdToAbstract = new Map<string, string>();
  const numberingFile = findZipEntry(zip, 'word/numbering.xml');
  if (numberingFile) {
    const numXml = parser.parseFromString(await numberingFile.async('string'), 'application/xml');
    for (const absEl of Array.from(numXml.getElementsByTagName('*')).filter(
      (e) => e.localName === 'abstractNum'
    )) {
      const absId = getWAttr(absEl, 'abstractNumId');
      if (!absId) continue;
      const lvlMap = new Map<number, NumberingLevelDef>();
      for (const lvlEl of getDirectChildrenByLocalName(absEl, 'lvl')) {
        const ilvl = Number(getWAttr(lvlEl, 'ilvl') ?? '0');
        const fmtEl = getFirstDirectChildByLocalName(lvlEl, 'numFmt');
        const startEl = getFirstDirectChildByLocalName(lvlEl, 'start');
        const pPrEl = getFirstDirectChildByLocalName(lvlEl, 'pPr');
        const indEl = pPrEl ? getFirstDirectChildByLocalName(pPrEl, 'ind') : undefined;
        lvlMap.set(ilvl, {
          numFmt: getWAttr(fmtEl, 'val') || 'decimal',
          start: Number(getWAttr(startEl, 'val') ?? '1') || 1,
          leftPt: twipsToPt(getWAttr(indEl, 'left') || getWAttr(indEl, 'start')),
          hangingPt: twipsToPt(getWAttr(indEl, 'hanging')),
        });
      }
      abstractNums.set(absId, lvlMap);
    }
    for (const numEl of Array.from(numXml.getElementsByTagName('*')).filter(
      (e) => e.localName === 'num'
    )) {
      const numId = getWAttr(numEl, 'numId');
      const absRefEl = getFirstDirectChildByLocalName(numEl, 'abstractNumId');
      const absId = getWAttr(absRefEl, 'val');
      if (numId && absId) {
        numIdToAbstract.set(numId, absId);
      }
    }
  }

  // 5. Footnotes & endnotes maps
  const footnotesMap = new Map<string, string>();
  const loadNotesMap = async (path: string, targetMap: Map<string, string>, tagName: string) => {
    const file = findZipEntry(zip, path);
    if (!file) return;
    const xml = parser.parseFromString(await file.async('string'), 'application/xml');
    for (const noteEl of Array.from(xml.getElementsByTagName('*')).filter(
      (e) => e.localName === tagName
    )) {
      const id = getWAttr(noteEl, 'id');
      const noteType = getWAttr(noteEl, 'type');
      if (!id || noteType === 'separator' || noteType === 'continuationSeparator') continue;
      const text = Array.from(noteEl.getElementsByTagName('*'))
        .filter((e) => e.localName === 't')
        .map((e) => e.textContent || '')
        .join('')
        .trim();
      if (text) targetMap.set(id, text);
    }
  };
  await loadNotesMap('word/footnotes.xml', footnotesMap, 'footnote');
  const endnotesMap = new Map<string, string>();
  await loadNotesMap('word/endnotes.xml', endnotesMap, 'endnote');

  const usedFootnotes: Array<{ id: string; text: string }> = [];
  const usedEndnotes: Array<{ id: string; text: string }> = [];

  type BlockItem =
    | { kind: 'html'; html: string }
    | { kind: 'break' }
    | { kind: 'listItem'; numId: string; ilvl: number; numFmt: string; start: number; innerHtml: string; styleCss: string };

  type RunInlineToken =
    | { type: 'text'; text: string; style: ResolvedRunStyle }
    | { type: 'html'; html: string }
    | { type: 'pageBreak' }
    | { type: 'blockHtml'; html: string };

  const pickPreferredAltContentBranch = (altEl: Element): Element | undefined => {
    const choice = getFirstDirectChildByLocalName(altEl, 'Choice');
    const fallback = getFirstDirectChildByLocalName(altEl, 'Fallback');
    if (!choice) return fallback;
    if (!fallback) return choice;

    const scoreBranch = (branch: Element): number => {
      const all = Array.from(branch.getElementsByTagName('*'));
      let score = 0;
      const hasTxbx = all.some((e) => e.localName === 'txbxContent' || e.localName === 'txBody');
      if (hasTxbx) score += 20;
      const hasText = all.some(
        (e) =>
          (e.localName === 't' && (e.textContent || '').trim().length > 0) ||
          (e.localName === 'textpath' && Boolean(e.getAttribute('string')?.trim()))
      );
      if (hasText) score += 15;
      for (const blip of all.filter((e) => e.localName === 'blip')) {
        const id =
          getAttrByLocalName(blip, 'embed') || getAttrByLocalName(blip, 'link');
        if (id) score += isLikelyRenderableImageRel(id) ? 30 : 2;
      }
      for (const im of all.filter((e) => e.localName === 'imagedata')) {
        const id =
          getAttrByLocalName(im, 'id') || getAttrByLocalName(im, 'relid');
        if (id) score += isLikelyRenderableImageRel(id) ? 30 : 2;
      }
      return score;
    };

    const choiceScore = scoreBranch(choice);
    const fallbackScore = scoreBranch(fallback);
    return fallbackScore > choiceScore ? fallback : choice;
  };

  const extractSmartArtDiagramHtml = async (diagramRelId: string): Promise<string> => {
    const rel = relsMap.get(diagramRelId);
    if (!rel || rel.external) return '';
    const zipPath = resolveZipMediaPath(rel.target, docBaseDir || 'word');
    const file = findZipEntry(zip, zipPath);
    if (!file) return '';
    try {
      const xml = parser.parseFromString(await file.async('string'), 'application/xml');
      const pNodes = Array.from(xml.getElementsByTagName('*')).filter((e) => e.localName === 'p');
      const lines: string[] = [];
      for (const pNode of pNodes) {
        const lineText = Array.from(pNode.getElementsByTagName('*'))
          .filter((e) => e.localName === 't')
          .map((t) => t.textContent || '')
          .join('');
        if (lineText.trim()) {
          lines.push(`<p>${escapeHtml(lineText)}</p>`);
        }
      }
      return lines.join('\n');
    } catch {
      return '';
    }
  };

  const convertGraphicOrPictContainer = async (
    containerEl: Element,
    runStyle: ResolvedRunStyle,
    depth = 0
  ): Promise<RunInlineToken[]> => {
    const tokens: RunInlineToken[] = [];
    if (depth > 8) return tokens;

    // Handle nested AlternateContent if encountered directly
    if (containerEl.localName === 'AlternateContent') {
      const preferred = pickPreferredAltContentBranch(containerEl);
      if (preferred) {
        return convertGraphicOrPictContainer(preferred, runStyle, depth + 1);
      }
      return tokens;
    }

    const handledTxbx = new Set<Element>();
    const handledBlips = new Set<Element>();
    const handledImagedatas = new Set<Element>();

    // Walk descendants for images, textboxes, shape text bodies, WordArt, and SmartArt
    const allNodes = Array.from(containerEl.getElementsByTagName('*'));
    const seenDiagramIds = new Set<string>();

    for (const node of allNodes) {
      if (node.localName === 'AlternateContent') continue;
      // Skip nodes inside an unselected mc:Choice / mc:Fallback branch
      let parentCheck: Element | null = node.parentElement;
      let skipUnpickedBranch = false;
      while (parentCheck && parentCheck !== containerEl) {
        if (
          (parentCheck.localName === 'Choice' || parentCheck.localName === 'Fallback') &&
          parentCheck.parentElement?.localName === 'AlternateContent'
        ) {
          const picked = pickPreferredAltContentBranch(parentCheck.parentElement);
          if (picked && picked !== parentCheck) {
            skipUnpickedBranch = true;
            break;
          }
        }
        parentCheck = parentCheck.parentElement;
      }
      if (skipUnpickedBranch) continue;

      if (node.localName === 'blip' && !handledBlips.has(node)) {
        handledBlips.add(node);
        const embedId =
          getAttrByLocalName(node, 'embed') || getAttrByLocalName(node, 'link');
        if (embedId) {
          let extentParent: Element | null = node.parentElement;
          let extent: Element | undefined;
          while (extentParent && extentParent !== containerEl) {
            extent = Array.from(extentParent.children).find((c) => c.localName === 'extent');
            if (extent) break;
            extentParent = extentParent.parentElement;
          }
          if (!extent) {
            extent = Array.from(containerEl.getElementsByTagName('*')).find(
              (e) => e.localName === 'extent'
            );
          }
          const cx = Number(extent?.getAttribute('cx'));
          const cy = Number(extent?.getAttribute('cy'));
          const wPx = cx > 0 ? Math.max(12, Math.round(cx / 9525)) : undefined;
          const hPx = cy > 0 ? Math.max(12, Math.round(cy / 9525)) : undefined;
          const imgHtml = await resolveImageByRelId(embedId, wPx, hPx);
          if (imgHtml) tokens.push({ type: 'html', html: imgHtml });
        }
      } else if (node.localName === 'imagedata' && !handledImagedatas.has(node)) {
        handledImagedatas.add(node);
        const relId = getAttrByLocalName(node, 'id') || getAttrByLocalName(node, 'relid');
        if (relId) {
          const imgHtml = await resolveImageByRelId(relId);
          if (imgHtml) tokens.push({ type: 'html', html: imgHtml });
        }
      } else if (node.localName === 'txbxContent' && !handledTxbx.has(node)) {
        handledTxbx.add(node);
        const boxBlocks: string[] = [];
        for (const tChild of Array.from(node.children)) {
          if (tChild.localName === 'p') {
            const pItems = await convertParagraph(tChild, true);
            for (const item of pItems) {
              if (item.kind === 'html') boxBlocks.push(item.html);
            }
          } else if (tChild.localName === 'tbl') {
            boxBlocks.push(await convertTable(tChild));
          }
        }
        const joined = boxBlocks.join('\n').trim();
        if (hasMeaningfulHtmlContent(joined)) {
          tokens.push({ type: 'blockHtml', html: joined });
        }
      } else if (node.localName === 'txBody') {
        // DrawingML native shape text (<a:txBody><a:p><a:r><a:t>...)
        const hasNestedTxbx = Array.from(node.getElementsByTagName('*')).some(
          (e) => e.localName === 'txbxContent'
        );
        if (!hasNestedTxbx) {
          const aParas = getDirectChildrenByLocalName(node, 'p');
          const shapeParts: string[] = [];
          for (const ap of aParas) {
            const lineTxt = Array.from(ap.getElementsByTagName('*'))
              .filter((e) => e.localName === 't')
              .map((e) => e.textContent || '')
              .join('');
            if (lineTxt.trim()) {
              shapeParts.push(renderStyledRunText(lineTxt, runStyle));
            }
          }
          if (shapeParts.length > 0) {
            tokens.push({
              type: 'blockHtml',
              html: shapeParts.map((part) => `<p>${part}</p>`).join('\n'),
            });
          }
        }
      } else if (node.localName === 'textpath') {
        const wordArt = node.getAttribute('string')?.trim();
        if (wordArt) {
          tokens.push({ type: 'text', text: wordArt, style: runStyle });
        }
      } else if (node.localName === 'relIds') {
        const dmId = getAttrByLocalName(node, 'dm');
        if (dmId && !seenDiagramIds.has(dmId)) {
          seenDiagramIds.add(dmId);
          const diagramHtml = await extractSmartArtDiagramHtml(dmId);
          if (diagramHtml) {
            tokens.push({ type: 'blockHtml', html: diagramHtml });
          }
        }
      }
    }

    return tokens;
  };

  const convertRunChildren = async (
    runEl: Element,
    runStyle: ResolvedRunStyle,
    depth = 0
  ): Promise<RunInlineToken[]> => {
    const tokens: RunInlineToken[] = [];
    if (depth > 8) return tokens;

    for (const child of Array.from(runEl.children)) {
      const name = child.localName;
      if (name === 'rPr' || name === 'instrText' || name === 'delText') continue;
      if (name === 't') {
        const txt = child.textContent || '';
        if (txt) tokens.push({ type: 'text', text: txt, style: runStyle });
      } else if (name === 'tab') {
        tokens.push({ type: 'text', text: '\u00A0\u00A0\u00A0\u00A0', style: runStyle });
      } else if (name === 'br') {
        const brType = getWAttr(child, 'type');
        if (brType === 'page') {
          tokens.push({ type: 'pageBreak' });
        } else {
          tokens.push({ type: 'html', html: '<br />' });
        }
      } else if (name === 'cr') {
        tokens.push({ type: 'html', html: '<br />' });
      } else if (name === 'noBreakHyphen') {
        tokens.push({ type: 'text', text: '-', style: runStyle });
      } else if (name === 'softHyphen') {
        tokens.push({ type: 'text', text: '\u00AD', style: runStyle });
      } else if (name === 'sym') {
        const charHex = getWAttr(child, 'char');
        if (charHex) {
          const code = parseInt(charHex, 16);
          if (!Number.isNaN(code)) {
            tokens.push({ type: 'text', text: String.fromCharCode(code), style: runStyle });
          }
        }
      } else if (name === 'footnoteReference') {
        const fid = getWAttr(child, 'id');
        if (fid && footnotesMap.has(fid)) {
          usedFootnotes.push({ id: fid, text: footnotesMap.get(fid)! });
          tokens.push({ type: 'html', html: `<sup>[${escapeHtml(fid)}]</sup>` });
        }
      } else if (name === 'endnoteReference') {
        const eid = getWAttr(child, 'id');
        if (eid && endnotesMap.has(eid)) {
          usedEndnotes.push({ id: eid, text: endnotesMap.get(eid)! });
          tokens.push({ type: 'html', html: `<sup>[e${escapeHtml(eid)}]</sup>` });
        }
      } else if (name === 'drawing' || name === 'pict' || name === 'AlternateContent' || name === 'object') {
        tokens.push(...(await convertGraphicOrPictContainer(child, runStyle, depth + 1)));
      }
    }
    return tokens;
  };

  const convertParagraph = async (pEl: Element, insideTableCell = false): Promise<BlockItem[]> => {
    const pPrEl = getFirstDirectChildByLocalName(pEl, 'pPr');
    const pStyleIdEl = pPrEl ? getFirstDirectChildByLocalName(pPrEl, 'pStyle') : undefined;
    const pStyleId = getWAttr(pStyleIdEl, 'val') || defaultParagraphStyleId;

    const pStyle: ResolvedParaStyle = { ...defaultParaStyle };
    const pRunBaseStyle: ResolvedRunStyle = { ...defaultRunStyle };

    const styleChain = resolveStyleChain(pStyleId);
    for (const st of styleChain) {
      parsePPrElement(st.pPrEl, pStyle);
      parseRPrElement(st.rPrEl, pRunBaseStyle);
      const lowerName = st.name.toLowerCase();
      if (!pStyle.headingLevel) {
        if (lowerName === 'heading 1' || lowerName === 'title' || st.id === 'Heading1') {
          pStyle.headingLevel = 1;
        } else if (lowerName === 'heading 2' || lowerName === 'subtitle' || st.id === 'Heading2') {
          pStyle.headingLevel = 2;
        } else if (lowerName === 'heading 3' || st.id === 'Heading3') {
          pStyle.headingLevel = 3;
        }
      }
    }

    parsePPrElement(pPrEl, pStyle);
    const pPrRPrEl = pPrEl ? getFirstDirectChildByLocalName(pPrEl, 'rPr') : undefined;
    parseRPrElement(pPrRPrEl, pRunBaseStyle);

    const outItems: BlockItem[] = [];
    if (pStyle.pageBreakBefore && !insideTableCell) {
      outItems.push({ kind: 'break' });
    }

    const collectInlineNodes = async (
      containerEl: Element,
      inheritedRunStyle: ResolvedRunStyle
    ): Promise<RunInlineToken[]> => {
      const tokens: RunInlineToken[] = [];

      for (const child of Array.from(containerEl.children)) {
        const name = child.localName;
        if (
          name === 'pPr' ||
          name === 'del' ||
          name === 'bookmarkStart' ||
          name === 'bookmarkEnd' ||
          name === 'proofErr'
        ) {
          continue;
        }
        if (name === 'r') {
          const runStyle: ResolvedRunStyle = { ...inheritedRunStyle };
          const rPr = getFirstDirectChildByLocalName(child, 'rPr');
          const rStyleEl = rPr ? getFirstDirectChildByLocalName(rPr, 'rStyle') : undefined;
          const rStyleId = getWAttr(rStyleEl, 'val');
          if (rStyleId) {
            for (const st of resolveStyleChain(rStyleId)) {
              parseRPrElement(st.rPrEl, runStyle);
            }
          }
          parseRPrElement(rPr, runStyle);
          const rTokens = await convertRunChildren(child, runStyle);
          tokens.push(...rTokens);
        } else if (name === 'hyperlink') {
          const rId = getAttrByLocalName(child, 'id');
          const rel = rId ? relsMap.get(rId) : undefined;
          const anchor = getWAttr(child, 'anchor');
          const href = rel?.target || (anchor ? `#${anchor}` : '');
          const innerTokens = await collectInlineNodes(child, inheritedRunStyle);
          const inlineOnly = innerTokens.filter(
            (t): t is Exclude<RunInlineToken, { type: 'pageBreak' | 'blockHtml' }> =>
              t.type !== 'pageBreak' && t.type !== 'blockHtml'
          );
          const innerHtml = assembleInlineTokens(inlineOnly);
          if (href && innerHtml) {
            tokens.push({
              type: 'html',
              html: `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${innerHtml}</a>`,
            });
          } else if (innerHtml) {
            tokens.push({ type: 'html', html: innerHtml });
          }
        } else if (name === 'ins' || name === 'smartTag' || name === 'fldSimple') {
          tokens.push(...(await collectInlineNodes(child, inheritedRunStyle)));
        } else if (name === 'sdt') {
          const sdtContent = getFirstDirectChildByLocalName(child, 'sdtContent');
          if (sdtContent) {
            tokens.push(...(await collectInlineNodes(sdtContent, inheritedRunStyle)));
          }
        } else if (name === 'oMath' || name === 'oMathPara') {
          const mathStr = extractMathTextWithBasicStructure(child);
          if (mathStr) {
            tokens.push({
              type: 'text',
              text: mathStr,
              style: { ...inheritedRunStyle, italic: true },
            });
          }
        } else if (name === 'drawing' || name === 'pict' || name === 'AlternateContent') {
          const picked =
            name === 'AlternateContent' ? pickPreferredAltContentBranch(child) : child;
          if (picked) {
            tokens.push(...(await convertGraphicOrPictContainer(picked, inheritedRunStyle)));
          }
        }
      }
      return tokens;
    };

    const assembleInlineTokens = (
      inlineTokens: Array<{ type: 'text'; text: string; style: ResolvedRunStyle } | { type: 'html'; html: string }>
    ): string => {
      let html = '';
      let pendingText = '';
      let pendingStyle: ResolvedRunStyle | null = null;
      let pendingKey = '';

      const flushPendingText = () => {
        if (pendingText && pendingStyle) {
          html += renderStyledRunText(pendingText, pendingStyle);
        }
        pendingText = '';
        pendingStyle = null;
        pendingKey = '';
      };

      for (const tok of inlineTokens) {
        if (tok.type === 'text') {
          const key = runStyleKey(tok.style);
          if (pendingStyle && key === pendingKey) {
            pendingText += tok.text;
          } else {
            flushPendingText();
            pendingText = tok.text;
            pendingStyle = tok.style;
            pendingKey = key;
          }
        } else {
          flushPendingText();
          html += tok.html;
        }
      }
      flushPendingText();
      return html;
    };

    const allTokens = await collectInlineNodes(pEl, pRunBaseStyle);
    const extraBlocksAfter: string[] = [];

    // Split on page breaks if any exist inside runs of this paragraph, extracting multi-block textboxes cleanly
    const segments: Array<
      Array<
        | { type: 'text'; text: string; style: ResolvedRunStyle }
        | { type: 'html'; html: string }
      >
    > = [[]];
    for (const tok of allTokens) {
      if (tok.type === 'pageBreak') {
        segments.push([]);
      } else if (tok.type === 'blockHtml') {
        if (insideTableCell) {
          segments[segments.length - 1].push({ type: 'html', html: tok.html });
        } else {
          extraBlocksAfter.push(tok.html);
        }
      } else {
        segments[segments.length - 1].push(tok);
      }
    }

    const css = buildParaStyleCss(pStyle, !insideTableCell);
    const styleAttr = css ? ` style="${escapeAttr(css)}"` : '';

    // Check if paragraph is a numbered/bulleted list item
    if (pStyle.numId && !insideTableCell && segments.length === 1) {
      const absId = numIdToAbstract.get(pStyle.numId);
      const lvl = pStyle.ilvl ?? 0;
      const lvlDef = absId ? abstractNums.get(absId)?.get(lvl) : undefined;
      if (lvlDef && lvlDef.numFmt !== 'none') {
        const innerHtml = assembleInlineTokens(segments[0]);
        outItems.push({
          kind: 'listItem',
          numId: pStyle.numId,
          ilvl: lvl,
          numFmt: lvlDef.numFmt,
          start: lvlDef.start,
          innerHtml: innerHtml || '',
          styleCss: css,
        });
        for (const blkHtml of extraBlocksAfter) {
          outItems.push({ kind: 'html', html: blkHtml });
        }
        return outItems;
      }
    }

    for (let sIdx = 0; sIdx < segments.length; sIdx++) {
      if (sIdx > 0 && !insideTableCell) {
        outItems.push({ kind: 'break' });
      }
      const seg = segments[sIdx];
      const innerHtml = assembleInlineTokens(seg);
      // Skip emitting an empty phantom paragraph created purely for a page break or floating textbox wrapper
      if (!innerHtml && (segments.length > 1 || extraBlocksAfter.length > 0)) continue;

      const tag =
        !insideTableCell && pStyle.headingLevel
          ? (`h${pStyle.headingLevel}` as 'h1' | 'h2' | 'h3')
          : 'p';
      outItems.push({
        kind: 'html',
        html: `<${tag}${styleAttr}>${innerHtml}</${tag}>`,
      });
    }

    for (const blkHtml of extraBlocksAfter) {
      outItems.push({ kind: 'html', html: blkHtml });
    }

    // Preserve mid-document section breaks inside <w:pPr><w:sectPr>
    const sectPrEl = pPrEl ? getFirstDirectChildByLocalName(pPrEl, 'sectPr') : undefined;
    if (sectPrEl && !insideTableCell) {
      const typeEl = getFirstDirectChildByLocalName(sectPrEl, 'type');
      const sectType = getWAttr(typeEl, 'val') || '';
      if (sectType !== 'continuous') {
        outItems.push({ kind: 'break' });
      }
    }

    return outItems;
  };

  const convertTable = async (tblEl: Element): Promise<string> => {
    const tblPrEl = getFirstDirectChildByLocalName(tblEl, 'tblPr');
    const tblGridEl = getFirstDirectChildByLocalName(tblEl, 'tblGrid');

    const gridColsTwips = tblGridEl
      ? getDirectChildrenByLocalName(tblGridEl, 'gridCol').map(
          (col) => Number(getWAttr(col, 'w')) || 0
        )
      : [];
    const totalGridTwips = gridColsTwips.reduce((acc, v) => acc + v, 0);

    const tblBordersEl = tblPrEl ? getFirstDirectChildByLocalName(tblPrEl, 'tblBorders') : undefined;
    const tblDefaultBorders = {
      top: mapDocxBorderCss(tblBordersEl ? getFirstDirectChildByLocalName(tblBordersEl, 'top') : undefined),
      bottom: mapDocxBorderCss(tblBordersEl ? getFirstDirectChildByLocalName(tblBordersEl, 'bottom') : undefined),
      left: mapDocxBorderCss(tblBordersEl ? getFirstDirectChildByLocalName(tblBordersEl, 'left') : undefined),
      right: mapDocxBorderCss(tblBordersEl ? getFirstDirectChildByLocalName(tblBordersEl, 'right') : undefined),
      insideH: mapDocxBorderCss(tblBordersEl ? getFirstDirectChildByLocalName(tblBordersEl, 'insideH') : undefined),
      insideV: mapDocxBorderCss(tblBordersEl ? getFirstDirectChildByLocalName(tblBordersEl, 'insideV') : undefined),
    };

    const trElements: Element[] = [];
    for (const child of Array.from(tblEl.children)) {
      if (child.localName === 'tr') trElements.push(child);
      else if (child.localName === 'sdt') {
        const sdtContent = getFirstDirectChildByLocalName(child, 'sdtContent');
        if (sdtContent) {
          trElements.push(...getDirectChildrenByLocalName(sdtContent, 'tr'));
        }
      }
    }

    interface CellSpec {
      tag: 'td' | 'th';
      colspan: number;
      rowspan: number;
      colStart: number;
      styleCss: string;
      colWidthAttr?: string;
      innerHtml: string;
      skip?: boolean;
    }

    const rowsMatrix: Array<{ isHeader: boolean; cells: CellSpec[] }> = [];
    const activeVMerge = new Map<number, CellSpec>();

    for (let rIdx = 0; rIdx < trElements.length; rIdx++) {
      const trEl = trElements[rIdx];
      const trPrEl = getFirstDirectChildByLocalName(trEl, 'trPr');
      const isHeader = Boolean(
        trPrEl && parseBoolToggle(getFirstDirectChildByLocalName(trPrEl, 'tblHeader'))
      );

      const tcElements: Element[] = [];
      for (const c of Array.from(trEl.children)) {
        if (c.localName === 'tc') tcElements.push(c);
        else if (c.localName === 'sdt') {
          const sdtContent = getFirstDirectChildByLocalName(c, 'sdtContent');
          if (sdtContent) tcElements.push(...getDirectChildrenByLocalName(sdtContent, 'tc'));
        }
      }

      const rowCells: CellSpec[] = [];
      let colCursor = 0;

      for (let cIdx = 0; cIdx < tcElements.length; cIdx++) {
        const tcEl = tcElements[cIdx];
        const tcPrEl = getFirstDirectChildByLocalName(tcEl, 'tcPr');
        const spanEl = tcPrEl ? getFirstDirectChildByLocalName(tcPrEl, 'gridSpan') : undefined;
        const colspan = Math.max(1, Number(getWAttr(spanEl, 'val')) || 1);

        const vMergeEl = tcPrEl ? getFirstDirectChildByLocalName(tcPrEl, 'vMerge') : undefined;
        const vMergeVal = vMergeEl ? getWAttr(vMergeEl, 'val') : undefined;

        if (vMergeEl && vMergeVal !== 'restart') {
          const origin = activeVMerge.get(colCursor);
          if (origin) {
            origin.rowspan += 1;
            colCursor += colspan;
            continue;
          }
        } else {
          for (let k = colCursor; k < colCursor + colspan; k++) {
            activeVMerge.delete(k);
          }
        }

        // Convert cell contents
        const cellBlocks: string[] = [];
        for (const tcChild of Array.from(tcEl.children)) {
          if (tcChild.localName === 'p') {
            const pItems = await convertParagraph(tcChild, true);
            for (const item of pItems) {
              if (item.kind === 'html') cellBlocks.push(item.html);
            }
          } else if (tcChild.localName === 'tbl') {
            cellBlocks.push(await convertTable(tcChild));
          }
        }

        const cellCss: string[] = [];
        const shdEl = tcPrEl ? getFirstDirectChildByLocalName(tcPrEl, 'shd') : undefined;
        const shdFill = getWAttr(shdEl, 'fill');
        if (shdFill && shdFill.toLowerCase() !== 'auto') {
          const hex = normalizeCssColor(shdFill);
          if (hex) cellCss.push(`background-color: ${hex}`);
        }

        const vAlignEl = tcPrEl ? getFirstDirectChildByLocalName(tcPrEl, 'vAlign') : undefined;
        const vAlign = getWAttr(vAlignEl, 'val');
        if (vAlign === 'center') cellCss.push('vertical-align: middle');
        else if (vAlign === 'bottom') cellCss.push('vertical-align: bottom');
        else if (vAlign === 'top') cellCss.push('vertical-align: top');

        // Cell borders overriding table borders
        const tcBordersEl = tcPrEl ? getFirstDirectChildByLocalName(tcPrEl, 'tcBorders') : undefined;
        const borderSides: Array<{ side: 'top' | 'bottom' | 'left' | 'right'; fallback?: string }> = [
          { side: 'top', fallback: rIdx === 0 ? tblDefaultBorders.top : tblDefaultBorders.insideH || tblDefaultBorders.top },
          { side: 'bottom', fallback: rIdx === trElements.length - 1 ? tblDefaultBorders.bottom : tblDefaultBorders.insideH || tblDefaultBorders.bottom },
          { side: 'left', fallback: colCursor === 0 ? tblDefaultBorders.left : tblDefaultBorders.insideV || tblDefaultBorders.left },
          { side: 'right', fallback: cIdx === tcElements.length - 1 ? tblDefaultBorders.right : tblDefaultBorders.insideV || tblDefaultBorders.right },
        ];
        for (const { side, fallback } of borderSides) {
          const explicit = mapDocxBorderCss(
            tcBordersEl ? getFirstDirectChildByLocalName(tcBordersEl, side) : undefined
          );
          const resolvedBdr = explicit || fallback;
          if (resolvedBdr === 'none') {
            cellCss.push(`border-${side}: none`);
          } else if (resolvedBdr) {
            cellCss.push(`border-${side}: ${resolvedBdr}`);
          }
        }

        // Width from gridCol or tcW
        let colWidthAttr: string | undefined;
        if (totalGridTwips > 0 && gridColsTwips.length >= colCursor + colspan) {
          const spanTwips = gridColsTwips
            .slice(colCursor, colCursor + colspan)
            .reduce((a, b) => a + b, 0);
          if (spanTwips > 0) {
            const pct = Math.round((spanTwips / totalGridTwips) * 1000) / 10;
            cellCss.push(`width: ${pct}%`);
            const px = Math.round((spanTwips / 20) * (96 / 72));
            if (colspan === 1 && px >= 25) colWidthAttr = String(px);
          }
        } else if (tcPrEl) {
          const tcWEl = getFirstDirectChildByLocalName(tcPrEl, 'tcW');
          const tcWVal = Number(getWAttr(tcWEl, 'w'));
          const tcWType = getWAttr(tcWEl, 'type');
          if (tcWVal > 0 && tcWType === 'pct') {
            cellCss.push(`width: ${Math.round((tcWVal / 50) * 10) / 10}%`);
          } else if (tcWVal > 0 && (tcWType === 'dxa' || !tcWType)) {
            const px = Math.round((tcWVal / 20) * (96 / 72));
            if (colspan === 1 && px >= 25) colWidthAttr = String(px);
          }
        }

        const spec: CellSpec = {
          tag: isHeader ? 'th' : 'td',
          colspan,
          rowspan: 1,
          colStart: colCursor,
          styleCss: cellCss.join('; '),
          colWidthAttr,
          innerHtml: cellBlocks.join('') || '<p></p>',
        };

        if (vMergeEl && vMergeVal === 'restart') {
          activeVMerge.set(colCursor, spec);
        }

        rowCells.push(spec);
        colCursor += colspan;
      }

      rowsMatrix.push({ isHeader, cells: rowCells });
    }

    const renderRow = (row: { cells: CellSpec[] }) => {
      const cellsHtml = row.cells
        .map((c) => {
          const attrs: string[] = [];
          if (c.colspan > 1) attrs.push(`colspan="${c.colspan}"`);
          if (c.rowspan > 1) attrs.push(`rowspan="${c.rowspan}"`);
          if (c.colWidthAttr) attrs.push(`data-colwidth="${c.colWidthAttr}"`);
          if (c.styleCss) attrs.push(`style="${escapeAttr(c.styleCss)}"`);
          const attrStr = attrs.length > 0 ? ` ${attrs.join(' ')}` : '';
          return `<${c.tag}${attrStr}>${c.innerHtml}</${c.tag}>`;
        })
        .join('');
      return `<tr>${cellsHtml}</tr>`;
    };

    const headRows = rowsMatrix.filter((r) => r.isHeader);
    const bodyRows = rowsMatrix.filter((r) => !r.isHeader);
    const tblStyleParts: string[] = ['border-collapse: collapse', 'width: 100%'];
    const tblJcEl = tblPrEl ? getFirstDirectChildByLocalName(tblPrEl, 'jc') : undefined;
    const tblJc = getWAttr(tblJcEl, 'val');
    if (tblJc === 'center') tblStyleParts.push('margin-left: auto; margin-right: auto');

    const theadHtml = headRows.length > 0 ? `<thead>${headRows.map(renderRow).join('')}</thead>` : '';
    const tbodyHtml = bodyRows.length > 0 ? `<tbody>${bodyRows.map(renderRow).join('')}</tbody>` : '';
    return `<table style="${escapeAttr(tblStyleParts.join('; '))}">${theadHtml}${tbodyHtml}</table>`;
  };

  const resolveAltChunkHtml = async (altChunkEl: Element): Promise<string> => {
    const rId = getAttrByLocalName(altChunkEl, 'id');
    if (!rId) return '';
    const rel = relsMap.get(rId);
    if (!rel || rel.external) return '';
    const chunkPath = resolveZipMediaPath(rel.target, docBaseDir || 'word');
    const chunkFile = findZipEntry(zip, chunkPath);
    if (!chunkFile) return '';
    const ext = chunkPath.split('.').pop()?.toLowerCase() || '';
    try {
      if (ext === 'docx') {
        const subBuf = await chunkFile.async('arraybuffer');
        const subZip = await JSZip.loadAsync(subBuf);
        const subRes = await convertDocxZipToHtml(subZip, inspectImage);
        return subRes?.html || '';
      }
      const rawText = await chunkFile.async('string');
      if (ext === 'rtf' || rawText.trimStart().startsWith('{\\rtf')) {
        return parseRtfToHtml(rawText);
      }
      if (ext === 'xml') {
        return convertWordXmlToHtml(rawText);
      }
      if (
        ext === 'htm' ||
        ext === 'html' ||
        ext === 'mht' ||
        ext === 'mhtml' ||
        /<html|<body|content-type:\s*multipart/i.test(rawText.slice(0, 2000))
      ) {
        return extractFormattedHtmlBody(rawText);
      }
      return plainTextToPreservedHtml(rawText);
    } catch {
      return '';
    }
  };

  // Walk body nodes recursively (supporting nested containers like <w:sdt>, <w:ins>, <w:altChunk>)
  const rawBlocks: BlockItem[] = [];
  const walkBodyElement = async (container: Element) => {
    for (const child of Array.from(container.children)) {
      const name = child.localName;
      if (name === 'p') {
        rawBlocks.push(...(await convertParagraph(child, false)));
      } else if (name === 'tbl') {
        rawBlocks.push({ kind: 'html', html: await convertTable(child) });
      } else if (name === 'altChunk') {
        const chunkHtml = await resolveAltChunkHtml(child);
        if (hasMeaningfulHtmlContent(chunkHtml)) {
          rawBlocks.push({ kind: 'html', html: chunkHtml });
        }
      } else if (name === 'sdt') {
        const sdtContent = getFirstDirectChildByLocalName(child, 'sdtContent');
        if (sdtContent) await walkBodyElement(sdtContent);
      } else if (name === 'ins' || name === 'customXml' || name === 'smartTag' || name === 'sect') {
        await walkBodyElement(child);
      }
    }
  };
  await walkBodyElement(bodyEl);

  // Coalesce consecutive listItem blocks into proper <ul> / <ol> lists
  const htmlOutput: string[] = [];
  let listGroup: Array<Extract<BlockItem, { kind: 'listItem' }>> = [];

  const flushListGroup = () => {
    if (listGroup.length === 0) return;
    // Split contiguous sub-groups if numFmt (ol vs ul) or top-level numId changes
    let i = 0;
    while (i < listGroup.length) {
      const first = listGroup[i];
      const mapped = mapNumFmtToListTag(first.numFmt);
      const subItems: Array<Extract<BlockItem, { kind: 'listItem' }>> = [first];
      i++;
      while (i < listGroup.length) {
        const nextMapped = mapNumFmtToListTag(listGroup[i].numFmt);
        if (
          listGroup[i].numId === first.numId &&
          listGroup[i].ilvl === first.ilvl &&
          nextMapped.tag === mapped.tag
        ) {
          subItems.push(listGroup[i]);
          i++;
        } else {
          break;
        }
      }
      const listStyles: string[] = [];
      if (mapped.listStyleType && mapped.listStyleType !== 'decimal') {
        listStyles.push(`list-style-type: ${mapped.listStyleType}`);
      }
      if (first.ilvl > 0) {
        listStyles.push(`margin-left: ${first.ilvl * 18}pt`);
      }
      const startAttr = mapped.tag === 'ol' && first.start > 1 ? ` start="${first.start}"` : '';
      const styleAttr = listStyles.length > 0 ? ` style="${escapeAttr(listStyles.join('; '))}"` : '';
      const itemsHtml = subItems
        .map((it) => {
          const pStyleAttr = it.styleCss ? ` style="${escapeAttr(it.styleCss)}"` : '';
          return `<li><p${pStyleAttr}>${it.innerHtml}</p></li>`;
        })
        .join('');
      htmlOutput.push(`<${mapped.tag}${startAttr}${styleAttr}>${itemsHtml}</${mapped.tag}>`);
    }
    listGroup = [];
  };

  for (const item of rawBlocks) {
    if (item.kind === 'listItem') {
      listGroup.push(item);
      continue;
    }
    flushListGroup();
    if (item.kind === 'break') {
      if (htmlOutput.length > 0 && htmlOutput[htmlOutput.length - 1] !== '<hr class="page-break-marker" />') {
        htmlOutput.push('<hr class="page-break-marker" />');
      }
    } else {
      htmlOutput.push(item.html);
    }
  }
  flushListGroup();

  // Remove trailing empty page break if document ends with one
  while (
    htmlOutput.length > 0 &&
    htmlOutput[htmlOutput.length - 1] === '<hr class="page-break-marker" />'
  ) {
    htmlOutput.pop();
  }

  // Append Footnotes / Endnotes cleanly so footnote content is never dropped
  const allNotes: string[] = [];
  const seenNoteKeys = new Set<string>();
  for (const fn of usedFootnotes) {
    const key = `fn:${fn.id}`;
    if (seenNoteKeys.has(key)) continue;
    seenNoteKeys.add(key);
    allNotes.push(`<p style="font-size: 9.5pt; color: #475569"><sup>[${escapeHtml(fn.id)}]</sup> ${escapeHtml(fn.text)}</p>`);
  }
  for (const en of usedEndnotes) {
    const key = `en:${en.id}`;
    if (seenNoteKeys.has(key)) continue;
    seenNoteKeys.add(key);
    allNotes.push(`<p style="font-size: 9.5pt; color: #475569"><sup>[e${escapeHtml(en.id)}]</sup> ${escapeHtml(en.text)}</p>`);
  }
  if (allNotes.length > 0) {
    htmlOutput.push('<hr />');
    htmlOutput.push(...allNotes);
  }

  let finalHtml = htmlOutput.join('\n').trim();
  if (!hasMeaningfulHtmlContent(finalHtml)) {
    // Check headers/footers in case all content lives in letterhead/header/footer XML
    const headerFooterParts: string[] = [];
    const hfKeys = Object.keys(zip.files)
      .filter((k) => !zip.files[k].dir && /^word\/(header|footer)\d*\.xml$/i.test(k.replace(/^\/+/, '')))
      .sort();
    for (const key of hfKeys) {
      try {
        const hfXml = parser.parseFromString(await zip.files[key].async('string'), 'application/xml');
        const hfParas = Array.from(hfXml.getElementsByTagName('*')).filter((e) => e.localName === 'p');
        for (const hp of hfParas) {
          if (hp.parentElement?.localName === 'txbxContent' || hp.parentElement?.localName === 'tc') continue;
          const items = await convertParagraph(hp, false);
          for (const it of items) {
            if (it.kind === 'html' && hasMeaningfulHtmlContent(it.html)) {
              headerFooterParts.push(it.html);
            }
          }
        }
      } catch {
        // Ignore malformed header/footer XML
      }
    }
    if (headerFooterParts.length > 0) {
      finalHtml = headerFooterParts.join('\n').trim();
    }
  }
  if (!hasMeaningfulHtmlContent(finalHtml)) return null;
  return { html: finalHtml, fallbackText };
}

const WIN1252_EXTRA: Record<number, number> = {
  0x80: 0x20ac,
  0x82: 0x201a,
  0x83: 0x0192,
  0x84: 0x201e,
  0x85: 0x2026,
  0x86: 0x2020,
  0x87: 0x2021,
  0x88: 0x02c6,
  0x89: 0x2030,
  0x8a: 0x0160,
  0x8b: 0x2039,
  0x8c: 0x0152,
  0x8e: 0x017d,
  0x91: 0x2018,
  0x92: 0x2019,
  0x93: 0x201c,
  0x94: 0x201d,
  0x95: 0x2022,
  0x96: 0x2013,
  0x97: 0x2014,
  0x98: 0x02dc,
  0x99: 0x2122,
  0x9a: 0x0161,
  0x9b: 0x203a,
  0x9c: 0x0153,
  0x9e: 0x017e,
  0x9f: 0x0178,
};

export function decodeWin1252Byte(code: number): string {
  const mapped = WIN1252_EXTRA[code];
  return String.fromCharCode(mapped ?? code);
}

interface RtfState {
  uc: number;
  ignorable: boolean;
  isUpr?: boolean;
  uprChildCount?: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  superScript: boolean;
  subScript: boolean;
  fontIndex: number;
  fontSizeHalfPt: number;
  colorIndex: number;
  highlightIndex: number;
  align: 'left' | 'center' | 'right' | 'justify';
  leftIndentTwips: number;
  firstIndentTwips: number;
  spaceBeforeTwips: number;
  spaceAfterTwips: number;
  inTable: boolean;
}

export function parseRtfToHtml(rtf: string): string {
  const fontTable = new Map<number, string>();
  const colorTable: Array<string | undefined> = [undefined];

  // Balanced-brace group extractor for \fonttbl
  const extractRtfGroup = (marker: string): string => {
    const startIdx = rtf.indexOf(marker);
    if (startIdx < 0) return '';
    let braceStart = rtf.lastIndexOf('{', startIdx);
    if (braceStart < 0) braceStart = startIdx;
    let depth = 0;
    for (let k = braceStart; k < rtf.length; k++) {
      if (rtf[k] === '\\') {
        k++;
        continue;
      }
      if (rtf[k] === '{') depth++;
      else if (rtf[k] === '}') {
        depth--;
        if (depth === 0) return rtf.slice(braceStart, k + 1);
      }
    }
    return '';
  };

  const fontTblGroup = extractRtfGroup('\\fonttbl');
  if (fontTblGroup) {
    const fEntries = fontTblGroup.matchAll(/\{\\f(\d+)[\s\S]*?\s([^;{}]+);\}/g);
    for (const m of fEntries) {
      const fIdx = Number(m[1]);
      const fName = m[2].replace(/\\[a-zA-Z]+-?\d*\s?/g, '').trim();
      if (!Number.isNaN(fIdx) && fName) fontTable.set(fIdx, fName);
    }
  }

  const colorTblMatch = rtf.match(/\{\\colortbl\s*;?([\s\S]*?)\}/);
  if (colorTblMatch) {
    const entries = colorTblMatch[1].split(';');
    for (const entry of entries) {
      const rM = entry.match(/\\red(\d+)/);
      const gM = entry.match(/\\green(\d+)/);
      const bM = entry.match(/\\blue(\d+)/);
      if (rM && gM && bM) {
        const toHex = (v: string) => Math.max(0, Math.min(255, Number(v))).toString(16).padStart(2, '0');
        colorTable.push(`#${toHex(rM[1])}${toHex(gM[1])}${toHex(bM[1])}`);
      } else if (entry.trim()) {
        colorTable.push(undefined);
      }
    }
  }

  const initialState: RtfState = {
    uc: 1,
    ignorable: false,
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    superScript: false,
    subScript: false,
    fontIndex: -1,
    fontSizeHalfPt: 0,
    colorIndex: 0,
    highlightIndex: 0,
    align: 'left',
    leftIndentTwips: 0,
    firstIndentTwips: 0,
    spaceBeforeTwips: 0,
    spaceAfterTwips: 0,
    inTable: false,
  };

  const stack: RtfState[] = [{ ...initialState }];
  const skipDestinations = new Set([
    'fonttbl',
    'colortbl',
    'stylesheet',
    'info',
    'pict',
    'object',
    'header',
    'footer',
    'headerl',
    'headerr',
    'headerf',
    'footerl',
    'footerr',
    'footerf',
    'listtable',
    'listoverridetable',
    'rsidtbl',
    'xmlnstbl',
    'fldinst',
    'themedata',
    'colorschememapping',
    'datastore',
    'latentstyles',
    'generator',
  ]);

  const blocks: string[] = [];
  let tableRowsHtml: string[] = [];
  let currentRowCellsHtml: string[] = [];
  let currentParaRuns: Array<{ text: string; html?: string; runStyle: ResolvedRunStyle }> = [];

  const toRunStyle = (st: RtfState): ResolvedRunStyle => {
    const fName = st.fontIndex >= 0 ? fontTable.get(st.fontIndex) : undefined;
    return {
      bold: st.bold || undefined,
      italic: st.italic || undefined,
      underline: st.underline || undefined,
      strike: st.strike || undefined,
      vertAlign: st.superScript ? 'superscript' : st.subScript ? 'subscript' : undefined,
      fontFamily: fName ? `"${fName.replace(/"/g, '')}", sans-serif` : undefined,
      fontSizePt: st.fontSizeHalfPt > 0 ? Math.round((st.fontSizeHalfPt / 2) * 10) / 10 : undefined,
      color: st.colorIndex > 0 ? colorTable[st.colorIndex] : undefined,
      highlightColor: st.highlightIndex > 0 ? colorTable[st.highlightIndex] : undefined,
    };
  };

  const appendChar = (ch: string) => {
    const st = stack[stack.length - 1];
    if (st.ignorable) return;
    const rs = toRunStyle(st);
    const last = currentParaRuns[currentParaRuns.length - 1];
    if (last && !last.html && runStyleKey(last.runStyle) === runStyleKey(rs)) {
      last.text += ch;
    } else {
      currentParaRuns.push({ text: ch, runStyle: rs });
    }
  };

  const renderParaInnerHtml = (): string => {
    const out = currentParaRuns
      .map((r) => (r.html ? r.html : renderStyledRunText(r.text, r.runStyle)))
      .join('');
    currentParaRuns = [];
    return out;
  };

  const buildParaElementHtml = (st: RtfState, innerHtml: string): string => {
    const cssParts: string[] = [];
    if (st.align !== 'left') cssParts.push(`text-align: ${st.align}`);
    if (st.leftIndentTwips > 0) cssParts.push(`margin-left: ${Math.round((st.leftIndentTwips / 20) * 10) / 10}pt`);
    if (st.firstIndentTwips !== 0) cssParts.push(`text-indent: ${Math.round((st.firstIndentTwips / 20) * 10) / 10}pt`);
    if (st.spaceBeforeTwips > 0) cssParts.push(`margin-top: ${Math.round((st.spaceBeforeTwips / 20) * 10) / 10}pt`);
    if (st.spaceAfterTwips > 0) cssParts.push(`margin-bottom: ${Math.round((st.spaceAfterTwips / 20) * 10) / 10}pt`);
    const styleAttr = cssParts.length > 0 ? ` style="${escapeAttr(cssParts.join('; '))}"` : '';
    return `<p${styleAttr}>${innerHtml}</p>`;
  };

  const flushTableIfActive = () => {
    if (tableRowsHtml.length > 0) {
      blocks.push(`<table><tbody>${tableRowsHtml.join('')}</tbody></table>`);
      tableRowsHtml = [];
    }
  };

  const flushParagraph = () => {
    const st = stack[stack.length - 1];
    const inner = renderParaInnerHtml();
    if (st.inTable) {
      // Hold content inside cell until \cell arrives
      const pHtml = buildParaElementHtml(st, inner);
      currentParaRuns.push({ text: '', html: pHtml, runStyle: {} });
      return;
    }
    flushTableIfActive();
    blocks.push(buildParaElementHtml(st, inner));
  };

  let i = 0;
  const len = rtf.length;

  while (i < len) {
    const ch = rtf[i];
    if (ch === '{') {
      const top = stack[stack.length - 1];
      const nextState: RtfState = { ...top, isUpr: false, uprChildCount: 0 };
      if (top.isUpr) {
        top.uprChildCount = (top.uprChildCount || 0) + 1;
        // Inside {\upr{ANSI}{\*\ud{UNICODE}}}, discard the ANSI fallback child group (#1)
        if (top.uprChildCount === 1) {
          nextState.ignorable = true;
        }
      }
      stack.push(nextState);
      i++;
    } else if (ch === '}') {
      if (stack.length > 1) stack.pop();
      i++;
    } else if (ch === '\\') {
      i++;
      if (i >= len) break;
      const next = rtf[i];
      if (next === '\\' || next === '{' || next === '}') {
        appendChar(next);
        i++;
      } else if (next === '*') {
        // Keep \ud destination alive if we're inside an \upr Unicode group
        const parentSt = stack.length >= 2 ? stack[stack.length - 2] : undefined;
        const lookahead = rtf.slice(i + 1, i + 6);
        if (parentSt?.isUpr && /^\\ud(?![a-zA-Z])/.test(lookahead)) {
          stack[stack.length - 1].ignorable = false;
        } else {
          stack[stack.length - 1].ignorable = true;
        }
        i++;
      } else if (next === "'") {
        const hex = rtf.slice(i + 1, i + 3);
        const code = parseInt(hex, 16);
        if (!Number.isNaN(code)) {
          appendChar(decodeWin1252Byte(code));
        }
        i += 3;
      } else if (next === '~') {
        appendChar('\u00A0');
        i++;
      } else if (next === '-' || next === '_') {
        if (next === '_') appendChar('-');
        i++;
      } else if (next === '\n' || next === '\r') {
        flushParagraph();
        i++;
      } else {
        let word = '';
        while (i < len && /[a-zA-Z]/.test(rtf[i])) {
          word += rtf[i];
          i++;
        }
        let paramStr = '';
        if (i < len && (rtf[i] === '-' || /[0-9]/.test(rtf[i]))) {
          paramStr += rtf[i];
          i++;
          while (i < len && /[0-9]/.test(rtf[i])) {
            paramStr += rtf[i];
            i++;
          }
        }
        if (i < len && rtf[i] === ' ') i++;
        const param = paramStr ? parseInt(paramStr, 10) : undefined;
        const top = stack[stack.length - 1];

        if (word === 'bin' && param !== undefined && param > 0) {
          // Skip exact N raw binary bytes so stray braces inside \bin never corrupt stack
          i += param;
        } else if (word === 'upr') {
          top.isUpr = true;
          top.uprChildCount = 0;
        } else if (word === 'ud') {
          top.ignorable = false;
        } else if (skipDestinations.has(word)) {
          top.ignorable = true;
        } else if (word === 'uc' && param !== undefined && !Number.isNaN(param)) {
          top.uc = param;
        } else if (word === 'u' && param !== undefined && !Number.isNaN(param)) {
          let code = param;
          if (code < 0) code += 65536;
          appendChar(String.fromCharCode(code));
          let skipCount = top.uc;
          while (skipCount > 0 && i < len) {
            if (rtf[i] === '\\' && rtf[i + 1] === "'") {
              i += 4;
              skipCount--;
            } else if (rtf[i] !== '{' && rtf[i] !== '}' && rtf[i] !== '\\') {
              i++;
              skipCount--;
            } else {
              break;
            }
          }
        } else if (!top.ignorable) {
          if (word === 'pard') {
            if (top.inTable && currentParaRuns.length > 0 && currentRowCellsHtml.length === 0 && tableRowsHtml.length === 0) {
              const stray = renderParaInnerHtml();
              if (stray) blocks.push(buildParaElementHtml(top, stray));
            }
            top.align = 'left';
            top.leftIndentTwips = 0;
            top.firstIndentTwips = 0;
            top.spaceBeforeTwips = 0;
            top.spaceAfterTwips = 0;
            top.inTable = false;
          } else if (word === 'plain') {
            top.bold = false;
            top.italic = false;
            top.underline = false;
            top.strike = false;
            top.superScript = false;
            top.subScript = false;
            top.colorIndex = 0;
            top.highlightIndex = 0;
            top.fontSizeHalfPt = 0;
          } else if (word === 'b') top.bold = param !== 0;
          else if (word === 'i') top.italic = param !== 0;
          else if (word === 'ul') top.underline = param !== 0;
          else if (word === 'ulnone') top.underline = false;
          else if (word === 'strike' || word === 'striked') top.strike = param !== 0;
          else if (word === 'super') {
            top.superScript = true;
            top.subScript = false;
          } else if (word === 'sub') {
            top.subScript = true;
            top.superScript = false;
          } else if (word === 'nosupersub') {
            top.superScript = false;
            top.subScript = false;
          } else if (word === 'f' && param !== undefined) top.fontIndex = param;
          else if (word === 'fs' && param !== undefined) top.fontSizeHalfPt = param;
          else if (word === 'cf' && param !== undefined) top.colorIndex = param;
          else if ((word === 'highlight' || word === 'cb') && param !== undefined) {
            top.highlightIndex = param;
          } else if (word === 'ql') top.align = 'left';
          else if (word === 'qc') top.align = 'center';
          else if (word === 'qr') top.align = 'right';
          else if (word === 'qj') top.align = 'justify';
          else if (word === 'li' && param !== undefined) top.leftIndentTwips = param;
          else if (word === 'fi' && param !== undefined) top.firstIndentTwips = param;
          else if (word === 'sb' && param !== undefined) top.spaceBeforeTwips = param;
          else if (word === 'sa' && param !== undefined) top.spaceAfterTwips = param;
          else if (word === 'intbl') top.inTable = true;
          else if (word === 'cell') {
            const cellInner = renderParaInnerHtml();
            currentRowCellsHtml.push(`<td>${cellInner || '<p></p>'}</td>`);
          } else if (word === 'row') {
            if (currentParaRuns.length > 0) {
              const trailingCell = renderParaInnerHtml();
              if (trailingCell) currentRowCellsHtml.push(`<td>${trailingCell}</td>`);
            }
            if (currentRowCellsHtml.length > 0) {
              tableRowsHtml.push(`<tr>${currentRowCellsHtml.join('')}</tr>`);
              currentRowCellsHtml = [];
            }
          } else if (word === 'par') {
            flushParagraph();
          } else if (word === 'line') {
            currentParaRuns.push({ text: '', html: '<br />', runStyle: {} });
          } else if (word === 'page') {
            flushParagraph();
            blocks.push('<hr class="page-break-marker" />');
          } else if (word === 'tab') {
            appendChar('\u00A0\u00A0\u00A0\u00A0');
          } else if (word === 'emdash') appendChar('\u2014');
          else if (word === 'endash') appendChar('\u2013');
          else if (word === 'lquote') appendChar('\u2018');
          else if (word === 'rquote') appendChar('\u2019');
          else if (word === 'ldblquote') appendChar('\u201C');
          else if (word === 'rdblquote') appendChar('\u201D');
          else if (word === 'bullet') appendChar('\u2022');
        }
      }
    } else if (ch === '\r' || ch === '\n') {
      i++;
    } else {
      appendChar(ch);
      i++;
    }
  }

  // Safely flush any leftover text (even if inTable remained true without closing \cell/\pard)
  if (currentParaRuns.length > 0) {
    const remainingHtml = renderParaInnerHtml();
    if (remainingHtml) {
      if (currentRowCellsHtml.length > 0 || tableRowsHtml.length > 0) {
        currentRowCellsHtml.push(`<td>${remainingHtml}</td>`);
      } else {
        blocks.push(buildParaElementHtml(stack[stack.length - 1], remainingHtml));
      }
    }
  }
  if (currentRowCellsHtml.length > 0) {
    tableRowsHtml.push(`<tr>${currentRowCellsHtml.join('')}</tr>`);
  }
  flushTableIfActive();

  return blocks.join('\n').trim() || '<p></p>';
}

function preserveLeadingIndentHtml(line: string): string {
  const match = line.match(/^([ \t]+)(.*)$/);
  if (!match) return escapeHtml(line);
  const leading = match[1]
    .replace(/\t/g, '\u00A0\u00A0\u00A0\u00A0')
    .replace(/ /g, '\u00A0');
  return `${leading}${escapeHtml(match[2])}`;
}

export function plainTextToPreservedHtml(text: string): string {
  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\f/g, `\n${PAGE_BREAK_SENTINEL}\n`);

  const segments = normalized.split(PAGE_BREAK_SENTINEL);
  const htmlSegments = segments.map((segment) => {
    const lines = segment.split('\n');
    const out: string[] = [];
    let currentGroup: string[] = [];

    const flushGroup = () => {
      if (currentGroup.length === 0) return;
      // Preserve explicit line breaks inside a paragraph block cleanly
      const joined = currentGroup.map((l) => preserveLeadingIndentHtml(l)).join('<br />');
      out.push(`<p>${joined}</p>`);
      currentGroup = [];
    };

    for (const line of lines) {
      if (line.trim() === '') {
        if (currentGroup.length > 0) {
          flushGroup();
        } else {
          // Preserve intentional blank spacing lines
          out.push('<p></p>');
        }
      } else {
        currentGroup.push(line);
        if (currentGroup.length >= 25) {
          flushGroup();
        }
      }
    }
    flushGroup();
    return out.join('\n');
  });

  return htmlSegments.filter(Boolean).join('\n<hr class="page-break-marker" />\n') || '<p></p>';
}

function renderInlineMarkdown(text: string): string {
  let out = escapeHtml(text);
  // Links [label](url)
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|#[^\s)]+)\)/g, (_m, label, url) => {
    return `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  // Bold **text** or __text__
  out = out.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_m, a, b) => `<strong>${a ?? b}</strong>`);
  // Strike ~~text~~
  out = out.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  // Italic *text* or _text_
  out = out.replace(/(?<!\*)\*([^*]+)\*(?!\*)|(?<!\w)_([^_]+)_(?!\w)/g, (_m, a, b) => `<em>${a ?? b}</em>`);
  // Inline code `text`
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  return out;
}

export function markdownToHtml(md: string): string {
  const normalized = md
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\f/g, `\n${PAGE_BREAK_SENTINEL}\n`);

  const segments = normalized.split(PAGE_BREAK_SENTINEL);
  const segHtml = segments.map((seg) => {
    const lines = seg.split('\n');
    const blocks: string[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Fenced code block
      if (/^```/.test(line.trim())) {
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i].trim())) {
          codeLines.push(lines[i]);
          i++;
        }
        i++;
        blocks.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        continue;
      }

      // Headings
      const hMatch = line.match(/^(#{1,3})\s+(.+)$/);
      if (hMatch) {
        const lvl = hMatch[1].length;
        blocks.push(`<h${lvl}>${renderInlineMarkdown(hMatch[2].trim())}</h${lvl}>`);
        i++;
        continue;
      }

      // Horizontal rule
      if (/^(\*\*\*+|---+|___+)\s*$/.test(line.trim())) {
        blocks.push('<hr />');
        i++;
        continue;
      }

      // GFM Table
      if (
        line.includes('|') &&
        i + 1 < lines.length &&
        /^\s*\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(lines[i + 1])
      ) {
        const parseRow = (rowStr: string) =>
          rowStr
            .trim()
            .replace(/^\|/, '')
            .replace(/\|$/, '')
            .split('|')
            .map((c) => c.trim());
        const headers = parseRow(line);
        i += 2;
        const bodyRows: string[][] = [];
        while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
          bodyRows.push(parseRow(lines[i]));
          i++;
        }
        const thead = `<thead><tr>${headers.map((h) => `<th>${renderInlineMarkdown(h)}</th>`).join('')}</tr></thead>`;
        const tbody =
          bodyRows.length > 0
            ? `<tbody>${bodyRows
                .map((r) => `<tr>${r.map((c) => `<td>${renderInlineMarkdown(c)}</td>`).join('')}</tr>`)
                .join('')}</tbody>`
            : '';
        blocks.push(`<table>${thead}${tbody}</table>`);
        continue;
      }

      // Blockquote
      if (/^\s*>\s?/.test(line)) {
        const quoteLines: string[] = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          quoteLines.push(renderInlineMarkdown(lines[i].replace(/^\s*>\s?/, '')));
          i++;
        }
        blocks.push(`<blockquote><p>${quoteLines.join('<br />')}</p></blockquote>`);
        continue;
      }

      // Unordered list
      if (/^\s*[-*+]\s+/.test(line)) {
        const items: string[] = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          items.push(`<li><p>${renderInlineMarkdown(lines[i].replace(/^\s*[-*+]\s+/, ''))}</p></li>`);
          i++;
        }
        blocks.push(`<ul>${items.join('')}</ul>`);
        continue;
      }

      // Ordered list
      if (/^\s*\d+[.)]\s+/.test(line)) {
        const items: string[] = [];
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
          items.push(`<li><p>${renderInlineMarkdown(lines[i].replace(/^\s*\d+[.)]\s+/, ''))}</p></li>`);
          i++;
        }
        blocks.push(`<ol>${items.join('')}</ol>`);
        continue;
      }

      // Blank line
      if (line.trim() === '') {
        i++;
        continue;
      }

      // Regular paragraph lines
      const paraLines: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() !== '' &&
        !/^(#{1,3})\s+/.test(lines[i]) &&
        !/^```/.test(lines[i].trim()) &&
        !/^\s*>\s?/.test(lines[i]) &&
        !/^\s*[-*+]\s+/.test(lines[i]) &&
        !/^\s*\d+[.)]\s+/.test(lines[i])
      ) {
        paraLines.push(renderInlineMarkdown(lines[i]));
        i++;
      }
      if (paraLines.length > 0) {
        blocks.push(`<p>${paraLines.join('<br />')}</p>`);
      }
    }

    return blocks.join('\n');
  });

  return segHtml.filter(Boolean).join('\n<hr class="page-break-marker" />\n') || '<p></p>';
}

export function legacyDocTextToHtml(rawText: string): string {
  const normalized = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\x0c/g, `\n${PAGE_BREAK_SENTINEL}\n`);

  const segments = normalized.split(PAGE_BREAK_SENTINEL);
  const segHtml = segments.map((seg) => {
    const lines = seg.split('\n');
    const blocks: string[] = [];
    let tableRows: string[][] = [];

    const flushTable = () => {
      if (tableRows.length === 0) return;
      const maxCols = Math.max(...tableRows.map((r) => r.length));
      const rowsHtml = tableRows
        .map((cells) => {
          const padded = [...cells];
          while (padded.length < maxCols) padded.push('');
          return `<tr>${padded
            .map((c) => `<td><p>${c.replace(/\x0b/g, '\n').split('\n').map(preserveLeadingIndentHtml).join('<br />')}</p></td>`)
            .join('')}</tr>`;
        })
        .join('');
      blocks.push(`<table><tbody>${rowsHtml}</tbody></table>`);
      tableRows = [];
    };

    for (const rawLine of lines) {
      if (rawLine.includes('\x07')) {
        // In legacy Word .doc binary, cells are separated by \x07 and row ends with \x07\x07 or trailing \x07
        const trimmedLine = rawLine.replace(/\x07+$/, '');
        const cells = trimmedLine.split('\x07');
        if (cells.length >= 2 || rawLine.endsWith('\x07\x07')) {
          tableRows.push(cells.map((c) => c.trim()));
          continue;
        }
      }
      flushTable();
      const cleaned = rawLine.replace(/\x07/g, ' ').replace(/[\x00-\x08\x0e-\x1f]/g, '');
      if (cleaned.trim() === '') {
        blocks.push('<p></p>');
      } else {
        const withBr = cleaned
          .split('\x0b')
          .map((part) => preserveLeadingIndentHtml(part))
          .join('<br />');
        blocks.push(`<p>${withBr}</p>`);
      }
    }
    flushTable();
    return blocks.join('\n');
  });

  return segHtml.filter(Boolean).join('\n<hr class="page-break-marker" />\n') || '<p></p>';
}

function decodeBytesWithCharset(bytes: Uint8Array, charset?: string): string {
  const cs = (charset || 'utf-8').toLowerCase().trim();
  try {
    return new TextDecoder(cs, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
}

function decodeQuotedPrintable(input: string, charset?: string): string {
  const unwrapped = input.replace(/=\r?\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < unwrapped.length; i++) {
    if (unwrapped[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(unwrapped.slice(i + 1, i + 3))) {
      bytes.push(parseInt(unwrapped.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(unwrapped.charCodeAt(i) & 0xff);
    }
  }
  return decodeBytesWithCharset(new Uint8Array(bytes), charset);
}

function unwrapMhtmlDocument(rawText: string, depth = 0): string {
  if (depth > 5) return rawText;
  const boundaryMatch = rawText.match(/boundary=["']?([^"'\r\n;]+)["']?/i);
  if (!boundaryMatch) return rawText;
  const boundary = boundaryMatch[1];
  const parts = rawText.split(`--${boundary}`);
  const resourceMap = new Map<string, string>();
  let mainHtml = '';

  for (const part of parts) {
    const splitIdx = part.search(/\r?\n\r?\n/);
    if (splitIdx < 0) continue;
    const headers = part.slice(0, splitIdx);
    const body = part.slice(splitIdx).replace(/^\r?\n\r?\n/, '').trim();
    const ctMatch = headers.match(/Content-Type:\s*([^\r\n;]+)/i);
    const charsetMatch = headers.match(/charset=["']?([^"'\r\n;]+)["']?/i);
    const cteMatch = headers.match(/Content-Transfer-Encoding:\s*([^\r\n;]+)/i);
    const locMatch = headers.match(/Content-Location:\s*([^\r\n]+)/i);
    const cidMatch = headers.match(/Content-ID:\s*<?([^>\r\n]+)>?/i);
    const ct = (ctMatch?.[1] || '').toLowerCase();
    const cte = (cteMatch?.[1] || '').toLowerCase();
    const charset = charsetMatch?.[1];

    if (ct.includes('multipart/')) {
      const nested = unwrapMhtmlDocument(`${headers}\r\n\r\n${body}`, depth + 1);
      if (nested && !mainHtml && nested !== `${headers}\r\n\r\n${body}`) {
        mainHtml = nested;
      }
    } else if (ct.includes('text/html') && !mainHtml) {
      if (cte.includes('quoted-printable')) {
        mainHtml = decodeQuotedPrintable(body, charset);
      } else if (cte.includes('base64')) {
        try {
          const bin = atob(body.replace(/\s+/g, ''));
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          mainHtml = decodeBytesWithCharset(arr, charset);
        } catch {
          mainHtml = body;
        }
      } else {
        mainHtml = body;
      }
    } else if (ct.startsWith('image/') && cte.includes('base64')) {
      const dataUrl = `data:${ct};base64,${body.replace(/\s+/g, '')}`;
      if (locMatch?.[1]) {
        resourceMap.set(locMatch[1].trim(), dataUrl);
        const fileOnly = locMatch[1].trim().split('/').pop();
        if (fileOnly) resourceMap.set(fileOnly, dataUrl);
      }
      if (cidMatch?.[1]) {
        resourceMap.set(`cid:${cidMatch[1].trim()}`, dataUrl);
      }
    }
  }

  if (!mainHtml) return rawText;
  for (const [ref, dataUrl] of resourceMap.entries()) {
    mainHtml = mainHtml.split(ref).join(dataUrl);
  }
  return mainHtml;
}

export function convertWordXmlToHtml(xmlText: string): string {
  if (typeof DOMParser === 'undefined') {
    return plainTextToPreservedHtml(xmlText.replace(/<[^>]+>/g, ' '));
  }
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlText, 'application/xml');
  if (xml.getElementsByTagName('parsererror').length > 0) {
    return extractFormattedHtmlBody(xmlText);
  }

  // Handle Flat OPC XML (<pkg:package>) by isolating word/document.xml part if present
  const pkgParts = Array.from(xml.getElementsByTagName('*')).filter((e) => e.localName === 'part');
  let targetRoot: Element = xml.documentElement;
  if (pkgParts.length > 0) {
    const docPart = pkgParts.find((p) => {
      const name = (getAttrByLocalName(p, 'name') || '').toLowerCase();
      return name.endsWith('/document.xml') || name === 'word/document.xml';
    });
    if (docPart) targetRoot = docPart;
  }

  // Embedded Word 2003 XML base64 binary images (<w:binData w:name="wordml://...">)
  const binImages = new Map<string, string>();
  for (const bd of Array.from(xml.getElementsByTagName('*')).filter((e) => e.localName === 'binData')) {
    const name = getWAttr(bd, 'name') || '';
    const b64 = (bd.textContent || '').replace(/\s+/g, '');
    if (name && b64) {
      const ext = name.split('.').pop()?.toLowerCase() || 'png';
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : 'image/png';
      binImages.set(name, `data:${mime};base64,${b64}`);
    }
  }

  const renderXmlParagraph = (pEl: Element): string => {
    const pPr = getFirstDirectChildByLocalName(pEl, 'pPr');
    const pStyleEl = pPr ? getFirstDirectChildByLocalName(pPr, 'pStyle') : undefined;
    const pStyleVal = (getWAttr(pStyleEl, 'val') || '').toLowerCase();
    const jcEl = pPr ? getFirstDirectChildByLocalName(pPr, 'jc') : undefined;
    const jcVal = getWAttr(jcEl, 'val');
    const alignCss =
      jcVal === 'center'
        ? 'text-align: center'
        : jcVal === 'right' || jcVal === 'end'
        ? 'text-align: right'
        : jcVal === 'both' || jcVal === 'distribute'
        ? 'text-align: justify'
        : '';

    const parts: string[] = [];
    const walkInline = (el: Element) => {
      for (const ch of Array.from(el.children)) {
        const ln = ch.localName;
        if (ln === 'pPr' || ln === 'rPr' || ln === 'instrText' || ln === 'del') continue;
        if (ln === 't') {
          if (ch.textContent) parts.push(escapeHtml(ch.textContent));
        } else if (ln === 'tab') {
          parts.push('\u00A0\u00A0\u00A0\u00A0');
        } else if (ln === 'br') {
          const bt = getWAttr(ch, 'type');
          parts.push(bt === 'page' ? '<hr class="page-break-marker" />' : '<br />');
        } else if (ln === 'imagedata') {
          const src = ch.getAttribute('src') || '';
          const url = binImages.get(src);
          if (url) parts.push(`<img src="${url}" alt="Embedded image" />`);
        } else if (ln === 'r') {
          const rPr = getFirstDirectChildByLocalName(ch, 'rPr');
          const b = rPr && parseBoolToggle(getFirstDirectChildByLocalName(rPr, 'b'));
          const it = rPr && parseBoolToggle(getFirstDirectChildByLocalName(rPr, 'i'));
          const u = rPr && getFirstDirectChildByLocalName(rPr, 'u');
          const startLen = parts.length;
          walkInline(ch);
          const inner = parts.splice(startLen).join('');
          if (inner) {
            let wrapped = inner;
            if (b) wrapped = `<strong>${wrapped}</strong>`;
            if (it) wrapped = `<em>${wrapped}</em>`;
            if (u) wrapped = `<u>${wrapped}</u>`;
            parts.push(wrapped);
          }
        } else {
          walkInline(ch);
        }
      }
    };
    walkInline(pEl);

    const inner = parts.join('');
    const tag =
      pStyleVal === 'heading1' || pStyleVal === 'title'
        ? 'h1'
        : pStyleVal === 'heading2' || pStyleVal === 'subtitle'
        ? 'h2'
        : pStyleVal === 'heading3'
        ? 'h3'
        : 'p';
    const styleAttr = alignCss ? ` style="${alignCss}"` : '';
    return `<${tag}${styleAttr}>${inner}</${tag}>`;
  };

  const renderXmlTable = (tblEl: Element): string => {
    const trs = getDirectChildrenByLocalName(tblEl, 'tr');
    const rowsHtml = trs
      .map((tr) => {
        const tcs = getDirectChildrenByLocalName(tr, 'tc');
        const cellsHtml = tcs
          .map((tc) => {
            const pEls = getDirectChildrenByLocalName(tc, 'p');
            const inner = pEls.map(renderXmlParagraph).join('') || '<p></p>';
            return `<td>${inner}</td>`;
          })
          .join('');
        return `<tr>${cellsHtml}</tr>`;
      })
      .join('');
    return `<table><tbody>${rowsHtml}</tbody></table>`;
  };

  const blocks: string[] = [];
  const walkBlockContainer = (el: Element) => {
    for (const ch of Array.from(el.children)) {
      const ln = ch.localName;
      if (ln === 'p') {
        blocks.push(renderXmlParagraph(ch));
      } else if (ln === 'tbl') {
        blocks.push(renderXmlTable(ch));
      } else if (
        ln === 'body' ||
        ln === 'sect' ||
        ln === 'sub-section' ||
        ln === 'xmlData' ||
        ln === 'document' ||
        ln === 'wordDocument' ||
        ln === 'part' ||
        ln === 'sdt' ||
        ln === 'sdtContent'
      ) {
        walkBlockContainer(ch);
      }
    }
  };

  const bodyNode = Array.from(targetRoot.getElementsByTagName('*')).find(
    (e) => e.localName === 'body'
  );
  walkBlockContainer(bodyNode || targetRoot);
  const out = blocks.join('\n').trim();
  if (hasMeaningfulHtmlContent(out)) return out;

  const fallbackAllText = Array.from(xml.getElementsByTagName('*'))
    .filter((e) => e.localName === 't')
    .map((e) => e.textContent || '')
    .join(' ')
    .trim();
  return fallbackAllText ? plainTextToPreservedHtml(fallbackAllText) : '<p></p>';
}

const PRESERVED_INLINE_CSS_PROPS = new Set([
  'text-align',
  'color',
  'background-color',
  'background',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-decoration',
  'margin-left',
  'margin-right',
  'margin-top',
  'margin-bottom',
  'text-indent',
  'line-height',
  'border',
  'border-top',
  'border-bottom',
  'border-left',
  'border-right',
  'vertical-align',
  'width',
]);

export function extractFormattedHtmlBody(rawInput: string): string {
  const cleanedRaw = rawInput.replace(/^\uFEFF/, '');
  const htmlText = /Content-Type:\s*multipart\//i.test(cleanedRaw.slice(0, 3000))
    ? unwrapMhtmlDocument(cleanedRaw)
    : cleanedRaw;

  if (typeof DOMParser === 'undefined') {
    return htmlText;
  }

  const doc = new DOMParser().parseFromString(htmlText, 'text/html');

  // Inline simple CSS rules from <style> blocks before removing <style>
  const cssRules: Array<{ selector: string; declarations: Array<[string, string]> }> = [];
  doc.querySelectorAll('style').forEach((styleEl) => {
    const cssText = (styleEl.textContent || '').replace(/\/\*[\s\S]*?\*\//g, '');
    const ruleRegex = /([^{}]+)\{([^{}]+)\}/g;
    let m: RegExpExecArray | null;
    while ((m = ruleRegex.exec(cssText)) !== null) {
      const rawSelectors = m[1].split(',').map((s) => s.trim()).filter(Boolean);
      const decls: Array<[string, string]> = [];
      for (const pair of m[2].split(';')) {
        const colonIdx = pair.indexOf(':');
        if (colonIdx <= 0) continue;
        const prop = pair.slice(0, colonIdx).trim().toLowerCase();
        const val = pair.slice(colonIdx + 1).replace(/!important/gi, '').trim();
        if (PRESERVED_INLINE_CSS_PROPS.has(prop) && val) {
          decls.push([prop, val]);
        }
      }
      if (decls.length > 0) {
        for (const sel of rawSelectors) {
          if (!sel.startsWith('@') && !sel.includes(':')) {
            cssRules.push({ selector: sel, declarations: decls });
          }
        }
      }
    }
  });

  if (doc.body && cssRules.length > 0) {
    for (const rule of cssRules) {
      try {
        const matched = doc.body.querySelectorAll(rule.selector);
        matched.forEach((el) => {
          const htmlEl = el as HTMLElement;
          for (const [prop, val] of rule.declarations) {
            if (!htmlEl.style.getPropertyValue(prop)) {
              htmlEl.style.setProperty(prop, val);
            }
          }
        });
      } catch {
        // Ignore invalid CSS selector syntax (e.g., mso-* pseudo-rules)
      }
    }
  }

  // Convert Word HTML explicit page breaks into <hr class="page-break-marker" />
  if (doc.body) {
    doc.body
      .querySelectorAll('br[clear="all"], span[style*="page-break-before"], p[style*="page-break-before"]')
      .forEach((brk) => {
        const styleStr = (brk.getAttribute('style') || '').toLowerCase();
        if (
          brk.tagName.toLowerCase() === 'br' ||
          styleStr.includes('page-break-before:always') ||
          styleStr.includes('page-break-before: always')
        ) {
          const hr = doc.createElement('hr');
          hr.className = 'page-break-marker';
          if (brk.tagName.toLowerCase() === 'p' && brk.textContent?.trim()) {
            brk.parentNode?.insertBefore(hr, brk);
          } else {
            brk.parentNode?.replaceChild(hr, brk);
          }
        }
      });
  }

  doc.querySelectorAll('script, style, meta, link, title, head, xml').forEach((el) => el.remove());
  return (doc.body?.innerHTML || '').trim() || '<p></p>';
}

function guessImageMimeFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'bmp') return 'image/bmp';
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'avif') return 'image/avif';
  return 'image/png';
}

export function csvOrTsvToHtml(rawText: string, explicitDelimiter?: ',' | '\t' | ';'): string {
  const clean = rawText.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!clean.trim()) return '<p></p>';

  let delimiter: ',' | '\t' | ';' = explicitDelimiter || ',';
  if (!explicitDelimiter) {
    const sampleLines = clean.split('\n').slice(0, 5).join('\n');
    const tabCount = (sampleLines.match(/\t/g) || []).length;
    const commaCount = (sampleLines.match(/,/g) || []).length;
    const semiCount = (sampleLines.match(/;/g) || []).length;
    if (tabCount > commaCount && tabCount >= semiCount) delimiter = '\t';
    else if (semiCount > commaCount && commaCount === 0) delimiter = ';';
  }

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n') {
      row.push(cell.trim());
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      cell = '';
      if (rows.length >= 3000) break;
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell.trim());
    if (row.some((c) => c !== '')) rows.push(row);
  }

  if (rows.length === 0) return '<p></p>';
  const maxCols = Math.min(60, Math.max(...rows.map((r) => r.length)));
  const renderRow = (r: string[], tag: 'th' | 'td') => {
    const cells: string[] = [];
    for (let c = 0; c < maxCols; c++) {
      cells.push(`<${tag}>${escapeHtml(r[c] || '')}</${tag}>`);
    }
    return `<tr>${cells.join('')}</tr>`;
  };

  if (rows.length === 1) {
    return `<table><tbody>${renderRow(rows[0], 'td')}</tbody></table>`;
  }
  const thead = `<thead>${renderRow(rows[0], 'th')}</thead>`;
  const tbody = `<tbody>${rows.slice(1).map((r) => renderRow(r, 'td')).join('')}</tbody>`;
  return `<table>${thead}${tbody}</table>`;
}

export async function convertOdtZipToHtml(
  zip: JSZip,
  inspectImage?: ImageInspector
): Promise<string> {
  if (typeof DOMParser === 'undefined') return '<p></p>';
  const contentEntry = findZipEntry(zip, 'content.xml');
  if (!contentEntry) return '<p></p>';

  const parser = new DOMParser();
  const xml = parser.parseFromString(await contentEntry.async('string'), 'application/xml');
  if (xml.getElementsByTagName('parsererror').length > 0) return '<p></p>';

  const imgCache = new Map<string, string>();
  const resolveOdfImage = async (href: string): Promise<string> => {
    if (!href) return '';
    if (imgCache.has(href)) return imgCache.get(href)!;
    const cleanPath = href.replace(/^\.\//, '');
    const entry = findZipEntry(zip, cleanPath);
    if (!entry) {
      imgCache.set(href, '');
      return '';
    }
    const mime = guessImageMimeFromPath(cleanPath);
    if (mime.includes('wmf') || mime.includes('emf') || mime.includes('tiff')) {
      imgCache.set(href, '');
      return '';
    }
    const b64 = await entry.async('base64');
    const rawUrl = `data:${mime};base64,${b64}`;
    let finalUrl = rawUrl;
    if (inspectImage) {
      const inspected = await inspectImage(rawUrl, mime);
      if (!inspected.renderable) {
        imgCache.set(href, '');
        return '';
      }
      finalUrl = inspected.dataUrl;
    }
    const tag = `<img src="${finalUrl}" alt="${escapeAttr(cleanPath.split('/').pop() || 'Image')}" />`;
    imgCache.set(href, tag);
    return tag;
  };

  // Detect automatic styles with fo:break-before="page"
  const pageBreakStyles = new Set<string>();
  const styleAlignMap = new Map<string, string>();
  for (const st of Array.from(xml.getElementsByTagName('*')).filter((e) => e.localName === 'style')) {
    const name = getAttrByLocalName(st, 'name');
    if (!name) continue;
    const pp = getFirstDirectChildByLocalName(st, 'paragraph-properties');
    if (pp) {
      if (getAttrByLocalName(pp, 'break-before') === 'page') pageBreakStyles.add(name);
      const align = getAttrByLocalName(pp, 'text-align');
      if (align === 'center' || align === 'right' || align === 'justify') {
        styleAlignMap.set(name, align);
      } else if (align === 'end') {
        styleAlignMap.set(name, 'right');
      }
    }
  }

  const collectInline = async (node: Node): Promise<string> => {
    if (node.nodeType === Node.TEXT_NODE) {
      return escapeHtml(node.textContent || '');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node as Element;
    const ln = el.localName;
    if (ln === 's') {
      const count = Math.min(20, Math.max(1, Number(getAttrByLocalName(el, 'c')) || 1));
      return ' '.repeat(count);
    }
    if (ln === 'tab') return '\u00A0\u00A0\u00A0\u00A0';
    if (ln === 'line-break') return '<br />';
    if (ln === 'soft-page-break') return '<hr class="page-break-marker" />';
    if (ln === 'image') {
      const href = getAttrByLocalName(el, 'href') || '';
      return resolveOdfImage(href);
    }
    const childParts: string[] = [];
    for (const c of Array.from(el.childNodes)) {
      childParts.push(await collectInline(c));
    }
    const inner = childParts.join('');
    if (ln === 'a') {
      const href = getAttrByLocalName(el, 'href');
      if (href && /^https?:\/\//i.test(href)) {
        return `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
      }
    }
    return inner;
  };

  const blocks: string[] = [];
  const walkOdtBlock = async (el: Element) => {
    for (const ch of Array.from(el.children)) {
      const ln = ch.localName;
      const styleName = getAttrByLocalName(ch, 'style-name') || '';
      if (styleName && pageBreakStyles.has(styleName) && blocks.length > 0) {
        blocks.push('<hr class="page-break-marker" />');
      }

      if (ln === 'p' || ln === 'h') {
        const inner = (await collectInline(ch)).replace(/<hr class="page-break-marker" \/>/g, '');
        const align = styleAlignMap.get(styleName);
        const styleAttr = align ? ` style="text-align: ${align}"` : '';
        if (ln === 'h') {
          const lvl = Math.min(3, Math.max(1, Number(getAttrByLocalName(ch, 'outline-level')) || 2));
          blocks.push(`<h${lvl}${styleAttr}>${inner}</h${lvl}>`);
        } else {
          blocks.push(`<p${styleAttr}>${inner}</p>`);
        }
      } else if (ln === 'list') {
        const items: string[] = [];
        for (const li of getDirectChildrenByLocalName(ch, 'list-item')) {
          const liParts: string[] = [];
          for (const lp of Array.from(li.children)) {
            if (lp.localName === 'p' || lp.localName === 'h') {
              liParts.push(`<p>${await collectInline(lp)}</p>`);
            }
          }
          if (liParts.length > 0) items.push(`<li>${liParts.join('')}</li>`);
        }
        if (items.length > 0) blocks.push(`<ul>${items.join('')}</ul>`);
      } else if (ln === 'table') {
        const rowHtmls: string[] = [];
        const rows = Array.from(ch.children).filter(
          (c) => c.localName === 'table-row' || c.localName === 'table-header-rows'
        );
        const flatRows: Element[] = [];
        for (const r of rows) {
          if (r.localName === 'table-header-rows') {
            flatRows.push(...getDirectChildrenByLocalName(r, 'table-row'));
          } else {
            flatRows.push(r);
          }
        }
        for (const tr of flatRows) {
          const cells = getDirectChildrenByLocalName(tr, 'table-cell');
          const cellHtmls: string[] = [];
          for (const td of cells) {
            const pEls = Array.from(td.children).filter((c) => c.localName === 'p' || c.localName === 'h');
            const pStrings: string[] = [];
            for (const p of pEls) {
              pStrings.push(`<p>${await collectInline(p)}</p>`);
            }
            const colspan = Number(getAttrByLocalName(td, 'number-columns-spanned')) || 1;
            const spanAttr = colspan > 1 ? ` colspan="${colspan}"` : '';
            cellHtmls.push(`<td${spanAttr}>${pStrings.join('') || '<p></p>'}</td>`);
          }
          if (cellHtmls.length > 0) rowHtmls.push(`<tr>${cellHtmls.join('')}</tr>`);
        }
        if (rowHtmls.length > 0) blocks.push(`<table><tbody>${rowHtmls.join('')}</tbody></table>`);
      } else if (ln === 'section' || ln === 'text' || ln === 'body' || ln === 'frame') {
        if (ln === 'frame') {
          const imgHtml = await collectInline(ch);
          if (imgHtml) blocks.push(`<p>${imgHtml}</p>`);
        } else {
          await walkOdtBlock(ch);
        }
      }
    }
  };

  const textBody = Array.from(xml.getElementsByTagName('*')).find((e) => e.localName === 'text');
  await walkOdtBlock(textBody || xml.documentElement);
  const out = blocks.join('\n').trim();
  if (hasMeaningfulHtmlContent(out)) return out;

  const fallbackText = Array.from(xml.getElementsByTagName('*'))
    .filter((e) => e.localName === 'p' || e.localName === 'h')
    .map((e) => (e.textContent || '').trim())
    .filter(Boolean)
    .join('\n\n');
  return fallbackText ? plainTextToPreservedHtml(fallbackText) : '<p></p>';
}

function colLettersToIndex(ref: string): number {
  const letters = ref.replace(/[^A-Za-z]/g, '').toUpperCase();
  let col = 0;
  for (let i = 0; i < letters.length; i++) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  return Math.max(0, col - 1);
}

export async function convertXlsxZipToHtml(zip: JSZip): Promise<string> {
  if (typeof DOMParser === 'undefined') return '<p></p>';
  const parser = new DOMParser();

  // 1. Shared strings table
  const sharedStrings: string[] = [];
  const ssEntry = findZipEntry(zip, 'xl/sharedStrings.xml');
  if (ssEntry) {
    const ssXml = parser.parseFromString(await ssEntry.async('string'), 'application/xml');
    for (const si of Array.from(ssXml.getElementsByTagName('*')).filter((e) => e.localName === 'si')) {
      const txt = Array.from(si.getElementsByTagName('*'))
        .filter((e) => e.localName === 't')
        .map((t) => t.textContent || '')
        .join('');
      sharedStrings.push(txt);
    }
  }

  // 2. Map sheet names to worksheet paths
  const sheetTargets: Array<{ name: string; path: string }> = [];
  const wbEntry = findZipEntry(zip, 'xl/workbook.xml');
  const relsEntry = findZipEntry(zip, 'xl/_rels/workbook.xml.rels');
  const relMap = new Map<string, string>();
  if (relsEntry) {
    const rXml = parser.parseFromString(await relsEntry.async('string'), 'application/xml');
    for (const rel of Array.from(rXml.getElementsByTagName('*')).filter((e) => e.localName === 'Relationship')) {
      const id = rel.getAttribute('Id') || '';
      const target = rel.getAttribute('Target') || '';
      if (id && target) {
        const norm = target.startsWith('/') ? target.slice(1) : target.startsWith('xl/') ? target : `xl/${target}`;
        relMap.set(id, norm);
      }
    }
  }
  if (wbEntry) {
    const wbXml = parser.parseFromString(await wbEntry.async('string'), 'application/xml');
    for (const sh of Array.from(wbXml.getElementsByTagName('*')).filter((e) => e.localName === 'sheet')) {
      const name = sh.getAttribute('name') || 'Sheet';
      const rId = getAttrByLocalName(sh, 'id') || '';
      const path = relMap.get(rId);
      if (path) sheetTargets.push({ name, path });
    }
  }

  if (sheetTargets.length === 0) {
    const wsKeys = Object.keys(zip.files)
      .filter((k) => !zip.files[k].dir && /^xl\/worksheets\/sheet\d+\.xml$/i.test(k.replace(/^\/+/, '')))
      .sort();
    wsKeys.forEach((k, idx) => sheetTargets.push({ name: `Sheet ${idx + 1}`, path: k }));
  }

  const sections: string[] = [];
  for (const sheet of sheetTargets) {
    const entry = findZipEntry(zip, sheet.path);
    if (!entry) continue;
    const sXml = parser.parseFromString(await entry.async('string'), 'application/xml');
    const rowEls = Array.from(sXml.getElementsByTagName('*')).filter((e) => e.localName === 'row');
    const parsedRows: string[][] = [];
    let maxCol = 0;

    for (const rEl of rowEls) {
      if (parsedRows.length >= 2500) break;
      const rowArr: string[] = [];
      let fallbackCol = 0;
      for (const cEl of getDirectChildrenByLocalName(rEl, 'c')) {
        const ref = cEl.getAttribute('r') || '';
        const colIdx = ref ? colLettersToIndex(ref) : fallbackCol;
        fallbackCol = colIdx + 1;
        if (colIdx >= 50) continue;

        const cType = cEl.getAttribute('t') || '';
        let val = '';
        if (cType === 'inlineStr') {
          val = Array.from(cEl.getElementsByTagName('*'))
            .filter((e) => e.localName === 't')
            .map((t) => t.textContent || '')
            .join('');
        } else {
          const vEl = getFirstDirectChildByLocalName(cEl, 'v');
          const rawVal = vEl?.textContent || '';
          if (cType === 's') {
            const idx = Number(rawVal);
            val = !Number.isNaN(idx) && sharedStrings[idx] !== undefined ? sharedStrings[idx] : rawVal;
          } else if (cType === 'b') {
            val = rawVal === '1' ? 'TRUE' : 'FALSE';
          } else {
            val = rawVal;
          }
        }
        while (rowArr.length <= colIdx) rowArr.push('');
        rowArr[colIdx] = val;
        if (val !== '' && colIdx + 1 > maxCol) maxCol = colIdx + 1;
      }
      if (rowArr.some((v) => v !== '')) {
        parsedRows.push(rowArr);
      }
    }

    if (parsedRows.length === 0) continue;
    const cols = Math.max(1, Math.min(50, maxCol));
    const tableRows = parsedRows.map((r, rIdx) => {
      const tag = rIdx === 0 && parsedRows.length > 1 ? 'th' : 'td';
      const cells: string[] = [];
      for (let c = 0; c < cols; c++) {
        cells.push(`<${tag}>${escapeHtml(r[c] || '')}</${tag}>`);
      }
      return `<tr>${cells.join('')}</tr>`;
    });
    const tableHtml =
      parsedRows.length > 1
        ? `<table><thead>${tableRows[0]}</thead><tbody>${tableRows.slice(1).join('')}</tbody></table>`
        : `<table><tbody>${tableRows.join('')}</tbody></table>`;
    sections.push(`<h2>${escapeHtml(sheet.name)}</h2>\n${tableHtml}`);
  }

  return sections.join('\n<hr class="page-break-marker" />\n') || '<p></p>';
}

export async function convertOdsZipToHtml(zip: JSZip): Promise<string> {
  if (typeof DOMParser === 'undefined') return '<p></p>';
  const contentEntry = findZipEntry(zip, 'content.xml');
  if (!contentEntry) return '<p></p>';
  const xml = new DOMParser().parseFromString(await contentEntry.async('string'), 'application/xml');
  if (xml.getElementsByTagName('parsererror').length > 0) return '<p></p>';

  const tables = Array.from(xml.getElementsByTagName('*')).filter((e) => e.localName === 'table');
  const sections: string[] = [];

  for (const tbl of tables) {
    const name = getAttrByLocalName(tbl, 'name') || `Sheet ${sections.length + 1}`;
    const rowEls = getDirectChildrenByLocalName(tbl, 'table-row');
    const parsedRows: string[][] = [];
    let maxCol = 0;

    for (const tr of rowEls) {
      if (parsedRows.length >= 2500) break;
      const rowRepeat = Math.min(50, Math.max(1, Number(getAttrByLocalName(tr, 'number-rows-repeated')) || 1));
      const rowArr: string[] = [];
      for (const tc of Array.from(tr.children)) {
        if (tc.localName !== 'table-cell' && tc.localName !== 'covered-table-cell') continue;
        const colRepeat = Math.min(25, Math.max(1, Number(getAttrByLocalName(tc, 'number-columns-repeated')) || 1));
        const text = Array.from(tc.getElementsByTagName('*'))
          .filter((e) => e.localName === 'p')
          .map((p) => p.textContent || '')
          .join('\n')
          .trim();
        if (text === '' && rowArr.length + colRepeat > 30) break;
        for (let r = 0; r < colRepeat && rowArr.length < 50; r++) {
          rowArr.push(text);
        }
      }
      if (rowArr.some((v) => v !== '')) {
        const lastNonEmpty = rowArr.reduce((acc, v, idx) => (v !== '' ? idx + 1 : acc), 0);
        if (lastNonEmpty > maxCol) maxCol = lastNonEmpty;
        for (let rr = 0; rr < rowRepeat && parsedRows.length < 2500; rr++) {
          parsedRows.push(rowArr.slice(0, lastNonEmpty));
        }
      }
    }

    if (parsedRows.length === 0) continue;
    const cols = Math.max(1, Math.min(50, maxCol));
    const trHtmls = parsedRows.map((r, idx) => {
      const tag = idx === 0 && parsedRows.length > 1 ? 'th' : 'td';
      const cells: string[] = [];
      for (let c = 0; c < cols; c++) {
        cells.push(`<${tag}>${escapeHtml(r[c] || '')}</${tag}>`);
      }
      return `<tr>${cells.join('')}</tr>`;
    });
    const tblHtml =
      parsedRows.length > 1
        ? `<table><thead>${trHtmls[0]}</thead><tbody>${trHtmls.slice(1).join('')}</tbody></table>`
        : `<table><tbody>${trHtmls.join('')}</tbody></table>`;
    sections.push(`<h2>${escapeHtml(name)}</h2>\n${tblHtml}`);
  }

  return sections.join('\n<hr class="page-break-marker" />\n') || '<p></p>';
}

export async function convertPptxZipToHtml(
  zip: JSZip,
  inspectImage?: ImageInspector
): Promise<string> {
  if (typeof DOMParser === 'undefined') return '<p></p>';
  const parser = new DOMParser();

  const slidePaths = Object.keys(zip.files)
    .filter((k) => !zip.files[k].dir && /^ppt\/slides\/slide\d+\.xml$/i.test(k.replace(/^\/+/, '')))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml/i)?.[1] || 0);
      const nb = Number(b.match(/slide(\d+)\.xml/i)?.[1] || 0);
      return na - nb;
    });

  const slideHtmls: string[] = [];
  for (let sIdx = 0; sIdx < slidePaths.length; sIdx++) {
    const sPath = slidePaths[sIdx];
    const sEntry = findZipEntry(zip, sPath);
    if (!sEntry) continue;
    const xml = parser.parseFromString(await sEntry.async('string'), 'application/xml');

    const parts: string[] = [];
    const pNodes = Array.from(xml.getElementsByTagName('*')).filter((e) => e.localName === 'p');
    let firstHeadingDone = false;
    for (const pNode of pNodes) {
      const txt = Array.from(pNode.getElementsByTagName('*'))
        .filter((e) => e.localName === 't')
        .map((t) => t.textContent || '')
        .join('')
        .trim();
      if (txt) {
        if (!firstHeadingDone) {
          parts.push(`<h2>${escapeHtml(txt)}</h2>`);
          firstHeadingDone = true;
        } else {
          parts.push(`<p>${escapeHtml(txt)}</p>`);
        }
      }
    }

    // Slide embedded images
    const slideName = sPath.split('/').pop() || '';
    const relsEntry = findZipEntry(zip, `ppt/slides/_rels/${slideName}.rels`);
    if (relsEntry) {
      const rXml = parser.parseFromString(await relsEntry.async('string'), 'application/xml');
      const rMap = new Map<string, string>();
      for (const rel of Array.from(rXml.getElementsByTagName('*')).filter((e) => e.localName === 'Relationship')) {
        const id = rel.getAttribute('Id') || '';
        const target = rel.getAttribute('Target') || '';
        if (id && target) {
          const resolved = target.startsWith('../') ? `ppt/${target.slice(3)}` : `ppt/slides/${target}`;
          rMap.set(id, resolved);
        }
      }
      for (const blip of Array.from(xml.getElementsByTagName('*')).filter((e) => e.localName === 'blip')) {
        const embedId = getAttrByLocalName(blip, 'embed');
        const imgPath = embedId ? rMap.get(embedId) : undefined;
        const imgEntry = imgPath ? findZipEntry(zip, imgPath) : null;
        if (imgEntry) {
          const mime = guessImageMimeFromPath(imgPath!);
          if (!mime.includes('wmf') && !mime.includes('emf')) {
            const rawUrl = `data:${mime};base64,${await imgEntry.async('base64')}`;
            if (inspectImage) {
              const res = await inspectImage(rawUrl, mime);
              if (res.renderable) parts.push(`<p><img src="${res.dataUrl}" alt="Slide ${sIdx + 1}" /></p>`);
            } else {
              parts.push(`<p><img src="${rawUrl}" alt="Slide ${sIdx + 1}" /></p>`);
            }
          }
        }
      }
    }

    if (parts.length > 0) {
      slideHtmls.push(parts.join('\n'));
    }
  }

  return slideHtmls.join('\n<hr class="page-break-marker" />\n') || '<p></p>';
}

export async function convertOdpZipToHtml(
  zip: JSZip,
  inspectImage?: ImageInspector
): Promise<string> {
  if (typeof DOMParser === 'undefined') return '<p></p>';
  const contentEntry = findZipEntry(zip, 'content.xml');
  if (!contentEntry) return '<p></p>';
  const xml = new DOMParser().parseFromString(await contentEntry.async('string'), 'application/xml');
  const pages = Array.from(xml.getElementsByTagName('*')).filter((e) => e.localName === 'page');
  const slideHtmls: string[] = [];

  for (let i = 0; i < pages.length; i++) {
    const pg = pages[i];
    const parts: string[] = [];
    for (const p of Array.from(pg.getElementsByTagName('*')).filter((e) => e.localName === 'p' || e.localName === 'h')) {
      const t = (p.textContent || '').trim();
      if (t) parts.push(parts.length === 0 ? `<h2>${escapeHtml(t)}</h2>` : `<p>${escapeHtml(t)}</p>`);
    }
    for (const imgEl of Array.from(pg.getElementsByTagName('*')).filter((e) => e.localName === 'image')) {
      const href = getAttrByLocalName(imgEl, 'href') || '';
      const entry = href ? findZipEntry(zip, href.replace(/^\.\//, '')) : null;
      if (entry) {
        const mime = guessImageMimeFromPath(href);
        const rawUrl = `data:${mime};base64,${await entry.async('base64')}`;
        if (inspectImage) {
          const res = await inspectImage(rawUrl, mime);
          if (res.renderable) parts.push(`<p><img src="${res.dataUrl}" alt="Slide ${i + 1}" /></p>`);
        } else {
          parts.push(`<p><img src="${rawUrl}" alt="Slide ${i + 1}" /></p>`);
        }
      }
    }
    if (parts.length > 0) slideHtmls.push(parts.join('\n'));
  }

  return slideHtmls.join('\n<hr class="page-break-marker" />\n') || '<p></p>';
}

export async function convertEpubZipToHtml(zip: JSZip): Promise<string> {
  if (typeof DOMParser === 'undefined') return '<p></p>';
  const parser = new DOMParser();
  const spinePaths: string[] = [];

  const containerEntry = findZipEntry(zip, 'META-INF/container.xml');
  if (containerEntry) {
    const cXml = parser.parseFromString(await containerEntry.async('string'), 'application/xml');
    const rootfile = Array.from(cXml.getElementsByTagName('*')).find((e) => e.localName === 'rootfile');
    const opfPath = rootfile?.getAttribute('full-path');
    const opfEntry = opfPath ? findZipEntry(zip, opfPath) : null;
    if (opfEntry && opfPath) {
      const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';
      const opfXml = parser.parseFromString(await opfEntry.async('string'), 'application/xml');
      const manifest = new Map<string, string>();
      for (const item of Array.from(opfXml.getElementsByTagName('*')).filter((e) => e.localName === 'item')) {
        const id = item.getAttribute('id') || '';
        const href = item.getAttribute('href') || '';
        if (id && href) {
          manifest.set(id, opfDir ? `${opfDir}/${href}` : href);
        }
      }
      for (const ref of Array.from(opfXml.getElementsByTagName('*')).filter((e) => e.localName === 'itemref')) {
        const idref = ref.getAttribute('idref') || '';
        const path = manifest.get(idref);
        if (path) spinePaths.push(path);
      }
    }
  }

  const targetPaths =
    spinePaths.length > 0
      ? spinePaths
      : Object.keys(zip.files)
          .filter((k) => !zip.files[k].dir && /\.(xhtml|html|htm)$/i.test(k))
          .sort();

  const chapters: string[] = [];
  for (const path of targetPaths) {
    const entry = findZipEntry(zip, path);
    if (!entry) continue;
    const raw = await entry.async('string');
    const body = extractFormattedHtmlBody(raw);
    if (hasMeaningfulHtmlContent(body)) {
      chapters.push(body);
    }
  }
  return chapters.join('\n<hr class="page-break-marker" />\n') || '<p></p>';
}

export function convertGenericXmlToHtml(xmlText: string): string {
  const sample = xmlText.replace(/^\uFEFF/, '').slice(0, 3000).toLowerCase();
  if (
    sample.includes('<w:worddocument') ||
    sample.includes('<worddocument') ||
    sample.includes('<pkg:package') ||
    sample.includes('schemas.openxmlformats.org/wordprocessingml') ||
    sample.includes('schemas.microsoft.com/office/word')
  ) {
    return convertWordXmlToHtml(xmlText);
  }
  if (sample.includes('<html') || sample.includes('<!doctype html')) {
    return extractFormattedHtmlBody(xmlText);
  }
  if (typeof DOMParser !== 'undefined') {
    const xml = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (xml.getElementsByTagName('parsererror').length === 0) {
      const proseText = Array.from(xml.getElementsByTagName('*'))
        .filter((e) => e.children.length === 0 && (e.textContent || '').trim().length > 0)
        .map((e) => (e.textContent || '').trim())
        .join('\n');
      if (proseText) {
        return plainTextToPreservedHtml(proseText);
      }
    }
  }
  return plainTextToPreservedHtml(xmlText);
}

