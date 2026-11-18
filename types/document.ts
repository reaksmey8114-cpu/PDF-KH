export type Language = 'en' | 'km';

export type PaperSize = 'A4' | 'A3' | 'A5' | 'Letter' | 'Legal' | 'Custom';
export type Orientation = 'portrait' | 'landscape';

export type NumberingFormat = '1' | 'i' | 'I' | 'A' | 'km' | 'km-alpha';
export type NumberingPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';
export type NumberingPattern = 'number' | 'page-x-of-y';

export type DocumentSourceType =
  | 'editor'
  | 'docx'
  | 'doc'
  | 'pdf'
  | 'txt'
  | 'rtf'
  | 'image'
  | 'blank'
  | 'section-break';

export type ProjectStatus = 'draft' | 'compiled' | 'archived';

export interface PageSetupConfig {
  paperSize: PaperSize;
  orientation: Orientation;
  customWidthMm: number;
  customHeightMm: number;
  marginTopMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  marginRightMm: number;
  pageBorder: boolean;
  borderColor: string;
  backgroundColor: string;
  defaultFontFamily: string;
  defaultFontSizePt: number;
  lineHeight: number;
  paragraphSpacingPt: number;
  firstLineIndentMm: number;
}

export interface PageNumberOverride {
  position?: NumberingPosition;
  offsetXPx?: number;
  offsetYPx?: number;
  hidden?: boolean;
  prefixText?: string;
  suffixText?: string;
}

export interface NumberingConfig {
  enabled: boolean;
  format: NumberingFormat;
  position: NumberingPosition;
  startPage: number;
  excludeCoverPage: boolean;
  restartPerSection: boolean;
  displayPattern: NumberingPattern;
  fontFamily: string;
  fontSizePt: number;
  color: string;
  maskBackground?: boolean;
  prefixText?: string;
  suffixText?: string;
  pageOverrides?: Record<string, PageNumberOverride>;
}

export interface HeaderFooterConfig {
  headerEnabled: boolean;
  headerLeft: string;
  headerCenter: string;
  headerRight: string;
  footerEnabled: boolean;
  footerLeft: string;
  footerCenter: string;
  footerRight: string;
  organizationName: string;
  logoUrl: string;
  differentFirstPage: boolean;
  differentOddEven: boolean;
  firstPageHeader: string;
  firstPageFooter: string;
  evenHeaderCenter: string;
  evenFooterCenter: string;
}

export interface TocConfig {
  enabled: boolean;
  title: string;
  includeH1: boolean;
  includeH2: boolean;
  includeH3: boolean;
  includeTables: boolean;
  includeFigures: boolean;
  style: 'classic' | 'modern' | 'academic';
}

export interface WatermarkConfig {
  enabled: boolean;
  text: string;
  opacity: number;
  angle: number;
  color: string;
}

export interface DocumentComment {
  id: string;
  author: string;
  text: string;
  createdAt: string;
  resolved: boolean;
}

export interface DocumentBookmark {
  id: string;
  label: string;
  createdAt: string;
}

export interface ProjectDocument {
  id: string;
  projectId: string;
  ownerId: string;
  title: string;
  sourceType: DocumentSourceType;
  order: number;
  selected: boolean;
  contentHtml: string;
  plainText: string;
  pageCountEstimate: number;
  sectionRestartNumbering: boolean;
  sectionHeaderOverride?: string;
  sectionFooterOverride?: string;
  comments?: DocumentComment[];
  bookmarks?: DocumentBookmark[];
  signatureText?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ProjectVersion {
  id: string;
  projectId: string;
  ownerId: string;
  label: string;
  snapshotSummary: string;
  documentsSnapshot: Array<{
    id: string;
    title: string;
    sourceType: DocumentSourceType;
    order: number;
    selected: boolean;
    contentHtml: string;
    plainText: string;
  }>;
  createdAt?: unknown;
}

export interface Project {
  id: string;
  ownerId: string;
  title: string;
  description?: string;
  folder: string;
  status: ProjectStatus;
  pageSetup: PageSetupConfig;
  numberingConfig: NumberingConfig;
  headerFooterConfig: HeaderFooterConfig;
  tocConfig: TocConfig;
  watermarkConfig: WatermarkConfig;
  documentCount: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL?: string;
  preferredLanguage: Language;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface TocEntry {
  id: string;
  docId: string;
  level: 1 | 2 | 3;
  text: string;
  pageLabel: string;
  pageIndex: number;
}

export interface AssetListEntry {
  id: string;
  docId: string;
  kind: 'table' | 'figure';
  label: string;
  pageLabel: string;
  pageIndex: number;
}

export interface CompiledPage {
  pageIndex: number;
  docId: string;
  docTitle: string;
  sourceType: DocumentSourceType;
  isCoverPage: boolean;
  isTocPage: boolean;
  sectionIndex: number;
  pageNumberValue: number | null;
  pageNumberFormatted: string;
  numberPosition?: NumberingPosition;
  numberOffsetXPx?: number;
  numberOffsetYPx?: number;
  numberHidden?: boolean;
  numberHasOverride?: boolean;
  headerLeft: string;
  headerCenter: string;
  headerRight: string;
  footerLeft: string;
  footerCenter: string;
  footerRight: string;
  html: string;
  signatureText?: string;
  pdfDocId?: string;
  pdfPageNumber?: number;
  pdfPageWidthPt?: number;
  pdfPageHeightPt?: number;
}

export interface CompilationResult {
  pages: CompiledPage[];
  tocEntries: TocEntry[];
  tableEntries: AssetListEntry[];
  figureEntries: AssetListEntry[];
  totalPages: number;
}

export interface ProjectTemplate {
  id: string;
  category: 'Academic' | 'Legal' | 'Government' | 'General';
  titleEn: string;
  titleKm: string;
  descriptionEn: string;
  descriptionKm: string;
  folder: string;
  pageSetup: PageSetupConfig;
  numberingConfig: NumberingConfig;
  headerFooterConfig: HeaderFooterConfig;
  tocConfig: TocConfig;
  watermarkConfig: WatermarkConfig;
  documents: Array<{
    title: string;
    sourceType: DocumentSourceType;
    contentHtml: string;
    sectionRestartNumbering: boolean;
    signatureText?: string;
  }>;
}

export const PAPER_DIMENSIONS_MM: Record<Exclude<PaperSize, 'Custom'>, { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  A3: { width: 297, height: 420 },
  A5: { width: 148, height: 210 },
  Letter: { width: 215.9, height: 279.4 },
  Legal: { width: 215.9, height: 355.6 },
};

export function getEffectivePaperMm(setup: PageSetupConfig): { widthMm: number; heightMm: number } {
  const base =
    setup.paperSize === 'Custom'
      ? { width: setup.customWidthMm || 210, height: setup.customHeightMm || 297 }
      : PAPER_DIMENSIONS_MM[setup.paperSize];
  if (setup.orientation === 'landscape') {
    return { widthMm: base.height, heightMm: base.width };
  }
  return { widthMm: base.width, heightMm: base.height };
}

export const FONT_OPTIONS = [
  { label: 'Plus Jakarta Sans', value: '"Plus Jakarta Sans", sans-serif' },
  { label: 'DM Sans', value: '"DM Sans", sans-serif' },
  { label: 'Khmer OS Siemreap', value: '"Siemreap", "Khmer OS Siemreap", "Noto Sans Khmer", sans-serif' },
  { label: 'Khmer OS Battambang', value: '"Battambang", "Khmer OS Battambang", "Noto Sans Khmer", sans-serif' },
  { label: 'Khmer OS Muol', value: '"Moul", "Khmer OS Muol", "Khmer OS Muol Light", serif' },
  { label: 'Noto Serif Khmer', value: '"Noto Serif Khmer", Georgia, serif' },
  { label: 'Georgia / Serif', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'JetBrains Mono', value: '"JetBrains Mono", monospace' },
];

export function createDefaultPageSetup(): PageSetupConfig {
  return {
    paperSize: 'A4',
    orientation: 'portrait',
    customWidthMm: 210,
    customHeightMm: 297,
    marginTopMm: 25.4,
    marginBottomMm: 25.4,
    marginLeftMm: 25.4,
    marginRightMm: 25.4,
    pageBorder: false,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    defaultFontFamily: '"Battambang", "Plus Jakarta Sans", sans-serif',
    defaultFontSizePt: 11,
    lineHeight: 1.5,
    paragraphSpacingPt: 8,
    firstLineIndentMm: 0,
  };
}

export function createDefaultNumberingConfig(): NumberingConfig {
  return {
    enabled: true,
    format: '1',
    position: 'bottom-center',
    startPage: 1,
    excludeCoverPage: false,
    restartPerSection: false,
    displayPattern: 'page-x-of-y',
    fontFamily: '"Battambang", "Siemreap", "Plus Jakarta Sans", sans-serif',
    fontSizePt: 10,
    color: '#475569',
    maskBackground: true,
    prefixText: '',
    suffixText: '',
    pageOverrides: {},
  };
}

export function createDefaultHeaderFooterConfig(): HeaderFooterConfig {
  return {
    headerEnabled: true,
    headerLeft: '{org}',
    headerCenter: '',
    headerRight: '{title}',
    footerEnabled: true,
    footerLeft: '',
    footerCenter: '',
    footerRight: '',
    organizationName: 'Document Master Compilation',
    logoUrl: '',
    differentFirstPage: true,
    differentOddEven: false,
    firstPageHeader: '',
    firstPageFooter: '',
    evenHeaderCenter: '{title}',
    evenFooterCenter: '{org}',
  };
}

export function createDefaultTocConfig(): TocConfig {
  return {
    enabled: true,
    title: 'Table of Contents',
    includeH1: true,
    includeH2: true,
    includeH3: true,
    includeTables: true,
    includeFigures: true,
    style: 'classic',
  };
}

export function createDefaultWatermarkConfig(): WatermarkConfig {
  return {
    enabled: false,
    text: 'CONFIDENTIAL',
    opacity: 0.12,
    angle: -35,
    color: '#64748b',
  };
}
