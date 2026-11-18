import React, { useEffect, useMemo, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bookmark,
  Check,
  ChevronDown,
  Columns2,
  Copy,
  Download,
  Eye,
  FilePlus,
  FileText,
  Globe,
  GripVertical,
  History,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  Pencil,
  Plus,
  Printer,
  Redo2,
  RotateCcw,
  Save,
  SeparatorHorizontal,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  Upload,
} from 'lucide-react';
import {
  FONT_OPTIONS,
  Language,
  NumberingFormat,
  NumberingPosition,
  PageNumberOverride,
  PaperSize,
  Project,
  ProjectDocument,
  ProjectVersion,
  getEffectivePaperMm,
} from '@/types/document';
import { getTranslations } from '@/lib/i18n';
import {
  addProjectDocument,
  createProjectVersion,
  deleteProjectDocument,
  generateSafeId,
  reorderProjectDocuments,
  restoreProjectVersion,
  subscribeProject,
  subscribeProjectDocuments,
  subscribeProjectVersions,
  updateProjectDocument,
  updateProjectFields,
} from '@/lib/firestore-service';
import {
  ImportedDocumentResult,
  buildEditableHtmlFromPdfTextPages,
  persistImportedBinaryIfPresent,
  processImportedFile,
  renderPdfPagesFromBytes,
  runOcrOnImageDataUrl,
  splitImportedResultForStorage,
} from '@/lib/document-processor';
import { getBinaryRecord, saveBinaryRecord } from '@/lib/local-binary-store';
import { compileProjectDocuments, formatNumberValue, mmToPx } from '@/lib/pagination-engine';
import {
  extractSingleHtmlPage,
  extractSinglePdfMarker,
  removeHtmlPageAtLocalIndex,
  removePdfMarkerAtLocalIndex,
  reorderHtmlPages,
  reorderPageNumberOverrides,
  reorderPdfMarkers,
  shiftPageNumberOverrides,
  splitHtmlPagesAroundLocalIndex,
  splitPdfMarkersAroundLocalIndex,
} from '@/lib/page-operations';
import {
  exportCompiledPagesToPdf,
  exportProjectToDocx,
  exportProjectToTxt,
} from '@/lib/exporters';
import {
  StainCleanOptions,
  cleanImageDataUrl,
  extractFirstImageSrcFromHtml,
  replaceImageSrcInHtml,
} from '@/lib/stain-cleaner';
import { RichTextEditor } from '@/components/RichTextEditor';
import { CompiledPageSheet } from '@/components/CompiledPageSheet';
import { InteractivePageNumberCard } from '@/components/InteractivePageNumberCard';
import { StainCleanerModal } from '@/components/StainCleanerModal';

interface DocumentEditorWorkspaceProps {
  user: User;
  projectId: string;
  language: Language;
  onChangeLanguage: (lang: Language) => void;
  onBackToDashboard: () => void;
}

type RightTab = 'page' | 'numbering' | 'header' | 'toc' | 'review';
type LeftTab = 'docs' | 'outline';

interface WorkspaceSnapshot {
  label: string;
  project: Project;
  documents: ProjectDocument[];
  activeDocId: string | null;
}

const MAX_UNDO_HISTORY = 40;

function cloneProjectForHistory(proj: Project): Project {
  return {
    ...proj,
    pageSetup: { ...proj.pageSetup },
    numberingConfig: {
      ...proj.numberingConfig,
      pageOverrides: proj.numberingConfig.pageOverrides
        ? Object.fromEntries(
            Object.entries(proj.numberingConfig.pageOverrides).map(([k, v]) => [k, { ...v }])
          )
        : {},
    },
    headerFooterConfig: { ...proj.headerFooterConfig },
    tocConfig: { ...proj.tocConfig },
    watermarkConfig: { ...proj.watermarkConfig },
  };
}

function cloneDocumentsForHistory(docs: ProjectDocument[]): ProjectDocument[] {
  return docs.map((d) => ({
    ...d,
    comments: d.comments ? d.comments.map((c) => ({ ...c })) : undefined,
    bookmarks: d.bookmarks ? d.bookmarks.map((b) => ({ ...b })) : undefined,
  }));
}

export function DocumentEditorWorkspace({
  user,
  projectId,
  language,
  onChangeLanguage,
  onBackToDashboard,
}: DocumentEditorWorkspaceProps) {
  const t = getTranslations(language);
  const [project, setProject] = useState<Project | null>(null);
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [versions, setVersions] = useState<ProjectVersion[]>([]);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [pdfPagesByDoc, setPdfPagesByDoc] = useState<Record<string, string[]>>({});
  const [pdfBytesByDoc, setPdfBytesByDoc] = useState<Record<string, ArrayBuffer>>({});
  const [cleanedPdfPagesByDoc, setCleanedPdfPagesByDoc] = useState<Record<string, number[]>>({});
  const [originalSrcByCleanedUrl, setOriginalSrcByCleanedUrl] = useState<Record<string, string>>({});
  const [missingPdfBinaryIds, setMissingPdfBinaryIds] = useState<Record<string, boolean>>({});
  const [pdfActionStatus, setPdfActionStatus] = useState<string | null>(null);
  const [stainCleanerTarget, setStainCleanerTarget] = useState<{
    docId: string;
    title: string;
    pageIndex: number;
    pdfPageNumber?: number;
    imageSrc: string;
    currentImageUrl: string;
    hasOriginalBackup: boolean;
    totalDocPages: number;
    isPdf: boolean;
  } | null>(null);

  const [viewMode, setViewMode] = useState<'edit' | 'preview'>('edit');
  const [previewZoom, setPreviewZoom] = useState(0.8);
  const [previewColumns, setPreviewColumns] = useState<1 | 2>(1);
  const [previewAutoFit, setPreviewAutoFit] = useState<boolean>(false);
  const [previewFocusCanvas, setPreviewFocusCanvas] = useState<boolean>(false);
  const [previewContainerWidth, setPreviewContainerWidth] = useState<number>(0);
  const [leftTab, setLeftTab] = useState<LeftTab>('docs');
  const [rightTab, setRightTab] = useState<RightTab>('page');
  const [saveState, setSaveState] = useState<'saved' | 'saving'>('saved');

  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [dragDocId, setDragDocId] = useState<string | null>(null);
  const [dragCompiledPageIdx, setDragCompiledPageIdx] = useState<number | null>(null);
  const [dropTargetCompiledPageIdx, setDropTargetCompiledPageIdx] = useState<number | null>(null);

  const [commentDraft, setCommentDraft] = useState('');
  const [bookmarkDraft, setBookmarkDraft] = useState('');
  const [versionLabel, setVersionLabel] = useState('');
  const [selectedNumberPageIdx, setSelectedNumberPageIdx] = useState<number>(0);
  const [undoStack, setUndoStack] = useState<WorkspaceSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<WorkspaceSnapshot[]>([]);
  const [editorSyncKey, setEditorSyncKey] = useState<number>(0);
  const [historyNotice, setHistoryNotice] = useState<string | null>(null);
  const [mediaRevision, setMediaRevision] = useState<number>(0);

  const importInputRef = useRef<HTMLInputElement>(null);
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const loadedBinaryIdsRef = useRef<Set<string>>(new Set());
  const contentSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exportSheetRefs = useRef<Array<HTMLDivElement | null>>([]);
  const previewSheetRefs = useRef<Array<HTMLDivElement | null>>([]);
  const projectRef = useRef<Project | null>(null);
  const documentsRef = useRef<ProjectDocument[]>([]);
  const activeDocIdRef = useRef<string | null>(null);
  const lastUndoGroupRef = useRef<{ key: string; at: number } | null>(null);
  const preDragSnapshotRef = useRef<WorkspaceSnapshot | null>(null);
  const historyNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  projectRef.current = project;
  documentsRef.current = documents;
  activeDocIdRef.current = activeDocId;

  useEffect(() => {
    const unsubProj = subscribeProject(projectId, (proj) => {
      setProject(proj);
      if (proj) setTitleDraft(proj.title);
    });
    const unsubDocs = subscribeProjectDocuments(projectId, user.uid, (docs) => {
      setDocuments(docs);
      setActiveDocId((prev) => {
        if (prev && docs.some((d) => d.id === prev)) return prev;
        return docs[0]?.id || null;
      });
    });
    const unsubVers = subscribeProjectVersions(projectId, user.uid, setVersions);

    return () => {
      unsubProj();
      unsubDocs();
      unsubVers();
    };
  }, [projectId, user.uid]);

  const inFlightBinaryIdsRef = useRef<Set<string>>(new Set());
  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const el = previewScrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const updateWidth = () => {
      setPreviewContainerWidth(el.clientWidth);
    };
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewMode, previewColumns, previewFocusCanvas, activeDocId]);

  const effectivePreviewScale = useMemo(() => {
    if (!previewAutoFit || previewContainerWidth <= 140 || !project) {
      return previewZoom;
    }
    const baseWidthPx = Math.max(400, mmToPx(getEffectivePaperMm(project.pageSetup).widthMm));
    const paddingPx = 64;
    const gapPx = previewColumns === 2 ? 24 : 0;
    const available = Math.max(240, previewContainerWidth - paddingPx - gapPx);
    const raw = available / (previewColumns * baseWidthPx);
    return Math.max(0.32, Math.min(1, Math.round(raw * 100) / 100));
  }, [previewAutoFit, previewContainerWidth, previewColumns, previewZoom, project]);

  const handleTogglePreviewColumns = (cols: 1 | 2) => {
    setPreviewColumns(cols);
    setPreviewAutoFit(cols === 2);
  };

  useEffect(() => {
    for (const d of documents) {
      if (loadedBinaryIdsRef.current.has(d.id) || inFlightBinaryIdsRef.current.has(d.id)) {
        continue;
      }
      inFlightBinaryIdsRef.current.add(d.id);
      void (async () => {
        try {
          const rec = await getBinaryRecord(d.id);
          if (!isMountedRef.current) return;
          if (!rec) {
            if (d.sourceType === 'pdf') {
              setMissingPdfBinaryIds((prev) => ({ ...prev, [d.id]: true }));
            }
            return;
          }

          if (rec.thumbnailDataUrl) {
            setThumbnails((prev) => ({ ...prev, [d.id]: rec.thumbnailDataUrl! }));
          }
          if (rec.bytes) {
            setPdfBytesByDoc((prev) => ({ ...prev, [d.id]: rec.bytes! }));
          }
          if (rec.cleanedPageNumbers?.length) {
            setCleanedPdfPagesByDoc((prev) => ({ ...prev, [d.id]: rec.cleanedPageNumbers! }));
          }
          if (rec.originalImageDataUrl && d.sourceType === 'image') {
            const curImg = extractFirstImageSrcFromHtml(d.contentHtml);
            if (curImg && curImg !== rec.originalImageDataUrl) {
              setOriginalSrcByCleanedUrl((prev) => ({
                ...prev,
                [curImg]: rec.originalImageDataUrl!,
              }));
            }
          }

          const hasCompletePdfPages =
            Boolean(rec.pageDataUrls && rec.pageDataUrls.length > 0) &&
            (d.sourceType !== 'pdf' ||
              (rec.pageDataUrls!.length >= d.pageCountEstimate &&
                rec.pageDataUrls!.every((u) => Boolean(u))));

          if (hasCompletePdfPages && rec.pageDataUrls) {
            setPdfPagesByDoc((prev) => ({ ...prev, [d.id]: rec.pageDataUrls! }));
          } else if (d.sourceType === 'pdf' && rec.bytes) {
            try {
              const rendered = await renderPdfPagesFromBytes(rec.bytes);
              if (!isMountedRef.current) return;
              setPdfPagesByDoc((prev) => ({ ...prev, [d.id]: rendered.pageDataUrls }));
              if (rendered.pageDataUrls[0]) {
                setThumbnails((prev) => ({ ...prev, [d.id]: rendered.pageDataUrls[0] }));
              }
              await saveBinaryRecord({
                ...rec,
                thumbnailDataUrl: rec.thumbnailDataUrl || rendered.pageDataUrls[0],
                pageDataUrls: rendered.pageDataUrls,
                pageSizesPt: rendered.pageSizesPt,
              });
            } catch (err) {
              console.warn('Could not render cached PDF pages:', err);
              if (rec.pageDataUrls?.length) {
                setPdfPagesByDoc((prev) => ({ ...prev, [d.id]: rec.pageDataUrls! }));
              } else {
                setMissingPdfBinaryIds((prev) => ({ ...prev, [d.id]: true }));
              }
            }
          } else if (rec.pageDataUrls?.length) {
            setPdfPagesByDoc((prev) => ({ ...prev, [d.id]: rec.pageDataUrls! }));
          } else if (d.sourceType === 'pdf') {
            setMissingPdfBinaryIds((prev) => ({ ...prev, [d.id]: true }));
          }

          loadedBinaryIdsRef.current.add(d.id);
        } finally {
          inFlightBinaryIdsRef.current.delete(d.id);
        }
      })();
    }
  }, [documents]);

  const loadedImageSrcsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;
    const imgSrcRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
    const pendingSrcs = new Set<string>();

    for (const d of documents) {
      if (!d.selected || !d.contentHtml || !d.contentHtml.includes('<img')) continue;
      let match: RegExpExecArray | null;
      imgSrcRegex.lastIndex = 0;
      while ((match = imgSrcRegex.exec(d.contentHtml)) !== null) {
        const src = match[1];
        if (src && !loadedImageSrcsRef.current.has(src)) {
          pendingSrcs.add(src);
        }
      }
    }

    if (pendingSrcs.size === 0) return;

    pendingSrcs.forEach((src) => {
      const img = new window.Image();
      const finish = () => {
        loadedImageSrcsRef.current.add(src);
        if (!cancelled) {
          setMediaRevision((r) => r + 1);
        }
      };
      img.onload = finish;
      img.onerror = finish;
      img.src = src;
      if (img.complete) {
        loadedImageSrcsRef.current.add(src);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [documents]);

  const activeDoc = useMemo(
    () => documents.find((d) => d.id === activeDocId) || documents[0] || null,
    [documents, activeDocId]
  );

  const compilation = useMemo(() => {
    if (!project) return null;
    void mediaRevision;
    return compileProjectDocuments(project, documents, language);
  }, [project, documents, language, mediaRevision]);

  const activeDocCompiledPageLabel = useMemo(() => {
    if (!compilation || !activeDoc) return undefined;
    const docPages = compilation.pages.filter((p) => p.docId === activeDoc.id);
    if (docPages.length === 0) return undefined;
    const first = docPages[0]?.pageNumberFormatted;
    const last = docPages[docPages.length - 1]?.pageNumberFormatted;
    if (!first) return undefined;
    return docPages.length > 1 && last && last !== first ? `${first} … ${last}` : first;
  }, [compilation, activeDoc]);

  const captureCurrentSnapshot = (label: string): WorkspaceSnapshot | null => {
    const curProj = projectRef.current;
    if (!curProj) return null;
    return {
      label,
      project: cloneProjectForHistory(curProj),
      documents: cloneDocumentsForHistory(documentsRef.current),
      activeDocId: activeDocIdRef.current,
    };
  };

  const pushUndoSnapshot = (label: string, groupKey?: string) => {
    const snap = captureCurrentSnapshot(label);
    if (!snap) return;
    const now = Date.now();
    if (
      groupKey &&
      lastUndoGroupRef.current &&
      lastUndoGroupRef.current.key === groupKey &&
      now - lastUndoGroupRef.current.at < 1200
    ) {
      lastUndoGroupRef.current = { key: groupKey, at: now };
      return;
    }
    lastUndoGroupRef.current = groupKey ? { key: groupKey, at: now } : null;
    setUndoStack((prev) => [...prev.slice(-(MAX_UNDO_HISTORY - 1)), snap]);
    setRedoStack([]);
  };

  const flashHistoryNotice = (msg: string) => {
    setHistoryNotice(msg);
    if (historyNoticeTimerRef.current) clearTimeout(historyNoticeTimerRef.current);
    historyNoticeTimerRef.current = setTimeout(() => setHistoryNotice(null), 2200);
  };

  const applyWorkspaceSnapshot = async (target: WorkspaceSnapshot) => {
    if (!projectRef.current) return;
    if (projectSaveTimerRef.current) clearTimeout(projectSaveTimerRef.current);
    if (contentSaveTimerRef.current) clearTimeout(contentSaveTimerRef.current);
    lastUndoGroupRef.current = null;
    preDragSnapshotRef.current = null;

    const currentDocs = documentsRef.current;
    const restoredProject = cloneProjectForHistory(target.project);
    const restoredDocs = cloneDocumentsForHistory(target.documents);

    setProject(restoredProject);
    setTitleDraft(restoredProject.title);
    setDocuments(restoredDocs);
    setActiveDocId(
      target.activeDocId && restoredDocs.some((d) => d.id === target.activeDocId)
        ? target.activeDocId
        : restoredDocs[0]?.id || null
    );
    setEditorSyncKey((k) => k + 1);
    setSaveState('saving');

    try {
      await updateProjectFields(restoredProject.id, {
        title: restoredProject.title,
        description: restoredProject.description,
        folder: restoredProject.folder,
        pageSetup: restoredProject.pageSetup,
        numberingConfig: restoredProject.numberingConfig,
        headerFooterConfig: restoredProject.headerFooterConfig,
        tocConfig: restoredProject.tocConfig,
        watermarkConfig: restoredProject.watermarkConfig,
        documentCount: restoredDocs.length,
      });

      const currentById = new Map(currentDocs.map((d) => [d.id, d]));
      const targetById = new Map(restoredDocs.map((d) => [d.id, d]));

      for (const curDoc of currentDocs) {
        if (!targetById.has(curDoc.id)) {
          await deleteProjectDocument(restoredProject.id, curDoc.id, restoredDocs.length);
        }
      }

      for (const tDoc of restoredDocs) {
        const existing = currentById.get(tDoc.id);
        if (!existing) {
          await addProjectDocument(
            restoredProject.id,
            user.uid,
            {
              title: tDoc.title,
              sourceType: tDoc.sourceType,
              order: tDoc.order,
              selected: tDoc.selected,
              contentHtml: tDoc.contentHtml,
              plainText: tDoc.plainText,
              pageCountEstimate: tDoc.pageCountEstimate,
              sectionRestartNumbering: tDoc.sectionRestartNumbering,
              sectionHeaderOverride: tDoc.sectionHeaderOverride,
              sectionFooterOverride: tDoc.sectionFooterOverride,
              comments: tDoc.comments,
              bookmarks: tDoc.bookmarks,
              signatureText: tDoc.signatureText,
            },
            restoredDocs.length,
            tDoc.id
          );
        } else if (
          existing.title !== tDoc.title ||
          existing.order !== tDoc.order ||
          existing.selected !== tDoc.selected ||
          existing.contentHtml !== tDoc.contentHtml ||
          existing.plainText !== tDoc.plainText ||
          existing.pageCountEstimate !== tDoc.pageCountEstimate ||
          existing.sectionRestartNumbering !== tDoc.sectionRestartNumbering ||
          (existing.sectionHeaderOverride || '') !== (tDoc.sectionHeaderOverride || '') ||
          (existing.sectionFooterOverride || '') !== (tDoc.sectionFooterOverride || '') ||
          (existing.signatureText || '') !== (tDoc.signatureText || '') ||
          JSON.stringify(existing.comments || []) !== JSON.stringify(tDoc.comments || []) ||
          JSON.stringify(existing.bookmarks || []) !== JSON.stringify(tDoc.bookmarks || [])
        ) {
          await updateProjectDocument(restoredProject.id, tDoc.id, {
            title: tDoc.title,
            order: tDoc.order,
            selected: tDoc.selected,
            contentHtml: tDoc.contentHtml,
            plainText: tDoc.plainText,
            pageCountEstimate: tDoc.pageCountEstimate,
            sectionRestartNumbering: tDoc.sectionRestartNumbering,
            sectionHeaderOverride: tDoc.sectionHeaderOverride ?? '',
            sectionFooterOverride: tDoc.sectionFooterOverride ?? '',
            comments: tDoc.comments || [],
            bookmarks: tDoc.bookmarks || [],
            signatureText: tDoc.signatureText ?? '',
          });
        }
      }
    } finally {
      setSaveState('saved');
    }
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    const currentSnap = captureCurrentSnapshot(previous.label);
    setUndoStack((prev) => prev.slice(0, -1));
    if (currentSnap) {
      setRedoStack((prev) => [...prev.slice(-(MAX_UNDO_HISTORY - 1)), currentSnap]);
    }
    flashHistoryNotice(
      language === 'km' ? `បានត្រឡប់៖ ${previous.label}` : `Undid: ${previous.label}`
    );
    void applyWorkspaceSnapshot(previous);
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    const currentSnap = captureCurrentSnapshot(next.label);
    setRedoStack((prev) => prev.slice(0, -1));
    if (currentSnap) {
      setUndoStack((prev) => [...prev.slice(-(MAX_UNDO_HISTORY - 1)), currentSnap]);
    }
    flashHistoryNotice(
      language === 'km' ? `បានធ្វើឡើងវិញ៖ ${next.label}` : `Redid: ${next.label}`
    );
    void applyWorkspaceSnapshot(next);
  };

  const handleUndoRef = useRef(handleUndo);
  const handleRedoRef = useRef(handleRedo);
  handleUndoRef.current = handleUndo;
  handleRedoRef.current = handleRedo;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;

      const active = document.activeElement as HTMLElement | null;
      if (active) {
        const tag = active.tagName.toLowerCase();
        if (tag === 'textarea') return;
        if (tag === 'input') {
          const inputType = (active as HTMLInputElement).type;
          if (!['checkbox', 'radio', 'button', 'submit', 'color', 'range'].includes(inputType)) {
            return;
          }
        }
        if (active.isContentEditable || active.closest('.ProseMirror')) {
          return;
        }
      }

      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndoRef.current();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        handleRedoRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const scheduleProjectUpdate = (
    updates: Partial<Project>,
    options?: { label?: string; groupKey?: string; skipUndo?: boolean }
  ) => {
    if (!project) return;
    if (!options?.skipUndo) {
      const inferLabel =
        options?.label ||
        (updates.numberingConfig
          ? language === 'km'
            ? 'លេខទំព័រ'
            : 'Page numbering'
          : updates.pageSetup
          ? language === 'km'
            ? 'ទម្រង់ទំព័រ'
            : 'Page setup'
          : updates.headerFooterConfig
          ? language === 'km'
            ? 'ក្បាល និងជើងទំព័រ'
            : 'Header & Footer'
          : updates.tocConfig
          ? language === 'km'
            ? 'មាតិកា'
            : 'Table of Contents'
          : updates.watermarkConfig
          ? 'Watermark'
          : updates.title
          ? language === 'km'
            ? 'ចំណងជើងគម្រោង'
            : 'Project title'
          : 'Project settings');
      const inferGroup =
        options?.groupKey ||
        (updates.numberingConfig
          ? 'numbering'
          : updates.pageSetup
          ? 'pageSetup'
          : updates.headerFooterConfig
          ? 'headerFooter'
          : updates.tocConfig
          ? 'toc'
          : updates.watermarkConfig
          ? 'watermark'
          : 'project');
      pushUndoSnapshot(inferLabel, inferGroup);
    }
    const optimistic = { ...project, ...updates };
    setProject(optimistic);
    setSaveState('saving');
    if (projectSaveTimerRef.current) clearTimeout(projectSaveTimerRef.current);
    projectSaveTimerRef.current = setTimeout(async () => {
      await updateProjectFields(project.id, updates);
      setSaveState('saved');
    }, 500);
  };

  const buildNextNumberingWithOverride = (
    pageIndex: number,
    patch: Partial<PageNumberOverride>
  ): Project['numberingConfig'] | null => {
    if (!project) return null;
    const key = String(pageIndex);
    const currentOverrides = { ...(project.numberingConfig.pageOverrides || {}) };
    const merged: PageNumberOverride = { ...(currentOverrides[key] || {}), ...patch };

    if (merged.offsetXPx === 0) delete merged.offsetXPx;
    if (merged.offsetYPx === 0) delete merged.offsetYPx;
    if (!merged.hidden) delete merged.hidden;
    if (merged.prefixText === undefined) delete merged.prefixText;
    if (merged.suffixText === undefined) delete merged.suffixText;
    if (merged.position === project.numberingConfig.position && Object.keys(merged).length === 1) {
      delete merged.position;
    }

    if (Object.keys(merged).length === 0) {
      delete currentOverrides[key];
    } else {
      currentOverrides[key] = merged;
    }

    return {
      ...project.numberingConfig,
      pageOverrides: currentOverrides,
    };
  };

  const handleUpdatePageNumberOverride = (
    pageIndex: number,
    patch: Partial<PageNumberOverride>,
    persist = true
  ) => {
    if (!project) return;
    if (!persist && !preDragSnapshotRef.current) {
      preDragSnapshotRef.current = captureCurrentSnapshot(
        language === 'km' ? `ផ្លាស់ទីលេខទំព័រ ${pageIndex + 1}` : `Move page ${pageIndex + 1} number`
      );
    }
    const nextNumCfg = buildNextNumberingWithOverride(pageIndex, patch);
    if (!nextNumCfg) return;
    if (!persist) {
      setProject({ ...project, numberingConfig: nextNumCfg });
      return;
    }
    if (preDragSnapshotRef.current) {
      const snap = preDragSnapshotRef.current;
      preDragSnapshotRef.current = null;
      lastUndoGroupRef.current = null;
      setUndoStack((prev) => [...prev.slice(-(MAX_UNDO_HISTORY - 1)), snap]);
      setRedoStack([]);
      scheduleProjectUpdate({ numberingConfig: nextNumCfg }, { skipUndo: true });
      return;
    }
    scheduleProjectUpdate(
      { numberingConfig: nextNumCfg },
      {
        label:
          language === 'km'
            ? `ទីតាំងលេខទំព័រ ${pageIndex + 1}`
            : `Page ${pageIndex + 1} number position`,
        groupKey: `pageOverride:${pageIndex}`,
      }
    );
  };

  const handleResetPageNumberOverride = (pageIndex: number) => {
    if (!project) return;
    const nextOverrides = { ...(project.numberingConfig.pageOverrides || {}) };
    delete nextOverrides[String(pageIndex)];
    scheduleProjectUpdate(
      {
        numberingConfig: { ...project.numberingConfig, pageOverrides: nextOverrides },
      },
      {
        label:
          language === 'km'
            ? `កំណត់ទីតាំងទំព័រ ${pageIndex + 1} ឡើងវិញ`
            : `Reset page ${pageIndex + 1} position`,
      }
    );
  };

  const handleResetAllPageNumberOverrides = () => {
    if (!project) return;
    scheduleProjectUpdate(
      {
        numberingConfig: { ...project.numberingConfig, pageOverrides: {} },
      },
      {
        label: language === 'km' ? 'កំណត់ទីតាំងទំព័រទាំងអស់ឡើងវិញ' : 'Reset all page positions',
      }
    );
  };

  const handleDocumentContentChange = (
    html: string,
    plainText: string,
    undoLabel?: string,
    groupKey?: string
  ) => {
    if (!project || !activeDoc) return;
    pushUndoSnapshot(
      undoLabel || (language === 'km' ? 'កែសម្រួលអត្ថបទ' : 'Edit document content'),
      groupKey === undefined ? `docContent:${activeDoc.id}` : groupKey || undefined
    );
    const estPages = Math.max(1, Math.ceil(plainText.length / 1800));
    setDocuments((prev) =>
      prev.map((d) =>
        d.id === activeDoc.id
          ? { ...d, contentHtml: html, plainText, pageCountEstimate: estPages }
          : d
      )
    );
    setSaveState('saving');
    if (contentSaveTimerRef.current) clearTimeout(contentSaveTimerRef.current);
    const targetDocId = activeDoc.id;
    contentSaveTimerRef.current = setTimeout(async () => {
      await updateProjectDocument(project.id, targetDocId, {
        contentHtml: html,
        plainText,
        pageCountEstimate: estPages,
      });
      setSaveState('saved');
    }, 650);
  };

  const handleAddSection = async (kind: 'editor' | 'blank' | 'section-break') => {
    if (!project) return;
    pushUndoSnapshot(language === 'km' ? 'បន្ថែមផ្នែកថ្មី' : 'Add section');
    const nextOrder = documents.length;
    const title =
      kind === 'blank'
        ? t.addBlankPage
        : kind === 'section-break'
        ? t.addSectionBreak
        : `Section ${nextOrder + 1}`;
    const contentHtml = kind === 'editor' ? `<h2>${title}</h2><p></p>` : '<p></p>';
    const newId = await addProjectDocument(
      project.id,
      user.uid,
      {
        title,
        sourceType: kind,
        order: nextOrder,
        selected: true,
        contentHtml,
        plainText: kind === 'editor' ? title : '',
        pageCountEstimate: 1,
        sectionRestartNumbering: kind === 'section-break',
      },
      documents.length + 1
    );
    setActiveDocId(newId);
    setViewMode('edit');
  };

  const handleDuplicateDoc = async (docItem: ProjectDocument) => {
    if (!project) return;
    pushUndoSnapshot(language === 'km' ? 'ចម្លងឯកសារ' : 'Duplicate document');
    const newId = await addProjectDocument(
      project.id,
      user.uid,
      {
        title: `${docItem.title} (Copy)`.slice(0, 200),
        sourceType: docItem.sourceType,
        order: documents.length,
        selected: docItem.selected,
        contentHtml: docItem.contentHtml,
        plainText: docItem.plainText,
        pageCountEstimate: docItem.pageCountEstimate,
        sectionRestartNumbering: docItem.sectionRestartNumbering,
        signatureText: docItem.signatureText,
      },
      documents.length + 1
    );
    const existingBin = await getBinaryRecord(docItem.id);
    if (existingBin) {
      await saveBinaryRecord({ ...existingBin, docId: newId, sourceBinaryDocId: undefined });
    }
    setActiveDocId(newId);
  };

  const handleDeleteDoc = async (docItem: ProjectDocument) => {
    if (!project || documents.length <= 1) return;
    pushUndoSnapshot(language === 'km' ? `លុប ${docItem.title}` : `Remove ${docItem.title}`);
    const deletedDocPages = compilation?.pages.filter((p) => p.docId === docItem.id) || [];
    const remaining = documents
      .filter((d) => d.id !== docItem.id)
      .map((d, idx) => ({ ...d, order: idx }));

    let nextProject = project;
    if (deletedDocPages.length > 0 && project.numberingConfig.pageOverrides) {
      let shiftedOverrides = { ...project.numberingConfig.pageOverrides };
      const sortedDesc = [...deletedDocPages].sort((a, b) => b.pageIndex - a.pageIndex);
      for (const p of sortedDesc) {
        shiftedOverrides = shiftPageNumberOverrides(shiftedOverrides, p.pageIndex, -1);
      }
      nextProject = {
        ...project,
        numberingConfig: { ...project.numberingConfig, pageOverrides: shiftedOverrides },
      };
      setProject(nextProject);
    }

    setDocuments(remaining);
    if (activeDocId === docItem.id) {
      setActiveDocId(remaining[0]?.id || null);
    }
    setSaveState('saving');
    try {
      await deleteProjectDocument(project.id, docItem.id, remaining.length);
      if (remaining.length > 0) {
        await reorderProjectDocuments(project.id, remaining);
      }
      if (nextProject !== project) {
        await updateProjectFields(project.id, {
          numberingConfig: nextProject.numberingConfig,
        });
      }
    } finally {
      setSaveState('saved');
    }
  };

  const handleAddCompiledPageAt = async (
    targetPageIndex: number,
    placement: 'before' | 'after',
    pageKind: 'blank' | 'editor'
  ) => {
    if (!project || !compilation) return;
    const pages = compilation.pages;
    if (pages.length === 0) {
      await handleAddSection(pageKind);
      return;
    }

    const clampedTarget = Math.max(0, Math.min(pages.length - 1, targetPageIndex));
    const pg = pages[clampedTarget];

    // If targeting the auto-generated TOC page, delegate to adjacent content page
    if (pg.isTocPage) {
      if (placement === 'after' && clampedTarget + 1 < pages.length) {
        await handleAddCompiledPageAt(clampedTarget + 1, 'before', pageKind);
        return;
      }
      if (placement === 'before' && clampedTarget > 0) {
        await handleAddCompiledPageAt(clampedTarget - 1, 'after', pageKind);
        return;
      }
    }

    const targetDoc =
      documents.find((d) => d.id === pg.docId) ||
      (placement === 'before' ? documents[0] : documents[documents.length - 1]);

    if (!targetDoc) {
      await handleAddSection(pageKind);
      return;
    }

    if (projectSaveTimerRef.current) clearTimeout(projectSaveTimerRef.current);
    if (contentSaveTimerRef.current) clearTimeout(contentSaveTimerRef.current);

    pushUndoSnapshot(
      pageKind === 'blank'
        ? language === 'km'
          ? 'បន្ថែមទំព័រទទេ'
          : 'Add blank page'
        : language === 'km'
        ? 'បន្ថែមទំព័រអត្ថបទ'
        : 'Add text page'
    );

    const docPages = pg.isTocPage ? [] : pages.filter((p) => p.docId === targetDoc.id);
    const localIdx = pg.isTocPage
      ? 0
      : Math.max(0, docPages.findIndex((p) => p.pageIndex === pg.pageIndex));

    const isAtDocStartBefore = pg.isTocPage
      ? placement === 'before'
      : placement === 'before' && localIdx === 0;
    const isAtDocEndAfter = pg.isTocPage
      ? placement === 'after'
      : placement === 'after' && localIdx >= docPages.length - 1;

    const overridePivot = pg.isTocPage
      ? placement === 'before'
        ? clampedTarget
        : clampedTarget + 1
      : placement === 'before'
      ? clampedTarget
      : clampedTarget + 1;

    const nextOverrides = shiftPageNumberOverrides(
      project.numberingConfig.pageOverrides,
      overridePivot,
      1
    );
    const nextProject: Project = {
      ...project,
      numberingConfig: { ...project.numberingConfig, pageOverrides: nextOverrides },
    };

    const newDocId = generateSafeId('doc');
    const newTitle =
      pageKind === 'blank'
        ? t.addBlankPage
        : language === 'km'
        ? `ទំព័រថ្មី`
        : `New Page`;
    const newDocBase: ProjectDocument = {
      id: newDocId,
      projectId: project.id,
      ownerId: user.uid,
      title: newTitle,
      sourceType: pageKind,
      order: 0,
      selected: true,
      contentHtml: '<p></p>',
      plainText: '',
      pageCountEstimate: 1,
      sectionRestartNumbering: false,
    };

    const docIdxInAll = documents.findIndex((d) => d.id === targetDoc.id);
    setProject(nextProject);
    setSaveState('saving');

    try {
      if (isAtDocStartBefore || isAtDocEndAfter || docPages.length <= 1) {
        const insertAt = isAtDocStartBefore ? Math.max(0, docIdxInAll) : docIdxInAll + 1;
        const nextDocs = [...documents];
        nextDocs.splice(insertAt, 0, newDocBase);
        const reindexed = nextDocs.map((d, idx) => ({ ...d, order: idx }));

        setDocuments(reindexed);
        setSelectedNumberPageIdx(overridePivot);
        if (pageKind === 'editor') {
          setActiveDocId(newDocId);
          setViewMode('edit');
        }
        flashHistoryNotice(t.pageAddedNotice);

        await addProjectDocument(
          project.id,
          user.uid,
          {
            title: newDocBase.title,
            sourceType: newDocBase.sourceType,
            order: insertAt,
            selected: true,
            contentHtml: newDocBase.contentHtml,
            plainText: newDocBase.plainText,
            pageCountEstimate: 1,
            sectionRestartNumbering: false,
          },
          reindexed.length,
          newDocId
        );
        await reorderProjectDocuments(project.id, reindexed);
        await updateProjectFields(project.id, {
          documentCount: reindexed.length,
          numberingConfig: nextProject.numberingConfig,
        });
      } else {
        // Split multi-page document around the insertion boundary so the new page lands at the exact page slot
        const splitAfterLocalIdx = placement === 'before' ? localIdx - 1 : localIdx;
        const isPdfDoc =
          targetDoc.sourceType === 'pdf' && targetDoc.contentHtml.includes('dm-pdf-page-marker');

        const tailDocId = generateSafeId('doc');
        let updatedHeadDoc: ProjectDocument;
        let tailDoc: ProjectDocument;

        if (isPdfDoc) {
          const pdfSplit = splitPdfMarkersAroundLocalIndex(
            targetDoc.contentHtml,
            splitAfterLocalIdx
          );
          if (!pdfSplit) {
            setSaveState('saved');
            return;
          }
          updatedHeadDoc = {
            ...targetDoc,
            contentHtml: pdfSplit.beforeHtml,
            pageCountEstimate: pdfSplit.beforeCount,
          };
          tailDoc = {
            id: tailDocId,
            projectId: project.id,
            ownerId: user.uid,
            title: `${targetDoc.title} (Cont.)`.slice(0, 200),
            sourceType: 'pdf',
            order: 0,
            selected: true,
            contentHtml: pdfSplit.afterHtml,
            plainText: targetDoc.plainText,
            pageCountEstimate: pdfSplit.afterCount,
            sectionRestartNumbering: false,
          };

          const existingBin = await getBinaryRecord(targetDoc.id);
          const rootBinaryId = existingBin?.sourceBinaryDocId || targetDoc.id;
          if (existingBin) {
            await saveBinaryRecord({
              docId: tailDocId,
              mimeType: existingBin.mimeType,
              fileName: existingBin.fileName,
              pageSizesPt: existingBin.pageSizesPt,
              sourceBinaryDocId: rootBinaryId,
            });
          }
          const curPages = pdfPagesByDoc[targetDoc.id] || existingBin?.pageDataUrls;
          const curBytes = pdfBytesByDoc[targetDoc.id] || existingBin?.bytes;
          const curThumb = thumbnails[targetDoc.id] || existingBin?.thumbnailDataUrl;
          if (curPages?.length) {
            setPdfPagesByDoc((prev) => ({ ...prev, [tailDocId]: curPages }));
          }
          if (curBytes) {
            setPdfBytesByDoc((prev) => ({ ...prev, [tailDocId]: curBytes }));
          }
          if (curThumb) {
            setThumbnails((prev) => ({ ...prev, [tailDocId]: curThumb }));
          }
          loadedBinaryIdsRef.current.add(tailDocId);
        } else {
          const htmlSplit = splitHtmlPagesAroundLocalIndex(docPages, splitAfterLocalIdx);
          updatedHeadDoc = {
            ...targetDoc,
            contentHtml: htmlSplit.beforeHtml,
            plainText: htmlSplit.beforePlain,
            pageCountEstimate: htmlSplit.beforeCount,
          };
          tailDoc = {
            id: tailDocId,
            projectId: project.id,
            ownerId: user.uid,
            title: `${targetDoc.title} (Cont.)`.slice(0, 200),
            sourceType: targetDoc.sourceType === 'image' ? 'editor' : targetDoc.sourceType,
            order: 0,
            selected: true,
            contentHtml: htmlSplit.afterHtml,
            plainText: htmlSplit.afterPlain,
            pageCountEstimate: htmlSplit.afterCount,
            sectionRestartNumbering: false,
          };
        }

        const nextDocs = [...documents];
        nextDocs[docIdxInAll] = updatedHeadDoc;
        nextDocs.splice(docIdxInAll + 1, 0, newDocBase, tailDoc);
        const reindexed = nextDocs.map((d, idx) => ({ ...d, order: idx }));

        setDocuments(reindexed);
        setEditorSyncKey((k) => k + 1);
        setSelectedNumberPageIdx(overridePivot);
        if (pageKind === 'editor') {
          setActiveDocId(newDocId);
          setViewMode('edit');
        }
        flashHistoryNotice(t.pageAddedNotice);

        await updateProjectDocument(project.id, updatedHeadDoc.id, {
          contentHtml: updatedHeadDoc.contentHtml,
          plainText: updatedHeadDoc.plainText,
          pageCountEstimate: updatedHeadDoc.pageCountEstimate,
        });
        await addProjectDocument(
          project.id,
          user.uid,
          {
            title: newDocBase.title,
            sourceType: newDocBase.sourceType,
            order: docIdxInAll + 1,
            selected: true,
            contentHtml: newDocBase.contentHtml,
            plainText: newDocBase.plainText,
            pageCountEstimate: 1,
            sectionRestartNumbering: false,
          },
          reindexed.length,
          newDocId
        );
        await addProjectDocument(
          project.id,
          user.uid,
          {
            title: tailDoc.title,
            sourceType: tailDoc.sourceType,
            order: docIdxInAll + 2,
            selected: true,
            contentHtml: tailDoc.contentHtml,
            plainText: tailDoc.plainText,
            pageCountEstimate: tailDoc.pageCountEstimate,
            sectionRestartNumbering: false,
          },
          reindexed.length,
          tailDocId
        );
        await reorderProjectDocuments(project.id, reindexed);
        await updateProjectFields(project.id, {
          documentCount: reindexed.length,
          numberingConfig: nextProject.numberingConfig,
        });
      }
    } finally {
      setSaveState('saved');
    }
  };

  const handleDeleteCompiledPageAt = async (targetPageIndex: number) => {
    if (!project || !compilation) return;
    const pg = compilation.pages[targetPageIndex];
    if (!pg) return;

    if (projectSaveTimerRef.current) clearTimeout(projectSaveTimerRef.current);
    if (contentSaveTimerRef.current) clearTimeout(contentSaveTimerRef.current);

    pushUndoSnapshot(
      language === 'km' ? `លុបទំព័រទី ${targetPageIndex + 1}` : `Delete page ${targetPageIndex + 1}`
    );

    const nextOverrides = shiftPageNumberOverrides(
      project.numberingConfig.pageOverrides,
      targetPageIndex,
      -1
    );
    const nextNumberingConfig = {
      ...project.numberingConfig,
      pageOverrides: nextOverrides,
    };

    setSaveState('saving');
    try {
      // Case 1: Deleting the auto-generated TOC page disables TOC and renumbers immediately
      if (pg.isTocPage) {
        const nextProject: Project = {
          ...project,
          tocConfig: { ...project.tocConfig, enabled: false },
          numberingConfig: nextNumberingConfig,
        };
        setProject(nextProject);
        setSelectedNumberPageIdx((prev) =>
          Math.max(0, Math.min(prev, Math.max(0, compilation.pages.length - 2)))
        );
        flashHistoryNotice(t.pageDeletedNotice);
        await updateProjectFields(project.id, {
          tocConfig: nextProject.tocConfig,
          numberingConfig: nextProject.numberingConfig,
        });
        return;
      }

      const targetDoc = documents.find((d) => d.id === pg.docId);
      if (!targetDoc) return;

      const docPages = compilation.pages.filter((p) => p.docId === targetDoc.id);
      const localIdx = Math.max(0, docPages.findIndex((p) => p.pageIndex === pg.pageIndex));

      const nextProject: Project = {
        ...project,
        numberingConfig: nextNumberingConfig,
      };
      setProject(nextProject);

      // Case 2: This document only occupies a single page
      if (docPages.length <= 1) {
        if (documents.length > 1) {
          const oldIdx = documents.findIndex((d) => d.id === targetDoc.id);
          const remaining = documents
            .filter((d) => d.id !== targetDoc.id)
            .map((d, idx) => ({ ...d, order: idx }));

          setDocuments(remaining);
          if (activeDocId === targetDoc.id) {
            const fallback = remaining[Math.min(oldIdx, remaining.length - 1)] || remaining[0];
            setActiveDocId(fallback?.id || null);
          }
          setSelectedNumberPageIdx((prev) =>
            Math.max(0, Math.min(prev, Math.max(0, compilation.pages.length - 2)))
          );
          setEditorSyncKey((k) => k + 1);
          flashHistoryNotice(t.pageDeletedNotice);

          await deleteProjectDocument(project.id, targetDoc.id, remaining.length);
          await reorderProjectDocuments(project.id, remaining);
          await updateProjectFields(project.id, {
            documentCount: remaining.length,
            numberingConfig: nextNumberingConfig,
          });
        } else {
          // Only 1 page remains in the entire project: reset cleanly to an empty single blank page
          if (targetDoc.sourceType === 'pdf') {
            const replacementId = generateSafeId('doc');
            const replacementDoc: ProjectDocument = {
              id: replacementId,
              projectId: project.id,
              ownerId: user.uid,
              title: t.addBlankPage,
              sourceType: 'blank',
              order: 0,
              selected: true,
              contentHtml: '<p></p>',
              plainText: '',
              pageCountEstimate: 1,
              sectionRestartNumbering: false,
            };
            setDocuments([replacementDoc]);
            setActiveDocId(replacementId);
            setSelectedNumberPageIdx(0);
            setEditorSyncKey((k) => k + 1);
            flashHistoryNotice(t.pageDeletedNotice);

            await addProjectDocument(
              project.id,
              user.uid,
              {
                title: replacementDoc.title,
                sourceType: 'blank',
                order: 0,
                selected: true,
                contentHtml: '<p></p>',
                plainText: '',
                pageCountEstimate: 1,
                sectionRestartNumbering: false,
              },
              1,
              replacementId
            );
            await deleteProjectDocument(project.id, targetDoc.id, 1);
            await updateProjectFields(project.id, {
              documentCount: 1,
              numberingConfig: nextNumberingConfig,
            });
          } else {
            const clearedDoc: ProjectDocument = {
              ...targetDoc,
              contentHtml: '<p></p>',
              plainText: '',
              pageCountEstimate: 1,
            };
            setDocuments([clearedDoc]);
            setSelectedNumberPageIdx(0);
            setEditorSyncKey((k) => k + 1);
            flashHistoryNotice(t.pageDeletedNotice);

            await updateProjectDocument(project.id, targetDoc.id, {
              contentHtml: '<p></p>',
              plainText: '',
              pageCountEstimate: 1,
            });
            await updateProjectFields(project.id, {
              numberingConfig: nextNumberingConfig,
            });
          }
        }
        return;
      }

      // Case 3: Deleting one page from a multi-page PDF document
      if (targetDoc.sourceType === 'pdf' && targetDoc.contentHtml.includes('dm-pdf-page-marker')) {
        const res = removePdfMarkerAtLocalIndex(
          targetDoc.contentHtml,
          localIdx,
          pg.pdfPageNumber
        );
        if (!res) return;
        const updatedDoc: ProjectDocument = {
          ...targetDoc,
          contentHtml: res.html,
          pageCountEstimate: Math.max(1, res.remainingCount),
        };
        setDocuments((prev) => prev.map((d) => (d.id === targetDoc.id ? updatedDoc : d)));
        setSelectedNumberPageIdx((prev) =>
          Math.max(0, Math.min(prev, Math.max(0, compilation.pages.length - 2)))
        );
        flashHistoryNotice(t.pageDeletedNotice);

        await updateProjectDocument(project.id, targetDoc.id, {
          contentHtml: updatedDoc.contentHtml,
          pageCountEstimate: updatedDoc.pageCountEstimate,
        });
        await updateProjectFields(project.id, {
          numberingConfig: nextNumberingConfig,
        });
        return;
      }

      // Case 4: Deleting one page from a multi-page HTML/DOCX/RichText document
      const res = removeHtmlPageAtLocalIndex(docPages, localIdx);
      const updatedDoc: ProjectDocument = {
        ...targetDoc,
        contentHtml: res.html,
        plainText: res.plainText,
        pageCountEstimate: Math.max(1, res.remainingCount),
      };
      setDocuments((prev) => prev.map((d) => (d.id === targetDoc.id ? updatedDoc : d)));
      setEditorSyncKey((k) => k + 1);
      setSelectedNumberPageIdx((prev) =>
        Math.max(0, Math.min(prev, Math.max(0, compilation.pages.length - 2)))
      );
      flashHistoryNotice(t.pageDeletedNotice);

      await updateProjectDocument(project.id, targetDoc.id, {
        contentHtml: updatedDoc.contentHtml,
        plainText: updatedDoc.plainText,
        pageCountEstimate: updatedDoc.pageCountEstimate,
      });
      await updateProjectFields(project.id, {
        numberingConfig: nextNumberingConfig,
      });
    } finally {
      setSaveState('saved');
    }
  };

  const handleReorderCompiledPage = async (fromPageIndex: number, toPageIndex: number) => {
    if (!project || !compilation) return;
    if (fromPageIndex === toPageIndex) return;
    const fromPg = compilation.pages[fromPageIndex];
    const toPg = compilation.pages[toPageIndex];
    if (!fromPg || !toPg || fromPg.isTocPage || toPg.isTocPage) return;

    const fromDocIdx = documents.findIndex((d) => d.id === fromPg.docId);
    const toDocIdx = documents.findIndex((d) => d.id === toPg.docId);
    if (fromDocIdx < 0 || toDocIdx < 0) return;

    if (projectSaveTimerRef.current) clearTimeout(projectSaveTimerRef.current);
    if (contentSaveTimerRef.current) clearTimeout(contentSaveTimerRef.current);

    pushUndoSnapshot(
      language === 'km'
        ? `ប្ដូរទីតាំងទំព័រ ${fromPageIndex + 1} → ${toPageIndex + 1}`
        : `Move page ${fromPageIndex + 1} → ${toPageIndex + 1}`
    );

    const nextOverrides = reorderPageNumberOverrides(
      project.numberingConfig.pageOverrides,
      fromPageIndex,
      toPageIndex
    );
    const nextNumberingConfig = {
      ...project.numberingConfig,
      pageOverrides: nextOverrides,
    };
    const nextProject: Project = {
      ...project,
      numberingConfig: nextNumberingConfig,
    };
    setProject(nextProject);

    setSaveState('saving');
    try {
      const fromDoc = documents[fromDocIdx];
      const toDoc = documents[toDocIdx];
      const fromDocPages = compilation.pages.filter((p) => p.docId === fromDoc.id);
      const fromLocalIdx = Math.max(
        0,
        fromDocPages.findIndex((p) => p.pageIndex === fromPg.pageIndex)
      );

      // Case 1: Reordering a page inside the same multi-page document
      if (fromDoc.id === toDoc.id) {
        const toLocalIdx = Math.max(
          0,
          fromDocPages.findIndex((p) => p.pageIndex === toPg.pageIndex)
        );
        if (fromLocalIdx === toLocalIdx) return;

        if (fromDoc.sourceType === 'pdf' && fromDoc.contentHtml.includes('dm-pdf-page-marker')) {
          const res = reorderPdfMarkers(fromDoc.contentHtml, fromLocalIdx, toLocalIdx);
          if (!res) return;
          const updatedDoc: ProjectDocument = {
            ...fromDoc,
            contentHtml: res.html,
            pageCountEstimate: res.count,
          };
          setDocuments((prev) => prev.map((d) => (d.id === fromDoc.id ? updatedDoc : d)));
          setSelectedNumberPageIdx(toPageIndex);
          flashHistoryNotice(t.pageReorderedNotice);

          await updateProjectDocument(project.id, fromDoc.id, {
            contentHtml: updatedDoc.contentHtml,
            pageCountEstimate: updatedDoc.pageCountEstimate,
          });
          await updateProjectFields(project.id, {
            numberingConfig: nextNumberingConfig,
          });
          return;
        }

        const res = reorderHtmlPages(fromDocPages, fromLocalIdx, toLocalIdx);
        const updatedDoc: ProjectDocument = {
          ...fromDoc,
          contentHtml: res.html,
          plainText: res.plainText,
        };
        setDocuments((prev) => prev.map((d) => (d.id === fromDoc.id ? updatedDoc : d)));
        setEditorSyncKey((k) => k + 1);
        setSelectedNumberPageIdx(toPageIndex);
        flashHistoryNotice(t.pageReorderedNotice);

        await updateProjectDocument(project.id, fromDoc.id, {
          contentHtml: updatedDoc.contentHtml,
          plainText: updatedDoc.plainText,
        });
        await updateProjectFields(project.id, {
          numberingConfig: nextNumberingConfig,
        });
        return;
      }

      // Case 2: Moving a page across documents (supports single-page move, extract, and target split)
      const toDocPages = compilation.pages.filter((p) => p.docId === toDoc.id);
      const toLocalIdx = Math.max(
        0,
        toDocPages.findIndex((p) => p.pageIndex === toPg.pageIndex)
      );

      let movedDoc: ProjectDocument;
      let updatedFromDoc: ProjectDocument | null = null;
      let isMovedDocNew = false;

      if (fromDocPages.length <= 1) {
        movedDoc = fromDoc;
      } else {
        isMovedDocNew = true;
        const movedId = generateSafeId('doc');
        const isFromPdf =
          fromDoc.sourceType === 'pdf' && fromDoc.contentHtml.includes('dm-pdf-page-marker');

        if (isFromPdf) {
          const ext = extractSinglePdfMarker(
            fromDoc.contentHtml,
            fromLocalIdx,
            fromPg.pdfPageNumber
          );
          if (!ext) return;

          updatedFromDoc = {
            ...fromDoc,
            contentHtml: ext.remainingHtml,
            pageCountEstimate: Math.max(1, ext.remainingCount),
          };
          movedDoc = {
            id: movedId,
            projectId: project.id,
            ownerId: user.uid,
            title: `${fromDoc.title} (p.${fromLocalIdx + 1})`.slice(0, 200),
            sourceType: 'pdf',
            order: 0,
            selected: true,
            contentHtml: ext.extractedHtml,
            plainText: fromDoc.plainText,
            pageCountEstimate: 1,
            sectionRestartNumbering: false,
          };

          const existingBin = await getBinaryRecord(fromDoc.id);
          const rootBinaryId = existingBin?.sourceBinaryDocId || fromDoc.id;
          if (existingBin) {
            await saveBinaryRecord({
              docId: movedId,
              mimeType: existingBin.mimeType,
              fileName: existingBin.fileName,
              pageSizesPt: existingBin.pageSizesPt,
              sourceBinaryDocId: rootBinaryId,
            });
          }
          const curPages = pdfPagesByDoc[fromDoc.id] || existingBin?.pageDataUrls;
          const curBytes = pdfBytesByDoc[fromDoc.id] || existingBin?.bytes;
          const curThumb = thumbnails[fromDoc.id] || existingBin?.thumbnailDataUrl;
          if (curPages?.length) {
            setPdfPagesByDoc((prev) => ({ ...prev, [movedId]: curPages }));
          }
          if (curBytes) {
            setPdfBytesByDoc((prev) => ({ ...prev, [movedId]: curBytes }));
          }
          if (curThumb) {
            setThumbnails((prev) => ({ ...prev, [movedId]: curThumb }));
          }
          loadedBinaryIdsRef.current.add(movedId);
        } else {
          const ext = extractSingleHtmlPage(fromDocPages, fromLocalIdx);
          updatedFromDoc = {
            ...fromDoc,
            contentHtml: ext.remainingHtml,
            plainText: ext.remainingPlain,
            pageCountEstimate: Math.max(1, ext.remainingCount),
          };
          movedDoc = {
            id: movedId,
            projectId: project.id,
            ownerId: user.uid,
            title: `${fromDoc.title} (p.${fromLocalIdx + 1})`.slice(0, 200),
            sourceType: fromDoc.sourceType === 'image' ? 'editor' : fromDoc.sourceType,
            order: 0,
            selected: true,
            contentHtml: ext.extractedHtml,
            plainText: ext.extractedPlain,
            pageCountEstimate: 1,
            sectionRestartNumbering: false,
          };
        }
      }

      const workingDocs = [...documents];
      if (updatedFromDoc) {
        workingDocs[fromDocIdx] = updatedFromDoc;
      } else {
        workingDocs.splice(fromDocIdx, 1);
      }

      const targetIdxInWorking = workingDocs.findIndex((d) => d.id === toDoc.id);
      if (targetIdxInWorking < 0) return;

      const placement: 'before' | 'after' = fromPageIndex < toPageIndex ? 'after' : 'before';
      const isAtBoundary =
        toDocPages.length <= 1 ||
        (placement === 'before' && toLocalIdx === 0) ||
        (placement === 'after' && toLocalIdx === toDocPages.length - 1);

      let updatedToHeadDoc: ProjectDocument | null = null;
      let createdTailDoc: ProjectDocument | null = null;

      if (isAtBoundary) {
        const insertAt = placement === 'before' ? targetIdxInWorking : targetIdxInWorking + 1;
        workingDocs.splice(insertAt, 0, movedDoc);
      } else {
        const splitAfterLocalIdx = placement === 'before' ? toLocalIdx - 1 : toLocalIdx;
        const isToPdf =
          toDoc.sourceType === 'pdf' && toDoc.contentHtml.includes('dm-pdf-page-marker');
        const tailDocId = generateSafeId('doc');

        if (isToPdf) {
          const pdfSplit = splitPdfMarkersAroundLocalIndex(
            toDoc.contentHtml,
            splitAfterLocalIdx
          );
          if (!pdfSplit) return;

          updatedToHeadDoc = {
            ...toDoc,
            contentHtml: pdfSplit.beforeHtml,
            pageCountEstimate: pdfSplit.beforeCount,
          };
          createdTailDoc = {
            id: tailDocId,
            projectId: project.id,
            ownerId: user.uid,
            title: `${toDoc.title} (Cont.)`.slice(0, 200),
            sourceType: 'pdf',
            order: 0,
            selected: true,
            contentHtml: pdfSplit.afterHtml,
            plainText: toDoc.plainText,
            pageCountEstimate: pdfSplit.afterCount,
            sectionRestartNumbering: false,
          };

          const existingBin = await getBinaryRecord(toDoc.id);
          const rootBinaryId = existingBin?.sourceBinaryDocId || toDoc.id;
          if (existingBin) {
            await saveBinaryRecord({
              docId: tailDocId,
              mimeType: existingBin.mimeType,
              fileName: existingBin.fileName,
              pageSizesPt: existingBin.pageSizesPt,
              sourceBinaryDocId: rootBinaryId,
            });
          }
          const curPages = pdfPagesByDoc[toDoc.id] || existingBin?.pageDataUrls;
          const curBytes = pdfBytesByDoc[toDoc.id] || existingBin?.bytes;
          const curThumb = thumbnails[toDoc.id] || existingBin?.thumbnailDataUrl;
          if (curPages?.length) {
            setPdfPagesByDoc((prev) => ({ ...prev, [tailDocId]: curPages }));
          }
          if (curBytes) {
            setPdfBytesByDoc((prev) => ({ ...prev, [tailDocId]: curBytes }));
          }
          if (curThumb) {
            setThumbnails((prev) => ({ ...prev, [tailDocId]: curThumb }));
          }
          loadedBinaryIdsRef.current.add(tailDocId);
        } else {
          const htmlSplit = splitHtmlPagesAroundLocalIndex(toDocPages, splitAfterLocalIdx);
          updatedToHeadDoc = {
            ...toDoc,
            contentHtml: htmlSplit.beforeHtml,
            plainText: htmlSplit.beforePlain,
            pageCountEstimate: htmlSplit.beforeCount,
          };
          createdTailDoc = {
            id: tailDocId,
            projectId: project.id,
            ownerId: user.uid,
            title: `${toDoc.title} (Cont.)`.slice(0, 200),
            sourceType: toDoc.sourceType === 'image' ? 'editor' : toDoc.sourceType,
            order: 0,
            selected: true,
            contentHtml: htmlSplit.afterHtml,
            plainText: htmlSplit.afterPlain,
            pageCountEstimate: htmlSplit.afterCount,
            sectionRestartNumbering: false,
          };
        }

        workingDocs[targetIdxInWorking] = updatedToHeadDoc;
        workingDocs.splice(targetIdxInWorking + 1, 0, movedDoc, createdTailDoc);
      }

      const reindexed = workingDocs.map((d, idx) => ({ ...d, order: idx }));
      setDocuments(reindexed);
      setEditorSyncKey((k) => k + 1);
      setSelectedNumberPageIdx(toPageIndex);
      flashHistoryNotice(t.pageReorderedNotice);

      if (updatedFromDoc) {
        await updateProjectDocument(project.id, updatedFromDoc.id, {
          contentHtml: updatedFromDoc.contentHtml,
          plainText: updatedFromDoc.plainText,
          pageCountEstimate: updatedFromDoc.pageCountEstimate,
        });
      }
      if (isMovedDocNew) {
        const movedOrder = reindexed.findIndex((d) => d.id === movedDoc.id);
        await addProjectDocument(
          project.id,
          user.uid,
          {
            title: movedDoc.title,
            sourceType: movedDoc.sourceType,
            order: Math.max(0, movedOrder),
            selected: true,
            contentHtml: movedDoc.contentHtml,
            plainText: movedDoc.plainText,
            pageCountEstimate: movedDoc.pageCountEstimate,
            sectionRestartNumbering: false,
          },
          reindexed.length,
          movedDoc.id
        );
      }
      if (updatedToHeadDoc) {
        await updateProjectDocument(project.id, updatedToHeadDoc.id, {
          contentHtml: updatedToHeadDoc.contentHtml,
          plainText: updatedToHeadDoc.plainText,
          pageCountEstimate: updatedToHeadDoc.pageCountEstimate,
        });
      }
      if (createdTailDoc) {
        const tailOrder = reindexed.findIndex((d) => d.id === createdTailDoc.id);
        await addProjectDocument(
          project.id,
          user.uid,
          {
            title: createdTailDoc.title,
            sourceType: createdTailDoc.sourceType,
            order: Math.max(0, tailOrder),
            selected: true,
            contentHtml: createdTailDoc.contentHtml,
            plainText: createdTailDoc.plainText,
            pageCountEstimate: createdTailDoc.pageCountEstimate,
            sectionRestartNumbering: false,
          },
          reindexed.length,
          createdTailDoc.id
        );
      }
      await reorderProjectDocuments(project.id, reindexed);
      await updateProjectFields(project.id, {
        documentCount: reindexed.length,
        numberingConfig: nextNumberingConfig,
      });
    } finally {
      setSaveState('saved');
    }
  };

  const handleStepMoveCompiledPage = async (pageIndex: number, direction: -1 | 1) => {
    if (!compilation) return;
    let targetIdx = pageIndex + direction;
    while (
      targetIdx >= 0 &&
      targetIdx < compilation.pages.length &&
      compilation.pages[targetIdx]?.isTocPage
    ) {
      targetIdx += direction;
    }
    if (targetIdx < 0 || targetIdx >= compilation.pages.length) return;
    await handleReorderCompiledPage(pageIndex, targetIdx);
  };

  const handleImportMoreFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || !project) return;
    pushUndoSnapshot(language === 'km' ? 'នាំចូលឯកសារ' : 'Import files');
    setSaveState('saving');
    let orderCursor = documents.length;
    let lastAddedId: string | null = null;
    for (const file of Array.from(files)) {
      try {
        const rawImported = await processImportedFile(file);
        const parts = splitImportedResultForStorage(rawImported);
        let fileRootDocId: string | undefined;
        let fileRootThumb: string | undefined;
        let fileRootPages: string[] | undefined;
        let fileRootBytes: ArrayBuffer | undefined;

        for (let partIdx = 0; partIdx < parts.length; partIdx++) {
          const imported = parts[partIdx];
          const docId = generateSafeId('doc');
          if (partIdx === 0) {
            fileRootDocId = docId;
            fileRootThumb = imported.thumbnailDataUrl;
            fileRootPages = imported.pageDataUrls;
            fileRootBytes = imported.binaryBytes;
          }
          await persistImportedBinaryIfPresent(
            docId,
            imported,
            partIdx > 0 ? fileRootDocId : undefined
          );

          const effThumb = imported.thumbnailDataUrl || fileRootThumb;
          const effPages = imported.pageDataUrls || fileRootPages;
          const effBytes = imported.binaryBytes || fileRootBytes;

          if (effThumb) {
            setThumbnails((prev) => ({ ...prev, [docId]: effThumb }));
          }
          if (effPages?.length) {
            setPdfPagesByDoc((prev) => ({ ...prev, [docId]: effPages }));
          }
          if (effBytes) {
            setPdfBytesByDoc((prev) => ({ ...prev, [docId]: effBytes }));
          }
          loadedBinaryIdsRef.current.add(docId);

          await addProjectDocument(
            project.id,
            user.uid,
            {
              title: imported.title,
              sourceType: imported.sourceType,
              order: orderCursor++,
              selected: true,
              contentHtml: imported.contentHtml,
              plainText: imported.plainText,
              pageCountEstimate: imported.pageCountEstimate,
              sectionRestartNumbering: false,
            },
            orderCursor,
            docId
          );
          lastAddedId = docId;
        }
      } catch (err) {
        console.error('Import file failed:', err);
        setExportStatus(err instanceof Error ? err.message : `Failed to import ${file.name}`);
        setTimeout(() => setExportStatus(null), 4000);
      }
    }
    if (lastAddedId) setActiveDocId(lastAddedId);
    setSaveState('saved');
  };

  const handleReorderDrop = async (targetDocId: string) => {
    if (!project || !dragDocId || dragDocId === targetDocId) return;
    const fromIdx = documents.findIndex((d) => d.id === dragDocId);
    const toIdx = documents.findIndex((d) => d.id === targetDocId);
    if (fromIdx < 0 || toIdx < 0) return;

    pushUndoSnapshot(language === 'km' ? 'រៀបចំលំដាប់ឯកសារ' : 'Reorder documents');
    const copy = [...documents];
    const [moved] = copy.splice(fromIdx, 1);
    copy.splice(toIdx, 0, moved);
    const reindexed = copy.map((d, idx) => ({ ...d, order: idx }));
    setDocuments(reindexed);
    setDragDocId(null);
    await reorderProjectDocuments(project.id, reindexed);
  };

  const handleMoveDoc = async (docId: string, direction: -1 | 1) => {
    if (!project) return;
    const idx = documents.findIndex((d) => d.id === docId);
    const targetIdx = idx + direction;
    if (idx < 0 || targetIdx < 0 || targetIdx >= documents.length) return;
    pushUndoSnapshot(language === 'km' ? 'ផ្លាស់ប្ដូរលំដាប់ឯកសារ' : 'Move document');
    const copy = [...documents];
    const [item] = copy.splice(idx, 1);
    copy.splice(targetIdx, 0, item);
    const reindexed = copy.map((d, i) => ({ ...d, order: i }));
    setDocuments(reindexed);
    await reorderProjectDocuments(project.id, reindexed);
  };

  const getPageCleanInfo = (pg: {
    docId: string;
    isTocPage: boolean;
    html: string;
    pdfDocId?: string;
    pdfPageNumber?: number;
  }): { canClean: boolean; isCleaned: boolean } => {
    if (pg.pdfDocId && pg.pdfPageNumber) {
      const imgUrl = pdfPagesByDoc[pg.pdfDocId]?.[pg.pdfPageNumber - 1];
      const cleanedNums = cleanedPdfPagesByDoc[pg.pdfDocId] || [];
      return {
        canClean: Boolean(imgUrl),
        isCleaned: cleanedNums.includes(pg.pdfPageNumber),
      };
    }
    if (!pg.isTocPage && pg.html && pg.html.includes('<img')) {
      const imgSrc = extractFirstImageSrcFromHtml(pg.html);
      return {
        canClean: Boolean(imgSrc && imgSrc.startsWith('data:image/')),
        isCleaned: Boolean(imgSrc && originalSrcByCleanedUrl[imgSrc]),
      };
    }
    return { canClean: false, isCleaned: false };
  };

  const openStainCleanerForCompiledPage = async (pageIndex: number) => {
    if (!compilation) return;
    const pg = compilation.pages[pageIndex];
    if (!pg || pg.isTocPage) return;
    const targetDoc = documents.find((d) => d.id === pg.docId);

    if (pg.pdfDocId && pg.pdfPageNumber) {
      const rec = await getBinaryRecord(pg.pdfDocId);
      const curUrl =
        pdfPagesByDoc[pg.pdfDocId]?.[pg.pdfPageNumber - 1] ||
        rec?.pageDataUrls?.[pg.pdfPageNumber - 1];
      const origUrl = rec?.originalPageDataUrls?.[pg.pdfPageNumber - 1] || curUrl;
      if (!origUrl || !curUrl) return;
      const cleanedList = cleanedPdfPagesByDoc[pg.pdfDocId] || rec?.cleanedPageNumbers || [];
      const docPdfPages = compilation.pages.filter((p) => p.pdfDocId === pg.pdfDocId);
      setStainCleanerTarget({
        docId: pg.pdfDocId,
        title: `${targetDoc?.title || pg.docTitle} — ${t.pageLabel} ${pg.pdfPageNumber}`,
        pageIndex,
        pdfPageNumber: pg.pdfPageNumber,
        imageSrc: origUrl,
        currentImageUrl: curUrl,
        hasOriginalBackup: cleanedList.includes(pg.pdfPageNumber),
        totalDocPages: docPdfPages.length || pdfPagesByDoc[pg.pdfDocId]?.length || 1,
        isPdf: true,
      });
      return;
    }

    const curImgSrc =
      extractFirstImageSrcFromHtml(pg.html) ||
      extractFirstImageSrcFromHtml(targetDoc?.contentHtml || '');
    if (!curImgSrc || !curImgSrc.startsWith('data:image/')) return;
    const rec = targetDoc ? await getBinaryRecord(targetDoc.id) : null;
    const idbOrig =
      targetDoc?.sourceType === 'image' ? rec?.originalImageDataUrl : undefined;
    const origSrc = originalSrcByCleanedUrl[curImgSrc] || idbOrig || curImgSrc;

    setStainCleanerTarget({
      docId: pg.docId,
      title: targetDoc?.title || pg.docTitle,
      pageIndex,
      imageSrc: origSrc,
      currentImageUrl: curImgSrc,
      hasOriginalBackup: Boolean(originalSrcByCleanedUrl[curImgSrc] || idbOrig),
      totalDocPages: 1,
      isPdf: false,
    });
  };

  const handleApplyStainCleanSingle = async (cleanedDataUrl: string) => {
    if (!stainCleanerTarget || !project) return;
    setSaveState('saving');
    try {
      if (stainCleanerTarget.isPdf && stainCleanerTarget.pdfPageNumber) {
        const targetDocId = stainCleanerTarget.docId;
        const pageNum = stainCleanerTarget.pdfPageNumber;
        const existingRec = await getBinaryRecord(targetDocId);
        const curPages = [
          ...(pdfPagesByDoc[targetDocId] || existingRec?.pageDataUrls || []),
        ];
        const origPages = [...(existingRec?.originalPageDataUrls || curPages)];
        if (!origPages[pageNum - 1]) {
          origPages[pageNum - 1] = stainCleanerTarget.imageSrc;
        }
        curPages[pageNum - 1] = cleanedDataUrl;

        const prevCleaned =
          cleanedPdfPagesByDoc[targetDocId] || existingRec?.cleanedPageNumbers || [];
        const cleanedNums = Array.from(new Set([...prevCleaned, pageNum]));

        setPdfPagesByDoc((prev) => ({ ...prev, [targetDocId]: curPages }));
        setCleanedPdfPagesByDoc((prev) => ({ ...prev, [targetDocId]: cleanedNums }));
        if (pageNum === 1) {
          setThumbnails((prev) => ({ ...prev, [targetDocId]: cleanedDataUrl }));
        }

        await saveBinaryRecord({
          docId: targetDocId,
          mimeType: existingRec?.mimeType || 'application/pdf',
          fileName: existingRec?.fileName || 'document.pdf',
          bytes: existingRec?.bytes || pdfBytesByDoc[targetDocId],
          thumbnailDataUrl:
            pageNum === 1
              ? cleanedDataUrl
              : existingRec?.thumbnailDataUrl || thumbnails[targetDocId],
          pageDataUrls: curPages,
          originalPageDataUrls: origPages,
          cleanedPageNumbers: cleanedNums,
          pageSizesPt: existingRec?.pageSizesPt,
          sourceBinaryDocId: existingRec?.sourceBinaryDocId,
        });
        flashHistoryNotice(t.pageCleanedNotice);
        return;
      }

      const targetDoc = documents.find((d) => d.id === stainCleanerTarget.docId);
      if (!targetDoc) return;
      pushUndoSnapshot(
        language === 'km' ? 'សម្អាតស្នាមប្រឡាក់លើរូបភាព' : 'Clean document image stains'
      );

      const origBackup =
        originalSrcByCleanedUrl[stainCleanerTarget.currentImageUrl] ||
        stainCleanerTarget.imageSrc;
      setOriginalSrcByCleanedUrl((prev) => {
        const next = { ...prev };
        delete next[stainCleanerTarget.currentImageUrl];
        next[cleanedDataUrl] = origBackup;
        return next;
      });

      if (targetDoc.sourceType === 'image') {
        const existingRec = await getBinaryRecord(targetDoc.id);
        await saveBinaryRecord({
          docId: targetDoc.id,
          mimeType: existingRec?.mimeType || 'image/png',
          fileName: existingRec?.fileName || targetDoc.title,
          bytes: existingRec?.bytes,
          thumbnailDataUrl: cleanedDataUrl,
          originalImageDataUrl: origBackup,
          pageSizesPt: existingRec?.pageSizesPt,
          sourceBinaryDocId: existingRec?.sourceBinaryDocId,
        });
      }

      const nextHtml = replaceImageSrcInHtml(
        targetDoc.contentHtml,
        stainCleanerTarget.currentImageUrl,
        cleanedDataUrl
      );
      setDocuments((prev) =>
        prev.map((d) => (d.id === targetDoc.id ? { ...d, contentHtml: nextHtml } : d))
      );
      setThumbnails((prev) => ({ ...prev, [targetDoc.id]: cleanedDataUrl }));
      setEditorSyncKey((k) => k + 1);
      setMediaRevision((r) => r + 1);
      flashHistoryNotice(t.pageCleanedNotice);

      await updateProjectDocument(project.id, targetDoc.id, {
        contentHtml: nextHtml,
      });
    } finally {
      setSaveState('saved');
    }
  };

  const handleApplyStainCleanAllPdfPages = async (
    options: StainCleanOptions,
    onProgress: (done: number, total: number) => void
  ) => {
    if (!stainCleanerTarget || !stainCleanerTarget.isPdf || !compilation) return;
    const targetDocId = stainCleanerTarget.docId;
    const existingRec = await getBinaryRecord(targetDocId);
    const curPages = [
      ...(pdfPagesByDoc[targetDocId] || existingRec?.pageDataUrls || []),
    ];
    if (curPages.length === 0) return;

    const origPages = [...(existingRec?.originalPageDataUrls || curPages)];
    const targetPageNums = Array.from(
      new Set(
        compilation.pages
          .filter((p) => p.pdfDocId === targetDocId && p.pdfPageNumber)
          .map((p) => p.pdfPageNumber as number)
      )
    );
    const pageNumsToClean =
      targetPageNums.length > 0 ? targetPageNums : curPages.map((_, idx) => idx + 1);

    setSaveState('saving');
    try {
      const cleanedNums = new Set<number>(
        cleanedPdfPagesByDoc[targetDocId] || existingRec?.cleanedPageNumbers || []
      );
      for (let i = 0; i < pageNumsToClean.length; i++) {
        const pNum = pageNumsToClean[i];
        const sourceUrl = origPages[pNum - 1] || curPages[pNum - 1];
        if (sourceUrl) {
          if (!origPages[pNum - 1]) origPages[pNum - 1] = sourceUrl;
          curPages[pNum - 1] = await cleanImageDataUrl(sourceUrl, options, [], undefined, 1800);
          cleanedNums.add(pNum);
        }
        onProgress(i + 1, pageNumsToClean.length);
        await new Promise((r) => setTimeout(r, 0));
      }

      const nextCleanedList = Array.from(cleanedNums);
      setPdfPagesByDoc((prev) => ({ ...prev, [targetDocId]: curPages }));
      setCleanedPdfPagesByDoc((prev) => ({ ...prev, [targetDocId]: nextCleanedList }));
      if (curPages[0]) {
        setThumbnails((prev) => ({ ...prev, [targetDocId]: curPages[0] }));
      }

      await saveBinaryRecord({
        docId: targetDocId,
        mimeType: existingRec?.mimeType || 'application/pdf',
        fileName: existingRec?.fileName || 'document.pdf',
        bytes: existingRec?.bytes || pdfBytesByDoc[targetDocId],
        thumbnailDataUrl: curPages[0] || existingRec?.thumbnailDataUrl,
        pageDataUrls: curPages,
        originalPageDataUrls: origPages,
        cleanedPageNumbers: nextCleanedList,
        pageSizesPt: existingRec?.pageSizesPt,
        sourceBinaryDocId: existingRec?.sourceBinaryDocId,
      });
      flashHistoryNotice(t.pageCleanedNotice);
    } finally {
      setSaveState('saved');
    }
  };

  const handleResetStainCleanPage = async () => {
    if (!stainCleanerTarget || !project) return;
    setSaveState('saving');
    try {
      if (stainCleanerTarget.isPdf && stainCleanerTarget.pdfPageNumber) {
        const targetDocId = stainCleanerTarget.docId;
        const pageNum = stainCleanerTarget.pdfPageNumber;
        const existingRec = await getBinaryRecord(targetDocId);
        let origUrl = existingRec?.originalPageDataUrls?.[pageNum - 1];

        if (!origUrl && (existingRec?.bytes || pdfBytesByDoc[targetDocId])) {
          const bytes = existingRec?.bytes || pdfBytesByDoc[targetDocId];
          if (bytes) {
            const rendered = await renderPdfPagesFromBytes(bytes);
            origUrl = rendered.pageDataUrls[pageNum - 1];
          }
        }
        if (!origUrl) return;

        const curPages = [
          ...(pdfPagesByDoc[targetDocId] || existingRec?.pageDataUrls || []),
        ];
        curPages[pageNum - 1] = origUrl;
        const nextCleaned = (
          cleanedPdfPagesByDoc[targetDocId] ||
          existingRec?.cleanedPageNumbers ||
          []
        ).filter((n) => n !== pageNum);

        setPdfPagesByDoc((prev) => ({ ...prev, [targetDocId]: curPages }));
        setCleanedPdfPagesByDoc((prev) => ({ ...prev, [targetDocId]: nextCleaned }));
        if (pageNum === 1) {
          setThumbnails((prev) => ({ ...prev, [targetDocId]: origUrl! }));
        }

        await saveBinaryRecord({
          docId: targetDocId,
          mimeType: existingRec?.mimeType || 'application/pdf',
          fileName: existingRec?.fileName || 'document.pdf',
          bytes: existingRec?.bytes || pdfBytesByDoc[targetDocId],
          thumbnailDataUrl:
            pageNum === 1 ? origUrl : existingRec?.thumbnailDataUrl || thumbnails[targetDocId],
          pageDataUrls: curPages,
          originalPageDataUrls: existingRec?.originalPageDataUrls,
          cleanedPageNumbers: nextCleaned,
          pageSizesPt: existingRec?.pageSizesPt,
          sourceBinaryDocId: existingRec?.sourceBinaryDocId,
        });
        flashHistoryNotice(t.pageCleanResetNotice);
        return;
      }

      const targetDoc = documents.find((d) => d.id === stainCleanerTarget.docId);
      if (!targetDoc) return;
      const existingRec = await getBinaryRecord(targetDoc.id);
      const idbOrig =
        targetDoc.sourceType === 'image' ? existingRec?.originalImageDataUrl : undefined;
      const origBackup =
        originalSrcByCleanedUrl[stainCleanerTarget.currentImageUrl] || idbOrig;
      if (!origBackup) return;

      pushUndoSnapshot(
        language === 'km' ? 'ស្ដាររូបភាពដើមវិញ' : 'Restore original document image'
      );
      const nextHtml = replaceImageSrcInHtml(
        targetDoc.contentHtml,
        stainCleanerTarget.currentImageUrl,
        origBackup
      );
      setDocuments((prev) =>
        prev.map((d) => (d.id === targetDoc.id ? { ...d, contentHtml: nextHtml } : d))
      );
      setOriginalSrcByCleanedUrl((prev) => {
        const copy = { ...prev };
        delete copy[stainCleanerTarget.currentImageUrl];
        return copy;
      });
      setThumbnails((prev) => ({ ...prev, [targetDoc.id]: origBackup }));
      setEditorSyncKey((k) => k + 1);
      setMediaRevision((r) => r + 1);
      flashHistoryNotice(t.pageCleanResetNotice);

      await updateProjectDocument(project.id, targetDoc.id, {
        contentHtml: nextHtml,
      });
    } finally {
      setSaveState('saved');
    }
  };

  const handleExportPdf = async () => {
    if (!project || !compilation) return;
    setShowExportMenu(false);
    setExportStatus('Preparing PDF...');
    try {
      await new Promise((r) => setTimeout(r, 120));
      const nodes = exportSheetRefs.current.slice(0, compilation.pages.length);
      await exportCompiledPagesToPdf(
        project,
        nodes,
        (cur, total) => {
          setExportStatus(`Rendering PDF (${cur}/${total})...`);
        },
        compilation.pages,
        async (docId) => pdfBytesByDoc[docId] || (await getBinaryRecord(docId))?.bytes,
        async (docId, pageNumber) => {
          const rec = await getBinaryRecord(docId);
          const cleanedList = cleanedPdfPagesByDoc[docId] || rec?.cleanedPageNumbers || [];
          if (!cleanedList.includes(pageNumber)) return undefined;
          return (
            pdfPagesByDoc[docId]?.[pageNumber - 1] || rec?.pageDataUrls?.[pageNumber - 1]
          );
        }
      );
      setExportStatus(t.exportSuccess);
      setTimeout(() => setExportStatus(null), 2500);
    } catch (err) {
      setExportStatus(err instanceof Error ? err.message : 'PDF Export Failed');
    }
  };

  const handleExportDocx = async () => {
    if (!project || !compilation) return;
    setShowExportMenu(false);
    setExportStatus('Generating DOCX...');
    try {
      await exportProjectToDocx(
        project,
        documents,
        compilation,
        async (docId) => pdfPagesByDoc[docId] || (await getBinaryRecord(docId))?.pageDataUrls
      );
      setExportStatus(t.exportSuccess);
      setTimeout(() => setExportStatus(null), 2500);
    } catch (err) {
      setExportStatus(err instanceof Error ? err.message : 'DOCX Export Failed');
    }
  };

  const handleExportTxt = () => {
    if (!project || !compilation) return;
    setShowExportMenu(false);
    exportProjectToTxt(project, compilation);
    setExportStatus(t.exportSuccess);
    setTimeout(() => setExportStatus(null), 2500);
  };

  const handleSaveVersion = async () => {
    if (!project) return;
    setSaveState('saving');
    const label = versionLabel.trim() || `Snapshot ${new Date().toLocaleTimeString()}`;
    await createProjectVersion(project.id, user.uid, label, documents);
    setVersionLabel('');
    setSaveState('saved');
  };

  const jumpToCompiledPage = (pageIndex: number) => {
    setViewMode('preview');
    setTimeout(() => {
      const target = previewSheetRefs.current[pageIndex];
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  };

  if (!project || !compilation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-sm text-slate-600">
        Loading workspace...
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-slate-100 overflow-hidden">
      <header className="no-print bg-white border-b border-slate-200 px-4 py-2.5 flex items-center justify-between gap-4 shrink-0 z-30">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBackToDashboard}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-md whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            {t.backToDashboard}
          </button>

          <div className="w-px h-5 bg-slate-200" />

          {editingTitle ? (
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => {
                  if (titleDraft.trim() && titleDraft.trim() !== project.title) {
                    scheduleProjectUpdate({ title: titleDraft.trim() });
                  }
                  setEditingTitle(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (titleDraft.trim() && titleDraft.trim() !== project.title) {
                      scheduleProjectUpdate({ title: titleDraft.trim() });
                    }
                    setEditingTitle(false);
                  }
                }}
                className="text-sm font-semibold border border-blue-600 rounded px-2 py-1 text-slate-900 focus:outline-none"
                autoFocus
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditingTitle(true)}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900 hover:text-blue-700 truncate max-w-xs"
            >
              <span className="truncate">{project.title}</span>
              <Pencil className="w-3 h-3 text-slate-400 shrink-0" />
            </button>
          )}

          <span className="hidden lg:inline text-xs text-slate-400 font-mono tabular-nums whitespace-nowrap">
            {saveState === 'saving' ? t.saving : t.saved} · {compilation.totalPages} pages
          </span>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg shrink-0">
          <button
            type="button"
            onClick={() => setViewMode('edit')}
            className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              viewMode === 'edit' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Pencil className="w-3.5 h-3.5" />
            {t.editMode}
          </button>
          <button
            type="button"
            onClick={() => setViewMode('preview')}
            className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              viewMode === 'preview' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            {t.previewMode}
          </button>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {(historyNotice || exportStatus) && (
            <span className="text-xs font-medium text-blue-700 px-2 whitespace-nowrap">
              {historyNotice || exportStatus}
            </span>
          )}

          <div className="flex items-center border border-slate-200 rounded-md overflow-hidden bg-white">
            <button
              type="button"
              onClick={handleUndo}
              disabled={undoStack.length === 0}
              title={
                undoStack.length > 0
                  ? `${t.undoBtn}: ${undoStack[undoStack.length - 1].label} (Ctrl+Z)`
                  : t.undoBtn
              }
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-35 disabled:cursor-not-allowed whitespace-nowrap"
            >
              <Undo2 className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">{t.undoBtn}</span>
            </button>
            <div className="w-px h-4 bg-slate-200" />
            <button
              type="button"
              onClick={handleRedo}
              disabled={redoStack.length === 0}
              title={
                redoStack.length > 0
                  ? `${t.redoBtn}: ${redoStack[redoStack.length - 1].label} (Ctrl+Y)`
                  : t.redoBtn
              }
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-35 disabled:cursor-not-allowed whitespace-nowrap"
            >
              <Redo2 className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">{t.redoBtn}</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => onChangeLanguage(language === 'en' ? 'km' : 'en')}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md whitespace-nowrap"
          >
            <Globe className="w-3.5 h-3.5" />
            {language === 'en' ? 'ខ្មែរ' : 'EN'}
          </button>

          <button
            type="button"
            onClick={handleSaveVersion}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-md whitespace-nowrap"
          >
            <Save className="w-3.5 h-3.5" />
            {t.saveVersion}
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-md whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5" />
            {t.printPreview}
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowExportMenu((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              {t.exportMenu}
              <ChevronDown className="w-3.5 h-3.5" />
            </button>

            {showExportMenu && (
              <div className="absolute right-0 mt-1.5 w-52 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-50">
                <button
                  type="button"
                  onClick={handleExportPdf}
                  className="w-full text-left px-3.5 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50"
                >
                  {t.exportPdf}
                </button>
                <button
                  type="button"
                  onClick={handleExportDocx}
                  className="w-full text-left px-3.5 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50"
                >
                  {t.exportDocx}
                </button>
                <button
                  type="button"
                  onClick={handleExportTxt}
                  className="w-full text-left px-3.5 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50"
                >
                  {t.exportTxt}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="no-print flex-1 flex min-h-0 overflow-hidden">
        <aside
          className={`w-72 bg-white border-r border-slate-200 flex flex-col shrink-0 ${
            viewMode === 'preview' && previewFocusCanvas ? 'hidden' : ''
          }`}
        >
          <div className="p-2 border-b border-slate-200 flex gap-1 bg-slate-50">
            <button
              type="button"
              onClick={() => setLeftTab('docs')}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                leftTab === 'docs' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              {t.leftSidebarDocs} ({documents.length})
            </button>
            <button
              type="button"
              onClick={() => setLeftTab('outline')}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                leftTab === 'outline' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              {t.leftSidebarToc}
            </button>
          </div>

          {leftTab === 'docs' ? (
            <>
              <div className="p-2.5 border-b border-slate-200 grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => handleAddSection('editor')}
                  className="inline-flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded"
                >
                  <FilePlus className="w-3.5 h-3.5" />
                  {t.addNewSection}
                </button>
                <button
                  type="button"
                  onClick={() => importInputRef.current?.click()}
                  className="inline-flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-medium text-blue-800 bg-blue-50 hover:bg-blue-100 rounded"
                >
                  <Upload className="w-3.5 h-3.5" />
                  {t.importMoreFiles}
                </button>
                <button
                  type="button"
                  onClick={() => handleAddSection('blank')}
                  className="inline-flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 rounded"
                >
                  <Square className="w-3 h-3" />
                  {t.addBlankPage}
                </button>
                <button
                  type="button"
                  onClick={() => handleAddSection('section-break')}
                  className="inline-flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 rounded"
                >
                  <SeparatorHorizontal className="w-3 h-3" />
                  {t.addSectionBreak}
                </button>
                <input
                  ref={importInputRef}
                  type="file"
                  multiple
                  accept=".docx,.docm,.dotx,.dotm,.doc,.dot,.wps,.pdf,.rtf,.odt,.ott,.ods,.ots,.odp,.otp,.xlsx,.xlsm,.xltx,.xls,.pptx,.pptm,.ppt,.ppsx,.epub,.csv,.tsv,.txt,.md,.xml,.html,.htm,.xhtml,.mht,.mhtml,.json,.log,.jpg,.jpeg,.png,.webp,.gif,.bmp,.svg,.avif"
                  className="hidden"
                  onChange={(e) => {
                    handleImportMoreFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
              </div>

              <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                {documents.map((docItem, idx) => {
                  const isActive = activeDoc?.id === docItem.id;
                  const thumb = thumbnails[docItem.id];
                  return (
                    <div
                      key={docItem.id}
                      draggable
                      onDragStart={() => setDragDocId(docItem.id)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => handleReorderDrop(docItem.id)}
                      onClick={() => {
                        setActiveDocId(docItem.id);
                        setViewMode('edit');
                      }}
                      className={`group border rounded-lg p-2.5 cursor-pointer transition-colors ${
                        isActive
                          ? 'border-blue-600 bg-blue-50/40'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <GripVertical className="w-3.5 h-3.5 text-slate-400 mt-1 shrink-0 cursor-grab" />
                        <input
                          type="checkbox"
                          checked={docItem.selected}
                          title={t.compileSelectedOnly}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            pushUndoSnapshot(
                              language === 'km' ? 'រួមបញ្ចូលឯកសារ' : 'Toggle document inclusion'
                            );
                            setDocuments((prev) =>
                              prev.map((d) =>
                                d.id === docItem.id ? { ...d, selected: checked } : d
                              )
                            );
                            updateProjectDocument(project.id, docItem.id, {
                              selected: checked,
                            });
                          }}
                          className="mt-1 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                        />

                        {thumb ? (
                          <img
                            src={thumb}
                            alt={docItem.title}
                            referrerPolicy="no-referrer"
                            className="w-8 h-10 object-cover border border-slate-200 rounded shrink-0"
                          />
                        ) : (
                          <div className="w-8 h-10 bg-slate-50 border border-slate-200 rounded flex items-center justify-center shrink-0">
                            <FileText className="w-4 h-4 text-slate-400" />
                          </div>
                        )}

                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold text-slate-900 truncate">
                            {docItem.title}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                            {docItem.sourceType.toUpperCase()} · ~{docItem.pageCountEstimate}p
                          </div>
                        </div>
                      </div>

                      <div className="mt-2 pt-1.5 border-t border-slate-100 flex items-center justify-between text-slate-400">
                        <span className="text-[10px] font-mono tabular-nums">#{idx + 1}</span>
                        <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => handleMoveDoc(docItem.id, -1)}
                            disabled={idx === 0}
                            className="p-1 hover:text-slate-800 disabled:opacity-30"
                            title="Move Up"
                          >
                            <ArrowUp className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMoveDoc(docItem.id, 1)}
                            disabled={idx === documents.length - 1}
                            className="p-1 hover:text-slate-800 disabled:opacity-30"
                            title="Move Down"
                          >
                            <ArrowDown className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDuplicateDoc(docItem)}
                            className="p-1 hover:text-slate-800"
                            title="Duplicate"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                          {documents.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleDeleteDoc(docItem)}
                              className="p-1 hover:text-red-600"
                              title="Remove"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="px-3 py-2 border-t border-slate-200 text-[11px] text-slate-500 font-mono tabular-nums flex justify-between">
                <span>
                  {documents.filter((d) => d.selected).length}/{documents.length}{' '}
                  {t.selectedForCompile}
                </span>
                <span>{compilation.totalPages} compiled pages</span>
              </div>
            </>
          ) : (
            <div className="flex-1 overflow-y-auto p-3 space-y-4">
              <div>
                <div className="text-xs font-semibold text-slate-900 mb-2">
                  {project.tocConfig.title || 'Table of Contents'}
                </div>
                {compilation.tocEntries.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    Add Heading 1, Heading 2, or Heading 3 elements to auto-populate the outline.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {compilation.tocEntries.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => jumpToCompiledPage(entry.pageIndex)}
                        style={{ paddingLeft: `${(entry.level - 1) * 12 + 8}px` }}
                        className="w-full flex items-center justify-between gap-2 py-1 pr-2 text-left text-xs text-slate-700 hover:bg-slate-100 rounded"
                      >
                        <span className="truncate">{entry.text}</span>
                        <span className="font-mono tabular-nums text-[11px] text-slate-400 shrink-0">
                          {entry.pageLabel}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {compilation.tableEntries.length > 0 && (
                <div className="pt-3 border-t border-slate-200">
                  <div className="text-xs font-semibold text-slate-900 mb-1.5">Tables</div>
                  {compilation.tableEntries.map((tb) => (
                    <button
                      key={tb.id}
                      type="button"
                      onClick={() => jumpToCompiledPage(tb.pageIndex)}
                      className="w-full flex items-center justify-between gap-2 py-1 px-2 text-left text-xs text-slate-600 hover:bg-slate-100 rounded"
                    >
                      <span className="truncate">{tb.label}</span>
                      <span className="font-mono tabular-nums text-[11px] text-slate-400">
                        {tb.pageLabel}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {compilation.figureEntries.length > 0 && (
                <div className="pt-3 border-t border-slate-200">
                  <div className="text-xs font-semibold text-slate-900 mb-1.5">Figures</div>
                  {compilation.figureEntries.map((fg) => (
                    <button
                      key={fg.id}
                      type="button"
                      onClick={() => jumpToCompiledPage(fg.pageIndex)}
                      className="w-full flex items-center justify-between gap-2 py-1 px-2 text-left text-xs text-slate-600 hover:bg-slate-100 rounded"
                    >
                      <span className="truncate">{fg.label}</span>
                      <span className="font-mono tabular-nums text-[11px] text-slate-400">
                        {fg.pageLabel}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </aside>

        <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-slate-100">
          {viewMode === 'edit' ? (
            activeDoc ? (
              activeDoc.sourceType === 'blank' || activeDoc.sourceType === 'section-break' ? (
                <div className="flex-1 flex items-center justify-center p-8">
                  <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-md text-center space-y-3">
                    <div className="text-base font-semibold text-slate-900">{activeDoc.title}</div>
                    <p className="text-xs text-slate-500">
                      {activeDoc.sourceType === 'blank'
                        ? 'Inserts a clean blank page at this position in the compiled document.'
                        : 'Forces a new compilation section break and optionally restarts page numbering.'}
                    </p>
                    <label className="inline-flex items-center gap-2 text-xs text-slate-700 pt-2">
                      <input
                        type="checkbox"
                        checked={activeDoc.sectionRestartNumbering}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          pushUndoSnapshot('Section numbering restart');
                          setDocuments((prev) =>
                            prev.map((d) =>
                              d.id === activeDoc.id ? { ...d, sectionRestartNumbering: checked } : d
                            )
                          );
                          updateProjectDocument(project.id, activeDoc.id, {
                            sectionRestartNumbering: checked,
                          });
                        }}
                      />
                      Restart page numbering at this point
                    </label>
                    {activeDoc.sourceType === 'blank' && (
                      <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-center gap-2">
                        {(() => {
                          const blankPageIdx = compilation.pages.findIndex(
                            (p) => p.docId === activeDoc.id
                          );
                          if (blankPageIdx < 0) return null;
                          return (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  handleAddCompiledPageAt(blankPageIdx, 'after', 'blank')
                                }
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-md"
                              >
                                <Plus className="w-3.5 h-3.5" />
                                {t.insertBlankAfter}
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleAddCompiledPageAt(blankPageIdx, 'after', 'editor')
                                }
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-700 border border-blue-200 hover:bg-blue-50 rounded-md"
                              >
                                <FilePlus className="w-3.5 h-3.5" />
                                {t.insertEditableAfter}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteCompiledPageAt(blankPageIdx)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-600 border border-red-200 hover:bg-red-50 rounded-md"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                {t.deleteThisPage}
                              </button>
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                </div>
              ) : activeDoc.sourceType === 'pdf' &&
                activeDoc.contentHtml.includes('dm-pdf-page-marker') ? (
                <div className="flex-1 flex flex-col min-h-0">
                  <div className="bg-white border-b border-slate-200 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 text-slate-700">
                      <FileText className="w-4 h-4 text-blue-700 shrink-0" />
                      <span className="font-medium">{t.pdfPreservedNotice}</span>
                      <span className="font-mono tabular-nums text-slate-400">
                        ({pdfPagesByDoc[activeDoc.id]?.length || activeDoc.pageCountEstimate}{' '}
                        {t.pageLabel})
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {pdfActionStatus && (
                        <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                          {pdfActionStatus}
                        </span>
                      )}
                      {(() => {
                        const firstPdfPage = compilation.pages.find((p) => p.docId === activeDoc.id);
                        if (!firstPdfPage || !pdfPagesByDoc[activeDoc.id]?.length) return null;
                        return (
                          <button
                            type="button"
                            onClick={() => void openStainCleanerForCompiledPage(firstPdfPage.pageIndex)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded font-medium"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                            <span>{t.cleanStainsBtn}</span>
                          </button>
                        );
                      })()}
                      <button
                        type="button"
                        onClick={async () => {
                          const allImgs = pdfPagesByDoc[activeDoc.id] || [];
                          if (allImgs.length === 0) return;

                          const markerContainer = document.createElement('div');
                          markerContainer.innerHTML = activeDoc.contentHtml || '';
                          const markerNums = Array.from(
                            markerContainer.querySelectorAll('.dm-pdf-page-marker')
                          )
                            .map((el) => Number(el.getAttribute('data-pdf-page')))
                            .filter((n) => Number.isFinite(n) && n >= 1 && n <= allImgs.length);
                          const targetPages =
                            markerNums.length > 0
                              ? markerNums
                              : allImgs.map((_, idx) => idx + 1);

                          setPdfActionStatus(t.ocrProcessing);
                          try {
                            const htmlParts: string[] = [];
                            let notice: string | undefined;
                            for (const pageNum of targetPages) {
                              const imgUrl = allImgs[pageNum - 1];
                              if (!imgUrl) continue;
                              const res = await runOcrOnImageDataUrl(imgUrl);
                              htmlParts.push(res.html);
                              if (res.notice) notice = res.notice;
                            }
                            const nextHtml = htmlParts.join('\n<hr class="page-break-marker" />\n');
                            const tmp = document.createElement('div');
                            tmp.innerHTML = nextHtml;
                            const nextPlain = (tmp.textContent || '').trim();
                            const synthetic: ImportedDocumentResult = {
                              title: activeDoc.title,
                              sourceType: 'pdf',
                              contentHtml: nextHtml,
                              plainText: nextPlain,
                              pageCountEstimate: Math.max(1, targetPages.length),
                              mimeType: 'text/html',
                              fileName: `${activeDoc.title}.html`,
                            };
                            const chunks = splitImportedResultForStorage(synthetic);
                            if (chunks.length <= 1) {
                              handleDocumentContentChange(
                                chunks[0]?.contentHtml || nextHtml,
                                chunks[0]?.plainText || nextPlain,
                                language === 'km' ? 'ស្រង់អក្សរពី PDF (OCR)' : 'OCR Extract PDF',
                                ''
                              );
                            } else {
                              pushUndoSnapshot(
                                language === 'km' ? 'ស្រង់អក្សរពី PDF (OCR)' : 'OCR Extract PDF'
                              );
                              setSaveState('saving');
                              const baseIdx = documents.findIndex((d) => d.id === activeDoc.id);
                              await updateProjectDocument(project.id, activeDoc.id, {
                                title: chunks[0].title,
                                contentHtml: chunks[0].contentHtml,
                                plainText: chunks[0].plainText,
                                pageCountEstimate: chunks[0].pageCountEstimate,
                              });
                              const insertedDocs: ProjectDocument[] = [];
                              for (let cIdx = 1; cIdx < chunks.length; cIdx++) {
                                const ch = chunks[cIdx];
                                const newDocId = generateSafeId('doc');
                                await addProjectDocument(
                                  project.id,
                                  user.uid,
                                  {
                                    title: ch.title,
                                    sourceType: 'pdf',
                                    order: baseIdx + cIdx,
                                    selected: true,
                                    contentHtml: ch.contentHtml,
                                    plainText: ch.plainText,
                                    pageCountEstimate: ch.pageCountEstimate,
                                    sectionRestartNumbering: false,
                                  },
                                  documents.length + cIdx,
                                  newDocId
                                );
                                insertedDocs.push({
                                  id: newDocId,
                                  projectId: project.id,
                                  ownerId: user.uid,
                                  title: ch.title,
                                  sourceType: 'pdf',
                                  order: baseIdx + cIdx,
                                  selected: true,
                                  contentHtml: ch.contentHtml,
                                  plainText: ch.plainText,
                                  pageCountEstimate: ch.pageCountEstimate,
                                  sectionRestartNumbering: false,
                                });
                              }
                              const nextDocs = [...documents];
                              nextDocs[baseIdx] = {
                                ...activeDoc,
                                title: chunks[0].title,
                                contentHtml: chunks[0].contentHtml,
                                plainText: chunks[0].plainText,
                                pageCountEstimate: chunks[0].pageCountEstimate,
                              };
                              nextDocs.splice(baseIdx + 1, 0, ...insertedDocs);
                              const reindexed = nextDocs.map((d, i) => ({ ...d, order: i }));
                              setDocuments(reindexed);
                              await reorderProjectDocuments(project.id, reindexed);
                              await updateProjectFields(project.id, {
                                documentCount: reindexed.length,
                              });
                              setSaveState('saved');
                            }
                            setPdfActionStatus(notice || null);
                          } catch (err) {
                            setPdfActionStatus(err instanceof Error ? err.message : 'OCR failed');
                          }
                        }}
                        className="px-2.5 py-1 border border-slate-300 rounded font-medium text-slate-700 hover:bg-slate-50"
                      >
                        {t.ocrExtract}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const bytes =
                            pdfBytesByDoc[activeDoc.id] || (await getBinaryRecord(activeDoc.id))?.bytes;
                          if (!bytes) return;
                          setPdfActionStatus('Extracting text...');
                          try {
                            const rendered = await renderPdfPagesFromBytes(bytes);
                            const existingImgs = pdfPagesByDoc[activeDoc.id] || rendered.pageDataUrls;

                            const markerContainer = document.createElement('div');
                            markerContainer.innerHTML = activeDoc.contentHtml || '';
                            const markerNums = Array.from(
                              markerContainer.querySelectorAll('.dm-pdf-page-marker')
                            )
                              .map((el) => Number(el.getAttribute('data-pdf-page')))
                              .filter(
                                (n) =>
                                  Number.isFinite(n) &&
                                  n >= 1 &&
                                  n <= rendered.extractedTextPages.length
                              );
                            const targetPages =
                              markerNums.length > 0
                                ? markerNums
                                : rendered.extractedTextPages.map((_, idx) => idx + 1);

                            const scopedTextPages = targetPages.map(
                              (pNum) => rendered.extractedTextPages[pNum - 1] || ''
                            );
                            const scopedImgUrls = targetPages.map(
                              (pNum) =>
                                existingImgs[pNum - 1] || rendered.pageDataUrls[pNum - 1] || ''
                            );

                            const editableHtml = buildEditableHtmlFromPdfTextPages(
                              scopedTextPages,
                              scopedImgUrls
                            );
                            const nextPlain = scopedTextPages.join('\n\n');
                            const synthetic: ImportedDocumentResult = {
                              title: activeDoc.title,
                              sourceType: 'pdf',
                              contentHtml: editableHtml,
                              plainText: nextPlain,
                              pageCountEstimate: Math.max(1, targetPages.length),
                              mimeType: 'text/html',
                              fileName: `${activeDoc.title}.html`,
                            };
                            const chunks = splitImportedResultForStorage(synthetic);
                            if (chunks.length <= 1) {
                              handleDocumentContentChange(
                                chunks[0]?.contentHtml || editableHtml,
                                chunks[0]?.plainText || nextPlain,
                                language === 'km' ? 'បំប្លែង PDF ជាអត្ថបទ' : 'Extract PDF text',
                                ''
                              );
                            } else {
                              pushUndoSnapshot(
                                language === 'km' ? 'បំប្លែង PDF ជាអត្ថបទ' : 'Extract PDF text'
                              );
                              setSaveState('saving');
                              const baseIdx = documents.findIndex((d) => d.id === activeDoc.id);
                              await updateProjectDocument(project.id, activeDoc.id, {
                                title: chunks[0].title,
                                contentHtml: chunks[0].contentHtml,
                                plainText: chunks[0].plainText,
                                pageCountEstimate: chunks[0].pageCountEstimate,
                              });
                              const insertedDocs: ProjectDocument[] = [];
                              for (let cIdx = 1; cIdx < chunks.length; cIdx++) {
                                const ch = chunks[cIdx];
                                const newDocId = generateSafeId('doc');
                                await addProjectDocument(
                                  project.id,
                                  user.uid,
                                  {
                                    title: ch.title,
                                    sourceType: 'pdf',
                                    order: baseIdx + cIdx,
                                    selected: true,
                                    contentHtml: ch.contentHtml,
                                    plainText: ch.plainText,
                                    pageCountEstimate: ch.pageCountEstimate,
                                    sectionRestartNumbering: false,
                                  },
                                  documents.length + cIdx,
                                  newDocId
                                );
                                insertedDocs.push({
                                  id: newDocId,
                                  projectId: project.id,
                                  ownerId: user.uid,
                                  title: ch.title,
                                  sourceType: 'pdf',
                                  order: baseIdx + cIdx,
                                  selected: true,
                                  contentHtml: ch.contentHtml,
                                  plainText: ch.plainText,
                                  pageCountEstimate: ch.pageCountEstimate,
                                  sectionRestartNumbering: false,
                                });
                              }
                              const nextDocs = [...documents];
                              nextDocs[baseIdx] = {
                                ...activeDoc,
                                title: chunks[0].title,
                                contentHtml: chunks[0].contentHtml,
                                plainText: chunks[0].plainText,
                                pageCountEstimate: chunks[0].pageCountEstimate,
                              };
                              nextDocs.splice(baseIdx + 1, 0, ...insertedDocs);
                              const reindexed = nextDocs.map((d, i) => ({ ...d, order: i }));
                              setDocuments(reindexed);
                              await reorderProjectDocuments(project.id, reindexed);
                              await updateProjectFields(project.id, {
                                documentCount: reindexed.length,
                              });
                              setSaveState('saved');
                            }
                            setPdfActionStatus(null);
                          } catch (err) {
                            setPdfActionStatus(
                              err instanceof Error ? err.message : 'Could not extract text'
                            );
                          }
                        }}
                        className="px-2.5 py-1 border border-slate-300 rounded font-medium text-slate-700 hover:bg-slate-50"
                      >
                        {t.editExtractedText}
                      </button>
                      <div className="w-px h-4 bg-slate-200 mx-0.5" />
                      <div className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 p-0.5">
                        <button
                          type="button"
                          onClick={() => handleTogglePreviewColumns(1)}
                          title={t.singlePageView}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                            previewColumns === 1
                              ? 'bg-white text-slate-900 shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          <Square className="w-3 h-3" />
                          <span>{t.singlePageView}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleTogglePreviewColumns(2)}
                          title={t.twoPageView}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                            previewColumns === 2
                              ? 'bg-white text-blue-700 shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          <Columns2 className="w-3 h-3" />
                          <span>{t.twoPageView}</span>
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPreviewAutoFit((v) => !v)}
                        className={`px-2 py-0.5 rounded border text-[11px] font-medium ${
                          previewAutoFit
                            ? 'border-blue-600 bg-blue-50 text-blue-700'
                            : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {t.fitToScreen}
                      </button>
                    </div>
                  </div>
                  <div
                    ref={previewScrollRef}
                    className="flex-1 overflow-auto p-6 lg:p-10 bg-slate-100"
                  >
                    {!activeDoc.selected ? (
                      <div className="bg-white border border-slate-200 rounded-xl p-6 max-w-md text-center space-y-3 mx-auto my-12">
                        <div className="text-sm font-semibold text-slate-900">{activeDoc.title}</div>
                        <p className="text-xs text-slate-500">
                          {language === 'km'
                            ? 'ឯកសារ PDF នេះត្រូវបានដកចេញពីការចងក្រងជាបណ្ដោះអាសន្ន។ សូមបើកការរួមបញ្ចូលដើម្បីដាក់លេខទំព័រ។'
                            : 'This PDF is currently excluded from compilation. Re-include it to preview and apply page numbers.'}
                        </p>
                        <button
                          type="button"
                          onClick={() =>
                            updateProjectDocument(project.id, activeDoc.id, { selected: true })
                          }
                          className="px-3 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-md hover:bg-slate-800"
                        >
                          {t.compileSelectedOnly}
                        </button>
                      </div>
                    ) : (
                      <div
                        className={
                          previewColumns === 2
                            ? 'grid grid-cols-2 gap-6 items-start w-fit mx-auto'
                            : 'flex flex-col items-center gap-6'
                        }
                      >
                        {(() => {
                          const docPagesList = compilation.pages.filter(
                            (p) => p.docId === activeDoc.id
                          );
                          return docPagesList.map((pg, localIdx) => (
                            <InteractivePageNumberCard
                              key={`pdf_edit_${pg.pageIndex}`}
                              project={project}
                              page={pg}
                              pdfPageImageUrl={
                                pg.pdfDocId && pg.pdfPageNumber
                                  ? pdfPagesByDoc[pg.pdfDocId]?.[pg.pdfPageNumber - 1]
                                  : undefined
                              }
                              pdfFallbackText={
                                pg.pdfDocId && missingPdfBinaryIds[pg.pdfDocId]
                                  ? activeDoc.plainText
                                  : undefined
                              }
                              scale={effectivePreviewScale}
                              compact={previewColumns === 2}
                              language={language}
                              t={t}
                              isSelectedForEdit={selectedNumberPageIdx === pg.pageIndex}
                              onSelectPage={(idx) => setSelectedNumberPageIdx(idx)}
                              onUpdatePageOverride={(idx, patch) =>
                                handleUpdatePageNumberOverride(idx, patch, true)
                              }
                              onResetPageOverride={handleResetPageNumberOverride}
                              onDragOffsetPreview={(idx, x, y) =>
                                handleUpdatePageNumberOverride(idx, { offsetXPx: x, offsetYPx: y }, false)
                              }
                              onDragOffsetCommit={(idx, x, y) =>
                                handleUpdatePageNumberOverride(idx, { offsetXPx: x, offsetYPx: y }, true)
                              }
                              onAddPage={(idx, placement, kind) =>
                                handleAddCompiledPageAt(idx, placement, kind)
                              }
                              onDeletePage={(idx) => handleDeleteCompiledPageAt(idx)}
                              onPageDragStart={(idx) => setDragCompiledPageIdx(idx)}
                              onPageDragOver={(idx) => {
                                if (dragCompiledPageIdx !== null && dragCompiledPageIdx !== idx) {
                                  setDropTargetCompiledPageIdx(idx);
                                }
                              }}
                              onPageDragLeave={(idx) => {
                                if (dropTargetCompiledPageIdx === idx) {
                                  setDropTargetCompiledPageIdx(null);
                                }
                              }}
                              onPageDrop={(targetIdx) => {
                                const fromIdx = dragCompiledPageIdx;
                                setDragCompiledPageIdx(null);
                                setDropTargetCompiledPageIdx(null);
                                if (fromIdx !== null && fromIdx !== targetIdx) {
                                  void handleReorderCompiledPage(fromIdx, targetIdx);
                                }
                              }}
                              onPageDragEnd={() => {
                                setDragCompiledPageIdx(null);
                                setDropTargetCompiledPageIdx(null);
                              }}
                              onStepMovePage={(idx, dir) => {
                                void handleStepMoveCompiledPage(idx, dir);
                              }}
                              canMoveEarlier={localIdx > 0}
                              canMoveLater={localIdx < docPagesList.length - 1}
                              isDraggingThisPage={dragCompiledPageIdx === pg.pageIndex}
                              isDropTargetPage={
                                dropTargetCompiledPageIdx === pg.pageIndex &&
                                dragCompiledPageIdx !== pg.pageIndex
                              }
                              canCleanStains={getPageCleanInfo(pg).canClean}
                              isPageCleaned={getPageCleanInfo(pg).isCleaned}
                              onOpenStainCleaner={(idx) =>
                                void openStainCleanerForCompiledPage(idx)
                              }
                            />
                          ));
                        })()}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col min-h-0">
                  {activeDoc.contentHtml.includes('data:image/') && (
                    <div className="bg-white border-b border-slate-200 px-4 py-2 flex items-center justify-between gap-2 text-xs shrink-0">
                      <span className="text-slate-600 truncate">
                        {language === 'km'
                          ? 'រកឃើញរូបភាពក្នុងឯកសារ — អាចសម្អាតស្នាមប្រឡាក់ ឬផ្ទៃក្រដាសខ្មៅបាន'
                          : 'Document contains scanned image — you can clean stains & brighten paper'}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const targetPg = compilation.pages.find(
                            (p) => p.docId === activeDoc.id && p.html.includes('data:image/')
                          );
                          if (targetPg) {
                            void openStainCleanerForCompiledPage(targetPg.pageIndex);
                          }
                        }}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 font-medium shrink-0"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>{t.cleanStainsBtn}</span>
                      </button>
                    </div>
                  )}
                  <RichTextEditor
                    project={project}
                    documentItem={activeDoc}
                    language={language}
                    externalSyncKey={editorSyncKey}
                    compiledPageLabel={activeDocCompiledPageLabel}
                    onChangeContent={handleDocumentContentChange}
                  />
                </div>
              )
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm text-slate-500">
                Select or import a document to begin editing.
              </div>
            )
          ) : (
            <div className="flex-1 flex min-h-0 overflow-hidden">
              <div className="w-44 bg-white border-r border-slate-200 overflow-y-auto p-3 space-y-3 shrink-0">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[11px] font-semibold text-slate-600 tabular-nums">
                    {t.pageLabel} ({compilation.totalPages})
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      handleAddCompiledPageAt(
                        Math.max(0, compilation.pages.length - 1),
                        'after',
                        'blank'
                      )
                    }
                    title={t.addPageAtEnd}
                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded border border-blue-200"
                  >
                    <Plus className="w-3 h-3" />
                    {t.addPageAtEnd}
                  </button>
                </div>
                {compilation.pages.map((pg, idx) => {
                  const canEarlier =
                    !pg.isTocPage &&
                    compilation.pages.slice(0, idx).some((p) => !p.isTocPage);
                  const canLater =
                    !pg.isTocPage &&
                    compilation.pages.slice(idx + 1).some((p) => !p.isTocPage);
                  const isDraggingThumb = dragCompiledPageIdx === pg.pageIndex;
                  const isDropTargetThumb =
                    dropTargetCompiledPageIdx === pg.pageIndex &&
                    dragCompiledPageIdx !== pg.pageIndex;

                  return (
                    <div
                      key={`thumb_${pg.pageIndex}`}
                      draggable={!pg.isTocPage}
                      title={!pg.isTocPage ? t.dragPageHint : undefined}
                      onDragStart={(e) => {
                        if (pg.isTocPage) {
                          e.preventDefault();
                          return;
                        }
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', String(pg.pageIndex));
                        setDragCompiledPageIdx(pg.pageIndex);
                      }}
                      onDragOver={(e) => {
                        if (dragCompiledPageIdx === null || pg.isTocPage) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        if (dropTargetCompiledPageIdx !== pg.pageIndex) {
                          setDropTargetCompiledPageIdx(pg.pageIndex);
                        }
                      }}
                      onDragLeave={() => {
                        if (dropTargetCompiledPageIdx === pg.pageIndex) {
                          setDropTargetCompiledPageIdx(null);
                        }
                      }}
                      onDrop={(e) => {
                        if (pg.isTocPage) return;
                        e.preventDefault();
                        const fromIdx = dragCompiledPageIdx;
                        setDragCompiledPageIdx(null);
                        setDropTargetCompiledPageIdx(null);
                        if (fromIdx !== null && fromIdx !== pg.pageIndex) {
                          void handleReorderCompiledPage(fromIdx, pg.pageIndex);
                        }
                      }}
                      onDragEnd={() => {
                        setDragCompiledPageIdx(null);
                        setDropTargetCompiledPageIdx(null);
                      }}
                      className={`group relative flex flex-col items-center gap-1 p-1.5 rounded-lg border transition-all ${
                        isDraggingThumb
                          ? 'opacity-45 scale-[0.98] border-blue-400 bg-blue-50/40'
                          : isDropTargetThumb
                          ? 'border-blue-600 ring-2 ring-blue-500/40 bg-blue-50/70'
                          : 'border-slate-200 hover:border-blue-600 bg-slate-50'
                      }`}
                    >
                      {!pg.isTocPage && (
                        <div className="w-full flex items-center justify-between text-slate-400 px-0.5">
                          <span className="inline-flex items-center gap-0.5 cursor-grab active:cursor-grabbing text-[10px]">
                            <GripVertical className="w-3 h-3" />
                          </span>
                          <div className="inline-flex items-center gap-0.5 opacity-80 group-hover:opacity-100">
                            <button
                              type="button"
                              disabled={!canEarlier}
                              onClick={() => void handleStepMoveCompiledPage(pg.pageIndex, -1)}
                              title={t.movePageEarlier}
                              className="p-0.5 rounded hover:bg-white hover:text-blue-700 disabled:opacity-30"
                            >
                              <ArrowUp className="w-2.5 h-2.5" />
                            </button>
                            <button
                              type="button"
                              disabled={!canLater}
                              onClick={() => void handleStepMoveCompiledPage(pg.pageIndex, 1)}
                              title={t.movePageLater}
                              className="p-0.5 rounded hover:bg-white hover:text-blue-700 disabled:opacity-30"
                            >
                              <ArrowDown className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          previewSheetRefs.current[idx]?.scrollIntoView({
                            behavior: 'smooth',
                            block: 'start',
                          })
                        }
                        className="w-full flex flex-col items-center gap-1"
                      >
                        <div className="pointer-events-none overflow-hidden rounded border border-slate-200 bg-white">
                          <CompiledPageSheet
                            project={project}
                            page={pg}
                            pdfPageImageUrl={
                              pg.pdfDocId && pg.pdfPageNumber
                                ? pdfPagesByDoc[pg.pdfDocId]?.[pg.pdfPageNumber - 1]
                                : undefined
                            }
                            pdfFallbackText={
                              pg.pdfDocId && missingPdfBinaryIds[pg.pdfDocId]
                                ? documents.find((d) => d.id === pg.pdfDocId)?.plainText
                                : undefined
                            }
                            scale={0.14}
                          />
                        </div>
                        <span
                          className="text-[10px] tabular-nums text-slate-600"
                          style={{ fontFamily: project.numberingConfig.fontFamily }}
                        >
                          {pg.pageNumberFormatted ||
                            (language === 'km'
                              ? `ទំព័រ ${formatNumberValue(idx + 1, 'km')}`
                              : `Page ${idx + 1}`)}
                        </span>
                      </button>

                      <div className="w-full flex items-center justify-between pt-1 border-t border-slate-200/70">
                        <button
                          type="button"
                          onClick={() => handleAddCompiledPageAt(pg.pageIndex, 'after', 'blank')}
                          title={t.insertBlankAfter}
                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] text-slate-600 hover:bg-white hover:text-blue-700"
                        >
                          <Plus className="w-3 h-3" />
                          <span>{t.pageLabel}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteCompiledPageAt(pg.pageIndex)}
                          title={t.deleteThisPage}
                          className="p-0.5 rounded text-slate-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div
                ref={previewScrollRef}
                className="flex-1 overflow-auto p-6 lg:p-8 flex flex-col items-center gap-6"
              >
                <div className="sticky top-0 z-20 bg-white/95 border border-slate-200 rounded-lg px-3.5 py-1.5 flex flex-wrap items-center gap-2.5 text-xs shadow-sm">
                  <span className="font-medium text-slate-700 font-mono tabular-nums">
                    {compilation.totalPages} {t.pageLabel}s
                  </span>
                  <div className="w-px h-4 bg-slate-200" />
                  <div className="inline-flex items-center rounded-md border border-slate-200 bg-slate-100 p-0.5">
                    <button
                      type="button"
                      onClick={() => handleTogglePreviewColumns(1)}
                      title={t.singlePageView}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                        previewColumns === 1
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Square className="w-3 h-3" />
                      <span>{t.singlePageView}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTogglePreviewColumns(2)}
                      title={t.twoPageView}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                        previewColumns === 2
                          ? 'bg-white text-blue-700 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Columns2 className="w-3 h-3" />
                      <span>{t.twoPageView}</span>
                    </button>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-slate-500">Zoom:</span>
                    <button
                      type="button"
                      onClick={() => setPreviewAutoFit(true)}
                      className={`px-2 py-0.5 rounded font-medium ${
                        previewAutoFit
                          ? 'bg-blue-700 text-white'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {t.fitToScreen}
                    </button>
                    {[0.5, 0.65, 0.8, 1].map((z) => (
                      <button
                        key={z}
                        type="button"
                        onClick={() => {
                          setPreviewAutoFit(false);
                          setPreviewZoom(z);
                        }}
                        className={`px-2 py-0.5 rounded font-mono ${
                          !previewAutoFit && previewZoom === z
                            ? 'bg-slate-900 text-white'
                            : 'text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        {Math.round(z * 100)}%
                      </button>
                    ))}
                  </div>
                  <div className="w-px h-4 bg-slate-200" />
                  <button
                    type="button"
                    onClick={() => setPreviewFocusCanvas((v) => !v)}
                    title={previewFocusCanvas ? t.showPanels : t.expandCanvas}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border font-medium ${
                      previewFocusCanvas
                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                        : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {previewFocusCanvas ? (
                      <Minimize2 className="w-3 h-3" />
                    ) : (
                      <Maximize2 className="w-3 h-3" />
                    )}
                    <span>{previewFocusCanvas ? t.showPanels : t.expandCanvas}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleAddCompiledPageAt(
                        Math.max(0, compilation.pages.length - 1),
                        'after',
                        'blank'
                      )
                    }
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-slate-200 text-slate-700 hover:bg-slate-50 font-medium"
                  >
                    <Plus className="w-3 h-3" />
                    {t.addBlankPage}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleAddCompiledPageAt(
                        Math.max(0, compilation.pages.length - 1),
                        'after',
                        'editor'
                      )
                    }
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 font-medium"
                  >
                    <FilePlus className="w-3 h-3" />
                    {t.addNewSection}
                  </button>
                </div>

                <div
                  className={
                    previewColumns === 2
                      ? 'grid grid-cols-2 gap-6 items-start w-fit mx-auto'
                      : 'flex flex-col items-center gap-8'
                  }
                >
                  {compilation.pages.map((pg, idx) => {
                    const canEarlier =
                      !pg.isTocPage &&
                      compilation.pages.slice(0, idx).some((p) => !p.isTocPage);
                    const canLater =
                      !pg.isTocPage &&
                      compilation.pages.slice(idx + 1).some((p) => !p.isTocPage);

                    return (
                      <InteractivePageNumberCard
                        key={`preview_${pg.pageIndex}`}
                        project={project}
                        page={pg}
                        pdfPageImageUrl={
                          pg.pdfDocId && pg.pdfPageNumber
                            ? pdfPagesByDoc[pg.pdfDocId]?.[pg.pdfPageNumber - 1]
                            : undefined
                        }
                        pdfFallbackText={
                          pg.pdfDocId && missingPdfBinaryIds[pg.pdfDocId]
                            ? documents.find((d) => d.id === pg.pdfDocId)?.plainText
                            : undefined
                        }
                        scale={effectivePreviewScale}
                        compact={previewColumns === 2}
                        language={language}
                        t={t}
                        isSelectedForEdit={selectedNumberPageIdx === pg.pageIndex}
                        onSelectPage={(pIdx) => setSelectedNumberPageIdx(pIdx)}
                        onUpdatePageOverride={(pIdx, patch) =>
                          handleUpdatePageNumberOverride(pIdx, patch, true)
                        }
                        onResetPageOverride={handleResetPageNumberOverride}
                        onDragOffsetPreview={(pIdx, x, y) =>
                          handleUpdatePageNumberOverride(pIdx, { offsetXPx: x, offsetYPx: y }, false)
                        }
                        onDragOffsetCommit={(pIdx, x, y) =>
                          handleUpdatePageNumberOverride(pIdx, { offsetXPx: x, offsetYPx: y }, true)
                        }
                        onAddPage={(pIdx, placement, kind) =>
                          handleAddCompiledPageAt(pIdx, placement, kind)
                        }
                        onDeletePage={(pIdx) => handleDeleteCompiledPageAt(pIdx)}
                        onPageDragStart={(pIdx) => setDragCompiledPageIdx(pIdx)}
                        onPageDragOver={(pIdx) => {
                          if (dragCompiledPageIdx !== null && dragCompiledPageIdx !== pIdx) {
                            setDropTargetCompiledPageIdx(pIdx);
                          }
                        }}
                        onPageDragLeave={(pIdx) => {
                          if (dropTargetCompiledPageIdx === pIdx) {
                            setDropTargetCompiledPageIdx(null);
                          }
                        }}
                        onPageDrop={(targetIdx) => {
                          const fromIdx = dragCompiledPageIdx;
                          setDragCompiledPageIdx(null);
                          setDropTargetCompiledPageIdx(null);
                          if (fromIdx !== null && fromIdx !== targetIdx) {
                            void handleReorderCompiledPage(fromIdx, targetIdx);
                          }
                        }}
                        onPageDragEnd={() => {
                          setDragCompiledPageIdx(null);
                          setDropTargetCompiledPageIdx(null);
                        }}
                        onStepMovePage={(pIdx, dir) => {
                          void handleStepMoveCompiledPage(pIdx, dir);
                        }}
                        canMoveEarlier={canEarlier}
                        canMoveLater={canLater}
                        isDraggingThisPage={dragCompiledPageIdx === pg.pageIndex}
                        isDropTargetPage={
                          dropTargetCompiledPageIdx === pg.pageIndex &&
                          dragCompiledPageIdx !== pg.pageIndex
                        }
                        canCleanStains={getPageCleanInfo(pg).canClean}
                        isPageCleaned={getPageCleanInfo(pg).isCleaned}
                        onOpenStainCleaner={(pIdx) =>
                          void openStainCleanerForCompiledPage(pIdx)
                        }
                        sheetRef={(el) => {
                          previewSheetRefs.current[idx] = el;
                        }}
                        onNavigateToPage={jumpToCompiledPage}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </main>

        <aside
          className={`w-80 bg-white border-l border-slate-200 flex flex-col shrink-0 ${
            viewMode === 'preview' && previewFocusCanvas ? 'hidden' : ''
          }`}
        >
          <div className="border-b border-slate-200 grid grid-cols-5 bg-slate-50">
            {(
              [
                ['page', t.tabPageSetup],
                ['numbering', t.tabNumbering],
                ['header', t.tabHeaderFooter],
                ['toc', t.tabTocWatermark],
                ['review', t.tabReviewHistory],
              ] as Array<[RightTab, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setRightTab(key)}
                className={`py-2.5 px-1 text-[11px] font-medium border-b-2 transition-colors truncate ${
                  rightTab === key
                    ? 'border-blue-700 text-blue-800 bg-white'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-5 text-xs">
            {rightTab === 'page' && (
              <>
                <div>
                  <label className="block font-semibold text-slate-800 mb-1.5">{t.paperSize}</label>
                  <select
                    value={project.pageSetup.paperSize}
                    onChange={(e) =>
                      scheduleProjectUpdate({
                        pageSetup: { ...project.pageSetup, paperSize: e.target.value as PaperSize },
                      })
                    }
                    className="w-full border border-slate-300 rounded-md px-2.5 py-1.5 bg-white text-slate-900"
                  >
                    <option value="A4">A4 (210 × 297 mm)</option>
                    <option value="A3">A3 (297 × 420 mm)</option>
                    <option value="A5">A5 (148 × 210 mm)</option>
                    <option value="Letter">Letter (215.9 × 279.4 mm)</option>
                    <option value="Legal">Legal (215.9 × 355.6 mm)</option>
                    <option value="Custom">Custom Dimensions</option>
                  </select>
                </div>

                {project.pageSetup.paperSize === 'Custom' && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-slate-600 mb-1">Width (mm)</label>
                      <input
                        type="number"
                        value={project.pageSetup.customWidthMm}
                        onChange={(e) =>
                          scheduleProjectUpdate({
                            pageSetup: {
                              ...project.pageSetup,
                              customWidthMm: Number(e.target.value) || 210,
                            },
                          })
                        }
                        className="w-full border border-slate-300 rounded px-2 py-1 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-600 mb-1">Height (mm)</label>
                      <input
                        type="number"
                        value={project.pageSetup.customHeightMm}
                        onChange={(e) =>
                          scheduleProjectUpdate({
                            pageSetup: {
                              ...project.pageSetup,
                              customHeightMm: Number(e.target.value) || 297,
                            },
                          })
                        }
                        className="w-full border border-slate-300 rounded px-2 py-1 font-mono"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block font-semibold text-slate-800 mb-1.5">{t.orientation}</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['portrait', 'landscape'] as const).map((orient) => (
                      <button
                        key={orient}
                        type="button"
                        onClick={() =>
                          scheduleProjectUpdate({
                            pageSetup: { ...project.pageSetup, orientation: orient },
                          })
                        }
                        className={`py-1.5 rounded-md border font-medium ${
                          project.pageSetup.orientation === orient
                            ? 'border-blue-700 bg-blue-50 text-blue-800'
                            : 'border-slate-200 text-slate-700'
                        }`}
                      >
                        {orient === 'portrait' ? t.portrait : t.landscape}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-slate-800 mb-1.5">{t.marginsMm}</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        ['marginTopMm', t.marginTop],
                        ['marginBottomMm', t.marginBottom],
                        ['marginLeftMm', t.marginLeft],
                        ['marginRightMm', t.marginRight],
                      ] as const
                    ).map(([field, label]) => (
                      <div key={field}>
                        <span className="text-[11px] text-slate-500">{label}</span>
                        <input
                          type="number"
                          step="1"
                          min="5"
                          max="60"
                          value={project.pageSetup[field]}
                          onChange={(e) =>
                            scheduleProjectUpdate({
                              pageSetup: {
                                ...project.pageSetup,
                                [field]: Number(e.target.value) || 20,
                              },
                            })
                          }
                          className="w-full border border-slate-300 rounded px-2 py-1 font-mono tabular-nums"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-200 space-y-3">
                  <div>
                    <label className="block font-semibold text-slate-800 mb-1">{t.defaultFont}</label>
                    <select
                      value={project.pageSetup.defaultFontFamily}
                      onChange={(e) =>
                        scheduleProjectUpdate({
                          pageSetup: { ...project.pageSetup, defaultFontFamily: e.target.value },
                        })
                      }
                      className="w-full border border-slate-300 rounded-md px-2.5 py-1.5 bg-white text-slate-900"
                    >
                      {FONT_OPTIONS.map((f) => (
                        <option key={f.label} value={f.value}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-slate-600 mb-1">{t.fontSize}</label>
                      <input
                        type="number"
                        min="8"
                        max="24"
                        value={project.pageSetup.defaultFontSizePt}
                        onChange={(e) =>
                          scheduleProjectUpdate({
                            pageSetup: {
                              ...project.pageSetup,
                              defaultFontSizePt: Number(e.target.value) || 11,
                            },
                          })
                        }
                        className="w-full border border-slate-300 rounded px-2 py-1 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-600 mb-1">{t.lineSpacing}</label>
                      <input
                        type="number"
                        step="0.1"
                        min="1"
                        max="2.5"
                        value={project.pageSetup.lineHeight}
                        onChange={(e) =>
                          scheduleProjectUpdate({
                            pageSetup: {
                              ...project.pageSetup,
                              lineHeight: Number(e.target.value) || 1.5,
                            },
                          })
                        }
                        className="w-full border border-slate-300 rounded px-2 py-1 font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-slate-600 mb-1">{t.paragraphSpacing}</label>
                      <input
                        type="number"
                        min="0"
                        max="32"
                        value={project.pageSetup.paragraphSpacingPt}
                        onChange={(e) =>
                          scheduleProjectUpdate({
                            pageSetup: {
                              ...project.pageSetup,
                              paragraphSpacingPt: Number(e.target.value) || 0,
                            },
                          })
                        }
                        className="w-full border border-slate-300 rounded px-2 py-1 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-600 mb-1">{t.firstLineIndent}</label>
                      <input
                        type="number"
                        min="0"
                        max="30"
                        value={project.pageSetup.firstLineIndentMm}
                        onChange={(e) =>
                          scheduleProjectUpdate({
                            pageSetup: {
                              ...project.pageSetup,
                              firstLineIndentMm: Number(e.target.value) || 0,
                            },
                          })
                        }
                        className="w-full border border-slate-300 rounded px-2 py-1 font-mono"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-200 space-y-2.5">
                  <label className="flex items-center justify-between">
                    <span className="font-semibold text-slate-800">{t.pageBorder}</span>
                    <input
                      type="checkbox"
                      checked={project.pageSetup.pageBorder}
                      onChange={(e) =>
                        scheduleProjectUpdate({
                          pageSetup: { ...project.pageSetup, pageBorder: e.target.checked },
                        })
                      }
                    />
                  </label>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">{t.pageBackground}</span>
                    <input
                      type="color"
                      value={project.pageSetup.backgroundColor}
                      onChange={(e) =>
                        scheduleProjectUpdate({
                          pageSetup: { ...project.pageSetup, backgroundColor: e.target.value },
                        })
                      }
                      className="w-8 h-6 border border-slate-300 rounded cursor-pointer"
                    />
                  </div>
                </div>
              </>
            )}

            {rightTab === 'numbering' && (
              <>
                <label className="flex items-center justify-between font-semibold text-slate-900">
                  <span>{t.enableNumbering}</span>
                  <input
                    type="checkbox"
                    checked={project.numberingConfig.enabled}
                    onChange={(e) =>
                      scheduleProjectUpdate({
                        numberingConfig: { ...project.numberingConfig, enabled: e.target.checked },
                      })
                    }
                  />
                </label>

                <div className="space-y-2">
                  <label className="flex items-center justify-between text-slate-700">
                    <span>{t.excludeCoverPage}</span>
                    <input
                      type="checkbox"
                      checked={project.numberingConfig.excludeCoverPage}
                      onChange={(e) =>
                        scheduleProjectUpdate({
                          numberingConfig: {
                            ...project.numberingConfig,
                            excludeCoverPage: e.target.checked,
                          },
                        })
                      }
                    />
                  </label>
                  <label className="flex items-center justify-between text-slate-700">
                    <span>{t.restartPerSection}</span>
                    <input
                      type="checkbox"
                      checked={project.numberingConfig.restartPerSection}
                      onChange={(e) =>
                        scheduleProjectUpdate({
                          numberingConfig: {
                            ...project.numberingConfig,
                            restartPerSection: e.target.checked,
                          },
                        })
                      }
                    />
                  </label>
                  <label className="flex items-center justify-between text-slate-700">
                    <span>{t.maskNumberBackground}</span>
                    <input
                      type="checkbox"
                      checked={project.numberingConfig.maskBackground !== false}
                      onChange={(e) =>
                        scheduleProjectUpdate({
                          numberingConfig: {
                            ...project.numberingConfig,
                            maskBackground: e.target.checked,
                          },
                        })
                      }
                    />
                  </label>
                </div>

                <div>
                  <label className="block font-semibold text-slate-800 mb-1">{t.startPageNum}</label>
                  <input
                    type="number"
                    min="1"
                    max="9999"
                    value={project.numberingConfig.startPage}
                    onChange={(e) =>
                      scheduleProjectUpdate({
                        numberingConfig: {
                          ...project.numberingConfig,
                          startPage: Math.max(1, Number(e.target.value) || 1),
                        },
                      })
                    }
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5 font-mono"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-800 mb-1.5">{t.numberingPosition}</label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        ['top-left', language === 'km' ? 'លើ-ឆ្វេង' : 'Top L'],
                        ['top-center', language === 'km' ? 'លើ-កណ្ដាល' : 'Top C'],
                        ['top-right', language === 'km' ? 'លើ-ស្ដាំ' : 'Top R'],
                        ['bottom-left', language === 'km' ? 'ក្រោម-ឆ្វេង' : 'Bot L'],
                        ['bottom-center', language === 'km' ? 'ក្រោម-កណ្ដាល' : 'Bot C'],
                        ['bottom-right', language === 'km' ? 'ក្រោម-ស្ដាំ' : 'Bot R'],
                      ] as Array<[NumberingPosition, string]>
                    ).map(([pos, label]) => (
                      <button
                        key={pos}
                        type="button"
                        onClick={() =>
                          scheduleProjectUpdate({
                            numberingConfig: { ...project.numberingConfig, position: pos },
                          })
                        }
                        className={`py-1.5 px-1 rounded border text-[11px] font-medium ${
                          project.numberingConfig.position === pos
                            ? 'border-blue-700 bg-blue-50 text-blue-800'
                            : 'border-slate-200 text-slate-700'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-slate-800 mb-1">{t.numberingFormat}</label>
                  <select
                    value={project.numberingConfig.format}
                    onChange={(e) =>
                      scheduleProjectUpdate({
                        numberingConfig: {
                          ...project.numberingConfig,
                          format: e.target.value as NumberingFormat,
                        },
                      })
                    }
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5 bg-white"
                  >
                    <option value="km">១, ២, ៣, ៤... (លេខខ្មែរ / Khmer Numerals)</option>
                    <option value="km-alpha">ក, ខ, គ, ឃ... (អក្សរខ្មែរ / Khmer Alphabet)</option>
                    <option value="1">1, 2, 3, 4...</option>
                    <option value="i">i, ii, iii, iv...</option>
                    <option value="I">I, II, III, IV...</option>
                    <option value="A">A, B, C, D...</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-800 mb-1">{t.numberingPattern}</label>
                  <select
                    value={project.numberingConfig.displayPattern}
                    onChange={(e) =>
                      scheduleProjectUpdate({
                        numberingConfig: {
                          ...project.numberingConfig,
                          displayPattern: e.target.value as 'number' | 'page-x-of-y',
                        },
                      })
                    }
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5 bg-white"
                  >
                    <option value="number">{t.patternNumberOnly}</option>
                    <option value="page-x-of-y">{t.patternPageXOfY}</option>
                  </select>
                </div>

                <div className="space-y-2 pt-2 border-t border-slate-200">
                  <div>
                    <label className="block font-semibold text-slate-800 mb-1">
                      {t.prefixTextLabel}
                    </label>
                    <input
                      type="text"
                      value={project.numberingConfig.prefixText || ''}
                      placeholder={t.prefixPlaceholder}
                      onChange={(e) =>
                        scheduleProjectUpdate({
                          numberingConfig: {
                            ...project.numberingConfig,
                            prefixText: e.target.value,
                          },
                        })
                      }
                      className="w-full border border-slate-300 rounded px-2.5 py-1.5 bg-white text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-800 mb-1">
                      {t.suffixTextLabel}
                    </label>
                    <input
                      type="text"
                      value={project.numberingConfig.suffixText || ''}
                      placeholder={t.suffixPlaceholder}
                      onChange={(e) =>
                        scheduleProjectUpdate({
                          numberingConfig: {
                            ...project.numberingConfig,
                            suffixText: e.target.value,
                          },
                        })
                      }
                      className="w-full border border-slate-300 rounded px-2.5 py-1.5 bg-white text-slate-900"
                    />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        scheduleProjectUpdate({
                          numberingConfig: {
                            ...project.numberingConfig,
                            displayPattern: 'number',
                            prefixText: 'ទំព័រទី ',
                          },
                        })
                      }
                      className="px-2 py-0.5 border border-slate-200 rounded bg-slate-50 hover:bg-slate-100 text-[11px] text-slate-700"
                    >
                      + ទំព័រទី ...
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        scheduleProjectUpdate({
                          numberingConfig: {
                            ...project.numberingConfig,
                            suffixText: ' — {org}',
                          },
                        })
                      }
                      className="px-2 py-0.5 border border-slate-200 rounded bg-slate-50 hover:bg-slate-100 text-[11px] text-slate-700"
                    >
                      + — {'{org}'}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        scheduleProjectUpdate({
                          numberingConfig: {
                            ...project.numberingConfig,
                            prefixText: '',
                            suffixText: '',
                          },
                        })
                      }
                      className="px-2 py-0.5 border border-slate-200 rounded bg-white hover:bg-slate-50 text-[11px] text-slate-500"
                    >
                      Clear
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400">
                    Tokens: {'{title}'}, {'{org}'}, {'{total}'}
                  </p>
                </div>

                <div>
                  <label className="block font-semibold text-slate-800 mb-1">{t.numberingFont}</label>
                  <select
                    value={project.numberingConfig.fontFamily}
                    onChange={(e) =>
                      scheduleProjectUpdate({
                        numberingConfig: {
                          ...project.numberingConfig,
                          fontFamily: e.target.value,
                        },
                      })
                    }
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5 bg-white text-slate-900"
                  >
                    {FONT_OPTIONS.map((f) => (
                      <option key={f.label} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200">
                  <div>
                    <label className="block text-slate-600 mb-1">{t.fontSize}</label>
                    <input
                      type="number"
                      min="8"
                      max="18"
                      value={project.numberingConfig.fontSizePt}
                      onChange={(e) =>
                        scheduleProjectUpdate({
                          numberingConfig: {
                            ...project.numberingConfig,
                            fontSizePt: Number(e.target.value) || 10,
                          },
                        })
                      }
                      className="w-full border border-slate-300 rounded px-2 py-1 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 mb-1">Color</label>
                    <input
                      type="color"
                      value={project.numberingConfig.color}
                      onChange={(e) =>
                        scheduleProjectUpdate({
                          numberingConfig: { ...project.numberingConfig, color: e.target.value },
                        })
                      }
                      className="w-full h-7 border border-slate-300 rounded cursor-pointer"
                    />
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-center">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1">
                    {language === 'km' ? 'គំរូលេខទំព័រ' : 'Live Sample'}
                  </div>
                  <div
                    className="tabular-nums break-words"
                    style={{
                      fontFamily: project.numberingConfig.fontFamily,
                      fontSize: `${project.numberingConfig.fontSizePt}pt`,
                      color: project.numberingConfig.color,
                    }}
                  >
                    {project.numberingConfig.enabled
                      ? (() => {
                          const startVal = formatNumberValue(
                            project.numberingConfig.startPage || 1,
                            project.numberingConfig.format
                          );
                          const totalVal = formatNumberValue(
                            Math.max(project.numberingConfig.startPage || 1, compilation.totalPages || 10),
                            project.numberingConfig.format
                          );
                          const core =
                            project.numberingConfig.displayPattern === 'page-x-of-y'
                              ? language === 'km' ||
                                project.numberingConfig.format === 'km' ||
                                project.numberingConfig.format === 'km-alpha'
                                ? `ទំព័រ ${startVal} នៃ ${totalVal}`
                                : `Page ${startVal} of ${totalVal}`
                              : startVal;
                          const pre = (project.numberingConfig.prefixText || '')
                            .replace(/\{title\}/gi, project.title)
                            .replace(/\{org\}/gi, project.headerFooterConfig.organizationName || project.title)
                            .replace(/\{total\}/gi, totalVal);
                          const suf = (project.numberingConfig.suffixText || '')
                            .replace(/\{title\}/gi, project.title)
                            .replace(/\{org\}/gi, project.headerFooterConfig.organizationName || project.title)
                            .replace(/\{total\}/gi, totalVal);
                          return `${pre}${core}${suf}`;
                        })()
                      : language === 'km'
                      ? 'បានបិទលេខទំព័រ'
                      : 'Numbering Disabled'}
                  </div>
                </div>

                {compilation.pages.length > 0 && (() => {
                  const safeIdx = Math.min(selectedNumberPageIdx, compilation.pages.length - 1);
                  const targetPage = compilation.pages[safeIdx];
                  const targetOv = project.numberingConfig.pageOverrides?.[String(safeIdx)];
                  const targetPos = targetPage.numberPosition || project.numberingConfig.position;
                  const targetX = targetPage.numberOffsetXPx || 0;
                  const targetY = targetPage.numberOffsetYPx || 0;
                  const overrideCount = Object.keys(project.numberingConfig.pageOverrides || {}).length;

                  return (
                    <div className="pt-3 border-t border-slate-200 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-800">
                          {t.perPagePositionTitle}
                        </span>
                        {overrideCount > 0 && (
                          <button
                            type="button"
                            onClick={handleResetAllPageNumberOverrides}
                            className="text-[11px] text-blue-700 hover:underline"
                          >
                            {t.resetAllPagePositions}
                          </button>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500">{t.dragToMoveHint}</p>

                      <select
                        value={safeIdx}
                        onChange={(e) => setSelectedNumberPageIdx(Number(e.target.value) || 0)}
                        className="w-full border border-slate-300 rounded px-2.5 py-1.5 bg-white text-slate-900"
                      >
                        {compilation.pages.map((pg, idx) => (
                          <option key={`sel_pg_${pg.pageIndex}`} value={idx}>
                            {language === 'km'
                              ? `ទំព័រ ${formatNumberValue(idx + 1, 'km')} — ${pg.docTitle}`
                              : `Page ${idx + 1} — ${pg.docTitle}`}
                            {pg.numberHasOverride ? ' ★' : ''}
                          </option>
                        ))}
                      </select>

                      <div className="grid grid-cols-3 gap-1">
                        {(
                          [
                            ['top-left', language === 'km' ? 'លើ-ឆ្វេង' : 'Top L'],
                            ['top-center', language === 'km' ? 'លើ-កណ្ដាល' : 'Top C'],
                            ['top-right', language === 'km' ? 'លើ-ស្ដាំ' : 'Top R'],
                            ['bottom-left', language === 'km' ? 'ក្រោម-ឆ្វេង' : 'Bot L'],
                            ['bottom-center', language === 'km' ? 'ក្រោម-កណ្ដាល' : 'Bot C'],
                            ['bottom-right', language === 'km' ? 'ក្រោម-ស្ដាំ' : 'Bot R'],
                          ] as Array<[NumberingPosition, string]>
                        ).map(([pos, label]) => (
                          <button
                            key={`pg_pos_${pos}`}
                            type="button"
                            onClick={() =>
                              handleUpdatePageNumberOverride(safeIdx, { position: pos })
                            }
                            className={`py-1 px-1 rounded border text-[10px] font-medium ${
                              targetPos === pos
                                ? 'border-blue-700 bg-blue-50 text-blue-800'
                                : 'border-slate-200 text-slate-700'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] text-slate-500 mb-0.5">X (px)</label>
                          <input
                            type="number"
                            step="2"
                            value={targetX}
                            onChange={(e) =>
                              handleUpdatePageNumberOverride(safeIdx, {
                                offsetXPx: Number(e.target.value) || 0,
                              })
                            }
                            className="w-full border border-slate-300 rounded px-2 py-1 font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-500 mb-0.5">Y (px)</label>
                          <input
                            type="number"
                            step="2"
                            value={targetY}
                            onChange={(e) =>
                              handleUpdatePageNumberOverride(safeIdx, {
                                offsetYPx: Number(e.target.value) || 0,
                              })
                            }
                            className="w-full border border-slate-300 rounded px-2 py-1 font-mono"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          placeholder={t.prefixTextLabel}
                          value={targetOv?.prefixText ?? ''}
                          onChange={(e) =>
                            handleUpdatePageNumberOverride(safeIdx, {
                              prefixText: e.target.value === '' ? undefined : e.target.value,
                            })
                          }
                          className="border border-slate-300 rounded px-2 py-1 text-[11px]"
                        />
                        <input
                          type="text"
                          placeholder={t.suffixTextLabel}
                          value={targetOv?.suffixText ?? ''}
                          onChange={(e) =>
                            handleUpdatePageNumberOverride(safeIdx, {
                              suffixText: e.target.value === '' ? undefined : e.target.value,
                            })
                          }
                          className="border border-slate-300 rounded px-2 py-1 text-[11px]"
                        />
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <label className="inline-flex items-center gap-1.5 text-slate-700">
                          <input
                            type="checkbox"
                            checked={Boolean(targetPage.numberHidden)}
                            onChange={(e) =>
                              handleUpdatePageNumberOverride(safeIdx, {
                                hidden: e.target.checked,
                              })
                            }
                          />
                          <span>{t.hideOnThisPage}</span>
                        </label>

                        {targetPage.numberHasOverride && (
                          <button
                            type="button"
                            onClick={() => handleResetPageNumberOverride(safeIdx)}
                            className="px-2 py-1 border border-slate-200 rounded text-[11px] text-slate-700 hover:bg-slate-50"
                          >
                            {t.resetPagePosition}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </>
            )}

            {rightTab === 'header' && (
              <>
                <div>
                  <label className="block font-semibold text-slate-800 mb-1">{t.organizationName}</label>
                  <input
                    type="text"
                    value={project.headerFooterConfig.organizationName}
                    onChange={(e) =>
                      scheduleProjectUpdate({
                        headerFooterConfig: {
                          ...project.headerFooterConfig,
                          organizationName: e.target.value,
                        },
                      })
                    }
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      scheduleProjectUpdate({
                        headerFooterConfig: {
                          ...project.headerFooterConfig,
                          logoUrl: project.headerFooterConfig.logoUrl ? '' : '/images/org_seal_emblem.jpg',
                        },
                      })
                    }
                    className="mt-2 w-full py-1.5 border border-slate-300 rounded text-slate-700 hover:bg-slate-50 font-medium"
                  >
                    {project.headerFooterConfig.logoUrl ? 'Remove Institutional Seal' : t.insertOrgSeal}
                  </button>
                </div>

                <div className="pt-2 border-t border-slate-200 space-y-2">
                  <label className="flex items-center justify-between font-semibold text-slate-800">
                    <span>{t.enableHeader}</span>
                    <input
                      type="checkbox"
                      checked={project.headerFooterConfig.headerEnabled}
                      onChange={(e) =>
                        scheduleProjectUpdate({
                          headerFooterConfig: {
                            ...project.headerFooterConfig,
                            headerEnabled: e.target.checked,
                          },
                        })
                      }
                    />
                  </label>
                  <p className="text-[11px] text-slate-500">
                    Tokens: {'{title}'}, {'{org}'}, {'{page}'}, {'{total}'}
                  </p>
                  <input
                    type="text"
                    placeholder="Header Left"
                    value={project.headerFooterConfig.headerLeft}
                    onChange={(e) =>
                      scheduleProjectUpdate({
                        headerFooterConfig: { ...project.headerFooterConfig, headerLeft: e.target.value },
                      })
                    }
                    className="w-full border border-slate-300 rounded px-2 py-1"
                  />
                  <input
                    type="text"
                    placeholder="Header Center"
                    value={project.headerFooterConfig.headerCenter}
                    onChange={(e) =>
                      scheduleProjectUpdate({
                        headerFooterConfig: { ...project.headerFooterConfig, headerCenter: e.target.value },
                      })
                    }
                    className="w-full border border-slate-300 rounded px-2 py-1"
                  />
                  <input
                    type="text"
                    placeholder="Header Right"
                    value={project.headerFooterConfig.headerRight}
                    onChange={(e) =>
                      scheduleProjectUpdate({
                        headerFooterConfig: { ...project.headerFooterConfig, headerRight: e.target.value },
                      })
                    }
                    className="w-full border border-slate-300 rounded px-2 py-1"
                  />
                </div>

                <div className="pt-2 border-t border-slate-200 space-y-2">
                  <label className="flex items-center justify-between font-semibold text-slate-800">
                    <span>{t.enableFooter}</span>
                    <input
                      type="checkbox"
                      checked={project.headerFooterConfig.footerEnabled}
                      onChange={(e) =>
                        scheduleProjectUpdate({
                          headerFooterConfig: {
                            ...project.headerFooterConfig,
                            footerEnabled: e.target.checked,
                          },
                        })
                      }
                    />
                  </label>
                  <input
                    type="text"
                    placeholder="Footer Left"
                    value={project.headerFooterConfig.footerLeft}
                    onChange={(e) =>
                      scheduleProjectUpdate({
                        headerFooterConfig: { ...project.headerFooterConfig, footerLeft: e.target.value },
                      })
                    }
                    className="w-full border border-slate-300 rounded px-2 py-1"
                  />
                  <input
                    type="text"
                    placeholder="Footer Center"
                    value={project.headerFooterConfig.footerCenter}
                    onChange={(e) =>
                      scheduleProjectUpdate({
                        headerFooterConfig: { ...project.headerFooterConfig, footerCenter: e.target.value },
                      })
                    }
                    className="w-full border border-slate-300 rounded px-2 py-1"
                  />
                  <input
                    type="text"
                    placeholder="Footer Right"
                    value={project.headerFooterConfig.footerRight}
                    onChange={(e) =>
                      scheduleProjectUpdate({
                        headerFooterConfig: { ...project.headerFooterConfig, footerRight: e.target.value },
                      })
                    }
                    className="w-full border border-slate-300 rounded px-2 py-1"
                  />
                </div>

                <div className="pt-2 border-t border-slate-200 space-y-2">
                  <label className="flex items-center justify-between text-slate-700">
                    <span>{t.differentFirstPage}</span>
                    <input
                      type="checkbox"
                      checked={project.headerFooterConfig.differentFirstPage}
                      onChange={(e) =>
                        scheduleProjectUpdate({
                          headerFooterConfig: {
                            ...project.headerFooterConfig,
                            differentFirstPage: e.target.checked,
                          },
                        })
                      }
                    />
                  </label>
                  <label className="flex items-center justify-between text-slate-700">
                    <span>{t.differentOddEven}</span>
                    <input
                      type="checkbox"
                      checked={project.headerFooterConfig.differentOddEven}
                      onChange={(e) =>
                        scheduleProjectUpdate({
                          headerFooterConfig: {
                            ...project.headerFooterConfig,
                            differentOddEven: e.target.checked,
                          },
                        })
                      }
                    />
                  </label>
                </div>

                {activeDoc && (
                  <div className="pt-2 border-t border-slate-200 space-y-2">
                    <div className="font-semibold text-slate-800">{t.sectionOverrides}</div>
                    <input
                      type="text"
                      placeholder="Section Header Override"
                      value={activeDoc.sectionHeaderOverride || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        pushUndoSnapshot('Section header override', `secHdr:${activeDoc.id}`);
                        setDocuments((prev) =>
                          prev.map((d) =>
                            d.id === activeDoc.id ? { ...d, sectionHeaderOverride: val } : d
                          )
                        );
                        updateProjectDocument(project.id, activeDoc.id, {
                          sectionHeaderOverride: val,
                        });
                      }}
                      className="w-full border border-slate-300 rounded px-2 py-1"
                    />
                    <input
                      type="text"
                      placeholder="Section Footer Override"
                      value={activeDoc.sectionFooterOverride || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        pushUndoSnapshot('Section footer override', `secFtr:${activeDoc.id}`);
                        setDocuments((prev) =>
                          prev.map((d) =>
                            d.id === activeDoc.id ? { ...d, sectionFooterOverride: val } : d
                          )
                        );
                        updateProjectDocument(project.id, activeDoc.id, {
                          sectionFooterOverride: val,
                        });
                      }}
                      className="w-full border border-slate-300 rounded px-2 py-1"
                    />
                  </div>
                )}
              </>
            )}

            {rightTab === 'toc' && (
              <>
                <label className="flex items-center justify-between font-semibold text-slate-900">
                  <span>{t.enableToc}</span>
                  <input
                    type="checkbox"
                    checked={project.tocConfig.enabled}
                    onChange={(e) =>
                      scheduleProjectUpdate({
                        tocConfig: { ...project.tocConfig, enabled: e.target.checked },
                      })
                    }
                  />
                </label>

                <div>
                  <label className="block text-slate-700 mb-1">{t.tocTitle}</label>
                  <input
                    type="text"
                    value={project.tocConfig.title}
                    onChange={(e) =>
                      scheduleProjectUpdate({
                        tocConfig: { ...project.tocConfig, title: e.target.value },
                      })
                    }
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 mb-1">{t.tocStyle}</label>
                  <select
                    value={project.tocConfig.style}
                    onChange={(e) =>
                      scheduleProjectUpdate({
                        tocConfig: {
                          ...project.tocConfig,
                          style: e.target.value as 'classic' | 'modern' | 'academic',
                        },
                      })
                    }
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5 bg-white"
                  >
                    <option value="classic">Classic Dotted Leader</option>
                    <option value="modern">Modern Hairline</option>
                    <option value="academic">Academic Formal</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <div className="font-semibold text-slate-800">{t.includeHeadings}</div>
                  {(
                    [
                      ['includeH1', 'Heading 1 (H1)'],
                      ['includeH2', 'Heading 2 (H2)'],
                      ['includeH3', 'Heading 3 (H3)'],
                      ['includeTables', t.includeTablesList],
                      ['includeFigures', t.includeFiguresList],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="flex items-center justify-between text-slate-700">
                      <span>{label}</span>
                      <input
                        type="checkbox"
                        checked={project.tocConfig[key]}
                        onChange={(e) =>
                          scheduleProjectUpdate({
                            tocConfig: { ...project.tocConfig, [key]: e.target.checked },
                          })
                        }
                      />
                    </label>
                  ))}
                </div>

                <div className="pt-3 border-t border-slate-200 space-y-2.5">
                  <label className="flex items-center justify-between font-semibold text-slate-900">
                    <span>{t.enableWatermark}</span>
                    <input
                      type="checkbox"
                      checked={project.watermarkConfig.enabled}
                      onChange={(e) =>
                        scheduleProjectUpdate({
                          watermarkConfig: { ...project.watermarkConfig, enabled: e.target.checked },
                        })
                      }
                    />
                  </label>
                  <div>
                    <label className="block text-slate-600 mb-1">{t.watermarkText}</label>
                    <input
                      type="text"
                      value={project.watermarkConfig.text}
                      onChange={(e) =>
                        scheduleProjectUpdate({
                          watermarkConfig: { ...project.watermarkConfig, text: e.target.value },
                        })
                      }
                      className="w-full border border-slate-300 rounded px-2 py-1"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-slate-600 mb-1">{t.watermarkOpacity}</label>
                      <input
                        type="number"
                        step="0.02"
                        min="0.04"
                        max="0.5"
                        value={project.watermarkConfig.opacity}
                        onChange={(e) =>
                          scheduleProjectUpdate({
                            watermarkConfig: {
                              ...project.watermarkConfig,
                              opacity: Number(e.target.value) || 0.12,
                            },
                          })
                        }
                        className="w-full border border-slate-300 rounded px-2 py-1 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-600 mb-1">{t.watermarkAngle}</label>
                      <input
                        type="number"
                        min="-90"
                        max="90"
                        value={project.watermarkConfig.angle}
                        onChange={(e) =>
                          scheduleProjectUpdate({
                            watermarkConfig: {
                              ...project.watermarkConfig,
                              angle: Number(e.target.value) || -35,
                            },
                          })
                        }
                        className="w-full border border-slate-300 rounded px-2 py-1 font-mono"
                      />
                    </div>
                  </div>
                </div>
              </>
            )}

            {rightTab === 'review' && (
              <>
                {activeDoc && (
                  <>
                    <div className="space-y-2">
                      <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                        <MessageSquarePlus className="w-3.5 h-3.5" />
                        {t.commentsTitle}
                      </div>
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          value={commentDraft}
                          onChange={(e) => setCommentDraft(e.target.value)}
                          placeholder="Add review note..."
                          className="flex-1 border border-slate-300 rounded px-2 py-1"
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            if (!commentDraft.trim()) return;
                            pushUndoSnapshot('Add comment');
                            const nextComments = [
                              ...(activeDoc.comments || []),
                              {
                                id: generateSafeId('cmt'),
                                author: user.displayName || user.email || 'Reviewer',
                                text: commentDraft.trim(),
                                createdAt: new Date().toLocaleDateString(),
                                resolved: false,
                              },
                            ];
                            setCommentDraft('');
                            setDocuments((prev) =>
                              prev.map((d) =>
                                d.id === activeDoc.id ? { ...d, comments: nextComments } : d
                              )
                            );
                            await updateProjectDocument(project.id, activeDoc.id, {
                              comments: nextComments,
                            });
                          }}
                          className="px-2.5 py-1 bg-slate-900 text-white rounded font-medium"
                        >
                          Add
                        </button>
                      </div>
                      <div className="space-y-1.5">
                        {(activeDoc.comments || []).map((c) => (
                          <div
                            key={c.id}
                            className="p-2 border border-slate-200 rounded bg-slate-50 flex items-start justify-between gap-2"
                          >
                            <div className={c.resolved ? 'line-through text-slate-400' : ''}>
                              <div className="font-semibold text-[11px]">{c.author}</div>
                              <div className="text-slate-700">{c.text}</div>
                            </div>
                            <button
                              type="button"
                              onClick={async () => {
                                pushUndoSnapshot('Toggle comment status');
                                const next = (activeDoc.comments || []).map((item) =>
                                  item.id === c.id ? { ...item, resolved: !item.resolved } : item
                                );
                                await updateProjectDocument(project.id, activeDoc.id, {
                                  comments: next,
                                });
                              }}
                              className="p-1 text-slate-500 hover:text-emerald-700"
                              title="Resolve"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-200 space-y-2">
                      <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                        <Bookmark className="w-3.5 h-3.5" />
                        {t.bookmarksTitle}
                      </div>
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          value={bookmarkDraft}
                          onChange={(e) => setBookmarkDraft(e.target.value)}
                          placeholder="Bookmark label..."
                          className="flex-1 border border-slate-300 rounded px-2 py-1"
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            if (!bookmarkDraft.trim()) return;
                            pushUndoSnapshot('Add bookmark');
                            const next = [
                              ...(activeDoc.bookmarks || []),
                              {
                                id: generateSafeId('bm'),
                                label: bookmarkDraft.trim(),
                                createdAt: new Date().toLocaleDateString(),
                              },
                            ];
                            setBookmarkDraft('');
                            await updateProjectDocument(project.id, activeDoc.id, {
                              bookmarks: next,
                            });
                          }}
                          className="px-2.5 py-1 bg-slate-900 text-white rounded font-medium"
                        >
                          Add
                        </button>
                      </div>
                      {(activeDoc.bookmarks || []).map((bm) => (
                        <div
                          key={bm.id}
                          className="flex items-center justify-between px-2 py-1 bg-slate-50 border border-slate-200 rounded"
                        >
                          <span>{bm.label}</span>
                          <button
                            type="button"
                            onClick={async () => {
                              pushUndoSnapshot('Remove bookmark');
                              const next = (activeDoc.bookmarks || []).filter((b) => b.id !== bm.id);
                              await updateProjectDocument(project.id, activeDoc.id, {
                                bookmarks: next,
                              });
                            }}
                            className="text-slate-400 hover:text-red-600"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="pt-3 border-t border-slate-200 space-y-1.5">
                      <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        {t.digitalSignature}
                      </div>
                      <input
                        type="text"
                        placeholder="e.g. Approved by Dean · 2026"
                        value={activeDoc.signatureText || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          pushUndoSnapshot(
                            language === 'km' ? 'ហត្ថលេខាឌីជីថល' : 'Digital signature',
                            `sig:${activeDoc.id}`
                          );
                          setDocuments((prev) =>
                            prev.map((d) =>
                              d.id === activeDoc.id ? { ...d, signatureText: val } : d
                            )
                          );
                          updateProjectDocument(project.id, activeDoc.id, {
                            signatureText: val,
                          });
                        }}
                        className="w-full border border-slate-300 rounded px-2 py-1"
                      />
                    </div>
                  </>
                )}

                <div className="pt-3 border-t border-slate-200 space-y-2">
                  <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5" />
                    {t.versionHistory}
                  </div>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={versionLabel}
                      onChange={(e) => setVersionLabel(e.target.value)}
                      placeholder="Snapshot label..."
                      className="flex-1 border border-slate-300 rounded px-2 py-1"
                    />
                    <button
                      type="button"
                      onClick={handleSaveVersion}
                      className="px-2.5 py-1 bg-slate-900 text-white rounded font-medium"
                    >
                      Save
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    {versions.map((ver) => (
                      <div
                        key={ver.id}
                        className="p-2 border border-slate-200 rounded flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-800 truncate">{ver.label}</div>
                          <div className="text-[10px] text-slate-500 font-mono">
                            {ver.snapshotSummary}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            restoreProjectVersion(project.id, user.uid, ver, documents)
                          }
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium border border-slate-300 rounded hover:bg-slate-50 shrink-0"
                        >
                          <RotateCcw className="w-3 h-3" />
                          {t.restoreVersion}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </aside>
      </div>

      <div
        aria-hidden="true"
        className="print-only-container fixed -left-[99999px] top-0 pointer-events-none"
      >
        {compilation.pages.map((pg, idx) => (
          <CompiledPageSheet
            key={`export_${pg.pageIndex}`}
            project={project}
            page={pg}
            pdfPageImageUrl={
              pg.pdfDocId && pg.pdfPageNumber
                ? pdfPagesByDoc[pg.pdfDocId]?.[pg.pdfPageNumber - 1]
                : undefined
            }
            scale={1}
            sheetRef={(el) => {
              exportSheetRefs.current[idx] = el;
            }}
          />
        ))}
      </div>
      <StainCleanerModal
        isOpen={Boolean(stainCleanerTarget)}
        title={stainCleanerTarget?.title || ''}
        sourceImageUrl={stainCleanerTarget?.imageSrc || ''}
        hasOriginalBackup={Boolean(stainCleanerTarget?.hasOriginalBackup)}
        totalDocPages={stainCleanerTarget?.totalDocPages || 1}
        outputMaxBytes={stainCleanerTarget?.isPdf ? undefined : 360000}
        language={language}
        onClose={() => setStainCleanerTarget(null)}
        onApplySingle={handleApplyStainCleanSingle}
        onApplyAllPages={
          stainCleanerTarget?.isPdf ? handleApplyStainCleanAllPdfPages : undefined
        }
        onResetOriginal={handleResetStainCleanPage}
      />
    </div>
  );
}
