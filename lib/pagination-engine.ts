import {
  AssetListEntry,
  CompilationResult,
  CompiledPage,
  Language,
  NumberingFormat,
  PageSetupConfig,
  Project,
  ProjectDocument,
  TocEntry,
  getEffectivePaperMm,
} from '@/types/document';

export const DPI_96_PER_MM = 96 / 25.4;

export function mmToPx(mm: number): number {
  return Math.round(mm * DPI_96_PER_MM);
}

export function mmToPt(mm: number): number {
  return (mm * 72) / 25.4;
}

const KHMER_DIGITS = ['០', '១', '២', '៣', '៤', '៥', '៦', '៧', '៨', '៩'];
const KHMER_CONSONANTS = [
  'ក', 'ខ', 'គ', 'ឃ', 'ង',
  'ច', 'ឆ', 'ជ', 'ឈ', 'ញ',
  'ដ', 'ឋ', 'ឌ', 'ឍ', 'ណ',
  'ត', 'ថ', 'ទ', 'ធ', 'ន',
  'ប', 'ផ', 'ព', 'ភ', 'ម',
  'យ', 'រ', 'ល', 'វ',
  'ស', 'ហ', 'ឡ', 'អ',
];

export function formatNumberValue(num: number, format: NumberingFormat): string {
  if (format === 'km') {
    return String(num)
      .split('')
      .map((ch) => {
        const code = ch.charCodeAt(0) - 48;
        return code >= 0 && code <= 9 ? KHMER_DIGITS[code] : ch;
      })
      .join('');
  }
  if (num <= 0) return String(num);
  if (format === '1') return String(num);
  if (format === 'km-alpha') {
    let n = num;
    let res = '';
    const base = KHMER_CONSONANTS.length;
    while (n > 0) {
      const rem = (n - 1) % base;
      res = KHMER_CONSONANTS[rem] + res;
      n = Math.floor((n - 1) / base);
    }
    return res;
  }
  if (format === 'A') {
    let n = num;
    let res = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      res = String.fromCharCode(65 + rem) + res;
      n = Math.floor((n - 1) / 26);
    }
    return res;
  }
  const romanMap: Array<[number, string]> = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let rem = num;
  let roman = '';
  for (const [val, sym] of romanMap) {
    while (rem >= val) {
      roman += sym;
      rem -= val;
    }
  }
  return format === 'i' ? roman.toLowerCase() : roman;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface RawBlock {
  html: string;
  isPageBreak: boolean;
  isPdfPage?: boolean;
  pdfPageNumber?: number;
  pdfWidthPt?: number;
  pdfHeightPt?: number;
  headingLevel?: 1 | 2 | 3;
  headingText?: string;
  tableCaption?: string;
  figureCaption?: string;
}

const UNWRAP_CONTAINER_TAGS = new Set([
  'div',
  'section',
  'article',
  'main',
  'header',
  'footer',
  'aside',
]);

function isPageBreakElement(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();
  return (
    tag === 'hr' &&
    (el.classList.contains('page-break-marker') ||
      el.getAttribute('data-page-break') === 'true' ||
      el.attributes.length === 0)
  );
}

function splitHtmlIntoBlocks(html: string): RawBlock[] {
  if (typeof window === 'undefined') {
    return [{ html: html || '<p></p>', isPageBreak: false }];
  }
  const container = document.createElement('div');
  container.innerHTML = html || '<p></p>';
  const blocks: RawBlock[] = [];
  let tableCounter = 0;
  let figureCounter = 0;

  const visitNodes = (nodes: NodeListOf<ChildNode> | ChildNode[]) => {
    Array.from(nodes).forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const txt = (node.textContent || '').trim();
        if (txt) {
          blocks.push({ html: `<p>${escapeHtml(txt)}</p>`, isPageBreak: false });
        }
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();

      if (el.classList.contains('dm-pdf-page-marker')) {
        const pdfPageNumber = Number(el.getAttribute('data-pdf-page')) || blocks.length + 1;
        const pdfWidthPt = Number(el.getAttribute('data-width-pt')) || 595;
        const pdfHeightPt = Number(el.getAttribute('data-height-pt')) || 842;
        blocks.push({
          html: '',
          isPageBreak: false,
          isPdfPage: true,
          pdfPageNumber,
          pdfWidthPt,
          pdfHeightPt,
        });
        return;
      }

      if (isPageBreakElement(el)) {
        blocks.push({ html: '', isPageBreak: true });
        return;
      }

      if (
        (UNWRAP_CONTAINER_TAGS.has(tag) && !el.classList.contains('dm-toc-block')) ||
        el.querySelector('.dm-pdf-page-marker, hr.page-break-marker, hr[data-page-break="true"]')
      ) {
        if (el.childNodes.length > 0) {
          visitNodes(el.childNodes);
          return;
        }
      }

      const block: RawBlock = { html: el.outerHTML, isPageBreak: false };

      if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
        const text = (el.textContent || '').trim();
        if (text) {
          block.headingLevel = Number(tag[1]) as 1 | 2 | 3;
          block.headingText = text;
        }
      }

      if (tag === 'table') {
        tableCounter++;
        const firstRowText = (el.querySelector('tr')?.textContent || '').trim().slice(0, 60);
        block.tableCaption = firstRowText ? `Table ${tableCounter}: ${firstRowText}` : `Table ${tableCounter}`;
      }

      if (tag === 'figure' || tag === 'img' || el.querySelector('img')) {
        figureCounter++;
        const imgEl = tag === 'img' ? el : el.querySelector('img');
        const alt = imgEl?.getAttribute('alt')?.trim();
        block.figureCaption = alt ? `Figure ${figureCounter}: ${alt}` : `Figure ${figureCounter}`;
      }

      blocks.push(block);
    });
  };

  visitNodes(container.childNodes);

  return blocks.length > 0 ? blocks : [{ html: '<p></p>', isPageBreak: false }];
}

interface SandboxHandle {
  outer: HTMLDivElement;
  inner: HTMLDivElement;
}

function createMeasurementSandbox(
  contentWidthPx: number,
  maxImageHeightPx: number,
  setup: PageSetupConfig
): SandboxHandle {
  const outer = document.createElement('div');
  outer.style.position = 'fixed';
  outer.style.left = '-99999px';
  outer.style.top = '0';
  outer.style.width = `${contentWidthPx}px`;
  outer.style.visibility = 'hidden';
  outer.style.pointerEvents = 'none';
  outer.style.boxSizing = 'border-box';
  outer.style.fontFamily = setup.defaultFontFamily;
  outer.style.fontSize = `${setup.defaultFontSizePt}pt`;
  outer.style.lineHeight = String(setup.lineHeight);
  if (setup.firstLineIndentMm) {
    outer.style.textIndent = `${mmToPx(setup.firstLineIndentMm)}px`;
  }
  outer.style.setProperty('--dm-max-img-height', `${maxImageHeightPx}px`);
  outer.className = 'dm-prose';

  const inner = document.createElement('div');
  inner.style.display = 'flow-root';
  outer.appendChild(inner);

  document.body.appendChild(outer);
  return { outer, inner };
}

function measureSingleBlockHtml(
  sandbox: SandboxHandle,
  html: string
): number {
  sandbox.inner.innerHTML = html;
  const rect = sandbox.inner.getBoundingClientRect();
  return Math.max(20, Math.ceil(rect.height) + 2);
}

function getDirectTableRows(tableEl: HTMLTableElement): {
  theadRows: HTMLTableRowElement[];
  bodyRows: HTMLTableRowElement[];
} {
  const theadRows: HTMLTableRowElement[] = [];
  const bodyRows: HTMLTableRowElement[] = [];
  const tfootRows: HTMLTableRowElement[] = [];

  for (const child of Array.from(tableEl.children)) {
    const cTag = child.tagName.toLowerCase();
    if (cTag === 'tr') {
      bodyRows.push(child as HTMLTableRowElement);
    } else if (cTag === 'thead') {
      for (const r of Array.from(child.children)) {
        if (r.tagName.toLowerCase() === 'tr') {
          theadRows.push(r as HTMLTableRowElement);
        }
      }
    } else if (cTag === 'tbody') {
      for (const r of Array.from(child.children)) {
        if (r.tagName.toLowerCase() === 'tr') {
          bodyRows.push(r as HTMLTableRowElement);
        }
      }
    } else if (cTag === 'tfoot') {
      for (const r of Array.from(child.children)) {
        if (r.tagName.toLowerCase() === 'tr') {
          tfootRows.push(r as HTMLTableRowElement);
        }
      }
    }
  }

  return { theadRows, bodyRows: [...bodyRows, ...tfootRows] };
}

function splitOversizedTable(
  el: HTMLTableElement,
  sandbox: SandboxHandle,
  maxHeightPx: number,
  baseBlock: RawBlock
): RawBlock[] {
  const { theadRows, bodyRows: initialBodyRows } = getDirectTableRows(el);
  const totalRows = theadRows.length + initialBodyRows.length;

  let headerRowHtml = '';
  let bodyRows: HTMLTableRowElement[] = [];

  if (theadRows.length > 0) {
    headerRowHtml = theadRows.map((r) => r.outerHTML).join('');
    bodyRows = initialBodyRows;
  } else if (initialBodyRows.length > 0) {
    const firstRowHasDirectTh = Array.from(initialBodyRows[0].children).some(
      (cell) => cell.tagName.toLowerCase() === 'th'
    );
    if (firstRowHasDirectTh && initialBodyRows.length > 1) {
      headerRowHtml = initialBodyRows[0].outerHTML;
      bodyRows = initialBodyRows.slice(1);
    } else {
      bodyRows = initialBodyRows;
    }
  }

  const tableClass = el.className ? ` class="${escapeHtml(el.className)}"` : '';
  const tableStyle = el.getAttribute('style')
    ? ` style="${escapeHtml(el.getAttribute('style') || '')}"`
    : '';
  const wrapTable = (rowsHtml: string) =>
    `<table${tableClass}${tableStyle}>${headerRowHtml ? `<thead>${headerRowHtml}</thead>` : ''}<tbody>${rowsHtml}</tbody></table>`;

  // Handle single-cell layout boxes taller than one page (common in imported DOCX/RTF forms)
  if (totalRows === 1 && bodyRows.length === 1) {
    const directCells = Array.from(bodyRows[0].children).filter((c) => {
      const t = c.tagName.toLowerCase();
      return t === 'td' || t === 'th';
    });
    if (directCells.length === 1) {
      const cell = directCells[0] as HTMLElement;
      const cellChildren = Array.from(cell.children);
      if (cellChildren.length > 1) {
        const cellTag = cell.tagName.toLowerCase();
        const cellStyle = cell.getAttribute('style')
          ? ` style="${escapeHtml(cell.getAttribute('style') || '')}"`
          : '';
        const wrapSingleCell = (innerHtml: string) =>
          `<table${tableClass}${tableStyle}><tbody><tr><${cellTag}${cellStyle}>${innerHtml}</${cellTag}></tr></tbody></table>`;
        const cellChunks: RawBlock[] = [];
        let curInner: string[] = [];
        for (const childEl of cellChildren) {
          const childHtml = (childEl as HTMLElement).outerHTML;
          const candidate = wrapSingleCell([...curInner, childHtml].join(''));
          if (
            curInner.length > 0 &&
            measureSingleBlockHtml(sandbox, candidate) > maxHeightPx
          ) {
            cellChunks.push({
              html: wrapSingleCell(curInner.join('')),
              isPageBreak: false,
              tableCaption: cellChunks.length === 0 ? baseBlock.tableCaption : undefined,
            });
            curInner = [childHtml];
          } else {
            curInner.push(childHtml);
          }
        }
        if (curInner.length > 0) {
          cellChunks.push({
            html: wrapSingleCell(curInner.join('')),
            isPageBreak: false,
            tableCaption: cellChunks.length === 0 ? baseBlock.tableCaption : undefined,
          });
        }
        if (cellChunks.length > 1) return cellChunks;
      }
    }
  }

  if (bodyRows.length < 2) return [baseBlock];

  const chunks: RawBlock[] = [];
  let currentRows: string[] = [];

  for (const row of bodyRows) {
    const candidateHtml = wrapTable([...currentRows, row.outerHTML].join(''));
    const candidateH = measureSingleBlockHtml(sandbox, candidateHtml);
    if (currentRows.length > 0 && candidateH > maxHeightPx) {
      chunks.push({
        html: wrapTable(currentRows.join('')),
        isPageBreak: false,
        tableCaption: chunks.length === 0 ? baseBlock.tableCaption : undefined,
      });
      currentRows = [row.outerHTML];
    } else {
      currentRows.push(row.outerHTML);
    }
  }
  if (currentRows.length > 0) {
    chunks.push({
      html: wrapTable(currentRows.join('')),
      isPageBreak: false,
      tableCaption: chunks.length === 0 ? baseBlock.tableCaption : undefined,
    });
  }

  return chunks.length > 0 ? chunks : [baseBlock];
}

function splitOversizedList(
  el: HTMLUListElement | HTMLOListElement,
  sandbox: SandboxHandle,
  maxHeightPx: number,
  baseBlock: RawBlock
): RawBlock[] {
  const items = Array.from(el.children).filter((c) => c.tagName.toLowerCase() === 'li');
  if (items.length < 2) return [baseBlock];

  const tag = el.tagName.toLowerCase();
  const baseStart = tag === 'ol' ? Number(el.getAttribute('start')) || 1 : 1;
  const listStyle = el.getAttribute('style')
    ? ` style="${escapeHtml(el.getAttribute('style') || '')}"`
    : '';
  const wrapList = (itemsHtml: string, startOffset: number) => {
    const startAttr = tag === 'ol' && startOffset !== 1 ? ` start="${startOffset}"` : '';
    return `<${tag}${startAttr}${listStyle}>${itemsHtml}</${tag}>`;
  };

  const chunks: RawBlock[] = [];
  let currentItems: string[] = [];
  let currentStart = baseStart;

  items.forEach((li, idx) => {
    const candidateHtml = wrapList([...currentItems, li.outerHTML].join(''), currentStart);
    const candidateH = measureSingleBlockHtml(sandbox, candidateHtml);
    if (currentItems.length > 0 && candidateH > maxHeightPx) {
      chunks.push({ html: wrapList(currentItems.join(''), currentStart), isPageBreak: false });
      currentItems = [li.outerHTML];
      currentStart = baseStart + idx;
    } else {
      currentItems.push(li.outerHTML);
    }
  });
  if (currentItems.length > 0) {
    chunks.push({ html: wrapList(currentItems.join(''), currentStart), isPageBreak: false });
  }

  return chunks.length > 0 ? chunks : [baseBlock];
}

function segmentWordsAndKhmer(text: string): string[] {
  if (!text) return [];
  const IntlWithSegmenter = Intl as unknown as {
    Segmenter?: new (
      locale?: string,
      opts?: { granularity: 'grapheme' | 'word' | 'sentence' }
    ) => { segment: (input: string) => Iterable<{ segment: string }> };
  };

  const rawTokens = /\s/.test(text) ? text.split(/(\s+)/) : [text];
  const out: string[] = [];

  for (const tok of rawTokens) {
    if (!tok) continue;
    if (/^\s+$/.test(tok)) {
      out.push(tok);
      continue;
    }
    if (typeof IntlWithSegmenter.Segmenter === 'function') {
      try {
        const wordSeg = new IntlWithSegmenter.Segmenter('km', { granularity: 'word' });
        const wordParts = Array.from(wordSeg.segment(tok), (s) => s.segment);
        if (wordParts.length > 1) {
          out.push(...wordParts);
          continue;
        }
      } catch {
        // Fallback below
      }
      if (tok.length > 24) {
        try {
          const graphSeg = new IntlWithSegmenter.Segmenter(undefined, { granularity: 'grapheme' });
          out.push(...Array.from(graphSeg.segment(tok), (s) => s.segment));
          continue;
        } catch {
          // Fallback below
        }
      }
    }
    out.push(tok);
  }
  return out;
}

interface InlineTagWrapper {
  openTag: string;
  closeTag: string;
}

type SplitInlineToken =
  | { kind: 'text'; text: string; wrappers: InlineTagWrapper[] }
  | { kind: 'br' }
  | { kind: 'raw'; html: string };

function serializeOpeningTag(elem: HTMLElement): string {
  const tag = elem.tagName.toLowerCase();
  const allowedAttrs = ['style', 'class', 'href', 'target', 'rel', 'data-color'];
  const attrs: string[] = [];
  for (const attr of allowedAttrs) {
    const val = elem.getAttribute(attr);
    if (val !== null && val !== '') {
      attrs.push(`${attr}="${escapeHtml(val)}"`);
    }
  }
  return attrs.length > 0 ? `<${tag} ${attrs.join(' ')}>` : `<${tag}>`;
}

function tokenizeElementWithFormatting(root: HTMLElement): SplitInlineToken[] {
  const tokens: SplitInlineToken[] = [];
  const isPreRoot = root.tagName.toLowerCase() === 'pre';

  const walk = (node: Node, wrappers: InlineTagWrapper[]) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const raw = node.textContent || '';
      if (!raw) return;
      if (isPreRoot && raw.includes('\n')) {
        const subLines = raw.split('\n');
        subLines.forEach((linePart, idx) => {
          if (idx > 0) tokens.push({ kind: 'br' });
          if (linePart) {
            for (const unit of segmentWordsAndKhmer(linePart)) {
              tokens.push({ kind: 'text', text: unit, wrappers: [...wrappers] });
            }
          }
        });
      } else {
        for (const unit of segmentWordsAndKhmer(raw)) {
          tokens.push({ kind: 'text', text: unit, wrappers: [...wrappers] });
        }
      }
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const childEl = node as HTMLElement;
    const childTag = childEl.tagName.toLowerCase();

    if (childTag === 'br') {
      tokens.push({ kind: 'br' });
      return;
    }

    if (childTag === 'img') {
      tokens.push({ kind: 'raw', html: childEl.outerHTML });
      return;
    }

    const wrapper: InlineTagWrapper = {
      openTag: serializeOpeningTag(childEl),
      closeTag: `</${childTag}>`,
    };
    const nextWrappers = [...wrappers, wrapper];
    for (const grand of Array.from(childEl.childNodes)) {
      walk(grand, nextWrappers);
    }
  };

  for (const child of Array.from(root.childNodes)) {
    walk(child, []);
  }
  return tokens;
}

function renderInlineTokensToHtml(tokens: SplitInlineToken[]): string {
  let out = '';
  let activeStack: InlineTagWrapper[] = [];

  const closeToDepth = (depth: number) => {
    while (activeStack.length > depth) {
      const popped = activeStack.pop()!;
      out += popped.closeTag;
    }
  };

  for (const tok of tokens) {
    if (tok.kind === 'br') {
      closeToDepth(0);
      out += '<br />';
      continue;
    }
    if (tok.kind === 'raw') {
      closeToDepth(0);
      out += tok.html;
      continue;
    }

    let common = 0;
    while (
      common < activeStack.length &&
      common < tok.wrappers.length &&
      activeStack[common].openTag === tok.wrappers[common].openTag
    ) {
      common++;
    }
    closeToDepth(common);
    while (activeStack.length < tok.wrappers.length) {
      const nextWrap = tok.wrappers[activeStack.length];
      out += nextWrap.openTag;
      activeStack.push(nextWrap);
    }
    out += escapeHtml(tok.text);
  }

  closeToDepth(0);
  return out;
}

function splitOversizedTextBlock(
  el: HTMLElement,
  sandbox: SandboxHandle,
  maxHeightPx: number,
  baseBlock: RawBlock
): RawBlock[] {
  const rawText = (el.textContent || '').trim();
  const hasBr = el.querySelector('br') !== null;
  if (!rawText && !hasBr) return [baseBlock];

  const tag = el.tagName.toLowerCase();
  const safeTag = ['p', 'blockquote', 'pre', 'div', 'h1', 'h2', 'h3'].includes(tag) ? tag : 'p';
  const styleAttr = el.getAttribute('style')
    ? ` style="${escapeHtml(el.getAttribute('style') || '')}"`
    : '';
  const classAttr = el.className ? ` class="${escapeHtml(el.className)}"` : '';
  const wrapHtml = (innerHtml: string) => `<${safeTag}${classAttr}${styleAttr}>${innerHtml}</${safeTag}>`;

  const allTokens = tokenizeElementWithFormatting(el);
  if (allTokens.length === 0) return [baseBlock];

  // Expand ultra-long single word tokens if needed, and binary-search exact slices cleanly
  const tokens: SplitInlineToken[] = [...allTokens];
  const chunks: RawBlock[] = [];
  let cursor = 0;

  while (cursor < tokens.length) {
    // Skip leading empty whitespace text tokens at page start unless inside <pre>
    if (safeTag !== 'pre') {
      while (
        cursor < tokens.length &&
        tokens[cursor].kind === 'text' &&
        /^\s+$/.test((tokens[cursor] as Extract<SplitInlineToken, { kind: 'text' }>).text)
      ) {
        cursor++;
      }
      if (cursor >= tokens.length) break;
    }

    // If single text token exceeds maxHeightPx, split it into grapheme tokens
    const firstTok = tokens[cursor];
    if (firstTok.kind === 'text' && firstTok.text.length > 1) {
      const singleHtml = wrapHtml(renderInlineTokensToHtml([firstTok]));
      if (measureSingleBlockHtml(sandbox, singleHtml) > maxHeightPx) {
        const graphemes = Array.from(firstTok.text).map((g) => ({
          kind: 'text' as const,
          text: g,
          wrappers: firstTok.wrappers,
        }));
        tokens.splice(cursor, 1, ...graphemes);
      }
    }

    let lo = 1;
    let hi = tokens.length - cursor;
    let best = 1;

    // Exponential upper-bound probe
    let probe = 1;
    while (probe < hi) {
      const candidateInner = renderInlineTokensToHtml(tokens.slice(cursor, cursor + probe));
      const candidateH = candidateInner
        ? measureSingleBlockHtml(sandbox, wrapHtml(candidateInner))
        : 0;
      if (candidateH <= maxHeightPx) {
        best = probe;
        lo = probe + 1;
        probe = Math.min(hi, probe * 2);
      } else {
        hi = probe - 1;
        break;
      }
    }

    // Binary search between lo and hi
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const candidateInner = renderInlineTokensToHtml(tokens.slice(cursor, cursor + mid));
      const candidateH = candidateInner
        ? measureSingleBlockHtml(sandbox, wrapHtml(candidateInner))
        : 0;
      if (candidateH <= maxHeightPx) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    const sliceTokens = tokens.slice(cursor, cursor + best);
    const sliceInner = renderInlineTokensToHtml(sliceTokens);
    if (sliceInner) {
      chunks.push({ html: wrapHtml(sliceInner), isPageBreak: false });
    }
    cursor += Math.max(1, best);
  }

  return chunks.length > 0 ? chunks : [baseBlock];
}

function measureAndSplitOversizedBlocks(
  rawBlocks: RawBlock[],
  sandbox: SandboxHandle | null,
  contentHeightPx: number
): { blocks: RawBlock[]; heights: number[] } {
  if (!sandbox) {
    return {
      blocks: rawBlocks,
      heights: rawBlocks.map((b) => (b.isPageBreak ? 0 : Math.max(28, Math.ceil(b.html.length / 80) * 22))),
    };
  }

  const finalBlocks: RawBlock[] = [];
  const finalHeights: number[] = [];

  for (const block of rawBlocks) {
    if (block.isPageBreak || block.isPdfPage) {
      finalBlocks.push(block);
      finalHeights.push(0);
      continue;
    }

    const h = measureSingleBlockHtml(sandbox, block.html);
    if (h <= contentHeightPx) {
      finalBlocks.push(block);
      finalHeights.push(h);
      continue;
    }

    const wrapper = document.createElement('div');
    wrapper.innerHTML = block.html;
    const el = wrapper.firstElementChild as HTMLElement | null;
    if (!el) {
      finalBlocks.push(block);
      finalHeights.push(h);
      continue;
    }

    const tag = el.tagName.toLowerCase();
    let splitParts: RawBlock[] = [block];
    if (tag === 'table') {
      splitParts = splitOversizedTable(
        el as HTMLTableElement,
        sandbox,
        contentHeightPx,
        block
      );
    } else if (tag === 'ul' || tag === 'ol') {
      splitParts = splitOversizedList(
        el as HTMLUListElement | HTMLOListElement,
        sandbox,
        contentHeightPx,
        block
      );
    } else if (!el.querySelector('img')) {
      splitParts = splitOversizedTextBlock(
        el,
        sandbox,
        contentHeightPx,
        block
      );
    }

    for (const part of splitParts) {
      finalBlocks.push(part);
      finalHeights.push(measureSingleBlockHtml(sandbox, part.html));
    }
  }

  return { blocks: finalBlocks, heights: finalHeights };
}

function resolveHeaderFooterTokens(
  template: string,
  tokens: { title: string; org: string; page: string; total: string }
): string {
  if (!template) return '';
  return template
    .replace(/\{title\}/gi, tokens.title)
    .replace(/\{org\}/gi, tokens.org)
    .replace(/\{page\}/gi, tokens.page)
    .replace(/\{total\}/gi, tokens.total);
}

function buildTocHtml(
  tocTitle: string,
  tocStyle: 'classic' | 'modern' | 'academic',
  tocEntries: TocEntry[],
  tableEntries: AssetListEntry[],
  figureEntries: AssetListEntry[],
  includeTables: boolean,
  includeFigures: boolean,
  isKhmerOutput: boolean
): string {
  const borderClass =
    tocStyle === 'modern'
      ? 'border-bottom: 1px solid #e2e8f0; padding: 6px 0;'
      : 'border-bottom: 1px dotted #cbd5e1; padding: 5px 0;';

  const rows = tocEntries
    .map((entry) => {
      const indent = (entry.level - 1) * 18;
      const weight = entry.level === 1 ? '600' : '400';
      return `<div data-toc-page="${entry.pageIndex}" style="display:flex; justify-content:space-between; align-items:baseline; margin-left:${indent}px; font-weight:${weight}; ${borderClass} cursor:pointer;">
        <span>${escapeHtml(entry.text)}</span>
        <span style="font-variant-numeric:tabular-nums; color:#475569; margin-left:12px;">${escapeHtml(entry.pageLabel)}</span>
      </div>`;
    })
    .join('\n');

  let extra = '';
  if (includeTables && tableEntries.length > 0) {
    const tRows = tableEntries
      .map(
        (t) =>
          `<div data-toc-page="${t.pageIndex}" style="display:flex; justify-content:space-between; ${borderClass} cursor:pointer;">
            <span>${escapeHtml(t.label)}</span>
            <span style="font-variant-numeric:tabular-nums; color:#475569;">${escapeHtml(t.pageLabel)}</span>
          </div>`
      )
      .join('\n');
    extra += `<h2 style="margin-top:20px;">${isKhmerOutput ? 'បញ្ជីតារាង (List of Tables)' : 'List of Tables'}</h2>${tRows}`;
  }
  if (includeFigures && figureEntries.length > 0) {
    const fRows = figureEntries
      .map(
        (f) =>
          `<div data-toc-page="${f.pageIndex}" style="display:flex; justify-content:space-between; ${borderClass} cursor:pointer;">
            <span>${escapeHtml(f.label)}</span>
            <span style="font-variant-numeric:tabular-nums; color:#475569;">${escapeHtml(f.pageLabel)}</span>
          </div>`
      )
      .join('\n');
    extra += `<h2 style="margin-top:20px;">${isKhmerOutput ? 'បញ្ជីរូបភាព (List of Figures)' : 'List of Figures'}</h2>${fRows}`;
  }

  return `
    <div class="dm-toc-block">
      <h1 style="margin-top:0;">${escapeHtml(tocTitle)}</h1>
      ${rows || `<p style="color:#64748b;">${isKhmerOutput ? 'មិនទាន់មានចំណងជើង H1–H3 ក្នុងឯកសារដែលបានជ្រើសនៅឡើយទេ។' : 'No Heading 1–3 elements found in selected documents.'}</p>`}
      ${extra}
    </div>
  `;
}

export function compileProjectDocuments(
  project: Project,
  documents: ProjectDocument[],
  uiLanguage: Language = 'en'
): CompilationResult {
  const selectedDocs = documents
    .filter((d) => d.selected)
    .sort((a, b) => a.order - b.order);

  const { widthMm, heightMm } = getEffectivePaperMm(project.pageSetup);
  const pageWidthPx = mmToPx(widthMm);
  const pageHeightPx = mmToPx(heightMm);
  const marginTopPx = mmToPx(project.pageSetup.marginTopMm);
  const marginBottomPx = mmToPx(project.pageSetup.marginBottomMm);
  const marginLeftPx = mmToPx(project.pageSetup.marginLeftMm);
  const marginRightPx = mmToPx(project.pageSetup.marginRightMm);

  const headerReservePx = 48;
  const footerReservePx = 48;
  const contentWidthPx = Math.max(220, pageWidthPx - marginLeftPx - marginRightPx);
  const contentHeightPx = Math.max(240, pageHeightPx - marginTopPx - marginBottomPx - headerReservePx - footerReservePx);
  const maxImgHeightPx = Math.max(140, contentHeightPx - 64);

  interface DraftPage {
    docId: string;
    docTitle: string;
    sourceType: ProjectDocument['sourceType'];
    isCoverPage: boolean;
    isTocPage: boolean;
    sectionIndex: number;
    restartNumberingHere: boolean;
    sectionHeaderOverride?: string;
    sectionFooterOverride?: string;
    html: string;
    signatureText?: string;
    pdfDocId?: string;
    pdfPageNumber?: number;
    pdfPageWidthPt?: number;
    pdfPageHeightPt?: number;
    headings: Array<{ level: 1 | 2 | 3; text: string }>;
    tables: string[];
    figures: string[];
  }

  const draftPages: DraftPage[] = [];
  let sectionCounter = 0;

  const sandbox =
    typeof document !== 'undefined'
      ? createMeasurementSandbox(contentWidthPx, maxImgHeightPx, project.pageSetup)
      : null;

  try {
    selectedDocs.forEach((docItem, docIdx) => {
      if (docItem.sourceType === 'section-break') {
        sectionCounter++;
        return;
      }

      if (docItem.sourceType === 'blank') {
        draftPages.push({
          docId: docItem.id,
          docTitle: docItem.title,
          sourceType: 'blank',
          isCoverPage: false,
          isTocPage: false,
          sectionIndex: sectionCounter,
          restartNumberingHere: docItem.sectionRestartNumbering,
          sectionHeaderOverride: docItem.sectionHeaderOverride,
          sectionFooterOverride: docItem.sectionFooterOverride,
          html: '<div style="min-height:120px;"></div>',
          headings: [],
          tables: [],
          figures: [],
        });
        return;
      }

      if (docIdx > 0 && docItem.sectionRestartNumbering) {
        sectionCounter++;
      }

      const rawBlocks = splitHtmlIntoBlocks(docItem.contentHtml);
      const hasOnlyPdfPages = rawBlocks.length > 0 && rawBlocks.every((b) => b.isPdfPage);

      if (hasOnlyPdfPages) {
        rawBlocks.forEach((block, bIdx) => {
          const isFirst = bIdx === 0;
          const isLast = bIdx === rawBlocks.length - 1;
          draftPages.push({
            docId: docItem.id,
            docTitle: docItem.title,
            sourceType: docItem.sourceType,
            isCoverPage: docIdx === 0 && project.numberingConfig.excludeCoverPage && isFirst,
            isTocPage: false,
            sectionIndex: sectionCounter,
            restartNumberingHere: isFirst && docItem.sectionRestartNumbering,
            sectionHeaderOverride: docItem.sectionHeaderOverride,
            sectionFooterOverride: docItem.sectionFooterOverride,
            html: '',
            signatureText: isLast ? docItem.signatureText : undefined,
            pdfDocId: docItem.id,
            pdfPageNumber: block.pdfPageNumber || bIdx + 1,
            pdfPageWidthPt: block.pdfWidthPt,
            pdfPageHeightPt: block.pdfHeightPt,
            headings: [],
            tables: [],
            figures: [],
          });
        });
        return;
      }

      const { blocks, heights } = measureAndSplitOversizedBlocks(
        rawBlocks,
        sandbox,
        contentHeightPx
      );

      let currentHtmlParts: string[] = [];
      let currentHeight = 0;
      let currentHeadings: Array<{ level: 1 | 2 | 3; text: string }> = [];
      let currentTables: string[] = [];
      let currentFigures: string[] = [];
      let isFirstPageOfDoc = true;

      const flushPage = (isLastOfDoc = false) => {
        draftPages.push({
          docId: docItem.id,
          docTitle: docItem.title,
          sourceType: docItem.sourceType,
          isCoverPage: docIdx === 0 && project.numberingConfig.excludeCoverPage && isFirstPageOfDoc,
          isTocPage: false,
          sectionIndex: sectionCounter,
          restartNumberingHere: isFirstPageOfDoc && docItem.sectionRestartNumbering,
          sectionHeaderOverride: docItem.sectionHeaderOverride,
          sectionFooterOverride: docItem.sectionFooterOverride,
          html: currentHtmlParts.join('\n') || '<p></p>',
          signatureText: isLastOfDoc ? docItem.signatureText : undefined,
          headings: currentHeadings,
          tables: currentTables,
          figures: currentFigures,
        });
        isFirstPageOfDoc = false;
        currentHtmlParts = [];
        currentHeight = 0;
        currentHeadings = [];
        currentTables = [];
        currentFigures = [];
      };

      blocks.forEach((block, bIdx) => {
        if (block.isPageBreak) {
          flushPage(false);
          return;
        }

        if (block.isPdfPage) {
          if (currentHtmlParts.length > 0) flushPage(false);
          draftPages.push({
            docId: docItem.id,
            docTitle: docItem.title,
            sourceType: docItem.sourceType,
            isCoverPage: docIdx === 0 && project.numberingConfig.excludeCoverPage && isFirstPageOfDoc,
            isTocPage: false,
            sectionIndex: sectionCounter,
            restartNumberingHere: isFirstPageOfDoc && docItem.sectionRestartNumbering,
            sectionHeaderOverride: docItem.sectionHeaderOverride,
            sectionFooterOverride: docItem.sectionFooterOverride,
            html: '',
            pdfDocId: docItem.id,
            pdfPageNumber: block.pdfPageNumber || 1,
            pdfPageWidthPt: block.pdfWidthPt,
            pdfPageHeightPt: block.pdfHeightPt,
            headings: [],
            tables: [],
            figures: [],
          });
          isFirstPageOfDoc = false;
          return;
        }

        const h = heights[bIdx] || 28;
        if (currentHtmlParts.length > 0) {
          if (sandbox && currentHeight + h > contentHeightPx * 0.85) {
            const combinedH = measureSingleBlockHtml(
              sandbox,
              [...currentHtmlParts, block.html].join('\n')
            );
            if (combinedH > contentHeightPx) {
              flushPage(false);
            } else {
              currentHeight = combinedH - h;
            }
          } else if (currentHeight + h > contentHeightPx) {
            flushPage(false);
          }
        }

        currentHtmlParts.push(block.html);
        currentHeight += h;
        if (block.headingLevel && block.headingText) {
          currentHeadings.push({ level: block.headingLevel, text: block.headingText });
        }
        if (block.tableCaption) currentTables.push(block.tableCaption);
        if (block.figureCaption) currentFigures.push(block.figureCaption);
      });

      if (docItem.signatureText && currentHtmlParts.length > 0) {
        const finalH = sandbox
          ? measureSingleBlockHtml(sandbox, currentHtmlParts.join('\n'))
          : currentHeight;
        if (finalH + 92 > contentHeightPx) {
          flushPage(false);
        }
      }

      flushPage(true);
    });
  } finally {
    if (sandbox && sandbox.outer.parentNode) {
      sandbox.outer.parentNode.removeChild(sandbox.outer);
    }
  }

  const hasTocTargets = draftPages.some(
    (p) => p.headings.length > 0 || p.tables.length > 0 || p.figures.length > 0
  );
  const insertTocIndex =
    project.tocConfig.enabled && hasTocTargets
      ? project.numberingConfig.excludeCoverPage && draftPages.length > 0
        ? 1
        : 0
      : -1;

  if (insertTocIndex >= 0) {
    draftPages.splice(insertTocIndex, 0, {
      docId: 'auto_toc',
      docTitle: project.tocConfig.title || 'Table of Contents',
      sourceType: 'editor',
      isCoverPage: false,
      isTocPage: true,
      sectionIndex: 0,
      restartNumberingHere: false,
      html: '',
      headings: [],
      tables: [],
      figures: [],
    });
  }

  const numCfg = project.numberingConfig;
  const hf = project.headerFooterConfig;
  const isKhmerNumbering = numCfg.format === 'km' || numCfg.format === 'km-alpha';
  const useKhmerPageText = uiLanguage === 'km' || isKhmerNumbering;
  const totalNumberedPages = draftPages.filter((p) => !p.isCoverPage).length || draftPages.length;
  const totalFormatted = formatNumberValue(totalNumberedPages, numCfg.format);
  let runningNum = (numCfg.startPage || 1) - 1;
  let lastSectionIdx = -1;

  const pageNumbers = draftPages.map((page, idx) => {
    const override = numCfg.pageOverrides?.[String(idx)];
    if (page.isCoverPage) {
      return { val: null as number | null, formatted: '', shortLabel: '', override };
    }
    if (
      (numCfg.restartPerSection && page.sectionIndex !== lastSectionIdx && lastSectionIdx !== -1) ||
      page.restartNumberingHere
    ) {
      runningNum = (numCfg.startPage || 1) - 1;
    }
    lastSectionIdx = page.sectionIndex;
    runningNum++;

    const baseNum = formatNumberValue(runningNum, numCfg.format);
    if (!numCfg.enabled || override?.hidden) {
      return { val: runningNum, formatted: '', shortLabel: baseNum, override };
    }

    const basePattern =
      numCfg.displayPattern === 'page-x-of-y'
        ? useKhmerPageText
          ? `ទំព័រ ${baseNum} នៃ ${totalFormatted}`
          : `Page ${baseNum} of ${totalFormatted}`
        : baseNum;

    const rawPrefix = override?.prefixText !== undefined ? override.prefixText : numCfg.prefixText || '';
    const rawSuffix = override?.suffixText !== undefined ? override.suffixText : numCfg.suffixText || '';
    const numTokens = {
      title: page.docTitle || project.title,
      org: hf.organizationName || project.title,
      page: baseNum,
      total: totalFormatted,
    };
    const resolvedPrefix = resolveHeaderFooterTokens(rawPrefix, numTokens);
    const resolvedSuffix = resolveHeaderFooterTokens(rawSuffix, numTokens);
    const formatted = `${resolvedPrefix}${basePattern}${resolvedSuffix}`;

    return { val: runningNum, formatted, shortLabel: baseNum, override, idx };
  });

  const tocEntries: TocEntry[] = [];
  const tableEntries: AssetListEntry[] = [];
  const figureEntries: AssetListEntry[] = [];

  draftPages.forEach((page, pIdx) => {
    if (page.isTocPage) return;
    const pNumLabel =
      pageNumbers[pIdx]?.shortLabel || formatNumberValue(pIdx + 1, numCfg.format);

    page.headings.forEach((h, hIdx) => {
      if (
        (h.level === 1 && project.tocConfig.includeH1) ||
        (h.level === 2 && project.tocConfig.includeH2) ||
        (h.level === 3 && project.tocConfig.includeH3)
      ) {
        tocEntries.push({
          id: `toc_${pIdx}_${hIdx}`,
          docId: page.docId,
          level: h.level,
          text: h.text,
          pageLabel: pNumLabel,
          pageIndex: pIdx,
        });
      }
    });

    page.tables.forEach((tLabel, tIdx) => {
      tableEntries.push({
        id: `tbl_${pIdx}_${tIdx}`,
        docId: page.docId,
        kind: 'table',
        label: tLabel,
        pageLabel: pNumLabel,
        pageIndex: pIdx,
      });
    });

    page.figures.forEach((fLabel, fIdx) => {
      figureEntries.push({
        id: `fig_${pIdx}_${fIdx}`,
        docId: page.docId,
        kind: 'figure',
        label: fLabel,
        pageLabel: pNumLabel,
        pageIndex: pIdx,
      });
    });
  });

  if (insertTocIndex >= 0 && draftPages[insertTocIndex]) {
    draftPages[insertTocIndex].html = buildTocHtml(
      project.tocConfig.title || 'Table of Contents',
      project.tocConfig.style,
      tocEntries,
      tableEntries,
      figureEntries,
      project.tocConfig.includeTables,
      project.tocConfig.includeFigures,
      useKhmerPageText
    );
  }

  const compiledPages: CompiledPage[] = draftPages.map((page, pIdx) => {
    const pInfo = pageNumbers[pIdx];
    const ov = pInfo.override;
    const isFirstOverall = pIdx === 0;
    const isEvenPage = (pIdx + 1) % 2 === 0;

    const tokenMap = {
      title: page.docTitle || project.title,
      org: hf.organizationName || project.title,
      page: pInfo.shortLabel || pInfo.formatted || '',
      total: totalFormatted,
    };

    let hLeft = hf.headerEnabled ? resolveHeaderFooterTokens(hf.headerLeft, tokenMap) : '';
    let hCenter = hf.headerEnabled ? resolveHeaderFooterTokens(hf.headerCenter, tokenMap) : '';
    let hRight = hf.headerEnabled ? resolveHeaderFooterTokens(hf.headerRight, tokenMap) : '';

    let fLeft = hf.footerEnabled ? resolveHeaderFooterTokens(hf.footerLeft, tokenMap) : '';
    let fCenter = hf.footerEnabled ? resolveHeaderFooterTokens(hf.footerCenter, tokenMap) : '';
    let fRight = hf.footerEnabled ? resolveHeaderFooterTokens(hf.footerRight, tokenMap) : '';

    if (hf.differentFirstPage && isFirstOverall) {
      hLeft = '';
      hCenter = hf.headerEnabled ? resolveHeaderFooterTokens(hf.firstPageHeader, tokenMap) : '';
      hRight = '';
      fLeft = '';
      fCenter = hf.footerEnabled ? resolveHeaderFooterTokens(hf.firstPageFooter, tokenMap) : '';
      fRight = '';
    } else if (hf.differentOddEven && isEvenPage) {
      hCenter = hf.headerEnabled ? resolveHeaderFooterTokens(hf.evenHeaderCenter, tokenMap) : hCenter;
      fCenter = hf.footerEnabled ? resolveHeaderFooterTokens(hf.evenFooterCenter, tokenMap) : fCenter;
    }

    if (page.sectionHeaderOverride) {
      hCenter = resolveHeaderFooterTokens(page.sectionHeaderOverride, tokenMap);
    }
    if (page.sectionFooterOverride) {
      fCenter = resolveHeaderFooterTokens(page.sectionFooterOverride, tokenMap);
    }

    const hasOverride = Boolean(
      ov &&
        ((ov.position && ov.position !== numCfg.position) ||
          (ov.offsetXPx ?? 0) !== 0 ||
          (ov.offsetYPx ?? 0) !== 0 ||
          ov.hidden ||
          ov.prefixText !== undefined ||
          ov.suffixText !== undefined)
    );

    return {
      pageIndex: pIdx,
      docId: page.docId,
      docTitle: page.docTitle,
      sourceType: page.sourceType,
      isCoverPage: page.isCoverPage,
      isTocPage: page.isTocPage,
      sectionIndex: page.sectionIndex,
      pageNumberValue: pInfo.val,
      pageNumberFormatted: pInfo.formatted,
      numberPosition: ov?.position || numCfg.position,
      numberOffsetXPx: ov?.offsetXPx || 0,
      numberOffsetYPx: ov?.offsetYPx || 0,
      numberHidden: Boolean(ov?.hidden),
      numberHasOverride: hasOverride,
      headerLeft: hLeft,
      headerCenter: hCenter,
      headerRight: hRight,
      footerLeft: fLeft,
      footerCenter: fCenter,
      footerRight: fRight,
      html: page.html,
      signatureText: page.signatureText,
      pdfDocId: page.pdfDocId,
      pdfPageNumber: page.pdfPageNumber,
      pdfPageWidthPt: page.pdfPageWidthPt,
      pdfPageHeightPt: page.pdfPageHeightPt,
    };
  });

  return {
    pages: compiledPages,
    tocEntries,
    tableEntries,
    figureEntries,
    totalPages: compiledPages.length,
  };
}
