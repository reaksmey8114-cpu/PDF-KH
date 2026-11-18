import JSZip from 'jszip';
import mammoth from 'mammoth';
import { PDFDocument } from 'pdf-lib';
import { DocumentSourceType } from '@/types/document';
import { saveBinaryRecord } from '@/lib/local-binary-store';
import {
  convertDocxZipToHtml,
  convertEpubZipToHtml,
  convertGenericXmlToHtml,
  convertOdpZipToHtml,
  convertOdsZipToHtml,
  convertOdtZipToHtml,
  convertPptxZipToHtml,
  convertWordXmlToHtml,
  convertXlsxZipToHtml,
  csvOrTsvToHtml,
  decodeWin1252Byte,
  escapeHtml,
  extractFormattedHtmlBody,
  hasMeaningfulHtmlContent,
  legacyDocTextToHtml,
  markdownToHtml,
  parseRtfToHtml,
  plainTextToPreservedHtml,
} from '@/lib/format-parsers';

export interface ImportedDocumentResult {
  title: string;
  sourceType: DocumentSourceType;
  contentHtml: string;
  plainText: string;
  pageCountEstimate: number;
  needsOcrHint?: boolean;
  binaryBytes?: ArrayBuffer;
  mimeType: string;
  fileName: string;
  thumbnailDataUrl?: string;
  pageDataUrls?: string[];
  pageSizesPt?: Array<{ widthPt: number; heightPt: number }>;
  extractedTextPages?: string[];
}

const MAX_STORAGE_HTML_BYTES = 560000;
const MAX_STORAGE_PLAIN_BYTES = 180000;
const MAX_SINGLE_IMAGE_DATA_URL_BYTES = 360000;

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();

function utf8ByteLength(str: string): number {
  return utf8Encoder.encode(str).byteLength;
}

function clampUtf8(str: string, maxBytes: number): string {
  const encoded = utf8Encoder.encode(str);
  if (encoded.byteLength <= maxBytes) return str;
  return utf8Decoder.decode(encoded.slice(0, maxBytes)).replace(/\uFFFD+$/g, '');
}

function decodeTextBufferAuto(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (bytes.length === 0) return '';

  // UTF-8 BOM
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(3));
  }
  // UTF-16LE BOM
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le', { fatal: false }).decode(bytes.subarray(2));
  }
  // UTF-16BE BOM
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    try {
      return new TextDecoder('utf-16be', { fatal: false }).decode(bytes.subarray(2));
    } catch {
      const body = bytes.subarray(2);
      const swapped = new Uint8Array(body.length - (body.length % 2));
      for (let i = 0; i + 1 < body.length; i += 2) {
        swapped[i] = body[i + 1];
        swapped[i + 1] = body[i];
      }
      return new TextDecoder('utf-16le', { fatal: false }).decode(swapped);
    }
  }

  // BOM-less UTF-16LE heuristic (high ratio of NUL bytes at odd positions)
  const sampleLen = Math.min(bytes.length, 512);
  if (sampleLen >= 8) {
    let oddZeros = 0;
    let evenNonZeros = 0;
    for (let i = 0; i + 1 < sampleLen; i += 2) {
      if (bytes[i] !== 0) evenNonZeros++;
      if (bytes[i + 1] === 0) oddZeros++;
    }
    const pairs = Math.floor(sampleLen / 2);
    if (pairs > 0 && oddZeros / pairs > 0.35 && evenNonZeros / pairs > 0.6) {
      return new TextDecoder('utf-16le', { fatal: false }).decode(bytes);
    }
  }

  // Strict UTF-8 first; if invalid sequences occur, fall back to Windows-1252
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252', { fatal: false }).decode(bytes);
  }
}

function stripHtmlToPlain(html: string): string {
  if (typeof window === 'undefined') {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.textContent || div.innerText || '').replace(/\s+/g, ' ').trim();
}

function segmentTextUnits(text: string): string[] {
  if (!text) return [];
  const IntlWithSegmenter = Intl as unknown as {
    Segmenter?: new (
      locale?: string,
      opts?: { granularity: 'grapheme' | 'word' | 'sentence' }
    ) => { segment: (input: string) => Iterable<{ segment: string }> };
  };

  if (typeof IntlWithSegmenter.Segmenter === 'function') {
    try {
      const seg = new IntlWithSegmenter.Segmenter('km', { granularity: 'word' });
      const parts = Array.from(seg.segment(text), (s) => s.segment);
      if (parts.length > 1) return parts;
    } catch {
      // Fallback below
    }
    try {
      const graphemeSeg = new IntlWithSegmenter.Segmenter(undefined, { granularity: 'grapheme' });
      return Array.from(graphemeSeg.segment(text), (s) => s.segment);
    } catch {
      // Fallback below
    }
  }
  return Array.from(text);
}

function splitLongPlainText(text: string, maxBytes: number): string[] {
  if (!text) return [];
  if (utf8ByteLength(text) <= maxBytes) return [text];

  const hasWhitespace = /\s/.test(text);
  const rawTokens = hasWhitespace ? text.split(/(\s+)/) : segmentTextUnits(text);
  const units: string[] = [];

  for (const tok of rawTokens) {
    if (utf8ByteLength(tok) > maxBytes) {
      units.push(...segmentTextUnits(tok));
    } else {
      units.push(tok);
    }
  }

  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;

  for (const unit of units) {
    const unitBytes = utf8ByteLength(unit);
    if (current && currentBytes + unitBytes > maxBytes) {
      const trimmed = current.trim();
      if (trimmed) chunks.push(trimmed);
      current = unit;
      currentBytes = unitBytes;
    } else {
      current += unit;
      currentBytes += unitBytes;
    }
  }
  const tail = current.trim();
  if (tail) chunks.push(tail);
  return chunks.length > 0 ? chunks : [clampUtf8(text, maxBytes)];
}

function textToParagraphHtml(text: string): string {
  return plainTextToPreservedHtml(text);
}

function readOle2Streams(buffer: ArrayBuffer): Map<string, Uint8Array> | null {
  try {
    if (buffer.byteLength < 512) return null;
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    const oleMagic = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
    for (let i = 0; i < 8; i++) {
      if (bytes[i] !== oleMagic[i]) return null;
    }

    const sectorShift = view.getUint16(30, true);
    const miniSectorShift = view.getUint16(32, true);
    const sectorSize = 1 << sectorShift;
    const miniSectorSize = 1 << miniSectorShift;
    if (sectorSize < 64 || sectorSize > 8192 || miniSectorSize < 16) return null;

    const numFatSectors = view.getInt32(44, true);
    const firstDirSector = view.getInt32(48, true);
    const miniStreamCutoff = view.getUint32(56, true);
    const firstMiniFatSector = view.getInt32(60, true);
    const numMiniFatSectors = view.getInt32(64, true);
    const firstDifatSector = view.getInt32(68, true);
    const numDifatSectors = view.getInt32(72, true);

    const ENDOFCHAIN = -2;
    const FREESECT = -1;

    const getSectorOffset = (secId: number) => 512 + secId * sectorSize;
    const readSector = (secId: number): Uint8Array => {
      const off = getSectorOffset(secId);
      if (off < 0 || off + sectorSize > bytes.length) {
        return bytes.subarray(Math.max(0, off), Math.min(bytes.length, off + sectorSize));
      }
      return bytes.subarray(off, off + sectorSize);
    };

    const fatSectorIds: number[] = [];
    for (let i = 0; i < 109 && fatSectorIds.length < numFatSectors; i++) {
      const sid = view.getInt32(76 + i * 4, true);
      if (sid >= 0) fatSectorIds.push(sid);
    }

    let difatSec = firstDifatSector;
    let difatLoops = 0;
    while (
      difatSec >= 0 &&
      difatSec !== ENDOFCHAIN &&
      difatSec !== FREESECT &&
      fatSectorIds.length < numFatSectors &&
      difatLoops < numDifatSectors + 4
    ) {
      difatLoops++;
      const off = getSectorOffset(difatSec);
      if (off + sectorSize > bytes.length) break;
      const entries = sectorSize / 4 - 1;
      for (let i = 0; i < entries && fatSectorIds.length < numFatSectors; i++) {
        const sid = view.getInt32(off + i * 4, true);
        if (sid >= 0) fatSectorIds.push(sid);
      }
      difatSec = view.getInt32(off + entries * 4, true);
    }

    const fatEntriesPerSector = sectorSize / 4;
    const fat = new Int32Array(fatSectorIds.length * fatEntriesPerSector);
    for (let sIdx = 0; sIdx < fatSectorIds.length; sIdx++) {
      const off = getSectorOffset(fatSectorIds[sIdx]);
      if (off + sectorSize > bytes.length) continue;
      for (let j = 0; j < fatEntriesPerSector; j++) {
        fat[sIdx * fatEntriesPerSector + j] = view.getInt32(off + j * 4, true);
      }
    }

    const readChain = (startSec: number, maxLen?: number): Uint8Array => {
      const chunks: Uint8Array[] = [];
      const visited = new Set<number>();
      let cur = startSec;
      let total = 0;
      while (cur >= 0 && cur < fat.length && !visited.has(cur)) {
        visited.add(cur);
        const secBytes = readSector(cur);
        chunks.push(secBytes);
        total += secBytes.length;
        if (maxLen !== undefined && total >= maxLen) break;
        cur = fat[cur];
      }
      const outLen = maxLen !== undefined ? Math.min(total, maxLen) : total;
      const out = new Uint8Array(outLen);
      let pos = 0;
      for (const c of chunks) {
        const take = Math.min(c.length, outLen - pos);
        if (take <= 0) break;
        out.set(c.subarray(0, take), pos);
        pos += take;
      }
      return out;
    };

    const dirBytes = readChain(firstDirSector);
    const dirView = new DataView(dirBytes.buffer, dirBytes.byteOffset, dirBytes.byteLength);
    const entrySize = 128;
    const numEntries = Math.floor(dirBytes.length / entrySize);

    let rootStartSector = -1;
    let rootSize = 0;
    const streamEntries: Array<{ name: string; startSector: number; size: number }> = [];

    for (let idx = 0; idx < numEntries; idx++) {
      const base = idx * entrySize;
      const objType = dirBytes[base + 66];
      const nameLen = dirView.getUint16(base + 64, true);
      if (nameLen < 2 || nameLen > 64) continue;
      const nameBytes = dirBytes.subarray(base, base + nameLen - 2);
      const name = new TextDecoder('utf-16le').decode(nameBytes);
      const startSector = dirView.getInt32(base + 116, true);
      const sizeLow = dirView.getUint32(base + 120, true);
      if (objType === 5) {
        rootStartSector = startSector;
        rootSize = sizeLow;
      } else if (objType === 2) {
        streamEntries.push({ name, startSector, size: sizeLow });
      }
    }

    const miniStream =
      rootStartSector >= 0 && rootSize > 0 ? readChain(rootStartSector, rootSize) : new Uint8Array(0);
    const miniFatRaw =
      firstMiniFatSector >= 0 && numMiniFatSectors > 0 ? readChain(firstMiniFatSector) : new Uint8Array(0);
    const miniFatView = new DataView(miniFatRaw.buffer, miniFatRaw.byteOffset, miniFatRaw.byteLength);
    const miniFat = new Int32Array(Math.floor(miniFatRaw.length / 4));
    for (let i = 0; i < miniFat.length; i++) {
      miniFat[i] = miniFatView.getInt32(i * 4, true);
    }

    const readMiniChain = (startSec: number, size: number): Uint8Array => {
      const out = new Uint8Array(size);
      const visited = new Set<number>();
      let cur = startSec;
      let pos = 0;
      while (cur >= 0 && cur < miniFat.length && pos < size && !visited.has(cur)) {
        visited.add(cur);
        const off = cur * miniSectorSize;
        const take = Math.min(miniSectorSize, size - pos, miniStream.length - off);
        if (take <= 0) break;
        out.set(miniStream.subarray(off, off + take), pos);
        pos += take;
        cur = miniFat[cur];
      }
      return out;
    };

    const result = new Map<string, Uint8Array>();
    for (const entry of streamEntries) {
      const data =
        entry.size < miniStreamCutoff && miniStream.length > 0
          ? readMiniChain(entry.startSector, entry.size)
          : readChain(entry.startSector, entry.size);
      result.set(entry.name, data);
    }
    return result;
  } catch {
    return null;
  }
}

function findOle2StreamCaseInsensitive(
  streams: Map<string, Uint8Array>,
  targetName: string
): Uint8Array | undefined {
  const exact = streams.get(targetName);
  if (exact) return exact;
  const lower = targetName.toLowerCase();
  for (const [k, v] of streams.entries()) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

function cleanWordBinaryExtractedText(raw: string): string {
  // Replace Word field codes (\x13 INSTR \x14 DISPLAY \x15) with just DISPLAY text
  let cleaned = raw.replace(/\x13[^\x14\x15]*\x14([^\x15]*)\x15/g, '$1');
  cleaned = cleaned.replace(/\x13[^\x15]*\x15/g, '');
  return cleaned
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\x00-\x06\x08\x0e-\x1f]/g, '')
    .trim();
}

function extractWordBinaryTextFromOle2(
  buffer: ArrayBuffer,
  preloadedStreams?: Map<string, Uint8Array> | null
): string | null {
  const streams = preloadedStreams ?? readOle2Streams(buffer);
  if (!streams) return null;
  const wordDoc = findOle2StreamCaseInsensitive(streams, 'WordDocument');
  if (!wordDoc || wordDoc.length < 0x40) return null;

  const wView = new DataView(wordDoc.buffer, wordDoc.byteOffset, wordDoc.byteLength);
  const magic = wView.getUint16(0, true);
  if (magic !== 0xa5ec && magic !== 0xa5dc && magic !== 0xa5db) return null;

  const nFib = wView.getUint16(0x02, true);
  const flags = wView.getUint16(0x0a, true);
  const fEncrypted = (flags & 0x0100) !== 0;
  if (fEncrypted) return null;

  // Word 6.0 / Word 95 contiguous stream fallback (nFib < 0x00c1)
  if (nFib < 0x00c1) {
    const fcMin = wView.getUint32(0x18, true);
    const fcMac = wView.getUint32(0x1c, true);
    if (fcMac > fcMin && fcMac <= wordDoc.length) {
      let winText = '';
      for (let k = fcMin; k < fcMac; k++) {
        winText += decodeWin1252Byte(wordDoc[k]);
      }
      const cleaned = cleanWordBinaryExtractedText(winText);
      if (cleaned) return cleaned;
    }
  }

  if (wordDoc.length < 0x1aa) return null;
  const fWhichTblStm = (flags & 0x0200) !== 0;
  const tableName = fWhichTblStm ? '1Table' : '0Table';
  const tableStream =
    findOle2StreamCaseInsensitive(streams, tableName) ||
    findOle2StreamCaseInsensitive(streams, '1Table') ||
    findOle2StreamCaseInsensitive(streams, '0Table');
  if (!tableStream) return null;

  const ccpText = Math.max(0, wView.getInt32(0x4c, true));
  const ccpFtn = Math.max(0, wView.getInt32(0x50, true));
  const ccpHdd = Math.max(0, wView.getInt32(0x54, true));
  const ccpMcr = Math.max(0, wView.getInt32(0x58, true));
  const ccpAtn = Math.max(0, wView.getInt32(0x5c, true));
  const ccpEdn = Math.max(0, wView.getInt32(0x60, true));
  const ccpTxbx = Math.max(0, wView.getInt32(0x64, true));
  const ccpHdrTxbx = wordDoc.length >= 0x6c ? Math.max(0, wView.getInt32(0x68, true)) : 0;
  const ccpTotal = ccpText + ccpFtn + ccpHdd + ccpMcr + ccpAtn + ccpEdn + ccpTxbx + ccpHdrTxbx;
  if (ccpTotal <= 0) return null;

  // Locate fcClx / lcbClx in FibRgFcLcb97 (offset 0x1a2 in WordDocument)
  const fcClx = wView.getUint32(0x1a2, true);
  const lcbClx = wView.getUint32(0x1a6, true);
  if (lcbClx === 0 || fcClx + lcbClx > tableStream.length) return null;

  const clx = tableStream.subarray(fcClx, fcClx + lcbClx);
  const clxView = new DataView(clx.buffer, clx.byteOffset, clx.byteLength);
  let pos = 0;

  // Skip optional Prc structures (clxt === 0x01)
  while (pos < clx.length && clx[pos] === 0x01) {
    if (pos + 3 > clx.length) return null;
    const cbGrpprl = clxView.getUint16(pos + 1, true);
    pos += 3 + cbGrpprl;
  }

  if (pos >= clx.length || clx[pos] !== 0x02) return null;
  pos += 1;
  if (pos + 4 > clx.length) return null;
  const lcbPcd = clxView.getUint32(pos, true);
  pos += 4;
  if (pos + lcbPcd > clx.length || lcbPcd < 12) return null;

  const nPieces = Math.floor((lcbPcd - 4) / 12);
  if (nPieces <= 0) return null;

  const cpBase = pos;
  const pcdBase = pos + (nPieces + 1) * 4;

  const readCpRange = (rangeStart: number, rangeEnd: number): string => {
    if (rangeEnd <= rangeStart) return '';
    let acc = '';
    for (let i = 0; i < nPieces; i++) {
      const cpStart = clxView.getUint32(cpBase + i * 4, true);
      const cpEnd = clxView.getUint32(cpBase + (i + 1) * 4, true);
      if (cpEnd <= rangeStart) continue;
      if (cpStart >= rangeEnd) break;

      const sliceStart = Math.max(cpStart, rangeStart);
      const sliceEnd = Math.min(cpEnd, rangeEnd);
      const charCount = sliceEnd - sliceStart;
      if (charCount <= 0) continue;

      const pcdOffset = pcdBase + i * 8;
      const fcRaw = clxView.getUint32(pcdOffset + 2, true);
      const isAnsiCompressed = (fcRaw & 0x40000000) !== 0;
      const pieceBaseFc = isAnsiCompressed ? (fcRaw & 0x3fffffff) >> 1 : fcRaw;
      const skipChars = sliceStart - cpStart;

      if (isAnsiCompressed) {
        const startByte = pieceBaseFc + skipChars;
        if (startByte + charCount > wordDoc.length) continue;
        for (let k = 0; k < charCount; k++) {
          acc += decodeWin1252Byte(wordDoc[startByte + k]);
        }
      } else {
        const startByte = pieceBaseFc + skipChars * 2;
        const byteLen = charCount * 2;
        if (startByte + byteLen > wordDoc.length) continue;
        acc += new TextDecoder('utf-16le', { fatal: false }).decode(
          wordDoc.subarray(startByte, startByte + byteLen)
        );
      }
    }
    return acc;
  };

  let bodyText = ccpText > 0 ? cleanWordBinaryExtractedText(readCpRange(0, ccpText)) : '';
  // If body CP text is tiny/empty (e.g. content lives inside Text Boxes or Headers), recover subdocuments
  if (bodyText.length < 5 && ccpTotal > ccpText) {
    const subDocText = cleanWordBinaryExtractedText(readCpRange(ccpText, ccpTotal));
    if (subDocText) {
      bodyText = bodyText ? `${bodyText}\n\n${subDocText}` : subDocText;
    }
  } else if (ccpTxbx > 0) {
    const txbxStart = ccpText + ccpFtn + ccpHdd + ccpMcr + ccpAtn + ccpEdn;
    const txbxText = cleanWordBinaryExtractedText(readCpRange(txbxStart, txbxStart + ccpTxbx));
    if (txbxText && !bodyText.includes(txbxText)) {
      bodyText = bodyText ? `${bodyText}\n\n${txbxText}` : txbxText;
    }
  }

  return bodyText || null;
}

function scanBytesForDocTextRuns(bytes: Uint8Array): string[] {
  const runs: string[] = [];

  const scanUtf16 = (slice: Uint8Array) => {
    const utf16Text = new TextDecoder('utf-16le', { fatal: false }).decode(slice);
    // Include ASCII, Latin, Khmer (\u1780-\u17FF, \u19E0-\u19FF), and ZWSP/punctuation (\u200B-\u206F)
    const utf16Regex =
      /[\t\n\r\u0020-\u007E\u00A0-\u00FF\u1780-\u17FF\u19E0-\u19FF\u200B-\u206F]{4,}/g;
    const matches = utf16Text.match(utf16Regex) || [];
    for (const m of matches) {
      const cleaned = m
        .replace(
          /[^\t\n\u0020-\u007E\u00A0-\u00FF\u1780-\u17FF\u19E0-\u19FF\u200B-\u206F]/g,
          ''
        )
        .trim();
      const hasKhmer = /[\u1780-\u17FF\u19E0-\u19FF]/.test(cleaned);
      const minLen = hasKhmer ? 4 : 8;
      if (
        cleaned.length >= minLen &&
        !cleaned.includes('Microsoft Word') &&
        !cleaned.includes('Root Entry') &&
        !cleaned.includes('WordDocument') &&
        !cleaned.includes('Normal.dotm') &&
        !runs.some((r) => r.includes(cleaned))
      ) {
        runs.push(cleaned);
      }
    }
  };

  scanUtf16(bytes);
  if (runs.length === 0 && bytes.length > 2) {
    // Also check unaligned 1-byte shifted UTF-16LE slices
    scanUtf16(bytes.subarray(1));
  }

  // Scan UTF-8 text runs (catches UTF-8 Khmer or ASCII blocks inside binary streams)
  const utf8Text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const khmerUtf8Matches =
    utf8Text.match(/[\u1780-\u17FF\u19E0-\u19FF\u200B-\u200D 0-9]{4,}/g) || [];
  for (const m of khmerUtf8Matches) {
    const cleaned = m.trim();
    if (cleaned.length >= 4 && /[\u1780-\u17FF]/.test(cleaned) && !runs.some((r) => r.includes(cleaned))) {
      runs.push(cleaned);
    }
  }

  const ascii = new TextDecoder('windows-1252', { fatal: false }).decode(bytes);
  const asciiMatches =
    ascii.match(/[A-Za-z0-9\u00C0-\u00FF ,.;:'"“”‘’()\-–—/\t\n]{16,}/g) || [];
  for (const m of asciiMatches) {
    const cleaned = m.trim();
    if (
      cleaned.length >= 16 &&
      !cleaned.includes('Microsoft Word') &&
      !cleaned.includes('Root Entry') &&
      !cleaned.includes('Word.Document') &&
      !cleaned.includes('bjbj') &&
      !runs.some((r) => r.includes(cleaned))
    ) {
      runs.push(cleaned);
    }
  }

  return runs;
}

function extractPptBinaryTextFromOle2(streams: Map<string, Uint8Array>): string | null {
  const pptStream = findOle2StreamCaseInsensitive(streams, 'PowerPoint Document');
  if (!pptStream || pptStream.length < 8) return null;

  const view = new DataView(pptStream.buffer, pptStream.byteOffset, pptStream.byteLength);
  const texts: string[] = [];
  let offset = 0;

  while (offset + 8 <= pptStream.length) {
    const verInst = view.getUint16(offset, true);
    const recType = view.getUint16(offset + 2, true);
    const recLen = view.getUint32(offset + 4, true);
    const recVer = verInst & 0x0f;

    if (recVer === 0x0f) {
      // Container record: descend into children immediately after 8-byte header
      offset += 8;
      continue;
    }

    const payloadStart = offset + 8;
    const payloadEnd = Math.min(pptStream.length, payloadStart + recLen);

    if (recType === 0x0fa0 && payloadEnd > payloadStart) {
      // TextCharsAtom (UTF-16LE)
      const str = new TextDecoder('utf-16le', { fatal: false })
        .decode(pptStream.subarray(payloadStart, payloadEnd))
        .replace(/[\x00-\x08\x0b-\x1f]/g, '')
        .trim();
      if (str && !texts.includes(str)) texts.push(str);
    } else if (recType === 0x0fa8 && payloadEnd > payloadStart) {
      // TextBytesAtom (single-byte Win-1252)
      let str = '';
      for (let i = payloadStart; i < payloadEnd; i++) {
        str += decodeWin1252Byte(pptStream[i]);
      }
      const cleaned = str.replace(/[\x00-\x08\x0b-\x1f]/g, '').trim();
      if (cleaned && !texts.includes(cleaned)) texts.push(cleaned);
    }

    offset = payloadEnd;
  }

  if (texts.length > 0) return texts.join('\n\n');
  const runs = scanBytesForDocTextRuns(pptStream);
  return runs.length > 0 ? runs.join('\n\n') : null;
}

function extractXlsBinaryTextFromOle2(streams: Map<string, Uint8Array>): string | null {
  const wbStream =
    findOle2StreamCaseInsensitive(streams, 'Workbook') ||
    findOle2StreamCaseInsensitive(streams, 'Book');
  if (!wbStream || wbStream.length < 4) return null;

  const view = new DataView(wbStream.buffer, wbStream.byteOffset, wbStream.byteLength);
  const sstStrings: string[] = [];
  const labelStrings: string[] = [];

  try {
    let offset = 0;
    while (offset + 4 <= wbStream.length) {
      const recType = view.getUint16(offset, true);
      const recLen = view.getUint16(offset + 2, true);
      const payloadStart = offset + 4;
      const payloadEnd = Math.min(wbStream.length, payloadStart + recLen);

      if (recType === 0x00fc && recLen >= 8) {
        // BIFF8 SST (+ contiguous 0x003C CONTINUE records merged into one buffer)
        const chunks: Uint8Array[] = [wbStream.subarray(payloadStart, payloadEnd)];
        let nextOff = payloadEnd;
        while (nextOff + 4 <= wbStream.length && view.getUint16(nextOff, true) === 0x003c) {
          const contLen = view.getUint16(nextOff + 2, true);
          const contStart = nextOff + 4;
          const contEnd = Math.min(wbStream.length, contStart + contLen);
          chunks.push(wbStream.subarray(contStart, contEnd));
          nextOff = contEnd;
        }
        const totalBytes = chunks.reduce((acc, c) => acc + c.length, 0);
        const sstBuf = new Uint8Array(totalBytes);
        let p = 0;
        for (const c of chunks) {
          sstBuf.set(c, p);
          p += c.length;
        }
        const sstView = new DataView(sstBuf.buffer, sstBuf.byteOffset, sstBuf.byteLength);
        const cstUnique = sstBuf.length >= 8 ? sstView.getUint32(4, true) : 0;
        let pos = 8;
        const maxStrings = Math.min(cstUnique, 8000);
        for (let i = 0; i < maxStrings && pos + 3 <= sstBuf.length; i++) {
          const cch = sstView.getUint16(pos, true);
          const flags = sstBuf[pos + 2];
          pos += 3;
          let cRun = 0;
          let cbExtRst = 0;
          if ((flags & 0x08) !== 0 && pos + 2 <= sstBuf.length) {
            cRun = sstView.getUint16(pos, true);
            pos += 2;
          }
          if ((flags & 0x04) !== 0 && pos + 4 <= sstBuf.length) {
            cbExtRst = sstView.getUint32(pos, true);
            pos += 4;
          }
          const isUtf16 = (flags & 0x01) !== 0;
          const charByteLen = isUtf16 ? cch * 2 : cch;
          if (pos + charByteLen > sstBuf.length) break;
          let str = '';
          if (isUtf16) {
            str = new TextDecoder('utf-16le', { fatal: false }).decode(
              sstBuf.subarray(pos, pos + charByteLen)
            );
          } else {
            for (let k = 0; k < charByteLen; k++) {
              str += decodeWin1252Byte(sstBuf[pos + k]);
            }
          }
          const cleaned = str.trim();
          if (cleaned) sstStrings.push(cleaned);
          pos += charByteLen + cRun * 4 + cbExtRst;
        }
        offset = nextOff;
        continue;
      }

      if (recType === 0x0204 && recLen >= 8) {
        // BIFF Label record
        const cch = view.getUint16(payloadStart + 6, true);
        const strStart = payloadStart + 8;
        if (strStart + cch <= payloadEnd) {
          let s = '';
          for (let k = 0; k < cch; k++) s += decodeWin1252Byte(wbStream[strStart + k]);
          if (s.trim()) labelStrings.push(s.trim());
        }
      }

      offset = payloadEnd;
    }
  } catch {
    // Fallback to raw run scan below
  }

  const combined = [...sstStrings, ...labelStrings].filter(Boolean);
  if (combined.length > 0) return combined.join('\n');
  const runs = scanBytesForDocTextRuns(wbStream);
  return runs.length > 0 ? runs.join('\n') : null;
}

function extractLegacyDocText(buffer: ArrayBuffer): string {
  const streams = readOle2Streams(buffer);
  const oleText = extractWordBinaryTextFromOle2(buffer, streams);
  if (oleText && oleText.length >= 4) {
    return oleText;
  }

  if (streams) {
    const pptText = extractPptBinaryTextFromOle2(streams);
    if (pptText && pptText.length >= 4) return pptText;

    const xlsText = extractXlsBinaryTextFromOle2(streams);
    if (xlsText && xlsText.length >= 2) return xlsText;

    const wordDocStream = findOle2StreamCaseInsensitive(streams, 'WordDocument');
    if (wordDocStream && wordDocStream.length > 0) {
      const streamRuns = scanBytesForDocTextRuns(wordDocStream);
      if (streamRuns.length > 0) {
        return streamRuns.join('\n\n').trim();
      }
    }

    const allStreamRuns: string[] = [];
    for (const sBytes of streams.values()) {
      for (const run of scanBytesForDocTextRuns(sBytes)) {
        if (!allStreamRuns.some((r) => r.includes(run))) {
          allStreamRuns.push(run);
        }
      }
    }
    if (allStreamRuns.length > 0) {
      return allStreamRuns.join('\n\n').trim();
    }
  }

  const rawRuns = scanBytesForDocTextRuns(new Uint8Array(buffer));
  return rawRuns.join('\n\n').trim() || 'Binary Office document imported.';
}

function isCanvasBlankWhite(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): boolean {
  try {
    const cols = 14;
    const rows = 14;
    const stepX = Math.max(1, Math.floor(width / cols));
    const stepY = Math.max(1, Math.floor(height / rows));
    for (let y = Math.floor(stepY / 2); y < height; y += stepY) {
      for (let x = Math.floor(stepX / 2); x < width; x += stepX) {
        const px = ctx.getImageData(x, y, 1, 1).data;
        if (px[0] < 252 || px[1] < 252 || px[2] < 252) {
          return false;
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}

export async function renderPdfPagesFromBytes(
  arrayBuffer: ArrayBuffer
): Promise<{
  pageDataUrls: string[];
  pageSizesPt: Array<{ widthPt: number; heightPt: number }>;
  extractedTextPages: string[];
  totalChars: number;
}> {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

  const loadingTask = pdfjsLib.getDocument({
    data: arrayBuffer.slice(0),
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    iccUrl: '/pdfjs/iccs/',
    wasmUrl: '/pdfjs/wasm/',
    useSystemFonts: true,
    useWasm: true,
  });
  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;

  const pageDataUrls: string[] = [];
  const pageSizesPt: Array<{ widthPt: number; heightPt: number }> = [];
  const extractedTextPages: string[] = [];
  let totalChars = 0;

  const preferredScale = numPages > 100 ? 1.15 : numPages > 45 ? 1.35 : 1.75;
  const jpegQuality = numPages > 100 ? 0.76 : numPages > 45 ? 0.8 : 0.88;
  const annotationMode = pdfjsLib.AnnotationMode?.ENABLE ?? 1;

  try {
    for (let p = 1; p <= numPages; p++) {
      let widthPt = 595;
      let heightPt = 842;
      let dataUrl = '';
      let pageText = '';

      try {
        const page = await pdf.getPage(p);
        const baseViewport = page.getViewport({ scale: 1 });
        widthPt = Math.max(1, Math.round(baseViewport.width));
        heightPt = Math.max(1, Math.round(baseViewport.height));

        const maxSidePt = Math.max(baseViewport.width, baseViewport.height, 1);
        const safeScale = Math.min(preferredScale, 2200 / maxSidePt);

        const renderAtScale = async (
          targetScale: number
        ): Promise<{ dataUrl: string; isBlank: boolean }> => {
          const renderViewport = page.getViewport({ scale: targetScale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.floor(renderViewport.width));
          canvas.height = Math.max(1, Math.floor(renderViewport.height));
          const ctx = canvas.getContext('2d');
          if (!ctx) return { dataUrl: '', isBlank: true };
          try {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({
              canvasContext: ctx,
              viewport: renderViewport,
              canvas,
              annotationMode,
            }).promise;
            const isBlank = isCanvasBlankWhite(ctx, canvas.width, canvas.height);
            return {
              dataUrl: canvas.toDataURL('image/jpeg', jpegQuality),
              isBlank,
            };
          } finally {
            canvas.width = 0;
            canvas.height = 0;
          }
        };

        let renderedBlank = false;
        try {
          const res = await renderAtScale(safeScale);
          dataUrl = res.dataUrl;
          renderedBlank = res.isBlank;
        } catch {
          try {
            const res = await renderAtScale(Math.min(0.75, safeScale));
            dataUrl = res.dataUrl;
            renderedBlank = res.isBlank;
          } catch {
            try {
              const res = await renderAtScale(Math.min(0.4, safeScale));
              dataUrl = res.dataUrl;
              renderedBlank = res.isBlank;
            } catch {
              dataUrl = '';
              renderedBlank = true;
            }
          }
        }

        try {
          const textContent = await page.getTextContent();
          const lines: string[] = [];
          let currentLine = '';
          let lastY: number | null = null;

          for (const item of textContent.items) {
            if ('str' in item) {
              const y = Array.isArray(item.transform) ? Math.round(item.transform[5]) : null;
              if (lastY !== null && y !== null && Math.abs(y - lastY) > 6) {
                if (currentLine.trim()) lines.push(currentLine.trim());
                currentLine = item.str;
              } else {
                currentLine += (currentLine && item.str ? ' ' : '') + item.str;
              }
              lastY = y;
            }
          }
          if (currentLine.trim()) lines.push(currentLine.trim());
          pageText = lines.join('\n').trim();
        } catch {
          pageText = '';
        }

        // If PDF canvas rendered completely blank white even though text exists on the page, trigger text-backed canvas synthesis
        if (renderedBlank && pageText.trim().length > 0) {
          dataUrl = '';
        }

        if (!dataUrl || dataUrl.length < 32) {
          // Synthesize crisp text-backed page image if PDF canvas rendering failed on a protected/exotic page
          try {
            const fbCanvas = document.createElement('canvas');
            fbCanvas.width = Math.max(400, Math.min(1000, Math.round(widthPt * 1.3)));
            fbCanvas.height = Math.max(
              500,
              Math.min(1400, Math.round((heightPt / Math.max(1, widthPt)) * fbCanvas.width))
            );
            const fbCtx = fbCanvas.getContext('2d');
            if (fbCtx) {
              fbCtx.fillStyle = '#ffffff';
              fbCtx.fillRect(0, 0, fbCanvas.width, fbCanvas.height);
              fbCtx.fillStyle = '#1e293b';
              fbCtx.font = '18px "Battambang", "Plus Jakarta Sans", sans-serif';
              const contentLines = (
                pageText || `PDF Page ${p} (visual canvas fallback)`
              ).split(/\r?\n/);
              const maxW = fbCanvas.width - 80;
              let cursorY = 64;
              for (const rawLine of contentLines) {
                const words = rawLine.split(/\s+/);
                let curLine = '';
                for (const w of words) {
                  const test = curLine ? `${curLine} ${w}` : w;
                  if (fbCtx.measureText(test).width > maxW && curLine) {
                    fbCtx.fillText(curLine, 40, cursorY);
                    cursorY += 26;
                    curLine = w;
                  } else {
                    curLine = test;
                  }
                  if (cursorY > fbCanvas.height - 50) break;
                }
                if (curLine && cursorY <= fbCanvas.height - 50) {
                  fbCtx.fillText(curLine, 40, cursorY);
                  cursorY += 28;
                }
                if (cursorY > fbCanvas.height - 50) break;
              }
              dataUrl = fbCanvas.toDataURL('image/jpeg', 0.84);
            }
            fbCanvas.width = 0;
            fbCanvas.height = 0;
          } catch {
            dataUrl = '';
          }
        }

        page.cleanup();
      } catch (pageErr) {
        console.warn(`PDF page ${p} partial recovery:`, pageErr);
      }

      pageSizesPt.push({ widthPt, heightPt });
      pageDataUrls.push(dataUrl);
      totalChars += pageText.length;
      extractedTextPages.push(pageText);
    }
  } finally {
    try {
      const destroyable = pdf as unknown as {
        destroy?: () => Promise<void> | void;
        cleanup?: () => void;
      };
      if (typeof destroyable.destroy === 'function') {
        await destroyable.destroy();
      } else if (typeof destroyable.cleanup === 'function') {
        destroyable.cleanup();
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  return { pageDataUrls, pageSizesPt, extractedTextPages, totalChars };
}

export function buildEditableHtmlFromPdfTextPages(
  textPages: string[],
  pageDataUrls?: string[]
): string {
  return (
    textPages
      .map((txt, idx) => {
        if (txt && txt.trim()) {
          return textToParagraphHtml(txt);
        }
        const scanUrl = pageDataUrls?.[idx];
        if (scanUrl) {
          return `<figure><img src="${scanUrl}" alt="Page ${idx + 1}" /></figure>`;
        }
        return '<p></p>';
      })
      .join('\n<hr class="page-break-marker" />\n') || '<p></p>'
  );
}

async function processPdfFile(
  file: File,
  arrayBuffer: ArrayBuffer
): Promise<ImportedDocumentResult> {
  let pageDataUrls: string[] = [];
  let pageSizesPt: Array<{ widthPt: number; heightPt: number }> = [];
  let extractedTextPages: string[] = [];
  let totalChars = 0;

  try {
    const rendered = await renderPdfPagesFromBytes(arrayBuffer);
    pageDataUrls = rendered.pageDataUrls;
    pageSizesPt = rendered.pageSizesPt;
    extractedTextPages = rendered.extractedTextPages;
    totalChars = rendered.totalChars;
  } catch (err) {
    console.warn('PDF.js primary load failed, trying pdf-lib structural fallback:', err);
    try {
      const pdfDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
      const pages = pdfDoc.getPages();
      pageSizesPt = pages.map((pg) => {
        const { width, height } = pg.getSize();
        return {
          widthPt: Math.max(1, Math.round(width)),
          heightPt: Math.max(1, Math.round(height)),
        };
      });
      pageDataUrls = pages.map(() => '');
      extractedTextPages = pages.map(() => '');
    } catch {
      pageSizesPt = [{ widthPt: 595, heightPt: 842 }];
      pageDataUrls = [''];
      extractedTextPages = [''];
    }
  }

  const numPages = Math.max(1, pageSizesPt.length, pageDataUrls.length);
  if (pageSizesPt.length === 0) {
    pageSizesPt = [{ widthPt: 595, heightPt: 842 }];
  }

  const markerParts = pageSizesPt.map(
    (sz, idx) =>
      `<div class="dm-pdf-page-marker" data-pdf-page="${idx + 1}" data-width-pt="${sz.widthPt}" data-height-pt="${sz.heightPt}"></div>`
  );

  const contentHtml = markerParts.join('\n') || '<p></p>';
  const plainText =
    extractedTextPages.filter(Boolean).join('\n\n') || `[PDF Document: ${file.name}]`;

  return {
    title: file.name.replace(/\.[^.]+$/, '') || 'Imported PDF',
    sourceType: 'pdf',
    contentHtml,
    plainText,
    pageCountEstimate: numPages,
    needsOcrHint: totalChars < 30,
    binaryBytes: arrayBuffer,
    mimeType: 'application/pdf',
    fileName: file.name,
    thumbnailDataUrl: pageDataUrls.find(Boolean) || undefined,
    pageDataUrls,
    pageSizesPt,
    extractedTextPages,
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function inspectAndCompressImageDataUrl(
  dataUrl: string,
  options: { maxWidth?: number; quality?: number; forceJpegOverBytes?: number } = {}
): Promise<{ dataUrl: string; width?: number; height?: number; renderable: boolean }> {
  const maxWidth = options.maxWidth ?? 1200;
  const quality = options.quality ?? 0.86;
  const forceOverBytes = options.forceJpegOverBytes ?? 260000;

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const natW = img.naturalWidth || img.width || 0;
      const natH = img.naturalHeight || img.height || 0;

      if (dataUrl.length <= forceOverBytes && natW <= maxWidth) {
        resolve({ dataUrl, width: natW || undefined, height: natH || undefined, renderable: true });
        return;
      }

      const isPngSource = dataUrl.startsWith('data:image/png');
      const encodeAt = (mw: number, mime: 'image/png' | 'image/jpeg', q: number): string => {
        const scale = natW > mw && natW > 0 ? mw / natW : 1;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(natW * scale));
        canvas.height = Math.max(1, Math.round(natH * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) return dataUrl;
        try {
          if (mime === 'image/jpeg') {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          return canvas.toDataURL(mime, q);
        } finally {
          canvas.width = 0;
          canvas.height = 0;
        }
      };

      let outUrl = dataUrl;
      if (isPngSource) {
        const resizedPng = encodeAt(maxWidth, 'image/png', 1);
        if (resizedPng.length <= MAX_SINGLE_IMAGE_DATA_URL_BYTES) {
          outUrl = resizedPng;
        } else {
          outUrl = encodeAt(maxWidth, 'image/jpeg', quality);
        }
      } else {
        outUrl = encodeAt(maxWidth, 'image/jpeg', quality);
      }

      if (outUrl.length > MAX_SINGLE_IMAGE_DATA_URL_BYTES) {
        outUrl = encodeAt(Math.min(maxWidth, 900), 'image/jpeg', 0.74);
      }
      if (outUrl.length > MAX_SINGLE_IMAGE_DATA_URL_BYTES) {
        outUrl = encodeAt(Math.min(maxWidth, 640), 'image/jpeg', 0.58);
      }

      resolve({
        dataUrl: outUrl,
        width: natW || undefined,
        height: natH || undefined,
        renderable: true,
      });
    };
    img.onerror = () => resolve({ dataUrl, renderable: false });
    img.src = dataUrl;
  });
}

function preprocessDocxXmlString(xmlText: string): string {
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') {
    return xmlText;
  }
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    return xmlText;
  }

  const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const createPageBreakParagraph = (): Element => {
    const p = doc.createElementNS(W_NS, 'w:p');
    const r = doc.createElementNS(W_NS, 'w:r');
    const br = doc.createElementNS(W_NS, 'w:br');
    br.setAttributeNS(W_NS, 'w:type', 'page');
    r.appendChild(br);
    p.appendChild(r);
    return p;
  };

  // 1. Preserve math equations (<m:oMathPara> / <m:oMath>) as plain Word text runs
  const mathElements = Array.from(doc.getElementsByTagName('m:oMath'));
  for (const mathEl of mathElements) {
    if (mathEl.parentElement?.localName === 'oMath') continue;
    const mathTexts = Array.from(mathEl.getElementsByTagName('m:t'))
      .map((t) => t.textContent || '')
      .join('');
    if (mathTexts.trim() && mathEl.parentNode) {
      const r = doc.createElementNS(W_NS, 'w:r');
      const t = doc.createElementNS(W_NS, 'w:t');
      t.setAttribute('xml:space', 'preserve');
      t.textContent = mathTexts;
      r.appendChild(t);
      const target =
        mathEl.parentElement?.localName === 'oMathPara' ? mathEl.parentElement : mathEl;
      target.parentNode?.replaceChild(r, target);
    }
  }

  // 2. Preserve <mc:AlternateContent> where <mc:Fallback> is missing or empty of content
  const altContents = Array.from(doc.getElementsByTagName('mc:AlternateContent'));
  for (const alt of altContents) {
    const fallback = Array.from(alt.children).find((c) => c.localName === 'Fallback');
    const choice = Array.from(alt.children).find((c) => c.localName === 'Choice');
    if (!choice) continue;

    const fallbackHasContent = Boolean(
      fallback &&
        ((fallback.textContent || '').trim().length > 0 ||
          fallback.getElementsByTagName('v:imagedata').length > 0 ||
          fallback.getElementsByTagName('a:blip').length > 0)
    );
    if (!fallbackHasContent && alt.parentNode) {
      const txbxList = Array.from(choice.getElementsByTagName('w:txbxContent'));
      if (txbxList.length > 0) {
        const frag = doc.createDocumentFragment();
        for (const txbx of txbxList) {
          for (const child of Array.from(txbx.children)) {
            frag.appendChild(child.cloneNode(true));
          }
        }
        alt.parentNode.replaceChild(frag, alt);
      } else {
        const frag = doc.createDocumentFragment();
        for (const child of Array.from(choice.children)) {
          frag.appendChild(child.cloneNode(true));
        }
        alt.parentNode.replaceChild(frag, alt);
      }
    }
  }

  // 3. Preserve <w:pageBreakBefore/> and mid-document <w:sectPr> section breaks
  const body = doc.getElementsByTagName('w:body')[0];
  if (body) {
    const paragraphs = Array.from(body.getElementsByTagName('w:p'));
    for (let idx = 0; idx < paragraphs.length; idx++) {
      const p = paragraphs[idx];
      const pPr = Array.from(p.children).find((c) => c.localName === 'pPr');
      if (!pPr) continue;

      const pbb = Array.from(pPr.children).find((c) => c.localName === 'pageBreakBefore');
      if (pbb && idx > 0) {
        const val = pbb.getAttribute('w:val') ?? pbb.getAttribute('val');
        if (val !== '0' && val !== 'false' && p.parentNode) {
          p.parentNode.insertBefore(createPageBreakParagraph(), p);
        }
      }

      const sectPr = Array.from(pPr.children).find((c) => c.localName === 'sectPr');
      if (sectPr && p.parentNode) {
        const typeEl = Array.from(sectPr.children).find((c) => c.localName === 'type');
        const sectType = typeEl?.getAttribute('w:val') ?? typeEl?.getAttribute('val') ?? '';
        if (sectType !== 'continuous') {
          p.parentNode.insertBefore(createPageBreakParagraph(), p.nextSibling);
        }
      }
    }
  }

  return new XMLSerializer().serializeToString(doc);
}

async function preprocessDocxBuffer(arrayBuffer: ArrayBuffer): Promise<{
  buffer: ArrayBuffer;
  fallbackText: string;
}> {
  let fallbackText = '';
  try {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const docEntryKey = Object.keys(zip.files).find(
      (k) => !zip.files[k].dir && /^word\/document[^/]*\.xml$/i.test(k.replace(/^\/+/, ''))
    );
    const docEntry = (docEntryKey ? zip.files[docEntryKey] : null) || zip.file('word/document.xml');
    if (!docEntry) {
      return { buffer: arrayBuffer, fallbackText: '' };
    }
    const rawXml = await docEntry.async('string');

    if (typeof DOMParser !== 'undefined') {
      const parsed = new DOMParser().parseFromString(rawXml, 'application/xml');
      const texts = Array.from(parsed.getElementsByTagName('*'))
        .filter((e) => e.localName === 't')
        .map((n) => n.textContent || '')
        .join(' ')
        .trim();
      fallbackText = texts;
    }

    const patchedXml = preprocessDocxXmlString(rawXml);
    if (patchedXml !== rawXml) {
      zip.file(docEntry.name, patchedXml);
      const nextBuffer = await zip.generateAsync({ type: 'arraybuffer' });
      return { buffer: nextBuffer, fallbackText };
    }
    return { buffer: arrayBuffer, fallbackText };
  } catch {
    return { buffer: arrayBuffer, fallbackText };
  }
}

async function collectAnyXmlTextFromDocxZip(arrayBuffer: ArrayBuffer): Promise<string> {
  if (typeof DOMParser === 'undefined') return '';
  try {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const parser = new DOMParser();
    const collected: string[] = [];
    const candidateKeys = Object.keys(zip.files)
      .filter(
        (k) =>
          !zip.files[k].dir &&
          /^word\/(document|header|footer|footnotes|endnotes|diagrams\/data)[^/]*\.xml$/i.test(
            k.replace(/^\/+/, '')
          )
      )
      .sort();
    for (const key of candidateKeys) {
      const xmlStr = await zip.files[key].async('string');
      const xml = parser.parseFromString(xmlStr, 'application/xml');
      const txt = Array.from(xml.getElementsByTagName('*'))
        .filter((e) => e.localName === 't')
        .map((n) => n.textContent || '')
        .join(' ')
        .trim();
      if (txt) collected.push(txt);
    }
    return collected.join('\n\n').trim();
  } catch {
    return '';
  }
}

async function processDocxBuffer(
  fileName: string,
  mimeType: string,
  arrayBuffer: ArrayBuffer
): Promise<ImportedDocumentResult> {
  const baseTitle = fileName.replace(/\.[^.]+$/, '') || 'Imported Document';
  let html = '';
  let fallbackText = '';

  // Primary: Direct OOXML format-preserving converter (fonts, sizes, colors, highlights, alignment, indents, spacing, tables, lists, textboxes, altChunk, footnotes, images)
  try {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const ooxmlResult = await convertDocxZipToHtml(zip, (rawUrl) =>
      inspectAndCompressImageDataUrl(rawUrl, {
        maxWidth: 1200,
        quality: 0.85,
        forceJpegOverBytes: 260000,
      })
    );
    if (ooxmlResult && hasMeaningfulHtmlContent(ooxmlResult.html)) {
      html = ooxmlResult.html;
      fallbackText = ooxmlResult.fallbackText;
    } else if (ooxmlResult?.fallbackText) {
      fallbackText = ooxmlResult.fallbackText;
    }
  } catch (ooxmlErr) {
    console.warn('Direct OOXML converter fallback to Mammoth:', ooxmlErr);
  }

  // Secondary fallback: Mammoth if OOXML conversion yielded empty or blank output
  if (!hasMeaningfulHtmlContent(html)) {
    const prepped = await preprocessDocxBuffer(arrayBuffer);
    if (!fallbackText) fallbackText = prepped.fallbackText;

    try {
      const result = await mammoth.convertToHtml(
        { arrayBuffer: prepped.buffer },
        {
          styleMap: ["br[type='page'] => hr.page-break-marker:fresh"],
          convertImage: mammoth.images.imgElement(async (image) => {
            const base64 = await image.read('base64');
            const mime = image.contentType || 'image/png';
            const rawUrl = `data:${mime};base64,${base64}`;
            const inspected = await inspectAndCompressImageDataUrl(rawUrl, {
              maxWidth: 1200,
              quality: 0.85,
              forceJpegOverBytes: 260000,
            });
            if (!inspected.renderable && inspected.dataUrl.length > MAX_SINGLE_IMAGE_DATA_URL_BYTES) {
              return {
                src: '',
                alt: `[Embedded image (${mime}) omitted: unsupported browser format]`,
              };
            }
            const attrs: { src: string } & Record<string, string> = { src: inspected.dataUrl };
            if (inspected.width && inspected.height) {
              attrs.width = String(inspected.width);
              attrs.height = String(inspected.height);
            }
            return attrs;
          }),
        }
      );
      const mammothHtml = (result.value || '').trim();
      if (hasMeaningfulHtmlContent(mammothHtml)) {
        html = mammothHtml;
      }
    } catch (err) {
      console.warn('DOCX convertToHtml fallback triggered:', err);
    }
  }

  let plain = html ? stripHtmlToPlain(html) : '';
  if (!plain && !html.includes('<img')) {
    try {
      const rawRes = await mammoth.extractRawText({ arrayBuffer });
      const rawText =
        (rawRes.value || '').trim() ||
        fallbackText ||
        (await collectAnyXmlTextFromDocxZip(arrayBuffer));
      if (rawText) {
        html = textToParagraphHtml(rawText);
        plain = stripHtmlToPlain(html);
      }
    } catch {
      const recovered = fallbackText || (await collectAnyXmlTextFromDocxZip(arrayBuffer));
      if (recovered) {
        html = textToParagraphHtml(recovered);
        plain = stripHtmlToPlain(html);
      }
    }
  }

  if (!html) html = '<p></p>';
  const explicitBreaks = (html.match(/<hr[^>]*page-break-marker/gi) || []).length;

  return {
    title: baseTitle,
    sourceType: 'docx',
    contentHtml: html,
    plainText: plain,
    pageCountEstimate: Math.max(1, explicitBreaks + 1, Math.ceil(plain.length / 1800)),
    binaryBytes: arrayBuffer,
    mimeType:
      mimeType || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    fileName,
  };
}

function looksLikeHtmlOrMhtmlDocument(text: string): boolean {
  const sample = text.replace(/^\uFEFF/, '').slice(0, 6000).trimStart().toLowerCase();
  return (
    sample.startsWith('<!doctype html') ||
    sample.startsWith('<html') ||
    (sample.includes('<html') && (sample.includes('<body') || sample.includes('<table') || sample.includes('<p'))) ||
    (sample.includes('mime-version:') && (sample.includes('text/html') || sample.includes('multipart/'))) ||
    (sample.includes('urn:schemas-microsoft-com:office:word') && sample.includes('<body'))
  );
}

function looksLikeWordXmlDocument(text: string): boolean {
  const sample = text.replace(/^\uFEFF/, '').slice(0, 3000).trimStart().toLowerCase();
  return (
    sample.includes('<w:worddocument') ||
    sample.includes('<worddocument') ||
    sample.includes('<pkg:package') ||
    (sample.startsWith('<?xml') &&
      (sample.includes('word.document') ||
        sample.includes('schemas.microsoft.com/office/word') ||
        sample.includes('schemas.openxmlformats.org/wordprocessingml')))
  );
}

function arrayBufferToDataUrl(buffer: ArrayBuffer, mimeType: string): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function detectMagicImageMime(bytes: Uint8Array, fallbackName: string, fallbackType: string): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return 'image/gif';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return 'image/bmp';
  }
  if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) {
    return 'image/x-icon';
  }
  if (
    bytes.length >= 4 &&
    ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
      (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a))
  ) {
    return 'image/tiff';
  }
  if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]).toLowerCase();
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (brand === 'heic' || brand === 'heix' || brand === 'mif1') return 'image/heic';
  }

  const ext = fallbackName.split('.').pop()?.toLowerCase() || '';
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'bmp') return 'image/bmp';
  if (ext === 'avif') return 'image/avif';
  if (ext === 'ico') return 'image/x-icon';
  if (ext === 'tif' || ext === 'tiff') return 'image/tiff';
  if (fallbackType.startsWith('image/')) return fallbackType;
  return null;
}

function hasPdfSignature(bytes: Uint8Array): boolean {
  const searchLen = Math.min(bytes.length, 1024);
  for (let i = 0; i + 4 < searchLen; i++) {
    if (
      bytes[i] === 0x25 &&
      bytes[i + 1] === 0x50 &&
      bytes[i + 2] === 0x44 &&
      bytes[i + 3] === 0x46 &&
      bytes[i + 4] === 0x2d
    ) {
      return true;
    }
  }
  return false;
}

function isOle2Signature(bytes: Uint8Array): boolean {
  const oleMagic = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (bytes.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== oleMagic[i]) return false;
  }
  return true;
}

function isZipSignature(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  return (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
      (bytes[2] === 0x05 && bytes[3] === 0x06) ||
      (bytes[2] === 0x07 && bytes[3] === 0x08))
  );
}

function looksLikeReadableText(bytes: Uint8Array, decoded: string): boolean {
  if (!decoded.trim()) return false;
  const sampleLen = Math.min(bytes.length, 2048);
  let suspiciousCtrl = 0;
  for (let i = 0; i < sampleLen; i++) {
    const b = bytes[i];
    if (b < 9 || (b > 13 && b < 32 && b !== 27)) {
      suspiciousCtrl++;
    }
  }
  if (suspiciousCtrl / Math.max(1, sampleLen) < 0.04) return true;
  // Also allow UTF-16LE/BE files that contain valid Unicode letters/Khmer
  let readableChars = 0;
  const strSample = decoded.slice(0, 1000);
  for (let i = 0; i < strSample.length; i++) {
    const c = strSample.charCodeAt(i);
    if ((c >= 32 && c <= 126) || c === 9 || c === 10 || c === 13 || (c >= 0x1780 && c <= 0x17ff) || c >= 0x00a0) {
      readableChars++;
    }
  }
  return strSample.length > 0 && readableChars / strSample.length >= 0.72;
}

function buildHtmlImportResult(
  fileName: string,
  baseTitle: string,
  sourceType: DocumentSourceType,
  html: string,
  mimeType: string,
  binaryBytes: ArrayBuffer
): ImportedDocumentResult {
  const safeHtml = html && html.trim() ? html : '<p></p>';
  const plain = stripHtmlToPlain(safeHtml);
  const explicitBreaks = (safeHtml.match(/<hr[^>]*page-break-marker/gi) || []).length;
  return {
    title: baseTitle,
    sourceType,
    contentHtml: safeHtml,
    plainText: plain || `[Document: ${fileName}]`,
    pageCountEstimate: Math.max(1, explicitBreaks + 1, Math.ceil(plain.length / 1800)),
    binaryBytes,
    mimeType,
    fileName,
  };
}

async function processZipArchiveFile(
  file: File,
  ext: string,
  baseTitle: string,
  arrayBuffer: ArrayBuffer
): Promise<ImportedDocumentResult> {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const entryNames = Object.keys(zip.files).filter((k) => !zip.files[k].dir);
  const hasEntry = (pattern: RegExp) => entryNames.some((k) => pattern.test(k.replace(/^\/+/, '')));
  const imageInspector = (rawUrl: string) =>
    inspectAndCompressImageDataUrl(rawUrl, {
      maxWidth: 1200,
      quality: 0.85,
      forceJpegOverBytes: 260000,
    });

  // 1. WordprocessingML (.docx / .docm / .dotx / .dotm)
  if (
    hasEntry(/^word\/document[^/]*\.xml$/i) ||
    ['docx', 'docm', 'dotx', 'dotm'].includes(ext)
  ) {
    return processDocxBuffer(file.name, file.type, arrayBuffer);
  }

  // 2. SpreadsheetML (.xlsx / .xlsm / .xltx / .xltm)
  if (
    hasEntry(/^xl\/(workbook\.xml|sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/i) ||
    ['xlsx', 'xlsm', 'xltx', 'xltm'].includes(ext)
  ) {
    const html = await convertXlsxZipToHtml(zip);
    return buildHtmlImportResult(
      file.name,
      baseTitle,
      'doc',
      html,
      file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      arrayBuffer
    );
  }

  // 3. PresentationML (.pptx / .pptm / .ppsx / .potx)
  if (
    hasEntry(/^ppt\/(presentation\.xml|slides\/slide\d+\.xml)$/i) ||
    ['pptx', 'pptm', 'ppsx', 'potx'].includes(ext)
  ) {
    const html = await convertPptxZipToHtml(zip, imageInspector);
    return buildHtmlImportResult(
      file.name,
      baseTitle,
      'docx',
      html,
      file.type || 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      arrayBuffer
    );
  }

  // 4. OpenDocument (.odt / .ott / .ods / .ots / .odp / .otp) & EPUB
  let odfMime = '';
  const mimeEntry = zip.file('mimetype');
  if (mimeEntry) {
    odfMime = (await mimeEntry.async('string')).trim().toLowerCase();
  }

  if (
    odfMime.includes('epub') ||
    hasEntry(/^META-INF\/container\.xml$/i) && !hasEntry(/^content\.xml$/i) ||
    ext === 'epub'
  ) {
    const html = await convertEpubZipToHtml(zip);
    return buildHtmlImportResult(
      file.name,
      baseTitle,
      'docx',
      html,
      file.type || 'application/epub+zip',
      arrayBuffer
    );
  }

  if (hasEntry(/^content\.xml$/i)) {
    if (odfMime.includes('spreadsheet') || ext === 'ods' || ext === 'ots') {
      const html = await convertOdsZipToHtml(zip);
      return buildHtmlImportResult(
        file.name,
        baseTitle,
        'doc',
        html,
        file.type || 'application/vnd.oasis.opendocument.spreadsheet',
        arrayBuffer
      );
    }
    if (odfMime.includes('presentation') || ext === 'odp' || ext === 'otp') {
      const html = await convertOdpZipToHtml(zip, imageInspector);
      return buildHtmlImportResult(
        file.name,
        baseTitle,
        'docx',
        html,
        file.type || 'application/vnd.oasis.opendocument.presentation',
        arrayBuffer
      );
    }
    const html = await convertOdtZipToHtml(zip, imageInspector);
    return buildHtmlImportResult(
      file.name,
      baseTitle,
      'docx',
      html,
      file.type || 'application/vnd.oasis.opendocument.text',
      arrayBuffer
    );
  }

  // 5. Generic ZIP archive: extract readable text/document files inside
  const readableParts: string[] = [];
  const textCandidates = entryNames
    .filter((k) => /\.(txt|md|csv|tsv|html?|xhtml|xml|json|log|rtf)$/i.test(k))
    .sort()
    .slice(0, 30);

  for (const key of textCandidates) {
    try {
      const raw = await zip.files[key].async('string');
      if (!raw.trim()) continue;
      const lower = key.toLowerCase();
      if (lower.endsWith('.rtf') || raw.trimStart().startsWith('{\\rtf')) {
        readableParts.push(`<h3>${escapeHtml(key)}</h3>\n${parseRtfToHtml(raw)}`);
      } else if (lower.endsWith('.html') || lower.endsWith('.htm') || lower.endsWith('.xhtml')) {
        readableParts.push(`<h3>${escapeHtml(key)}</h3>\n${extractFormattedHtmlBody(raw)}`);
      } else if (lower.endsWith('.csv')) {
        readableParts.push(`<h3>${escapeHtml(key)}</h3>\n${csvOrTsvToHtml(raw, ',')}`);
      } else if (lower.endsWith('.tsv')) {
        readableParts.push(`<h3>${escapeHtml(key)}</h3>\n${csvOrTsvToHtml(raw, '\t')}`);
      } else if (lower.endsWith('.md')) {
        readableParts.push(`<h3>${escapeHtml(key)}</h3>\n${markdownToHtml(raw)}`);
      } else if (lower.endsWith('.xml')) {
        readableParts.push(`<h3>${escapeHtml(key)}</h3>\n${convertGenericXmlToHtml(raw)}`);
      } else {
        readableParts.push(`<h3>${escapeHtml(key)}</h3>\n${plainTextToPreservedHtml(raw.slice(0, 40000))}`);
      }
    } catch {
      // Skip unreadable archive entry
    }
  }

  if (readableParts.length > 0) {
    return buildHtmlImportResult(
      file.name,
      baseTitle,
      'doc',
      readableParts.join('\n<hr class="page-break-marker" />\n'),
      file.type || 'application/zip',
      arrayBuffer
    );
  }

  const listingHtml = `<h2>${escapeHtml(file.name)}</h2><p>${escapeHtml(
    `ZIP Archive (${entryNames.length} entries): ${entryNames.slice(0, 30).join(', ')}`
  )}</p>`;
  return buildHtmlImportResult(
    file.name,
    baseTitle,
    'txt',
    listingHtml,
    file.type || 'application/zip',
    arrayBuffer
  );
}

export async function processImportedFile(file: File): Promise<ImportedDocumentResult> {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const mime = (file.type || '').toLowerCase();
  const baseTitle = file.name.replace(/\.[^.]+$/, '') || 'Imported Document';
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  // 1. PDF detection (magic signature anywhere in header OR .pdf extension/MIME)
  if (hasPdfSignature(bytes) || ext === 'pdf' || mime === 'application/pdf') {
    return processPdfFile(file, arrayBuffer);
  }

  // 2. ZIP container formats (DOCX/DOCM/DOTX, XLSX/XLSM, PPTX/PPTM/PPSX, ODT/ODS/ODP, EPUB, generic ZIP)
  if (
    isZipSignature(bytes) ||
    [
      'docx', 'docm', 'dotx', 'dotm',
      'xlsx', 'xlsm', 'xltx', 'xltm',
      'pptx', 'pptm', 'ppsx', 'potx',
      'odt', 'ott', 'ods', 'ots', 'odp', 'otp',
      'epub', 'zip',
    ].includes(ext)
  ) {
    if (isZipSignature(bytes)) {
      return processZipArchiveFile(file, ext, baseTitle, arrayBuffer);
    }
    // File had OOXML extension but wasn't actually a ZIP (fall through to magic-byte/text inspection below)
  }

  // 3. Image formats (by magic bytes, MIME type, or extension)
  const detectedImgMime = detectMagicImageMime(bytes, file.name, mime);
  if (detectedImgMime) {
    const rawUrl =
      file.type && file.type.startsWith('image/')
        ? await readFileAsDataUrl(file)
        : arrayBufferToDataUrl(arrayBuffer, detectedImgMime);
    const inspected = await inspectAndCompressImageDataUrl(rawUrl, {
      maxWidth: 1600,
      quality: 0.9,
      forceJpegOverBytes: MAX_SINGLE_IMAGE_DATA_URL_BYTES,
    });
    if (inspected.renderable) {
      const dimAttrs =
        inspected.width && inspected.height
          ? ` width="${inspected.width}" height="${inspected.height}"`
          : '';
      const html = `<p style="text-align: center"><img src="${inspected.dataUrl}" alt="${escapeHtml(baseTitle)}"${dimAttrs} /></p>`;
      return {
        title: baseTitle,
        sourceType: 'image',
        contentHtml: html,
        plainText: `[Image: ${file.name}]`,
        pageCountEstimate: 1,
        needsOcrHint: true,
        binaryBytes: arrayBuffer,
        mimeType: detectedImgMime,
        fileName: file.name,
        thumbnailDataUrl: inspected.dataUrl,
      };
    }
    return {
      title: baseTitle,
      sourceType: 'image',
      contentHtml: `<p>[Image: ${escapeHtml(file.name)} (${escapeHtml(detectedImgMime)}, ${Math.max(1, Math.round(bytes.length / 1024))} KB) — binary preserved]</p>`,
      plainText: `[Image: ${file.name}]`,
      pageCountEstimate: 1,
      needsOcrHint: true,
      binaryBytes: arrayBuffer,
      mimeType: detectedImgMime,
      fileName: file.name,
    };
  }

  // 4. OLE2 Compound Binary formats (.doc, .dot, .wps, .xls, .ppt, .pps, .msg)
  if (isOle2Signature(bytes)) {
    const extracted = extractLegacyDocText(arrayBuffer);
    const html = legacyDocTextToHtml(extracted);
    return buildHtmlImportResult(
      file.name,
      baseTitle,
      'doc',
      html,
      file.type || 'application/msword',
      arrayBuffer
    );
  }

  // 5. Text & structured markup formats (auto-detect BOM/UTF-16/UTF-8/Win-1252)
  const decodedText = decodeTextBufferAuto(arrayBuffer);
  const trimmedDecoded = decodedText.replace(/^\uFEFF/, '').trimStart();

  if (trimmedDecoded.startsWith('{\\rtf') || ext === 'rtf') {
    const html = parseRtfToHtml(trimmedDecoded);
    return buildHtmlImportResult(file.name, baseTitle, 'rtf', html, 'application/rtf', arrayBuffer);
  }

  if (looksLikeWordXmlDocument(decodedText)) {
    const html = convertWordXmlToHtml(trimmedDecoded);
    return buildHtmlImportResult(
      file.name,
      baseTitle,
      'doc',
      html,
      file.type || 'application/xml',
      arrayBuffer
    );
  }

  if (
    looksLikeHtmlOrMhtmlDocument(decodedText) ||
    ['html', 'htm', 'xhtml', 'mht', 'mhtml'].includes(ext)
  ) {
    const html = extractFormattedHtmlBody(decodedText);
    return buildHtmlImportResult(
      file.name,
      baseTitle,
      'doc',
      html,
      file.type || 'text/html',
      arrayBuffer
    );
  }

  if (trimmedDecoded.startsWith('<?xml') || ext === 'xml') {
    const html = convertGenericXmlToHtml(trimmedDecoded);
    return buildHtmlImportResult(
      file.name,
      baseTitle,
      'doc',
      html,
      file.type || 'application/xml',
      arrayBuffer
    );
  }

  if (ext === 'csv' || ext === 'tsv') {
    const html = csvOrTsvToHtml(decodedText, ext === 'tsv' ? '\t' : ',');
    return buildHtmlImportResult(
      file.name,
      baseTitle,
      'doc',
      html,
      file.type || (ext === 'tsv' ? 'text/tab-separated-values' : 'text/csv'),
      arrayBuffer
    );
  }

  if (ext === 'md' || ext === 'markdown') {
    const html = markdownToHtml(decodedText);
    return buildHtmlImportResult(file.name, baseTitle, 'txt', html, 'text/markdown', arrayBuffer);
  }

  if (ext === 'json' || ext === 'jsonl') {
    let formattedJson = decodedText;
    try {
      if (ext === 'json') {
        formattedJson = JSON.stringify(JSON.parse(trimmedDecoded), null, 2);
      }
    } catch {
      // Keep original text if invalid JSON
    }
    const html = plainTextToPreservedHtml(formattedJson);
    return buildHtmlImportResult(
      file.name,
      baseTitle,
      'txt',
      html,
      file.type || 'application/json',
      arrayBuffer
    );
  }

  if (
    ['txt', 'log', 'yaml', 'yml', 'ini', 'cfg', 'conf', 'env', 'tex', 'srt', 'vtt', 'sql', 'js', 'ts', 'tsx', 'jsx', 'css', 'py', 'java', 'c', 'cpp', 'sh'].includes(ext) ||
    looksLikeReadableText(bytes, decodedText)
  ) {
    const html = plainTextToPreservedHtml(decodedText);
    return buildHtmlImportResult(
      file.name,
      baseTitle,
      'txt',
      html,
      file.type || 'text/plain',
      arrayBuffer
    );
  }

  // 6. Universal binary fallback: salvage readable Unicode/ASCII text runs or preserve cleanly
  const salvagedRuns = scanBytesForDocTextRuns(bytes);
  if (salvagedRuns.length > 0) {
    const html = legacyDocTextToHtml(salvagedRuns.join('\n\n'));
    return buildHtmlImportResult(
      file.name,
      baseTitle,
      ext === 'doc' || ext === 'dot' || ext === 'wps' || ext === 'xls' || ext === 'ppt' ? 'doc' : 'txt',
      html,
      file.type || 'application/octet-stream',
      arrayBuffer
    );
  }

  const fallbackMsg = `[Imported file: ${file.name} (${file.type || ext || 'binary'}, ${Math.max(1, Math.round(bytes.length / 1024))} KB)]`;
  return {
    title: baseTitle,
    sourceType: 'txt',
    contentHtml: `<p>${escapeHtml(fallbackMsg)}</p>`,
    plainText: fallbackMsg,
    pageCountEstimate: 1,
    binaryBytes: arrayBuffer,
    mimeType: file.type || 'application/octet-stream',
    fileName: file.name,
  };
}

const UNWRAP_STORAGE_TAGS = new Set([
  'div',
  'section',
  'article',
  'main',
  'header',
  'footer',
  'aside',
]);

function flattenHtmlElementsForStorage(container: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];

  const visit = (nodes: ChildNode[]) => {
    for (const node of nodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const txt = (node.textContent || '').trim();
        if (txt) {
          const p = document.createElement('p');
          p.textContent = txt;
          out.push(p);
        }
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();

      if (
        el.classList.contains('dm-pdf-page-marker') ||
        el.classList.contains('dm-toc-block')
      ) {
        out.push(el);
        continue;
      }

      if (UNWRAP_STORAGE_TAGS.has(tag) && el.children.length > 0) {
        visit(Array.from(el.childNodes));
        continue;
      }

      out.push(el);
    }
  };

  visit(Array.from(container.childNodes));
  return out;
}

function splitOversizedStorageElement(
  el: HTMLElement,
  maxHtmlBytes: number,
  maxPlainBytes: number
): Array<{ html: string; plain: string }> {
  const initialHtml = el.outerHTML;
  const initialPlain = (el.textContent || '').trim();
  if (
    utf8ByteLength(initialHtml) <= maxHtmlBytes &&
    utf8ByteLength(initialPlain) <= maxPlainBytes
  ) {
    return [{ html: initialHtml, plain: initialPlain }];
  }

  const tag = el.tagName.toLowerCase();

  const styleAttr = el.getAttribute('style')
    ? ` style="${escapeHtml(el.getAttribute('style') || '')}"`
    : '';
  const classAttr = el.className ? ` class="${escapeHtml(el.className)}"` : '';

  // Split oversized <table> by direct rows while preserving table class/style
  if (tag === 'table') {
    const thead = Array.from(el.children).find((c) => c.tagName.toLowerCase() === 'thead');
    const headerHtml = thead ? thead.outerHTML : '';
    const directRows: HTMLElement[] = [];
    for (const child of Array.from(el.children)) {
      const cTag = child.tagName.toLowerCase();
      if (cTag === 'tr') directRows.push(child as HTMLElement);
      else if (cTag === 'tbody' || cTag === 'tfoot') {
        for (const r of Array.from(child.children)) {
          if (r.tagName.toLowerCase() === 'tr') directRows.push(r as HTMLElement);
        }
      }
    }
    if (directRows.length >= 2) {
      const chunks: Array<{ html: string; plain: string }> = [];
      let bucketRows: string[] = [];
      let bucketPlain: string[] = [];

      const buildTable = (rowsHtml: string[]) =>
        `<table${classAttr}${styleAttr}>${headerHtml}<tbody>${rowsHtml.join('')}</tbody></table>`;

      for (const row of directRows) {
        const rowHtml = row.outerHTML;
        const rowPlain = (row.textContent || '').trim();
        const candidateHtml = buildTable([...bucketRows, rowHtml]);
        const candidatePlain = [...bucketPlain, rowPlain].filter(Boolean).join(' ');
        if (
          bucketRows.length > 0 &&
          (utf8ByteLength(candidateHtml) > maxHtmlBytes ||
            utf8ByteLength(candidatePlain) > maxPlainBytes)
        ) {
          chunks.push({
            html: buildTable(bucketRows),
            plain: bucketPlain.filter(Boolean).join(' '),
          });
          bucketRows = [rowHtml];
          bucketPlain = rowPlain ? [rowPlain] : [];
        } else {
          bucketRows.push(rowHtml);
          if (rowPlain) bucketPlain.push(rowPlain);
        }
      }
      if (bucketRows.length > 0) {
        chunks.push({
          html: buildTable(bucketRows),
          plain: bucketPlain.filter(Boolean).join(' '),
        });
      }
      if (chunks.length > 0) return chunks;
    }
  }

  // Split oversized <ul> / <ol> by <li> items while preserving list class/style
  if (tag === 'ul' || tag === 'ol') {
    const items = Array.from(el.children).filter((c) => c.tagName.toLowerCase() === 'li');
    if (items.length >= 2) {
      const baseStart = tag === 'ol' ? Number(el.getAttribute('start')) || 1 : 1;
      const chunks: Array<{ html: string; plain: string }> = [];
      let bucketItems: string[] = [];
      let bucketPlain: string[] = [];
      let curStart = baseStart;

      const wrapList = (itemsHtml: string[], startVal: number) => {
        const startAttr = tag === 'ol' && startVal !== 1 ? ` start="${startVal}"` : '';
        return `<${tag}${startAttr}${classAttr}${styleAttr}>${itemsHtml.join('')}</${tag}>`;
      };

      items.forEach((li, idx) => {
        const liHtml = li.outerHTML;
        const liPlain = (li.textContent || '').trim();
        const candidateHtml = wrapList([...bucketItems, liHtml], curStart);
        const candidatePlain = [...bucketPlain, liPlain].filter(Boolean).join(' ');
        if (
          bucketItems.length > 0 &&
          (utf8ByteLength(candidateHtml) > maxHtmlBytes ||
            utf8ByteLength(candidatePlain) > maxPlainBytes)
        ) {
          chunks.push({
            html: wrapList(bucketItems, curStart),
            plain: bucketPlain.filter(Boolean).join(' '),
          });
          bucketItems = [liHtml];
          bucketPlain = liPlain ? [liPlain] : [];
          curStart = baseStart + idx;
        } else {
          bucketItems.push(liHtml);
          if (liPlain) bucketPlain.push(liPlain);
        }
      });
      if (bucketItems.length > 0) {
        chunks.push({
          html: wrapList(bucketItems, curStart),
          plain: bucketPlain.filter(Boolean).join(' '),
        });
      }
      if (chunks.length > 0) return chunks;
    }
  }

  // Split elements containing multiple embedded images (e.g. a single <p> holding many images)
  const imgs = Array.from(el.querySelectorAll('img'));
  if (imgs.length > 1) {
    const out: Array<{ html: string; plain: string }> = [];
    for (const img of imgs) {
      const imgHtml = `<p${classAttr}${styleAttr}>${img.outerHTML}</p>`;
      if (utf8ByteLength(imgHtml) <= maxHtmlBytes) {
        out.push({ html: imgHtml, plain: img.getAttribute('alt') || '' });
      }
    }
    if (initialPlain) {
      for (const txtPart of splitLongPlainText(initialPlain, Math.min(maxPlainBytes, 30000))) {
        out.push({ html: `<p${classAttr}${styleAttr}>${escapeHtml(txtPart)}</p>`, plain: txtPart });
      }
    }
    if (out.length > 0) return out;
  }

  // Split giant text element by plain-text chunks safely under both limits while preserving block styling
  if (initialPlain) {
    const safeTextBudget = Math.min(maxPlainBytes - 1000, Math.floor((maxHtmlBytes - 1000) / 2));
    const textPieces = splitLongPlainText(initialPlain, Math.max(4000, safeTextBudget));
    const safeTag = ['p', 'blockquote', 'pre', 'h1', 'h2', 'h3'].includes(tag) ? tag : 'p';
    return textPieces.map((piece) => ({
      html: `<${safeTag}${classAttr}${styleAttr}>${escapeHtml(piece)}</${safeTag}>`,
      plain: piece,
    }));
  }

  if (imgs.length === 1) {
    const safeAlt = imgs[0].getAttribute('alt') || 'Embedded image';
    const note = initialPlain || `[${safeAlt}]`;
    return [
      {
        html: `<p${classAttr}${styleAttr}>${escapeHtml(clampUtf8(note, Math.min(maxPlainBytes, 30000)))}</p>`,
        plain: clampUtf8(note, Math.min(maxPlainBytes, 30000)),
      },
    ];
  }

  return [{ html: clampUtf8(initialHtml, maxHtmlBytes), plain: '' }];
}

function splitPdfResultForStorage(imported: ImportedDocumentResult): ImportedDocumentResult[] {
  const htmlBytes = utf8ByteLength(imported.contentHtml || '');
  const plainBytes = utf8ByteLength(imported.plainText || '');
  if (htmlBytes <= MAX_STORAGE_HTML_BYTES && plainBytes <= MAX_STORAGE_PLAIN_BYTES) {
    return [imported];
  }
  if (typeof window === 'undefined') {
    return [imported];
  }

  const container = document.createElement('div');
  container.innerHTML = imported.contentHtml || '';
  const markers = Array.from(container.querySelectorAll('.dm-pdf-page-marker'));
  if (markers.length <= 1) {
    return [
      {
        ...imported,
        plainText: clampUtf8(imported.plainText || imported.title, MAX_STORAGE_PLAIN_BYTES),
      },
    ];
  }

  const textPages = imported.extractedTextPages || [];
  const chunks: ImportedDocumentResult[] = [];
  let bucketHtml: string[] = [];
  let bucketPlain: string[] = [];
  let bucketHtmlBytes = 0;
  let bucketPlainBytes = 0;

  const flushPdfBucket = () => {
    if (bucketHtml.length === 0) return;
    const partIdx = chunks.length + 1;
    const html = bucketHtml.join('\n');
    const rawPlain = bucketPlain.join('\n\n').trim() || `[PDF Document: ${imported.fileName}]`;
    const plain = clampUtf8(rawPlain, MAX_STORAGE_PLAIN_BYTES);
    const isFirst = partIdx === 1;
    chunks.push({
      ...imported,
      title: clampUtf8(`${imported.title} (Part ${partIdx})`, 200),
      contentHtml: html,
      plainText: plain,
      pageCountEstimate: bucketHtml.length,
      binaryBytes: isFirst ? imported.binaryBytes : undefined,
      thumbnailDataUrl: isFirst ? imported.thumbnailDataUrl : undefined,
      pageDataUrls: isFirst ? imported.pageDataUrls : undefined,
      pageSizesPt: isFirst ? imported.pageSizesPt : undefined,
      extractedTextPages: undefined,
    });
    bucketHtml = [];
    bucketPlain = [];
    bucketHtmlBytes = 0;
    bucketPlainBytes = 0;
  };

  markers.forEach((markerEl, idx) => {
    const pageNum = Number(markerEl.getAttribute('data-pdf-page')) || idx + 1;
    const mHtml = markerEl.outerHTML;
    const pageText = (textPages[pageNum - 1] || '').trim();
    const clampedPageText =
      utf8ByteLength(pageText) > MAX_STORAGE_PLAIN_BYTES
        ? clampUtf8(pageText, MAX_STORAGE_PLAIN_BYTES)
        : pageText;
    const mHtmlBytes = utf8ByteLength(mHtml) + 1;
    const mPlainBytes = utf8ByteLength(clampedPageText) + 2;

    if (
      bucketHtml.length > 0 &&
      (bucketHtmlBytes + mHtmlBytes > MAX_STORAGE_HTML_BYTES ||
        bucketPlainBytes + mPlainBytes > MAX_STORAGE_PLAIN_BYTES)
    ) {
      flushPdfBucket();
    }

    bucketHtml.push(mHtml);
    if (clampedPageText) bucketPlain.push(clampedPageText);
    bucketHtmlBytes += mHtmlBytes;
    bucketPlainBytes += mPlainBytes;
  });
  flushPdfBucket();

  if (chunks.length === 1) {
    chunks[0].title = clampUtf8(imported.title, 200);
  }
  return chunks.length > 0 ? chunks : [imported];
}

export function splitImportedResultForStorage(
  imported: ImportedDocumentResult
): ImportedDocumentResult[] {
  if (imported.sourceType === 'pdf' && imported.contentHtml.includes('dm-pdf-page-marker')) {
    return splitPdfResultForStorage(imported);
  }

  const htmlBytes = utf8ByteLength(imported.contentHtml || '');
  const plainBytes = utf8ByteLength(imported.plainText || '');

  if (htmlBytes <= MAX_STORAGE_HTML_BYTES && plainBytes <= MAX_STORAGE_PLAIN_BYTES) {
    return [imported];
  }

  if (typeof window === 'undefined') {
    return [imported];
  }

  const container = document.createElement('div');
  container.innerHTML = imported.contentHtml || '<p></p>';
  const flattened = flattenHtmlElementsForStorage(container);
  const atomicPieces: Array<{ html: string; plain: string }> = [];

  for (const el of flattened) {
    atomicPieces.push(
      ...splitOversizedStorageElement(el, MAX_STORAGE_HTML_BYTES, MAX_STORAGE_PLAIN_BYTES)
    );
  }

  if (atomicPieces.length <= 1) {
    return [
      {
        ...imported,
        contentHtml: atomicPieces[0]?.html || clampUtf8(imported.contentHtml, MAX_STORAGE_HTML_BYTES),
        plainText:
          atomicPieces[0]?.plain || clampUtf8(imported.plainText, MAX_STORAGE_PLAIN_BYTES),
      },
    ];
  }

  const chunks: ImportedDocumentResult[] = [];
  let bucketHtml: string[] = [];
  let bucketPlain: string[] = [];
  let bucketHtmlBytes = 0;
  let bucketPlainBytes = 0;

  const flushBucket = () => {
    if (bucketHtml.length === 0) return;
    const partIdx = chunks.length + 1;
    const html = bucketHtml.join('\n');
    const plain = clampUtf8(
      bucketPlain.join('\n').trim() || imported.title,
      MAX_STORAGE_PLAIN_BYTES
    );
    const isFirst = partIdx === 1;
    const explicitBreaks = (html.match(/<hr[^>]*page-break-marker/gi) || []).length;
    chunks.push({
      ...imported,
      title: clampUtf8(`${imported.title} (Part ${partIdx})`, 200),
      contentHtml: html,
      plainText: plain,
      pageCountEstimate: Math.max(1, explicitBreaks + 1, Math.ceil(plain.length / 1800)),
      binaryBytes: isFirst ? imported.binaryBytes : undefined,
      thumbnailDataUrl: isFirst ? imported.thumbnailDataUrl : undefined,
      pageDataUrls: isFirst ? imported.pageDataUrls : undefined,
      pageSizesPt: isFirst ? imported.pageSizesPt : undefined,
      extractedTextPages: undefined,
    });
    bucketHtml = [];
    bucketPlain = [];
    bucketHtmlBytes = 0;
    bucketPlainBytes = 0;
  };

  for (const piece of atomicPieces) {
    const pieceHtmlBytes = utf8ByteLength(piece.html) + 1;
    const piecePlainBytes = utf8ByteLength(piece.plain) + 1;

    if (
      bucketHtml.length > 0 &&
      (bucketHtmlBytes + pieceHtmlBytes > MAX_STORAGE_HTML_BYTES ||
        bucketPlainBytes + piecePlainBytes > MAX_STORAGE_PLAIN_BYTES)
    ) {
      flushBucket();
    }

    bucketHtml.push(piece.html);
    if (piece.plain) bucketPlain.push(piece.plain);
    bucketHtmlBytes += pieceHtmlBytes;
    bucketPlainBytes += piecePlainBytes;
  }
  flushBucket();

  if (chunks.length === 1) {
    chunks[0].title = clampUtf8(imported.title, 200);
  }
  return chunks.length > 0 ? chunks : [imported];
}

export async function persistImportedBinaryIfPresent(
  docId: string,
  imported: ImportedDocumentResult,
  sourceBinaryDocId?: string
): Promise<void> {
  if (
    imported.binaryBytes ||
    imported.thumbnailDataUrl ||
    imported.pageDataUrls?.length ||
    sourceBinaryDocId
  ) {
    await saveBinaryRecord({
      docId,
      mimeType: imported.mimeType,
      fileName: imported.fileName,
      bytes: imported.binaryBytes,
      thumbnailDataUrl: imported.thumbnailDataUrl,
      pageDataUrls: imported.pageDataUrls,
      pageSizesPt: imported.pageSizesPt,
      sourceBinaryDocId,
    });
  }
}

export interface OcrExecutionResult {
  html: string;
  engine: 'gemini' | 'tesseract';
  notice?: string;
}

async function runLocalTesseractOcr(dataUrl: string): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(['khm', 'eng']);
  try {
    const result = await worker.recognize(dataUrl);
    const text = (result?.data?.text || '').trim();
    return text ? textToParagraphHtml(text) : '<p>No readable text detected.</p>';
  } finally {
    await worker.terminate();
  }
}

export async function runOcrOnImageDataUrl(dataUrl: string): Promise<OcrExecutionResult> {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Invalid image data URL for OCR');
  }
  const [, mimeType, base64Data] = match;
  const res = await fetch('/api/ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mimeType, base64Data }),
  });

  if (res.ok) {
    const data = (await res.json()) as { html?: string };
    return {
      html: data.html || '<p></p>',
      engine: 'gemini',
    };
  }

  const errPayload = (await res.json().catch(() => ({ error: 'OCR request failed' }))) as {
    error?: string;
  };
  const cloudReason = errPayload.error || 'Cloud OCR unavailable.';

  if (res.status === 403 || res.status === 400 || res.status === 429) {
    try {
      const localHtml = await runLocalTesseractOcr(dataUrl);
      return {
        html: localHtml,
        engine: 'tesseract',
        notice: `${cloudReason} Extracted using local Tesseract OCR (Khmer + English).`,
      };
    } catch (localErr) {
      const localMsg = localErr instanceof Error ? localErr.message : 'Local OCR failed';
      throw new Error(`${cloudReason} Local OCR also failed: ${localMsg}`);
    }
  }

  throw new Error(cloudReason);
}
