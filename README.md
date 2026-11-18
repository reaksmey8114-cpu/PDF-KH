# Document Master — Professional Document Compilation & Management System

Document Master is a full-stack, bilingual (**English / ខ្មែរ**) document compilation, formatting, automatic pagination, and export studio built with React, Vite, Express, TypeScript, Tailwind CSS, Tiptap, PDF.js, pdf-lib, Mammoth.js, `docx`, and Firebase (Authentication & Cloud Firestore).

## Core Capabilities
- **Multi-Format Document Import**: Simultaneous drag-and-drop import for `.docx`, `.doc`, `.pdf`, `.txt`, `.rtf`, `.jpg`, `.jpeg`, and `.png`.
- **Server-Side Scanned OCR (`/api/ocr`)**: Extracts structured HTML from scanned images and scanned PDFs using Gemini (`gemini-4-hydrogen`) with full Khmer Unicode & English support.
- **Compilation & Organization**: Drag-and-drop document reordering, selective document inclusion, blank pages, section breaks, and thumbnails.
- **Automatic Page Numbering**: Formats (`1, 2, 3`, `i, ii, iii`, `I, II, III`, `A, B, C`), `"Page X of Y"` patterns, 6-position placement, cover page exclusion, custom start page, and per-section numbering restarts.
- **Page Setup & Khmer Typography**: A4, A3, A5, Letter, Legal, and custom dimensions; Portrait/Landscape; custom margins, borders, backgrounds; full Khmer Unicode fonts (`Khmer OS Siemreap`, `Khmer OS Battambang`, `Khmer OS Muol`, `Noto Serif Khmer`).
- **Headers, Footers, TOC & Watermarks**: Custom token headers/footers (`{title}`, `{org}`, `{page}`, `{total}`), institutional seal logo, different first page & odd/even pages, automatic Table of Contents (H1–H3) + Lists of Tables & Figures, and customizable watermarks.
- **Export & Print**: Export compiled volumes to `.pdf`, `.docx`, `.txt`, or native browser Print Preview.

## Database Structure (`firebase-blueprint.json` & `firestore.rules`)
- `/users/{userId}`: Owner-isolated user profile and preferred interface language (`en` | `km`).
- `/projects/{projectId}`: Project metadata, folder category, status (`draft` | `compiled` | `archived`), and compilation configurations (`pageSetup`, `numberingConfig`, `headerFooterConfig`, `tocConfig`, `watermarkConfig`).
- `/projects/{projectId}/documents/{docId}`: Ordered document sections, rich HTML content, section overrides, inline comments, bookmarks, and digital signatures.
- `/projects/{projectId}/versions/{versionId}`: Saved project snapshots for instant version recovery.

## Local Development & Deployment
1. Install dependencies: `npm install`
2. Configure `GEMINI_API_KEY` and `firebase-applet-config.json`.
3. Development server: `npm run dev` (runs Express + Vite on port `3000`)
4. Build & production start:
   ```bash
   npm run build
   NODE_ENV=production npm run start
   ```
5. Deploy Firestore security rules:
   ```bash
   firebase deploy --only firestore:rules
   ```
