import { CompiledPage, PageNumberOverride } from '@/types/document';

export function shiftPageNumberOverrides(
  overrides: Record<string, PageNumberOverride> | undefined,
  pivotIndex: number,
  delta: 1 | -1
): Record<string, PageNumberOverride> {
  const result: Record<string, PageNumberOverride> = {};
  if (!overrides) return result;

  for (const [key, val] of Object.entries(overrides)) {
    if (!/^\d+$/.test(key)) continue;
    const idx = Number(key);
    if (!Number.isFinite(idx) || idx < 0) continue;

    if (delta === -1) {
      if (idx === pivotIndex) continue;
      const nextIdx = idx > pivotIndex ? idx - 1 : idx;
      result[String(nextIdx)] = { ...val };
    } else {
      const nextIdx = idx >= pivotIndex ? idx + 1 : idx;
      result[String(nextIdx)] = { ...val };
    }
  }

  return result;
}

export function extractPlainTextFromHtml(html: string): string {
  if (typeof document === 'undefined') {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const container = document.createElement('div');
  container.innerHTML = html || '';
  return (container.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

export function splitPdfMarkersAroundLocalIndex(
  contentHtml: string,
  splitAfterLocalIdx: number
): {
  beforeHtml: string;
  beforeCount: number;
  afterHtml: string;
  afterCount: number;
} | null {
  if (typeof document === 'undefined') return null;
  const container = document.createElement('div');
  container.innerHTML = contentHtml || '';
  const markers = Array.from(container.querySelectorAll('.dm-pdf-page-marker'));
  if (markers.length < 2) return null;

  const clampedSplit = Math.max(0, Math.min(markers.length - 2, splitAfterLocalIdx));
  const beforeMarkers = markers.slice(0, clampedSplit + 1);
  const afterMarkers = markers.slice(clampedSplit + 1);

  return {
    beforeHtml: beforeMarkers.map((el) => el.outerHTML).join('\n'),
    beforeCount: beforeMarkers.length,
    afterHtml: afterMarkers.map((el) => el.outerHTML).join('\n'),
    afterCount: afterMarkers.length,
  };
}

export function removePdfMarkerAtLocalIndex(
  contentHtml: string,
  localIdx: number,
  expectedPdfPageNumber?: number
): { html: string; remainingCount: number } | null {
  if (typeof document === 'undefined') return null;
  const container = document.createElement('div');
  container.innerHTML = contentHtml || '';
  const markers = Array.from(container.querySelectorAll('.dm-pdf-page-marker'));
  if (markers.length === 0) return null;

  let removeIdx = localIdx;
  if (
    expectedPdfPageNumber !== undefined &&
    Number(markers[removeIdx]?.getAttribute('data-pdf-page')) !== expectedPdfPageNumber
  ) {
    const matchedIdx = markers.findIndex(
      (el) => Number(el.getAttribute('data-pdf-page')) === expectedPdfPageNumber
    );
    if (matchedIdx >= 0) {
      removeIdx = matchedIdx;
    }
  }

  if (removeIdx < 0 || removeIdx >= markers.length) return null;

  const remaining = markers.filter((_, i) => i !== removeIdx);
  return {
    html: remaining.map((el) => el.outerHTML).join('\n'),
    remainingCount: remaining.length,
  };
}

function normalizePageHtmlChunk(html: string): string {
  const trimmed = (html || '').trim();
  return trimmed || '<p></p>';
}

export function splitHtmlPagesAroundLocalIndex(
  docPages: CompiledPage[],
  splitAfterLocalIdx: number
): {
  beforeHtml: string;
  beforePlain: string;
  beforeCount: number;
  afterHtml: string;
  afterPlain: string;
  afterCount: number;
} {
  const clampedSplit = Math.max(0, Math.min(docPages.length - 2, splitAfterLocalIdx));
  const beforePages = docPages.slice(0, clampedSplit + 1);
  const afterPages = docPages.slice(clampedSplit + 1);

  const beforeHtml = beforePages
    .map((p) => normalizePageHtmlChunk(p.html))
    .join('\n<hr class="page-break-marker" />\n');
  const afterHtml = afterPages
    .map((p) => normalizePageHtmlChunk(p.html))
    .join('\n<hr class="page-break-marker" />\n');

  return {
    beforeHtml,
    beforePlain: extractPlainTextFromHtml(beforeHtml),
    beforeCount: beforePages.length,
    afterHtml,
    afterPlain: extractPlainTextFromHtml(afterHtml),
    afterCount: afterPages.length,
  };
}

export function removeHtmlPageAtLocalIndex(
  docPages: CompiledPage[],
  removeLocalIdx: number
): {
  html: string;
  plainText: string;
  remainingCount: number;
} {
  const remaining = docPages.filter((_, idx) => idx !== removeLocalIdx);
  const html =
    remaining.length === 0
      ? '<p></p>'
      : remaining
          .map((p) => normalizePageHtmlChunk(p.html))
          .join('\n<hr class="page-break-marker" />\n');

  return {
    html,
    plainText: extractPlainTextFromHtml(html),
    remainingCount: remaining.length,
  };
}

export function reorderPageNumberOverrides(
  overrides: Record<string, PageNumberOverride> | undefined,
  fromIndex: number,
  toIndex: number
): Record<string, PageNumberOverride> {
  const result: Record<string, PageNumberOverride> = {};
  if (!overrides) return result;
  if (fromIndex === toIndex) {
    for (const [k, v] of Object.entries(overrides)) {
      if (/^\d+$/.test(k)) result[k] = { ...v };
    }
    return result;
  }

  for (const [key, val] of Object.entries(overrides)) {
    if (!/^\d+$/.test(key)) continue;
    const idx = Number(key);
    if (!Number.isFinite(idx) || idx < 0) continue;

    let nextIdx = idx;
    if (idx === fromIndex) {
      nextIdx = toIndex;
    } else if (fromIndex < toIndex) {
      if (idx > fromIndex && idx <= toIndex) nextIdx = idx - 1;
    } else {
      if (idx >= toIndex && idx < fromIndex) nextIdx = idx + 1;
    }
    result[String(nextIdx)] = { ...val };
  }

  return result;
}

export function reorderPdfMarkers(
  contentHtml: string,
  fromLocalIdx: number,
  toLocalIdx: number
): { html: string; count: number } | null {
  if (typeof document === 'undefined') return null;
  const container = document.createElement('div');
  container.innerHTML = contentHtml || '';
  const markers = Array.from(container.querySelectorAll('.dm-pdf-page-marker'));
  if (
    fromLocalIdx < 0 ||
    fromLocalIdx >= markers.length ||
    toLocalIdx < 0 ||
    toLocalIdx >= markers.length ||
    fromLocalIdx === toLocalIdx
  ) {
    return null;
  }

  const reordered = [...markers];
  const [moved] = reordered.splice(fromLocalIdx, 1);
  reordered.splice(toLocalIdx, 0, moved);

  return {
    html: reordered.map((el) => el.outerHTML).join('\n'),
    count: reordered.length,
  };
}

export function extractSinglePdfMarker(
  contentHtml: string,
  localIdx: number,
  expectedPdfPageNumber?: number
): {
  extractedHtml: string;
  remainingHtml: string;
  remainingCount: number;
} | null {
  if (typeof document === 'undefined') return null;
  const container = document.createElement('div');
  container.innerHTML = contentHtml || '';
  const markers = Array.from(container.querySelectorAll('.dm-pdf-page-marker'));
  if (markers.length === 0) return null;

  let targetIdx = localIdx;
  if (
    expectedPdfPageNumber !== undefined &&
    Number(markers[targetIdx]?.getAttribute('data-pdf-page')) !== expectedPdfPageNumber
  ) {
    const matchedIdx = markers.findIndex(
      (el) => Number(el.getAttribute('data-pdf-page')) === expectedPdfPageNumber
    );
    if (matchedIdx >= 0) targetIdx = matchedIdx;
  }

  if (targetIdx < 0 || targetIdx >= markers.length) return null;
  const extracted = markers[targetIdx];
  const remaining = markers.filter((_, i) => i !== targetIdx);

  return {
    extractedHtml: extracted.outerHTML,
    remainingHtml: remaining.map((el) => el.outerHTML).join('\n'),
    remainingCount: remaining.length,
  };
}

export function reorderHtmlPages(
  docPages: CompiledPage[],
  fromLocalIdx: number,
  toLocalIdx: number
): { html: string; plainText: string } {
  const reordered = [...docPages];
  if (
    fromLocalIdx >= 0 &&
    fromLocalIdx < reordered.length &&
    toLocalIdx >= 0 &&
    toLocalIdx < reordered.length &&
    fromLocalIdx !== toLocalIdx
  ) {
    const [moved] = reordered.splice(fromLocalIdx, 1);
    reordered.splice(toLocalIdx, 0, moved);
  }
  const html =
    reordered.length === 0
      ? '<p></p>'
      : reordered
          .map((p) => normalizePageHtmlChunk(p.html))
          .join('\n<hr class="page-break-marker" />\n');

  return {
    html,
    plainText: extractPlainTextFromHtml(html),
  };
}

export function extractSingleHtmlPage(
  docPages: CompiledPage[],
  localIdx: number
): {
  extractedHtml: string;
  extractedPlain: string;
  remainingHtml: string;
  remainingPlain: string;
  remainingCount: number;
} {
  const target = docPages[localIdx];
  const extractedHtml = normalizePageHtmlChunk(target?.html || '<p></p>');
  const remaining = docPages.filter((_, i) => i !== localIdx);
  const remainingHtml =
    remaining.length === 0
      ? '<p></p>'
      : remaining
          .map((p) => normalizePageHtmlChunk(p.html))
          .join('\n<hr class="page-break-marker" />\n');

  return {
    extractedHtml,
    extractedPlain: extractPlainTextFromHtml(extractedHtml),
    remainingHtml,
    remainingPlain: extractPlainTextFromHtml(remainingHtml),
    remainingCount: remaining.length,
  };
}

