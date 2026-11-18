import React, { useRef, useState } from 'react';
import { CompiledPage, Project, getEffectivePaperMm } from '@/types/document';
import { mmToPx } from '@/lib/pagination-engine';

interface CompiledPageSheetProps {
  project: Project;
  page: CompiledPage;
  pdfPageImageUrl?: string;
  pdfFallbackText?: string;
  scale?: number;
  onNavigateToPage?: (pageIndex: number) => void;
  onDragNumberOffsetPreview?: (pageIndex: number, offsetXPx: number, offsetYPx: number) => void;
  onDragNumberOffsetCommit?: (pageIndex: number, offsetXPx: number, offsetYPx: number) => void;
  onSelectPageForNumberEdit?: (pageIndex: number) => void;
  id?: string;
  sheetRef?: (el: HTMLDivElement | null) => void;
  className?: string;
}

export function CompiledPageSheet({
  project,
  page,
  pdfPageImageUrl,
  pdfFallbackText,
  scale = 1,
  onNavigateToPage,
  onDragNumberOffsetPreview,
  onDragNumberOffsetCommit,
  onSelectPageForNumberEdit,
  id,
  sheetRef,
  className = '',
}: CompiledPageSheetProps) {
  const { widthMm, heightMm } = getEffectivePaperMm(project.pageSetup);
  const isPdfPage = Boolean(page.pdfDocId && page.pdfPageNumber);
  const widthPx =
    isPdfPage && page.pdfPageWidthPt
      ? Math.round((page.pdfPageWidthPt * 96) / 72)
      : mmToPx(widthMm);
  const heightPx =
    isPdfPage && page.pdfPageHeightPt
      ? Math.round((page.pdfPageHeightPt * 96) / 72)
      : mmToPx(heightMm);
  const marginTopPx = isPdfPage ? 16 : mmToPx(project.pageSetup.marginTopMm);
  const marginBottomPx = isPdfPage ? 16 : mmToPx(project.pageSetup.marginBottomMm);
  const marginLeftPx = isPdfPage ? 24 : mmToPx(project.pageSetup.marginLeftMm);
  const marginRightPx = isPdfPage ? 24 : mmToPx(project.pageSetup.marginRightMm);

  const numCfg = project.numberingConfig;
  const hf = project.headerFooterConfig;
  const wm = project.watermarkConfig;

  const effectivePos = page.numberPosition || numCfg.position;
  const offsetX = page.numberOffsetXPx || 0;
  const offsetY = page.numberOffsetYPx || 0;
  const maskEnabled = numCfg.maskBackground !== false;
  const isInteractive = Boolean(onDragNumberOffsetPreview || onDragNumberOffsetCommit);

  const [isDraggingBadge, setIsDraggingBadge] = useState(false);
  const dragOriginRef = useRef<{
    clientX: number;
    clientY: number;
    startX: number;
    startY: number;
  } | null>(null);

  const handleBadgePointerDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!isInteractive) return;
    e.preventDefault();
    e.stopPropagation();
    onSelectPageForNumberEdit?.(page.pageIndex);
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    setIsDraggingBadge(true);
    dragOriginRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      startX: offsetX,
      startY: offsetY,
    };
  };

  const handleBadgePointerMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!isDraggingBadge || !dragOriginRef.current) return;
    const dx = (e.clientX - dragOriginRef.current.clientX) / (scale || 1);
    const dy = (e.clientY - dragOriginRef.current.clientY) / (scale || 1);
    const nextX = Math.max(-widthPx, Math.min(widthPx, Math.round(dragOriginRef.current.startX + dx)));
    const nextY = Math.max(-heightPx, Math.min(heightPx, Math.round(dragOriginRef.current.startY + dy)));
    onDragNumberOffsetPreview?.(page.pageIndex, nextX, nextY);
  };

  const handleBadgePointerUp = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!isDraggingBadge || !dragOriginRef.current) return;
    const dx = (e.clientX - dragOriginRef.current.clientX) / (scale || 1);
    const dy = (e.clientY - dragOriginRef.current.clientY) / (scale || 1);
    const nextX = Math.max(-widthPx, Math.min(widthPx, Math.round(dragOriginRef.current.startX + dx)));
    const nextY = Math.max(-heightPx, Math.min(heightPx, Math.round(dragOriginRef.current.startY + dy)));
    setIsDraggingBadge(false);
    dragOriginRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore if capture already released
    }
    onDragNumberOffsetCommit?.(page.pageIndex, nextX, nextY);
  };

  const numBadge =
    numCfg.enabled && !page.numberHidden && page.pageNumberFormatted ? (
      <span
        onPointerDown={handleBadgePointerDown}
        onPointerMove={handleBadgePointerMove}
        onPointerUp={handleBadgePointerUp}
        onPointerCancel={handleBadgePointerUp}
        title={isInteractive ? 'Drag to reposition page number on this page' : undefined}
        style={{
          fontFamily: numCfg.fontFamily,
          fontSize: `${numCfg.fontSizePt}pt`,
          color: numCfg.color,
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1.5,
          display: 'inline-block',
          whiteSpace: 'nowrap',
          position: 'relative',
          zIndex: 30,
          transform: offsetX || offsetY ? `translate(${offsetX}px, ${offsetY}px)` : undefined,
          backgroundColor:
            isPdfPage && maskEnabled ? project.pageSetup.backgroundColor || '#ffffff' : undefined,
          padding: isPdfPage && maskEnabled ? '2px 8px' : undefined,
          borderRadius: isPdfPage && maskEnabled ? '3px' : undefined,
          touchAction: isInteractive ? 'none' : undefined,
        }}
        className={
          isInteractive
            ? `select-none cursor-grab active:cursor-grabbing rounded transition-shadow ${
                isDraggingBadge
                  ? 'ring-2 ring-blue-600 shadow-md'
                  : 'hover:ring-1 hover:ring-blue-500/70'
              }`
            : undefined
        }
      >
        {page.pageNumberFormatted}
      </span>
    ) : null;

  const handleBodyClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onNavigateToPage) return;
    const target = (e.target as HTMLElement).closest('[data-toc-page]');
    if (target) {
      const idx = Number(target.getAttribute('data-toc-page'));
      if (!Number.isNaN(idx)) {
        onNavigateToPage(idx);
      }
    }
  };

  return (
    <div
      style={{
        width: `${Math.round(widthPx * scale)}px`,
        height: `${Math.round(heightPx * scale)}px`,
      }}
      className={`relative shrink-0 ${className}`}
    >
      <div
        id={id}
        ref={sheetRef}
        style={{
          width: `${widthPx}px`,
          height: `${heightPx}px`,
          transform: scale !== 1 ? `scale(${scale})` : undefined,
          transformOrigin: 'top left',
          backgroundColor: project.pageSetup.backgroundColor || '#ffffff',
          paddingTop: `${marginTopPx}px`,
          paddingBottom: `${marginBottomPx}px`,
          paddingLeft: `${marginLeftPx}px`,
          paddingRight: `${marginRightPx}px`,
          border: project.pageSetup.pageBorder
            ? `2px solid ${project.pageSetup.borderColor || '#cbd5e1'}`
            : '1px solid #e2e8f0',
          fontFamily: project.pageSetup.defaultFontFamily,
          fontSize: `${project.pageSetup.defaultFontSizePt}pt`,
          lineHeight: project.pageSetup.lineHeight,
        }}
        className="relative flex flex-col justify-between box-border overflow-hidden shadow-sm print-page-sheet"
      >
        {isPdfPage && pdfPageImageUrl && (
          <img
            src={pdfPageImageUrl}
            alt={`${page.docTitle} - Page ${page.pdfPageNumber}`}
            className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none z-0"
          />
        )}

        {wm.enabled && wm.text && (
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
              zIndex: 5,
            }}
          >
            <div
              style={{
                transform: `rotate(${wm.angle}deg)`,
                opacity: wm.opacity,
                color: wm.color,
                fontSize: '56px',
                fontWeight: 700,
                letterSpacing: '0.12em',
                userSelect: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              {wm.text}
            </div>
          </div>
        )}

        <div
          className={`relative z-20 flex items-center justify-between gap-4 pb-2 mb-2 min-h-[30px] text-[11px] leading-relaxed text-slate-500 overflow-visible ${
            isPdfPage ? '' : 'border-b border-slate-100'
          }`}
          style={{
            visibility:
              hf.headerEnabled ||
              (numBadge && effectivePos.startsWith('top'))
                ? 'visible'
                : 'hidden',
          }}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1 text-left overflow-visible">
            {hf.headerEnabled && hf.logoUrl && !page.isCoverPage && !isPdfPage && (
              <img
                src={hf.logoUrl}
                alt="Logo"
                referrerPolicy="no-referrer"
                className="w-5 h-5 object-contain shrink-0"
              />
            )}
            {effectivePos === 'top-left' && numBadge ? (
              numBadge
            ) : !isPdfPage ? (
              <span className="truncate">{page.headerLeft}</span>
            ) : null}
          </div>
          <div className="flex-1 text-center overflow-visible">
            {effectivePos === 'top-center' && numBadge
              ? numBadge
              : !isPdfPage && page.headerCenter
              ? <span className="inline-block max-w-full truncate">{page.headerCenter}</span>
              : null}
          </div>
          <div className="flex-1 text-right overflow-visible">
            {effectivePos === 'top-right' && numBadge
              ? numBadge
              : !isPdfPage && page.headerRight
              ? <span className="inline-block max-w-full truncate">{page.headerRight}</span>
              : null}
          </div>
        </div>

        <div
          onClick={handleBodyClick}
          className="relative z-10 flex-1 overflow-hidden dm-prose text-slate-900"
          style={
            {
              textIndent:
                !isPdfPage && project.pageSetup.firstLineIndentMm
                  ? `${mmToPx(project.pageSetup.firstLineIndentMm)}px`
                  : undefined,
              '--dm-max-img-height': `${Math.max(
                140,
                heightPx -
                  marginTopPx -
                  marginBottomPx -
                  96 -
                  64
              )}px`,
            } as React.CSSProperties
          }
        >
          {isPdfPage ? (
            !pdfPageImageUrl ? (
              pdfFallbackText ? (
                <div className="h-full overflow-hidden p-4 text-xs leading-relaxed text-slate-700 whitespace-pre-wrap">
                  {pdfFallbackText}
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-xs text-slate-400">
                  Rendering original PDF page {page.pdfPageNumber}...
                </div>
              )
            ) : null
          ) : (
            <div className="flow-root" dangerouslySetInnerHTML={{ __html: page.html }} />
          )}

          {page.signatureText && (
            <div className="mt-8 pt-4 border-t border-slate-300 flex justify-end">
              <div className="text-right bg-white/90 px-3 py-1.5 rounded">
                <div className="text-xs font-semibold text-slate-800">{page.signatureText}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">Verified Digital Signature</div>
              </div>
            </div>
          )}
        </div>

        <div
          className={`relative z-20 flex items-center justify-between gap-4 pt-2 mt-2 min-h-[30px] text-[11px] leading-relaxed text-slate-500 overflow-visible ${
            isPdfPage ? '' : 'border-t border-slate-100'
          }`}
          style={{
            visibility:
              hf.footerEnabled ||
              (numBadge && effectivePos.startsWith('bottom'))
                ? 'visible'
                : 'hidden',
          }}
        >
          <div className="flex-1 text-left overflow-visible">
            {effectivePos === 'bottom-left' && numBadge
              ? numBadge
              : !isPdfPage && page.footerLeft
              ? <span className="inline-block max-w-full truncate">{page.footerLeft}</span>
              : null}
          </div>
          <div className="flex-1 text-center overflow-visible">
            {effectivePos === 'bottom-center' && numBadge
              ? numBadge
              : !isPdfPage && page.footerCenter
              ? <span className="inline-block max-w-full truncate">{page.footerCenter}</span>
              : null}
          </div>
          <div className="flex-1 text-right overflow-visible">
            {effectivePos === 'bottom-right' && numBadge
              ? numBadge
              : !isPdfPage && page.footerRight
              ? <span className="inline-block max-w-full truncate">{page.footerRight}</span>
              : null}
          </div>
        </div>
      </div>
    </div>
  );
}
