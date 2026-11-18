import {
  ProjectTemplate,
  createDefaultHeaderFooterConfig,
  createDefaultNumberingConfig,
  createDefaultPageSetup,
  createDefaultTocConfig,
  createDefaultWatermarkConfig,
} from '@/types/document';

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'khmer-official-report',
    category: 'Government',
    titleEn: 'Khmer Official Ministry & Administrative Report',
    titleKm: 'របាយការណ៍រដ្ឋបាល និងក្រសួងផ្លូវការ (ភាសាខ្មែរ)',
    descriptionEn:
      'A4 bilingual administrative compilation using Khmer OS Muol headers, Khmer OS Siemreap body, institutional seal, and formal Khmer punctuation.',
    descriptionKm:
      'គំរូរបាយការណ៍ផ្លូវការខ្នាត A4 ប្រើពុម្ពអក្សរ Khmer OS Muol និង Khmer OS Siemreap ជាមួយត្រាស្ថាប័ន និងលេខទំព័រស្វ័យប្រវត្តិ។',
    folder: 'Government',
    pageSetup: {
      ...createDefaultPageSetup(),
      paperSize: 'A4',
      orientation: 'portrait',
      marginTopMm: 25,
      marginBottomMm: 25,
      marginLeftMm: 28,
      marginRightMm: 22,
      defaultFontFamily: '"Siemreap", "Khmer OS Siemreap", "Noto Sans Khmer", sans-serif',
      defaultFontSizePt: 11,
      lineHeight: 1.65,
    },
    numberingConfig: {
      ...createDefaultNumberingConfig(),
      enabled: true,
      format: 'km',
      position: 'bottom-center',
      excludeCoverPage: true,
      displayPattern: 'page-x-of-y',
      fontFamily: '"Siemreap", "Khmer OS Siemreap", "Noto Sans Khmer", sans-serif',
    },
    headerFooterConfig: {
      ...createDefaultHeaderFooterConfig(),
      headerEnabled: true,
      headerLeft: 'ព្រះរាជាណាចក្រកម្ពុជា',
      headerCenter: '',
      headerRight: '{title}',
      footerEnabled: true,
      footerLeft: '{org}',
      footerCenter: '',
      footerRight: 'ឯកសារផ្លូវការ',
      organizationName: 'នាយកដ្ឋានរដ្ឋបាល និងផែនការ',
      logoUrl: '/images/org_seal_emblem.jpg',
      differentFirstPage: true,
    },
    tocConfig: {
      ...createDefaultTocConfig(),
      enabled: true,
      title: 'មាតិកា (Table of Contents)',
      style: 'academic',
    },
    watermarkConfig: createDefaultWatermarkConfig(),
    documents: [
      {
        title: 'ទំព័រក្រប (Cover Page)',
        sourceType: 'editor',
        sectionRestartNumbering: false,
        contentHtml: `
          <p style="text-align: center;"><span style="font-family: 'Moul', 'Khmer OS Muol', serif; font-size: 16pt;">ព្រះរាជាណាចក្រកម្ពុជា</span></p>
          <p style="text-align: center;"><span style="font-family: 'Moul', 'Khmer OS Muol', serif; font-size: 13pt;">ជាតិ សាសនា ព្រះមហាក្សត្រ</span></p>
          <p style="text-align: center;">***</p>
          <p style="text-align: center;"><img src="/images/org_seal_emblem.jpg" alt="Institutional Seal" width="110" /></p>
          <h1 style="text-align: center;"><span style="font-family: 'Moul', 'Khmer OS Muol', serif;">របាយការណ៍បូកសរុបលទ្ធផលការងារប្រចាំឆ្នាំ</span></h1>
          <p style="text-align: center;"><strong>Annual Institutional Performance &amp; Compilation Report</strong></p>
          <p style="text-align: center;">រៀបចំដោយ៖ នាយកដ្ឋានរដ្ឋបាល និងផែនការ</p>
          <p style="text-align: center;">រាជធានីភ្នំពេញ · ឆ្នាំ ២០២៦</p>
        `,
      },
      {
        title: 'ជំពូកទី ១៖ សេចក្តីផ្តើម',
        sourceType: 'editor',
        sectionRestartNumbering: false,
        contentHtml: `
          <h1>ជំពូកទី ១៖ សេចក្តីផ្តើម (Introduction)</h1>
          <p>របាយការណ៍នេះត្រូវបានចងក្រងឡើងដើម្បីបង្ហាញអំពីវឌ្ឍនភាពការងារ សមិទ្ធផលសំខាន់ៗ និងទិសដៅអនុវត្តបន្តសម្រាប់ឆ្នាំសារពើពន្ធបច្ចុប្បន្ន។</p>
          <h2>១.១ គោលបំណងនៃការចងក្រង</h2>
          <p>ការប្រមូលផ្តុំឯកសារពីផ្នែកជំនាញនានាត្រូវបានសម្របសម្រួលតាមស្តង់ដារទម្រង់តែមួយ ដោយរក្សាបាននូវភាពត្រឹមត្រូវនៃអក្ខរាវិរុទ្ធខ្មែរយូនីកូដ និងលេខរៀងទំព័រស្វ័យប្រវត្តិ។</p>
          <table>
            <thead>
              <tr><th>ល.រ</th><th>សកម្មភាពការងារ</th><th>លទ្ធផលសម្រេច</th></tr>
            </thead>
            <tbody>
              <tr><td>១</td><td>ការគ្រប់គ្រងឯកសាររដ្ឋបាល</td><td>សម្រេចបាន ១០០%</td></tr>
              <tr><td>២</td><td>ការបូកសរុបទិន្នន័យប្រចាំត្រីមាស</td><td>សម្រេចបាន ៩៨%</td></tr>
            </tbody>
          </table>
        `,
      },
      {
        title: 'ជំពូកទី ២៖ សេចក្តីសន្និដ្ឋាន និងហត្ថលេខា',
        sourceType: 'editor',
        sectionRestartNumbering: false,
        signatureText: 'អនុម័តដោយ ប្រធាននាយកដ្ឋាន · ភ្នំពេញ ២០២៦',
        contentHtml: `
          <h1>ជំពូកទី ២៖ សេចក្តីសន្និដ្ឋាន និងអនុសាសន៍</h1>
          <h2>២.១ ការវាយតម្លៃជារួម</h2>
          <p>ផ្អែកលើលទ្ធផលដែលបានចងក្រងខាងលើ អង្គភាពបានអនុវត្តភារកិច្ចប្រកបដោយប្រសិទ្ធភាព និងតម្លាភាពខ្ពស់។</p>
        `,
      },
    ],
  },
  {
    id: 'university-thesis',
    category: 'Academic',
    titleEn: 'University Thesis & Research Monograph',
    titleKm: 'សារណាបញ្ចប់ការសិក្សា និងនិក្ខេបបទស្រាវជ្រាវ',
    descriptionEn:
      'Standard academic structure with excluded cover page, Roman numeral front-matter, Chapter-based headings (H1-H3), and List of Tables/Figures.',
    descriptionKm:
      'គំរូសារណាសាកលវិទ្យាល័យ ដែលមិនដាក់លេខទំព័រក្រប ប្រើលេខរ៉ូម៉ាំងសម្រាប់អារម្ភកថា និងបង្កើតមាតិកាស្វ័យប្រវត្តិ។',
    folder: 'Academic',
    pageSetup: {
      ...createDefaultPageSetup(),
      paperSize: 'A4',
      orientation: 'portrait',
      marginTopMm: 25.4,
      marginBottomMm: 25.4,
      marginLeftMm: 31.7,
      marginRightMm: 25.4,
      defaultFontFamily: 'Georgia, "Times New Roman", serif',
      defaultFontSizePt: 11,
      lineHeight: 1.6,
    },
    numberingConfig: {
      ...createDefaultNumberingConfig(),
      enabled: true,
      format: '1',
      position: 'bottom-right',
      excludeCoverPage: true,
      restartPerSection: false,
      displayPattern: 'number',
    },
    headerFooterConfig: {
      ...createDefaultHeaderFooterConfig(),
      headerEnabled: true,
      headerLeft: '{org}',
      headerRight: '{title}',
      organizationName: 'School of Graduate Studies',
      differentFirstPage: true,
    },
    tocConfig: {
      ...createDefaultTocConfig(),
      enabled: true,
      title: 'Table of Contents',
      includeTables: true,
      includeFigures: true,
      style: 'academic',
    },
    watermarkConfig: createDefaultWatermarkConfig(),
    documents: [
      {
        title: 'Title Page',
        sourceType: 'editor',
        sectionRestartNumbering: false,
        contentHtml: `
          <p style="text-align: center;"><img src="/images/org_seal_emblem.jpg" alt="University Seal" width="96" /></p>
          <h1 style="text-align: center;">Multilingual Document Architecture in Archival Systems</h1>
          <p style="text-align: center;"><em>A Thesis Submitted in Partial Fulfillment of the Requirements for the Degree of Master of Science</em></p>
          <p style="text-align: center;">Department of Information Systems · Academic Year 2026</p>
        `,
      },
      {
        title: 'Chapter 1: Research Problem & Methodology',
        sourceType: 'editor',
        sectionRestartNumbering: false,
        contentHtml: `
          <h1>Chapter 1: Research Problem &amp; Methodology</h1>
          <p>Modern institutional repositories must unify heterogeneous file formats—including DOCX, PDF, and scanned imagery—into cohesive, citable volumes with deterministic pagination.</p>
          <h2>1.1 Scope of Investigation</h2>
          <p>This study evaluates automated pagination engines across Latin and Khmer Unicode script systems.</p>
          <h3>1.1.1 Corpus Selection Criteria</h3>
          <p>Documents were sampled from academic monographs, administrative decrees, and appellate briefs.</p>
          <table>
            <thead>
              <tr><th>Document Format</th><th>Preservation Fidelity</th><th>Pagination Accuracy</th></tr>
            </thead>
            <tbody>
              <tr><td>DOCX (OOXML)</td><td>High (98.4%)</td><td>Exact</td></tr>
              <tr><td>PDF (Vector)</td><td>Native</td><td>Exact</td></tr>
            </tbody>
          </table>
        `,
      },
    ],
  },
  {
    id: 'legal-case-bundle',
    category: 'Legal',
    titleEn: 'Legal Brief & Exhibit Bundle',
    titleKm: 'សំណុំឯកសារច្បាប់ និងភស្តុតាងតុលាការ',
    descriptionEn:
      'Letter-sized legal compilation with "Page X of Y" bottom numbering, section-restart exhibits, border frame option, and confidential watermark.',
    descriptionKm:
      'គំរូសំណុំឯកសារផ្លូវច្បាប់ ខ្នាត Letter មានលេខទំព័រ "Page X of Y" ការបំបែកផ្នែកភស្តុតាង និង Watermark។',
    folder: 'Legal',
    pageSetup: {
      ...createDefaultPageSetup(),
      paperSize: 'Letter',
      orientation: 'portrait',
      marginTopMm: 25.4,
      marginBottomMm: 25.4,
      marginLeftMm: 25.4,
      marginRightMm: 25.4,
      pageBorder: true,
      borderColor: '#94a3b8',
      defaultFontFamily: '"Times New Roman", Times, serif',
      defaultFontSizePt: 12,
      lineHeight: 1.5,
    },
    numberingConfig: {
      ...createDefaultNumberingConfig(),
      enabled: true,
      format: '1',
      position: 'bottom-center',
      excludeCoverPage: false,
      restartPerSection: true,
      displayPattern: 'page-x-of-y',
    },
    headerFooterConfig: {
      ...createDefaultHeaderFooterConfig(),
      headerEnabled: true,
      headerLeft: 'CASE NO. 2026-CIV-0412',
      headerRight: '{title}',
      footerEnabled: true,
      footerLeft: 'ATTORNEY-CLIENT PRIVILEGED',
      organizationName: 'Chambers & Legal Counsel',
      differentFirstPage: false,
    },
    tocConfig: {
      ...createDefaultTocConfig(),
      enabled: true,
      title: 'Index of Authorities & Exhibits',
      style: 'classic',
    },
    watermarkConfig: {
      ...createDefaultWatermarkConfig(),
      enabled: true,
      text: 'CONFIDENTIAL',
      opacity: 0.08,
    },
    documents: [
      {
        title: 'Memorandum of Law',
        sourceType: 'editor',
        sectionRestartNumbering: false,
        contentHtml: `
          <h1>Memorandum of Points and Authorities</h1>
          <h2>I. Preliminary Statement</h2>
          <p>Counsel respectfully submits this compiled record pursuant to the Court's scheduling order, unifying primary pleadings and authenticated documentary exhibits.</p>
          <h2>II. Statement of Facts</h2>
          <p>All documentary evidence referenced herein is sequentially indexed in the accompanying exhibit section.</p>
        `,
      },
      {
        title: 'Exhibit A: Authenticated Record',
        sourceType: 'editor',
        sectionRestartNumbering: true,
        signatureText: 'Certified True Copy · Counsel of Record',
        contentHtml: `
          <h1>Exhibit A: Authenticated Documentary Record</h1>
          <p>This section restarts numbering independently to preserve exhibit citation integrity.</p>
        `,
      },
    ],
  },
  {
    id: 'course-syllabus-pack',
    category: 'Academic',
    titleEn: 'Academic Course Pack & Curriculum Guide',
    titleKm: 'សៀវភៅណែនាំកម្មវិធីសិក្សា និងឯកសារមេរៀន',
    descriptionEn:
      'Clean contemporary layout combining lecture notes, reading schedules, and assessment rubrics into one printable student packet.',
    descriptionKm:
      'គំរូឯកសារបង្រៀនសម្រាប់គ្រូ និងសាស្ត្រាចារ្យ ដើម្បីចងក្រងមេរៀន កាលវិភាគ និងលំហាត់ជារួម។',
    folder: 'Academic',
    pageSetup: {
      ...createDefaultPageSetup(),
      paperSize: 'A4',
      orientation: 'portrait',
      defaultFontFamily: '"Plus Jakarta Sans", "Battambang", sans-serif',
      defaultFontSizePt: 11,
      lineHeight: 1.55,
    },
    numberingConfig: {
      ...createDefaultNumberingConfig(),
      enabled: true,
      format: '1',
      position: 'top-right',
      displayPattern: 'page-x-of-y',
    },
    headerFooterConfig: {
      ...createDefaultHeaderFooterConfig(),
      headerEnabled: true,
      headerLeft: '{org}',
      organizationName: 'Faculty of Humanities & Sciences',
      differentFirstPage: true,
    },
    tocConfig: createDefaultTocConfig(),
    watermarkConfig: createDefaultWatermarkConfig(),
    documents: [
      {
        title: 'Course Syllabus & Schedule',
        sourceType: 'editor',
        sectionRestartNumbering: false,
        contentHtml: `
          <h1>Course Syllabus: Foundations of Research Writing</h1>
          <h2>Instructor Information &amp; Objectives</h2>
          <p>Welcome to the compiled semester reader. Students will master structured argumentation, primary source analysis, and multilingual scholarly formatting.</p>
          <table>
            <thead>
              <tr><th>Week</th><th>Module Topic</th><th>Required Deliverable</th></tr>
            </thead>
            <tbody>
              <tr><td>Week 1</td><td>Archival Research Methods</td><td>Annotated Bibliography</td></tr>
              <tr><td>Week 2</td><td>Structured Synthesis</td><td>Literature Matrix</td></tr>
            </tbody>
          </table>
        `,
      },
    ],
  },
];
