import { Language } from '@/types/document';

export interface Translations {
  appName: string;
  tagline: string;
  signInTitle: string;
  signInSubtitle: string;
  signInGoogle: string;
  signOut: string;
  dashboard: string;
  recentProjects: string;
  myDocuments: string;
  templates: string;
  createNewProject: string;
  importDocuments: string;
  searchPlaceholder: string;
  allFolders: string;
  folderAcademic: string;
  folderLegal: string;
  folderGovernment: string;
  folderGeneral: string;
  newProjectTitle: string;
  projectTitleLabel: string;
  projectFolderLabel: string;
  projectDescLabel: string;
  createBtn: string;
  cancelBtn: string;
  renameBtn: string;
  duplicateBtn: string;
  deleteBtn: string;
  archiveBtn: string;
  restoreBtn: string;
  openWorkspace: string;
  dropFilesPrompt: string;
  dropFilesSub: string;
  supportedFormats: string;
  documentsCount: string;
  lastModified: string;
  noProjectsTitle: string;
  noProjectsDesc: string;
  backToDashboard: string;
  undoBtn: string;
  redoBtn: string;
  saveVersion: string;
  saving: string;
  saved: string;
  editMode: string;
  previewMode: string;
  printPreview: string;
  exportMenu: string;
  exportPdf: string;
  exportDocx: string;
  exportTxt: string;
  exportSuccess: string;
  leftSidebarDocs: string;
  leftSidebarToc: string;
  addBlankPage: string;
  addSectionBreak: string;
  addNewSection: string;
  addPageMenu: string;
  insertBlankBefore: string;
  insertBlankAfter: string;
  insertEditableBefore: string;
  insertEditableAfter: string;
  deleteThisPage: string;
  addPageAtEnd: string;
  pageAddedNotice: string;
  pageDeletedNotice: string;
  importMoreFiles: string;
  compileSelectedOnly: string;
  selectedForCompile: string;
  ocrExtract: string;
  ocrProcessing: string;
  tabPageSetup: string;
  tabNumbering: string;
  tabHeaderFooter: string;
  tabTocWatermark: string;
  tabReviewHistory: string;
  paperSize: string;
  orientation: string;
  portrait: string;
  landscape: string;
  marginsMm: string;
  marginTop: string;
  marginBottom: string;
  marginLeft: string;
  marginRight: string;
  pageBorder: string;
  pageBackground: string;
  defaultFont: string;
  fontSize: string;
  lineSpacing: string;
  paragraphSpacing: string;
  firstLineIndent: string;
  enableNumbering: string;
  startPageNum: string;
  excludeCoverPage: string;
  restartPerSection: string;
  numberingPosition: string;
  numberingFormat: string;
  numberingPattern: string;
  numberingFont: string;
  maskNumberBackground: string;
  prefixTextLabel: string;
  suffixTextLabel: string;
  prefixPlaceholder: string;
  suffixPlaceholder: string;
  perPagePositionTitle: string;
  dragToMoveHint: string;
  hideOnThisPage: string;
  resetPagePosition: string;
  resetAllPagePositions: string;
  customTextForPage: string;
  pdfPreservedNotice: string;
  editExtractedText: string;
  viewOriginalPdf: string;
  patternNumberOnly: string;
  patternPageXOfY: string;
  enableHeader: string;
  enableFooter: string;
  organizationName: string;
  insertOrgSeal: string;
  differentFirstPage: string;
  differentOddEven: string;
  sectionOverrides: string;
  enableToc: string;
  tocTitle: string;
  tocStyle: string;
  includeHeadings: string;
  includeTablesList: string;
  includeFiguresList: string;
  enableWatermark: string;
  watermarkText: string;
  watermarkOpacity: string;
  watermarkAngle: string;
  commentsTitle: string;
  addComment: string;
  bookmarksTitle: string;
  addBookmark: string;
  digitalSignature: string;
  versionHistory: string;
  restoreVersion: string;
  findAndReplace: string;
  findLabel: string;
  replaceLabel: string;
  replaceAllBtn: string;
  pageLabel: string;
  ofLabel: string;
  khmerLanguageBanner: string;
  useTemplate: string;
  singlePageView: string;
  twoPageView: string;
  fitToScreen: string;
  expandCanvas: string;
  showPanels: string;
  pageReorderedNotice: string;
  dragPageHint: string;
  movePageEarlier: string;
  movePageLater: string;
  cleanStainsBtn: string;
  cleanStainsTitle: string;
  cleanedBadge: string;
  pageCleanedNotice: string;
  pageCleanResetNotice: string;
}

const en: Translations = {
  appName: 'Document Master',
  tagline: 'Professional Document Compilation & Pagination Studio',
  signInTitle: 'Compile, standardize, and publish multi-format documents.',
  signInSubtitle:
    'Built for university researchers, legal teams, government offices, and educators with full Khmer Unicode & Latin typography.',
  signInGoogle: 'Continue with Google',
  signOut: 'Sign Out',
  dashboard: 'Workspace',
  recentProjects: 'Recent Projects',
  myDocuments: 'My Documents',
  templates: 'Templates',
  createNewProject: 'New Project',
  importDocuments: 'Import Documents',
  searchPlaceholder: 'Search projects or documents...',
  allFolders: 'All Folders',
  folderAcademic: 'Academic',
  folderLegal: 'Legal',
  folderGovernment: 'Government',
  folderGeneral: 'General',
  newProjectTitle: 'Create Compilation Project',
  projectTitleLabel: 'Project Title',
  projectFolderLabel: 'Folder Category',
  projectDescLabel: 'Description (Optional)',
  createBtn: 'Create Project',
  cancelBtn: 'Cancel',
  renameBtn: 'Rename',
  duplicateBtn: 'Duplicate',
  deleteBtn: 'Delete',
  archiveBtn: 'Archive',
  restoreBtn: 'Restore',
  openWorkspace: 'Open Editor',
  dropFilesPrompt: 'Drag & drop Word, PDF, Excel, PowerPoint, ODT, RTF, TXT, or image files here',
  dropFilesSub: 'Multiple files supported simultaneously — creates a ready-to-compile project',
  supportedFormats: 'DOCX, DOC, PDF, XLSX, PPTX, ODT, RTF, HTML, CSV, EPUB, TXT, Images',
  documentsCount: 'documents',
  lastModified: 'Modified',
  noProjectsTitle: 'No compilation projects yet',
  noProjectsDesc: 'Create a blank project, pick an institutional template, or drop files above to begin.',
  backToDashboard: 'Dashboard',
  undoBtn: 'Undo',
  redoBtn: 'Redo',
  saveVersion: 'Save Snapshot',
  saving: 'Saving...',
  saved: 'Saved',
  editMode: 'Editor',
  previewMode: 'Compiled Preview',
  printPreview: 'Print',
  exportMenu: 'Export',
  exportPdf: 'Download PDF (.pdf)',
  exportDocx: 'Download Word (.docx)',
  exportTxt: 'Download Plain Text (.txt)',
  exportSuccess: 'Export completed',
  leftSidebarDocs: 'Documents',
  leftSidebarToc: 'Outline & TOC',
  addBlankPage: 'Blank Page',
  addSectionBreak: 'Section Break',
  addNewSection: 'New Document',
  addPageMenu: 'Add Page',
  insertBlankBefore: 'Blank Page Before',
  insertBlankAfter: 'Blank Page After',
  insertEditableBefore: 'Text Page Before',
  insertEditableAfter: 'Text Page After',
  deleteThisPage: 'Delete Page',
  addPageAtEnd: 'Add Page',
  pageAddedNotice: 'Page added — numbers updated',
  pageDeletedNotice: 'Page deleted — numbers updated',
  importMoreFiles: 'Import Files',
  compileSelectedOnly: 'Include in compilation',
  selectedForCompile: 'selected',
  ocrExtract: 'OCR Extract Text',
  ocrProcessing: 'Running OCR...',
  tabPageSetup: 'Page',
  tabNumbering: 'Numbers',
  tabHeaderFooter: 'Header/Footer',
  tabTocWatermark: 'TOC/Mark',
  tabReviewHistory: 'Review',
  paperSize: 'Paper Size',
  orientation: 'Orientation',
  portrait: 'Portrait',
  landscape: 'Landscape',
  marginsMm: 'Margins (mm)',
  marginTop: 'Top',
  marginBottom: 'Bottom',
  marginLeft: 'Left',
  marginRight: 'Right',
  pageBorder: 'Page Border',
  pageBackground: 'Page Background',
  defaultFont: 'Default Font',
  fontSize: 'Font Size (pt)',
  lineSpacing: 'Line Spacing',
  paragraphSpacing: 'Paragraph Spacing (pt)',
  firstLineIndent: 'First-Line Indent (mm)',
  enableNumbering: 'Automatic Page Numbering',
  startPageNum: 'Start Numbering From',
  excludeCoverPage: 'Exclude Cover Page',
  restartPerSection: 'Restart Each Section',
  numberingPosition: 'Position',
  numberingFormat: 'Format',
  numberingPattern: 'Display Pattern',
  numberingFont: 'Numbering Font',
  maskNumberBackground: 'Cover background behind page number',
  prefixTextLabel: 'Text Before Number',
  suffixTextLabel: 'Text After Number',
  prefixPlaceholder: 'e.g. Page  or Annex A - ',
  suffixPlaceholder: 'e.g.  — Confidential',
  perPagePositionTitle: 'Individual Page Position',
  dragToMoveHint: 'Drag page number directly on any page or adjust below',
  hideOnThisPage: 'Hide on this page',
  resetPagePosition: 'Reset',
  resetAllPagePositions: 'Reset All Pages',
  customTextForPage: 'Custom text for this page',
  pdfPreservedNotice: 'Original PDF formatting preserved intact with live page numbers',
  editExtractedText: 'Edit Extracted Text',
  viewOriginalPdf: 'Original PDF View',
  patternNumberOnly: 'Number only (1, ១, ii, A, ក)',
  patternPageXOfY: 'Page X of Y',
  enableHeader: 'Show Header',
  enableFooter: 'Show Footer',
  organizationName: 'Organization Name',
  insertOrgSeal: 'Use Institutional Seal Logo',
  differentFirstPage: 'Different First Page',
  differentOddEven: 'Different Odd & Even Pages',
  sectionOverrides: 'Current Section Overrides',
  enableToc: 'Generate Table of Contents',
  tocTitle: 'TOC Heading',
  tocStyle: 'TOC Style',
  includeHeadings: 'Included Heading Levels',
  includeTablesList: 'Generate List of Tables',
  includeFiguresList: 'Generate List of Figures',
  enableWatermark: 'Enable Watermark',
  watermarkText: 'Watermark Text',
  watermarkOpacity: 'Opacity',
  watermarkAngle: 'Rotation Angle',
  commentsTitle: 'Comments & Annotations',
  addComment: 'Add Comment',
  bookmarksTitle: 'Bookmarks',
  addBookmark: 'Add Bookmark',
  digitalSignature: 'Digital Signature Stamp',
  versionHistory: 'Version History',
  restoreVersion: 'Restore',
  findAndReplace: 'Find & Replace',
  findLabel: 'Find text',
  replaceLabel: 'Replace with',
  replaceAllBtn: 'Replace All',
  pageLabel: 'Page',
  ofLabel: 'of',
  khmerLanguageBanner: 'Khmer Unicode Ready',
  useTemplate: 'Use Template',
  singlePageView: '1 Page',
  twoPageView: '2 Pages',
  fitToScreen: 'Fit',
  expandCanvas: 'Full Canvas',
  showPanels: 'Show Panels',
  pageReorderedNotice: 'Page order updated — numbers updated',
  dragPageHint: 'Drag to move page',
  movePageEarlier: 'Move page backward',
  movePageLater: 'Move page forward',
  cleanStainsBtn: 'Clean Stains',
  cleanStainsTitle: 'Document Stain & Background Cleaner',
  cleanedBadge: 'Cleaned',
  pageCleanedNotice: 'Document stains cleaned successfully',
  pageCleanResetNotice: 'Restored original document image',
};

const km: Translations = {
  appName: 'Document Master',
  tagline: 'ប្រព័ន្ធចងក្រង និងរៀបចំទម្រង់ឯកសារវិជ្ជាជីវៈ',
  signInTitle: 'ចងក្រង រៀបចំទម្រង់ និងបោះពុម្ពឯកសារច្រើនទម្រង់ក្នុងពេលតែមួយ។',
  signInSubtitle:
    'រចនាឡើងសម្រាប់និស្សិត អ្នកស្រាវជ្រាវ មេធាវី មន្ត្រីរាជការ និងស្ថាប័នអប់រំ ជាមួយការគាំទ្រអក្សរខ្មែរយូនីកូដពេញលេញ។',
  signInGoogle: 'ចូលប្រើប្រាស់ជាមួយ Google',
  signOut: 'ចាកចេញ',
  dashboard: 'ផ្ទាំងគ្រប់គ្រង',
  recentProjects: 'គម្រោងថ្មីៗ',
  myDocuments: 'ឯកសាររបស់ខ្ញុំ',
  templates: 'គំរូឯកសារ',
  createNewProject: 'បង្កើតគម្រោងថ្មី',
  importDocuments: 'នាំចូលឯកសារ',
  searchPlaceholder: 'ស្វែងរកគម្រោង ឬឯកសារ...',
  allFolders: 'ថតឯកសារទាំងអស់',
  folderAcademic: 'សិក្សា និងស្រាវជ្រាវ',
  folderLegal: 'ច្បាប់ និងតុលាការ',
  folderGovernment: 'រដ្ឋបាល និងក្រសួង',
  folderGeneral: 'ទូទៅ',
  newProjectTitle: 'បង្កើតគម្រោងចងក្រងឯកសារថ្មី',
  projectTitleLabel: 'ចំណងជើងគម្រោង',
  projectFolderLabel: 'ប្រភេទថតឯកសារ',
  projectDescLabel: 'ការពិពណ៌នា (ជម្រើស)',
  createBtn: 'បង្កើតគម្រោង',
  cancelBtn: 'បោះបង់',
  renameBtn: 'ប្តូរឈ្មោះ',
  duplicateBtn: 'ចម្លងទុក',
  deleteBtn: 'លុប',
  archiveBtn: 'ទុកក្នុងបណ្ណសារ',
  restoreBtn: 'ស្ដារឡើងវិញ',
  openWorkspace: 'បើកកម្មវិធីកែសម្រួល',
  dropFilesPrompt: 'អូស និងទម្លាក់ឯកសារ Word, PDF, Excel, PowerPoint, ODT, RTF, TXT ឬរូបភាពនៅទីនេះ',
  dropFilesSub: 'គាំទ្រការនាំចូលឯកសារច្រើនក្នុងពេលតែមួយ — បង្កើតជាគម្រោងភ្លាមៗ',
  supportedFormats: 'DOCX, DOC, PDF, XLSX, PPTX, ODT, RTF, HTML, CSV, EPUB, TXT, រូបភាព',
  documentsCount: 'ឯកសារ',
  lastModified: 'កែប្រែចុងក្រោយ',
  noProjectsTitle: 'មិនទាន់មានគម្រោងចងក្រងឯកសារនៅឡើយទេ',
  noProjectsDesc: 'សូមបង្កើតគម្រោងថ្មី ជ្រើសរើសគំរូឯកសារ ឬទម្លាក់ឯកសារខាងលើដើម្បីចាប់ផ្ដើម។',
  backToDashboard: 'ត្រឡប់ទៅផ្ទាំងដើម',
  undoBtn: 'ត្រឡប់ក្រោយ',
  redoBtn: 'ធ្វើឡើងវិញ',
  saveVersion: 'រក្សាទុកជំនាន់',
  saving: 'កំពុងរក្សាទុក...',
  saved: 'បានរក្សាទុក',
  editMode: 'កែសម្រួល',
  previewMode: 'មើលលទ្ធផលចងក្រង',
  printPreview: 'បោះពុម្ព',
  exportMenu: 'នាំចេញ',
  exportPdf: 'ទាញយក PDF (.pdf)',
  exportDocx: 'ទាញយក Word (.docx)',
  exportTxt: 'ទាញយកអត្ថបទ (.txt)',
  exportSuccess: 'នាំចេញបានជោគជ័យ',
  leftSidebarDocs: 'បញ្ជីឯកសារ',
  leftSidebarToc: 'មាតិកា',
  addBlankPage: 'បន្ថែមទំព័រទទេ',
  addSectionBreak: 'បំបែកផ្នែក',
  addNewSection: 'ឯកសារថ្មី',
  addPageMenu: 'បន្ថែមទំព័រ',
  insertBlankBefore: 'ទំព័រទទេខាងមុខ',
  insertBlankAfter: 'ទំព័រទទេខាងក្រោយ',
  insertEditableBefore: 'ទំព័រអត្ថបទខាងមុខ',
  insertEditableAfter: 'ទំព័រអត្ថបទខាងក្រោយ',
  deleteThisPage: 'លុបទំព័រនេះ',
  addPageAtEnd: 'បន្ថែមទំព័រ',
  pageAddedNotice: 'បានបន្ថែមទំព័រ — លេខទំព័រត្រូវបានកែសម្រួល',
  pageDeletedNotice: 'បានលុបទំព័រ — លេខទំព័រត្រូវបានកែសម្រួល',
  importMoreFiles: 'នាំចូលបន្ថែម',
  compileSelectedOnly: 'រួមបញ្ចូលក្នុងការចងក្រង',
  selectedForCompile: 'បានជ្រើស',
  ocrExtract: 'ស្រង់អក្សរពីរូបភាព (OCR)',
  ocrProcessing: 'កំពុងស្រង់អក្សរ...',
  tabPageSetup: 'ទំព័រ',
  tabNumbering: 'លេខទំព័រ',
  tabHeaderFooter: 'ក្បាល/ជើង',
  tabTocWatermark: 'មាតិកា/ត្រា',
  tabReviewHistory: 'ពិនិត្យ',
  paperSize: 'ទំហំក្រដាស',
  orientation: 'ទិសក្រដាស',
  portrait: 'បញ្ឈរ',
  landscape: 'ផ្ដេក',
  marginsMm: 'រឹមទំព័រ (ម.ម)',
  marginTop: 'លើ',
  marginBottom: 'ក្រោម',
  marginLeft: 'ឆ្វេង',
  marginRight: 'ស្ដាំ',
  pageBorder: 'ស៊ុមទំព័រ',
  pageBackground: 'ពណ៌ផ្ទៃទំព័រ',
  defaultFont: 'ពុម្ពអក្សរលំនាំដើម',
  fontSize: 'ទំហំអក្សរ (pt)',
  lineSpacing: 'គម្លាតបន្ទាត់',
  paragraphSpacing: 'គម្លាតកថាខណ្ឌ (pt)',
  firstLineIndent: 'ចូលបន្ទាត់ដំបូង (ម.ម)',
  enableNumbering: 'ដាក់លេខទំព័រស្វ័យប្រវត្តិ',
  startPageNum: 'ចាប់ផ្ដើមរាប់ពីលេខ',
  excludeCoverPage: 'មិនដាក់លេខលើទំព័រក្រប',
  restartPerSection: 'រាប់លេខឡើងវិញតាមផ្នែក',
  numberingPosition: 'ទីតាំងលេខទំព័រ',
  numberingFormat: 'ទម្រង់លេខ',
  numberingPattern: 'ទម្រង់បង្ហាញ',
  numberingFont: 'ពុម្ពអក្សរលេខទំព័រ',
  maskNumberBackground: 'បិទបាំងផ្ទៃខាងក្រោយលេខទំព័រ',
  prefixTextLabel: 'អក្សរនៅពីមុខលេខទំព័រ',
  suffixTextLabel: 'អក្សរនៅពីក្រោយលេខទំព័រ',
  prefixPlaceholder: 'ឧ. ទំព័រទី  ឬ ឧបសម្ព័ន្ធ - ',
  suffixPlaceholder: 'ឧ.  — ឯកសារផ្លូវការ',
  perPagePositionTitle: 'កំណត់ទីតាំងតាមទំព័រនីមួយៗ',
  dragToMoveHint: 'អាចអូសលេខទំព័រដោយផ្ទាល់លើទំព័រនីមួយៗ ឬកំណត់ខាងក្រោម',
  hideOnThisPage: 'លាក់លេខលើទំព័រនេះ',
  resetPagePosition: 'កំណត់ដើមវិញ',
  resetAllPagePositions: 'កំណត់ទំព័រទាំងអស់ឡើងវិញ',
  customTextForPage: 'អក្សរពិសេសសម្រាប់ទំព័រនេះ',
  pdfPreservedNotice: 'រក្សាទម្រង់ដើមនៃឯកសារ PDF ទាំងស្រុង ជាមួយលេខទំព័រថ្មី',
  editExtractedText: 'កែសម្រួលជាអត្ថបទ',
  viewOriginalPdf: 'មើលទម្រង់ PDF ដើម',
  patternNumberOnly: 'លេខទោល (១, 1, ii, ក, A)',
  patternPageXOfY: 'ទំព័រ X នៃ Y',
  enableHeader: 'បង្ហាញក្បាលទំព័រ',
  enableFooter: 'បង្ហាញជើងទំព័រ',
  organizationName: 'ឈ្មោះស្ថាប័ន ឬអង្គភាព',
  insertOrgSeal: 'ប្រើរូបសញ្ញាស្ថាប័ន',
  differentFirstPage: 'ទំព័រដំបូងផ្សេងគ្នា',
  differentOddEven: 'ទំព័រគូ និងសេសផ្សេងគ្នា',
  sectionOverrides: 'ការកំណត់ផ្នែកបច្ចុប្បន្ន',
  enableToc: 'បង្កើតតារាងមាតិកាស្វ័យប្រវត្តិ',
  tocTitle: 'ចំណងជើងមាតិកា',
  tocStyle: 'រចនាប័ទ្មមាតិកា',
  includeHeadings: 'កម្រិតចំណងជើងដែលរួមបញ្ចូល',
  includeTablesList: 'បង្កើតបញ្ជីតារាង',
  includeFiguresList: 'បង្កើតបញ្ជីរូបភាព',
  enableWatermark: 'បើក Watermark',
  watermarkText: 'អក្សរ Watermark',
  watermarkOpacity: 'ភាពថ្លា',
  watermarkAngle: 'មុំបង្វិល',
  commentsTitle: 'មតិយោបល់ និងកំណត់ចំណាំ',
  addComment: 'បន្ថែមមតិយោបល់',
  bookmarksTitle: 'ចំណាំទំព័រ (Bookmarks)',
  addBookmark: 'បន្ថែមចំណាំ',
  digitalSignature: 'ត្រាហត្ថលេខាឌីជីថល',
  versionHistory: 'ប្រវត្តិជំនាន់ឯកសារ',
  restoreVersion: 'ស្ដារជំនាន់នេះ',
  findAndReplace: 'ស្វែងរក និងជំនួស',
  findLabel: 'ស្វែងរកពាក្យ',
  replaceLabel: 'ជំនួសដោយ',
  replaceAllBtn: 'ជំនួសទាំងអស់',
  pageLabel: 'ទំព័រ',
  ofLabel: 'នៃ',
  khmerLanguageBanner: 'គាំទ្រអក្សរខ្មែរយូនីកូដ',
  useTemplate: 'ប្រើគំរូនេះ',
  singlePageView: '១ ទំព័រ',
  twoPageView: '២ ទំព័រ',
  fitToScreen: 'សមល្មម',
  expandCanvas: 'ពង្រីកផ្ទាំង',
  showPanels: 'បង្ហាញផ្ទាំងឧបករណ៍',
  pageReorderedNotice: 'បានផ្លាស់ប្តូរទីតាំងទំព័រ — លេខទំព័រត្រូវបានកែសម្រួល',
  dragPageHint: 'ទាញឆ្លាស់ទំព័រ',
  movePageEarlier: 'រំកិលទំព័រទៅមុខ',
  movePageLater: 'រំកិលទំព័រទៅក្រោយ',
  cleanStainsBtn: 'សម្អាតស្នាមប្រឡាក់',
  cleanStainsTitle: 'សម្អាតស្នាមប្រឡាក់ និងផ្ទៃខាងក្រោយឯកសារ',
  cleanedBadge: 'បានសម្អាត',
  pageCleanedNotice: 'បានសម្អាតស្នាមប្រឡាក់លើឯកសារដោយជោគជ័យ',
  pageCleanResetNotice: 'បានស្ដាររូបភាពដើមវិញ',
};

export function getTranslations(lang: Language): Translations {
  return lang === 'km' ? km : en;
}
