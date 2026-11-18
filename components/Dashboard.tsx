import React, { useRef, useState } from 'react';
import {
  Archive,
  BookTemplate,
  Copy,
  FileText,
  FolderOpen,
  Globe,
  LogOut,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { User } from 'firebase/auth';
import {
  Language,
  Project,
  ProjectTemplate,
  createDefaultHeaderFooterConfig,
  createDefaultNumberingConfig,
  createDefaultPageSetup,
  createDefaultTocConfig,
  createDefaultWatermarkConfig,
} from '@/types/document';
import { getTranslations } from '@/lib/i18n';
import { PROJECT_TEMPLATES } from '@/lib/templates';
import {
  createProjectWithDocuments,
  deleteProjectRecursive,
  duplicateProject,
  updateProjectFields,
} from '@/lib/firestore-service';
import {
  ImportedDocumentResult,
  persistImportedBinaryIfPresent,
  processImportedFile,
  splitImportedResultForStorage,
} from '@/lib/document-processor';

interface DashboardProps {
  user: User;
  projects: Project[];
  loading: boolean;
  language: Language;
  onChangeLanguage: (lang: Language) => void;
  onOpenProject: (projectId: string) => void;
  onSignOut: () => void;
}

type NavSection = 'recent' | 'documents' | 'templates';

export function Dashboard({
  user,
  projects,
  loading,
  language,
  onChangeLanguage,
  onOpenProject,
  onSignOut,
}: DashboardProps) {
  const t = getTranslations(language);
  const [navSection, setNavSection] = useState<NavSection>('recent');
  const [folderFilter, setFolderFilter] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewModal, setShowNewModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newFolder, setNewFolder] = useState('Academic');
  const [newDescription, setNewDescription] = useState('');
  const [creating, setCreating] = useState(false);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const folders = ['All', 'Academic', 'Legal', 'Government', 'General'];

  const filteredProjects = projects.filter((p) => {
    if (navSection === 'recent' && p.status === 'archived') return false;
    if (folderFilter !== 'All' && p.folder !== folderFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        p.title.toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q) ||
        p.folder.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleCreateBlankProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const { projectId } = await createProjectWithDocuments(
        {
          ownerId: user.uid,
          title: newTitle.trim(),
          description: newDescription.trim(),
          folder: newFolder,
          status: 'draft',
          pageSetup: createDefaultPageSetup(),
          numberingConfig: {
            ...createDefaultNumberingConfig(),
            format: language === 'km' ? 'km' : '1',
          },
          headerFooterConfig: createDefaultHeaderFooterConfig(),
          tocConfig: createDefaultTocConfig(),
          watermarkConfig: createDefaultWatermarkConfig(),
          documentCount: 1,
        },
        [
          {
            title: language === 'km' ? 'ផ្នែកទី ១' : 'Section 1',
            sourceType: 'editor',
            order: 0,
            selected: true,
            contentHtml: `<h1>${newTitle.trim()}</h1><p></p>`,
            plainText: newTitle.trim(),
            pageCountEstimate: 1,
            sectionRestartNumbering: false,
          },
        ]
      );
      setShowNewModal(false);
      setNewTitle('');
      setNewDescription('');
      onOpenProject(projectId);
    } finally {
      setCreating(false);
    }
  };

  const handleUseTemplate = async (tpl: ProjectTemplate) => {
    setCreating(true);
    try {
      const { projectId } = await createProjectWithDocuments(
        {
          ownerId: user.uid,
          title: language === 'km' ? tpl.titleKm : tpl.titleEn,
          description: language === 'km' ? tpl.descriptionKm : tpl.descriptionEn,
          folder: tpl.folder,
          status: 'draft',
          pageSetup: tpl.pageSetup,
          numberingConfig: tpl.numberingConfig,
          headerFooterConfig: tpl.headerFooterConfig,
          tocConfig: tpl.tocConfig,
          watermarkConfig: tpl.watermarkConfig,
          documentCount: tpl.documents.length,
        },
        tpl.documents.map((d, idx) => ({
          title: d.title,
          sourceType: d.sourceType,
          order: idx,
          selected: true,
          contentHtml: d.contentHtml,
          plainText: d.contentHtml.replace(/<[^>]+>/g, ' ').trim(),
          pageCountEstimate: 1,
          sectionRestartNumbering: d.sectionRestartNumbering,
          signatureText: d.signatureText,
        }))
      );
      onOpenProject(projectId);
    } finally {
      setCreating(false);
    }
  };

  const handleFilesImport = async (files: FileList | File[]) => {
    const fileList = Array.from(files);
    if (fileList.length === 0) return;
    setImporting(true);
    setImportError(null);
    try {
      const fileGroups: Array<{
        baseTitle: string;
        fileName: string;
        parts: ImportedDocumentResult[];
      }> = [];

      for (const file of fileList) {
        const raw = await processImportedFile(file);
        fileGroups.push({
          baseTitle: raw.title,
          fileName: raw.fileName,
          parts: splitImportedResultForStorage(raw),
        });
      }

      const flatEntries = fileGroups.flatMap((group, groupIdx) =>
        group.parts.map((part, partIdx) => ({ groupIdx, partIdx, part }))
      );

      const projectTitle =
        fileGroups.length === 1
          ? fileGroups[0].baseTitle
          : `Compiled Bundle (${fileGroups.length} files)`;

      const { projectId, docIds } = await createProjectWithDocuments(
        {
          ownerId: user.uid,
          title: projectTitle,
          description: `Imported ${fileGroups.map((g) => g.fileName).join(', ')}`.slice(0, 900),
          folder: 'General',
          status: 'draft',
          pageSetup: createDefaultPageSetup(),
          numberingConfig: {
            ...createDefaultNumberingConfig(),
            format: language === 'km' ? 'km' : '1',
          },
          headerFooterConfig: createDefaultHeaderFooterConfig(),
          tocConfig: createDefaultTocConfig(),
          watermarkConfig: createDefaultWatermarkConfig(),
          documentCount: flatEntries.length,
        },
        flatEntries.map((entry, idx) => ({
          title: entry.part.title,
          sourceType: entry.part.sourceType,
          order: idx,
          selected: true,
          contentHtml: entry.part.contentHtml,
          plainText: entry.part.plainText,
          pageCountEstimate: entry.part.pageCountEstimate,
          sectionRestartNumbering: false,
        }))
      );

      const groupFirstDocId: Record<number, string> = {};
      for (let i = 0; i < flatEntries.length; i++) {
        const entry = flatEntries[i];
        const currentDocId = docIds[i];
        if (!currentDocId) continue;
        if (entry.partIdx === 0) {
          groupFirstDocId[entry.groupIdx] = currentDocId;
        }
        await persistImportedBinaryIfPresent(
          currentDocId,
          entry.part,
          entry.partIdx > 0 ? groupFirstDocId[entry.groupIdx] : undefined
        );
      }

      onOpenProject(projectId);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to import files');
    } finally {
      setImporting(false);
    }
  };

  const formatDate = (ts: unknown): string => {
    if (!ts) return 'Just now';
    if (typeof ts === 'object' && ts !== null && 'toDate' in ts) {
      return (ts as { toDate: () => Date }).toDate().toLocaleDateString();
    }
    return 'Recently';
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col justify-between shrink-0">
        <div>
          <div className="px-6 py-5 border-b border-slate-200">
            <div className="text-lg font-bold tracking-tight text-slate-900">{t.appName}</div>
            <div className="text-xs text-slate-500 mt-0.5 truncate">{t.khmerLanguageBanner}</div>
          </div>

          <nav className="p-3 space-y-1">
            <button
              type="button"
              onClick={() => setNavSection('recent')}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                navSection === 'recent' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <FolderOpen className="w-4 h-4 shrink-0" />
              {t.recentProjects}
            </button>
            <button
              type="button"
              onClick={() => setNavSection('documents')}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                navSection === 'documents' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <FileText className="w-4 h-4 shrink-0" />
              {t.myDocuments}
            </button>
            <button
              type="button"
              onClick={() => setNavSection('templates')}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                navSection === 'templates' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <BookTemplate className="w-4 h-4 shrink-0" />
              {t.templates}
            </button>
          </nav>

          <div className="px-4 pt-4 pb-2">
            <div className="text-xs font-semibold text-slate-400 mb-2 px-2">
              {t.projectFolderLabel}
            </div>
            <div className="space-y-0.5">
              {folders.map((folder) => {
                const label =
                  folder === 'All'
                    ? t.allFolders
                    : folder === 'Academic'
                    ? t.folderAcademic
                    : folder === 'Legal'
                    ? t.folderLegal
                    : folder === 'Government'
                    ? t.folderGovernment
                    : t.folderGeneral;
                return (
                  <button
                    key={folder}
                    type="button"
                    onClick={() => {
                      setFolderFilter(folder);
                      if (navSection === 'templates') setNavSection('recent');
                    }}
                    className={`w-full text-left px-3 py-1.5 text-xs font-medium rounded-md transition-colors truncate ${
                      folderFilter === folder
                        ? 'bg-blue-50 text-blue-800'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-slate-200 space-y-3">
          <button
            type="button"
            onClick={() => onChangeLanguage(language === 'en' ? 'km' : 'en')}
            className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <span className="inline-flex items-center gap-2">
              <Globe className="w-3.5 h-3.5" />
              {language === 'en' ? 'Language: English' : 'ភាសា៖ ខ្មែរ'}
            </span>
            <span className="text-blue-700 font-semibold">
              {language === 'en' ? 'ខ្មែរ' : 'EN'}
            </span>
          </button>

          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-900 truncate">
                {user.displayName || user.email}
              </div>
              <div className="text-[11px] text-slate-500 truncate">{user.email}</div>
            </div>
            <button
              type="button"
              onClick={onSignOut}
              title={t.signOut}
              className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors shrink-0"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-slate-200 px-6 lg:px-8 py-4 flex items-center justify-between gap-6">
          <div className="flex items-center gap-3 flex-1 max-w-md">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t.searchPlaceholder}
                className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:bg-white focus:border-blue-600"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Upload className="w-4 h-4" />
              {t.importDocuments}
            </button>
            <button
              type="button"
              onClick={() => setShowNewModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              {t.createNewProject}
            </button>
          </div>
        </header>

        <main className="flex-1 p-6 lg:p-8 max-w-6xl w-full mx-auto space-y-8">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              if (e.dataTransfer.files.length > 0) {
                handleFilesImport(e.dataTransfer.files);
              }
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
              isDragging
                ? 'border-blue-600 bg-blue-50/70'
                : 'border-slate-300 bg-white hover:border-slate-400'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".docx,.docm,.dotx,.dotm,.doc,.dot,.wps,.pdf,.rtf,.odt,.ott,.ods,.ots,.odp,.otp,.xlsx,.xlsm,.xltx,.xls,.pptx,.pptm,.ppt,.ppsx,.epub,.csv,.tsv,.txt,.md,.xml,.html,.htm,.xhtml,.mht,.mhtml,.json,.log,.jpg,.jpeg,.png,.webp,.gif,.bmp,.svg,.avif"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) handleFilesImport(e.target.files);
                e.target.value = '';
              }}
            />
            <div className="flex flex-col items-center gap-2">
              <Upload className="w-6 h-6 text-blue-700" />
              <div className="text-sm font-semibold text-slate-900">
                {importing ? 'Processing & compiling imported files...' : t.dropFilesPrompt}
              </div>
              <div className="text-xs text-slate-500">
                {t.dropFilesSub} · <span className="font-mono">{t.supportedFormats}</span>
              </div>
            </div>
          </div>

          {importError && (
            <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
              {importError}
            </div>
          )}

          {navSection === 'templates' ? (
            <section>
              <h2 className="text-lg font-semibold text-slate-900 mb-4">{t.templates}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {PROJECT_TEMPLATES.map((tpl) => (
                  <div
                    key={tpl.id}
                    className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between gap-4"
                  >
                    <div>
                      <div className="text-xs text-slate-500 mb-1.5">
                        {tpl.category} · {tpl.pageSetup.paperSize} · {tpl.documents.length} {t.documentsCount}
                      </div>
                      <h3 className="text-base font-semibold text-slate-900 mb-2">
                        {language === 'km' ? tpl.titleKm : tpl.titleEn}
                      </h3>
                      <p className="text-sm text-slate-600 leading-relaxed">
                        {language === 'km' ? tpl.descriptionKm : tpl.descriptionEn}
                      </p>
                    </div>
                    <div className="pt-3 border-t border-slate-100 flex justify-end">
                      <button
                        type="button"
                        disabled={creating}
                        onClick={() => handleUseTemplate(tpl)}
                        className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap"
                      >
                        {t.useTemplate}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : (
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-slate-900">
                  {navSection === 'recent' ? t.recentProjects : t.myDocuments}
                </h2>
                <span className="text-xs text-slate-500 font-mono tabular-nums">
                  {filteredProjects.length} projects
                </span>
              </div>

              {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {[1, 2, 3].map((n) => (
                    <div key={n} className="h-44 bg-white border border-slate-200 rounded-xl p-5 animate-pulse" />
                  ))}
                </div>
              ) : filteredProjects.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
                  <h3 className="text-base font-semibold text-slate-900 mb-1">{t.noProjectsTitle}</h3>
                  <p className="text-sm text-slate-500 mb-5 max-w-md mx-auto">{t.noProjectsDesc}</p>
                  <button
                    type="button"
                    onClick={() => setNavSection('templates')}
                    className="px-4 py-2 text-sm font-medium text-slate-900 border border-slate-300 rounded-lg hover:bg-slate-50"
                  >
                    {t.templates}
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {filteredProjects.map((project) => (
                    <div
                      key={project.id}
                      className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-4 hover:border-slate-300 transition-colors"
                    >
                      <div>
                        <div className="text-xs text-slate-500 mb-1.5 flex items-center gap-1.5 font-mono tabular-nums">
                          <span>{project.folder}</span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {project.documentCount} {t.documentsCount}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{project.pageSetup.paperSize}</span>
                        </div>

                        {renamingId === project.id ? (
                          <div className="flex items-center gap-2 mt-1">
                            <input
                              type="text"
                              value={renameText}
                              onChange={(e) => setRenameText(e.target.value)}
                              className="flex-1 text-sm border border-blue-600 rounded px-2 py-1 text-slate-900 focus:outline-none"
                              autoFocus
                            />
                            <button
                              type="button"
                              onClick={async () => {
                                if (renameText.trim()) {
                                  await updateProjectFields(project.id, { title: renameText.trim() });
                                }
                                setRenamingId(null);
                              }}
                              className="px-2.5 py-1 text-xs font-medium bg-slate-900 text-white rounded"
                            >
                              Save
                            </button>
                          </div>
                        ) : (
                          <h3
                            onClick={() => onOpenProject(project.id)}
                            className="text-base font-semibold text-slate-900 hover:text-blue-700 cursor-pointer line-clamp-2"
                          >
                            {project.title}
                          </h3>
                        )}

                        {project.description && (
                          <p className="text-xs text-slate-500 mt-1.5 line-clamp-2">
                            {project.description}
                          </p>
                        )}
                      </div>

                      <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                        <span className="text-[11px] text-slate-400 font-mono tabular-nums">
                          {t.lastModified} {formatDate(project.updatedAt)}
                        </span>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setRenamingId(project.id);
                              setRenameText(project.title);
                            }}
                            title={t.renameBtn}
                            className="p-1.5 text-slate-500 hover:text-slate-900 rounded hover:bg-slate-100"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => duplicateProject(project)}
                            title={t.duplicateBtn}
                            className="p-1.5 text-slate-500 hover:text-slate-900 rounded hover:bg-slate-100"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updateProjectFields(project.id, {
                                status: project.status === 'archived' ? 'draft' : 'archived',
                              })
                            }
                            title={project.status === 'archived' ? t.restoreBtn : t.archiveBtn}
                            className="p-1.5 text-slate-500 hover:text-slate-900 rounded hover:bg-slate-100"
                          >
                            {project.status === 'archived' ? (
                              <RotateCcw className="w-3.5 h-3.5" />
                            ) : (
                              <Archive className="w-3.5 h-3.5" />
                            )}
                          </button>
                          {deletingId === project.id ? (
                            <button
                              type="button"
                              onClick={async () => {
                                await deleteProjectRecursive(project.id, user.uid);
                                setDeletingId(null);
                              }}
                              className="px-2 py-1 text-[11px] font-semibold text-white bg-red-600 rounded hover:bg-red-700"
                            >
                              Confirm
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setDeletingId(project.id)}
                              title={t.deleteBtn}
                              className="p-1.5 text-slate-500 hover:text-red-700 rounded hover:bg-red-50"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onOpenProject(project.id)}
                            className="ml-1 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md whitespace-nowrap"
                          >
                            {t.openWorkspace}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </main>
      </div>

      {showNewModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateBlankProject}
            className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4 shadow-lg"
          >
            <h3 className="text-lg font-semibold text-slate-900">{t.newProjectTitle}</h3>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                {t.projectTitleLabel}
              </label>
              <input
                type="text"
                required
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. Annual Ministry Compilation 2026"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-blue-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                {t.projectFolderLabel}
              </label>
              <select
                value={newFolder}
                onChange={(e) => setNewFolder(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 bg-white focus:outline-none focus:border-blue-600"
              >
                <option value="Academic">{t.folderAcademic}</option>
                <option value="Legal">{t.folderLegal}</option>
                <option value="Government">{t.folderGovernment}</option>
                <option value="General">{t.folderGeneral}</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                {t.projectDescLabel}
              </label>
              <textarea
                rows={2}
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-blue-600"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg"
              >
                {t.cancelBtn}
              </button>
              <button
                type="submit"
                disabled={creating}
                className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
              >
                {creating ? '...' : t.createBtn}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
