import React, { useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Eye,
  EyeOff,
  GripVertical,
  Move,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  CompiledPage,
  Language,
  NumberingPosition,
  PageNumberOverride,
  Project,
  getEffectivePaperMm,
} from '@/types/document';
import { CompiledPageSheet } from '@/components/CompiledPageSheet';
import { Translations } from '@/lib/i18n';
import { formatNumberValue, mmToPx } from '@/lib/pagination-engine';

interface InteractivePageNumberCardProps {
  project: Project;
  page: CompiledPage;
  pdfPageImageUrl?: string;
  pdfFallbackText?: string;
  scale: number;
  compact?: boolean;
  language: Language;
  t: Translations;
  isSelectedForEdit?: boolean;
  onSelectPage?: (pageIndex: number) => void;
  onUpdatePageOverride: (pageIndex: number, patch: Partial<PageNumberOverride>) => void;
  onResetPageOverride: (pageIndex: number) => void;
  onDragOffsetPreview: (pageIndex: number, offsetXPx: number, offsetYPx: number) => void;
  onDragOffsetCommit: (pageIndex: number, offsetXPx: number, offsetYPx: number) => void;
  onNavigateToPage?: (pageIndex: number) => void;
  onAddPage?: (pageIndex: number, placement: 'before' | 'after', kind: 'blank' | 'editor') => void;
  onDeletePage?: (pageIndex: number) => void;
  onPageDragStart?: (pageIndex: number) => void;
  onPageDragOver?: (pageIndex: number) => void;
  onPageDragLeave?: (pageIndex: number) => void;
  onPageDrop?: (pageIndex: number) => void;
  onPageDragEnd?: () => void;
  onStepMovePage?: (pageIndex: number, direction: -1 | 1) => void;
  canMoveEarlier?: boolean;
  canMoveLater?: boolean;
  isDraggingThisPage?: boolean;
  isDropTargetPage?: boolean;
  canCleanStains?: boolean;
  isPageCleaned?: boolean;
  onOpenStainCleaner?: (pageIndex: number) => void;
  sheetRef?: (el: HTMLDivElement | null) => void;
}

const POSITIONS: Array<{ pos: NumberingPosition; en: string; km: string }> = [
  { pos: 'top-left', en: 'TL', km: 'លើឆ្វេង' },
  { pos: 'top-center', en: 'TC', km: 'លើកណ្ដាល' },
  { pos: 'top-right', en: 'TR', km: 'លើស្ដាំ' },
  { pos: 'bottom-left', en: 'BL', km: 'ក្រោមឆ្វេង' },
  { pos: 'bottom-center', en: 'BC', km: 'ក្រោមកណ្ដាល' },
  { pos: 'bottom-right', en: 'BR', km: 'ក្រោមស្ដាំ' },
];

export function InteractivePageNumberCard({
  project,
  page,
  pdfPageImageUrl,
  pdfFallbackText,
  scale,
  compact = false,
  language,
  t,
  isSelectedForEdit,
  onSelectPage,
  onUpdatePageOverride,
  onResetPageOverride,
  onDragOffsetPreview,
  onDragOffsetCommit,
  onNavigateToPage,
  onAddPage,
  onDeletePage,
  onPageDragStart,
  onPageDragOver,
  onPageDragLeave,
  onPageDrop,
  onPageDragEnd,
  onStepMovePage,
  canMoveEarlier = false,
  canMoveLater = false,
  isDraggingThisPage = false,
  isDropTargetPage = false,
  canCleanStains = false,
  isPageCleaned = false,
  onOpenStainCleaner,
  sheetRef,
}: InteractivePageNumberCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const cardWrapperRef = useRef<HTMLDivElement>(null);

  const numCfg = project.numberingConfig;
  const existingOverride = numCfg.pageOverrides?.[String(page.pageIndex)];
  const effectivePos = page.numberPosition || numCfg.position;
  const offsetX = page.numberOffsetXPx || 0;
  const offsetY = page.numberOffsetYPx || 0;
  const isHidden = Boolean(page.numberHidden);
  const hasOverride = Boolean(page.numberHasOverride);

  const basePageWidthPx =
    page.pdfDocId && page.pdfPageWidthPt
      ? Math.round((page.pdfPageWidthPt * 96) / 72)
      : mmToPx(getEffectivePaperMm(project.pageSetup).widthMm);
  const scaledSheetWidthPx = Math.round(basePageWidthPx * scale);

  const pageLabelText =
    language === 'km'
      ? `ទំព័រ ${formatNumberValue(page.pageIndex + 1, 'km')}`
      : `Page ${page.pageIndex + 1}`;

  return (
    <div
      ref={cardWrapperRef}
      onDragOver={(e) => {
        if (!onPageDrop || page.isTocPage) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        onPageDragOver?.(page.pageIndex);
      }}
      onDragLeave={(e) => {
        if (!onPageDragLeave) return;
        if (!cardWrapperRef.current?.contains(e.relatedTarget as Node)) {
          onPageDragLeave(page.pageIndex);
        }
      }}
      onDrop={(e) => {
        if (!onPageDrop || page.isTocPage) return;
        e.preventDefault();
        onPageDrop(page.pageIndex);
      }}
      className={`flex flex-col items-center gap-2 transition-all rounded-xl ${
        isDraggingThisPage
          ? 'opacity-45 scale-[0.98]'
          : isDropTargetPage
          ? 'ring-2 ring-blue-600 bg-blue-50/60 p-1.5 shadow-md'
          : isSelectedForEdit
          ? 'ring-2 ring-blue-500/40 p-1.5 bg-blue-50/30'
          : ''
      }`}
    >
      <div
        style={{ maxWidth: compact ? Math.max(270, scaledSheetWidthPx) : 720 }}
        className="w-full bg-white/95 border border-slate-200 rounded-lg px-2.5 py-1.5 shadow-xs space-y-2"
      >
        <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px]">
          <div className="flex items-center gap-1.5 min-w-0">
            {onPageDragStart && !page.isTocPage && (
              <span
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', String(page.pageIndex));
                  if (cardWrapperRef.current && e.dataTransfer.setDragImage) {
                    e.dataTransfer.setDragImage(cardWrapperRef.current, 40, 24);
                  }
                  onPageDragStart(page.pageIndex);
                }}
                onDragEnd={() => onPageDragEnd?.()}
                title={t.dragPageHint}
                className="inline-flex items-center justify-center p-1 -ml-1 rounded cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <GripVertical className="w-3.5 h-3.5" />
              </span>
            )}
            <span className="font-mono font-semibold text-slate-800 tabular-nums">
              {pageLabelText}
            </span>
            {onStepMovePage && !page.isTocPage && (
              <div className="inline-flex items-center gap-0.5 ml-0.5">
                <button
                  type="button"
                  disabled={!canMoveEarlier}
                  onClick={() => onStepMovePage(page.pageIndex, -1)}
                  title={t.movePageEarlier}
                  className="p-0.5 rounded border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-800 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {compact ? <ArrowLeft className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />}
                </button>
                <button
                  type="button"
                  disabled={!canMoveLater}
                  onClick={() => onStepMovePage(page.pageIndex, 1)}
                  title={t.movePageLater}
                  className="p-0.5 rounded border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-800 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {compact ? <ArrowRight className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                </button>
              </div>
            )}
            {hasOverride && (
              <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-medium text-[10px]">
                {language === 'km' ? 'ទីតាំងផ្ទាល់ខ្លួន' : 'Custom'}
              </span>
            )}
            {(offsetX !== 0 || offsetY !== 0) && (
              <span className="font-mono text-[10px] text-slate-500 tabular-nums">
                ({offsetX >= 0 ? `+${offsetX}` : offsetX}, {offsetY >= 0 ? `+${offsetY}` : offsetY}px)
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1">
            {POSITIONS.map((item) => (
              <button
                key={item.pos}
                type="button"
                onClick={() => {
                  onSelectPage?.(page.pageIndex);
                  onUpdatePageOverride(page.pageIndex, { position: item.pos });
                }}
                title={`${language === 'km' ? 'ប្ដូរទីតាំងទំព័រនេះទៅ' : 'Move this page number to'} ${
                  language === 'km' ? item.km : item.en
                }`}
                className={`px-1.5 py-0.5 rounded border text-[10px] font-medium transition-colors ${
                  effectivePos === item.pos && !isHidden
                    ? 'border-blue-600 bg-blue-50 text-blue-800'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {language === 'km' ? item.km : item.en}
              </button>
            ))}

            <div className="w-px h-4 bg-slate-200 mx-0.5" />

            <button
              type="button"
              onClick={() => {
                onSelectPage?.(page.pageIndex);
                setExpanded((v) => !v);
              }}
              title={language === 'km' ? 'កំណត់កូអរដោនេ X/Y និងអក្សរ' : 'Adjust X/Y offset & text'}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-medium ${
                expanded
                  ? 'border-slate-800 bg-slate-800 text-white'
                  : 'border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <SlidersHorizontal className="w-3 h-3" />
              {language === 'km' ? 'កែលម្អិត' : 'Fine Tune'}
            </button>

            <button
              type="button"
              onClick={() => {
                onSelectPage?.(page.pageIndex);
                onUpdatePageOverride(page.pageIndex, { hidden: !isHidden });
              }}
              title={t.hideOnThisPage}
              className={`p-1 rounded border ${
                isHidden
                  ? 'border-amber-300 bg-amber-50 text-amber-700'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {isHidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            </button>

            {hasOverride && (
              <button
                type="button"
                onClick={() => onResetPageOverride(page.pageIndex)}
                title={t.resetPagePosition}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-200 text-[10px] text-slate-600 hover:bg-slate-50"
              >
                <RotateCcw className="w-3 h-3" />
                {t.resetPagePosition}
              </button>
            )}

            {(canCleanStains || onAddPage || onDeletePage) && (
              <div className="w-px h-4 bg-slate-200 mx-0.5" />
            )}

            {canCleanStains && onOpenStainCleaner && (
              <button
                type="button"
                onClick={() => {
                  onSelectPage?.(page.pageIndex);
                  onOpenStainCleaner(page.pageIndex);
                }}
                title={t.cleanStainsBtn}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-medium transition-colors ${
                  isPageCleaned
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                    : 'border-blue-200 bg-blue-50/70 text-blue-700 hover:bg-blue-100'
                }`}
              >
                <Sparkles className="w-3 h-3" />
                <span className={compact ? 'hidden' : 'inline'}>
                  {isPageCleaned ? t.cleanedBadge : t.cleanStainsBtn}
                </span>
              </button>
            )}

            {onAddPage && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    onSelectPage?.(page.pageIndex);
                    setShowAddMenu((v) => !v);
                  }}
                  title={t.addPageMenu}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-medium transition-colors ${
                    showAddMenu
                      ? 'border-blue-600 bg-blue-50 text-blue-800'
                      : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Plus className="w-3 h-3" />
                  {t.addPageMenu}
                </button>
                {showAddMenu && (
                  <div
                    onMouseLeave={() => setShowAddMenu(false)}
                    className="absolute right-0 mt-1 w-44 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-40"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddMenu(false);
                        onAddPage(page.pageIndex, 'before', 'blank');
                      }}
                      className="w-full text-left px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                    >
                      {t.insertBlankBefore}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddMenu(false);
                        onAddPage(page.pageIndex, 'after', 'blank');
                      }}
                      className="w-full text-left px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                    >
                      {t.insertBlankAfter}
                    </button>
                    <div className="my-1 border-t border-slate-100" />
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddMenu(false);
                        onAddPage(page.pageIndex, 'before', 'editor');
                      }}
                      className="w-full text-left px-3 py-1.5 text-[11px] font-medium text-blue-700 hover:bg-blue-50"
                    >
                      {t.insertEditableBefore}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddMenu(false);
                        onAddPage(page.pageIndex, 'after', 'editor');
                      }}
                      className="w-full text-left px-3 py-1.5 text-[11px] font-medium text-blue-700 hover:bg-blue-50"
                    >
                      {t.insertEditableAfter}
                    </button>
                  </div>
                )}
              </div>
            )}

            {onDeletePage && (
              <button
                type="button"
                onClick={() => onDeletePage(page.pageIndex)}
                title={t.deleteThisPage}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-red-200 text-[10px] font-medium text-red-600 hover:bg-red-50 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                <span className={compact ? 'hidden' : 'hidden sm:inline'}>{t.deleteThisPage}</span>
              </button>
            )}
          </div>
        </div>

        {expanded && (
          <div className="pt-2 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[11px]">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-slate-600 font-medium">
                <span className="inline-flex items-center gap-1">
                  <Move className="w-3 h-3" />
                  {language === 'km' ? 'គម្លាតទីតាំង (px)' : 'Fine Offset (px)'}
                </span>
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => onUpdatePageOverride(page.pageIndex, { offsetXPx: offsetX - 6 })}
                    className="p-1 border border-slate-200 rounded hover:bg-slate-50"
                    title="Nudge Left"
                  >
                    <ArrowLeft className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdatePageOverride(page.pageIndex, { offsetYPx: offsetY - 6 })}
                    className="p-1 border border-slate-200 rounded hover:bg-slate-50"
                    title="Nudge Up"
                  >
                    <ArrowUp className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdatePageOverride(page.pageIndex, { offsetYPx: offsetY + 6 })}
                    className="p-1 border border-slate-200 rounded hover:bg-slate-50"
                    title="Nudge Down"
                  >
                    <ArrowDown className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdatePageOverride(page.pageIndex, { offsetXPx: offsetX + 6 })}
                    className="p-1 border border-slate-200 rounded hover:bg-slate-50"
                    title="Nudge Right"
                  >
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <label className="flex items-center gap-1.5 border border-slate-200 rounded px-2 py-1 bg-slate-50">
                  <span className="text-slate-500 font-mono">X:</span>
                  <input
                    type="number"
                    step="2"
                    value={offsetX}
                    onChange={(e) =>
                      onUpdatePageOverride(page.pageIndex, {
                        offsetXPx: Number(e.target.value) || 0,
                      })
                    }
                    className="w-full bg-transparent font-mono text-slate-800 focus:outline-none"
                  />
                </label>
                <label className="flex items-center gap-1.5 border border-slate-200 rounded px-2 py-1 bg-slate-50">
                  <span className="text-slate-500 font-mono">Y:</span>
                  <input
                    type="number"
                    step="2"
                    value={offsetY}
                    onChange={(e) =>
                      onUpdatePageOverride(page.pageIndex, {
                        offsetYPx: Number(e.target.value) || 0,
                      })
                    }
                    className="w-full bg-transparent font-mono text-slate-800 focus:outline-none"
                  />
                </label>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-slate-600 font-medium">{t.customTextForPage}</div>
              <div className="grid grid-cols-2 gap-1.5">
                <input
                  type="text"
                  placeholder={t.prefixTextLabel}
                  value={existingOverride?.prefixText ?? ''}
                  onChange={(e) =>
                    onUpdatePageOverride(page.pageIndex, {
                      prefixText: e.target.value === '' ? undefined : e.target.value,
                    })
                  }
                  className="border border-slate-200 rounded px-2 py-1 text-slate-800 bg-white"
                />
                <input
                  type="text"
                  placeholder={t.suffixTextLabel}
                  value={existingOverride?.suffixText ?? ''}
                  onChange={(e) =>
                    onUpdatePageOverride(page.pageIndex, {
                      suffixText: e.target.value === '' ? undefined : e.target.value,
                    })
                  }
                  className="border border-slate-200 rounded px-2 py-1 text-slate-800 bg-white"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <CompiledPageSheet
        project={project}
        page={page}
        pdfPageImageUrl={pdfPageImageUrl}
        pdfFallbackText={pdfFallbackText}
        scale={scale}
        sheetRef={sheetRef}
        onNavigateToPage={onNavigateToPage}
        onSelectPageForNumberEdit={onSelectPage}
        onDragNumberOffsetPreview={onDragOffsetPreview}
        onDragNumberOffsetCommit={onDragOffsetCommit}
      />
    </div>
  );
}
