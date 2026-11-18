import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  Eraser,
  Eye,
  Layers,
  Loader2,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  SplitSquareHorizontal,
  Undo2,
  X,
} from 'lucide-react';
import { Language } from '@/types/document';
import {
  BrushPoint,
  BrushStroke,
  STAIN_CLEAN_PRESETS,
  StainCleanOptions,
  StainCleanPreset,
  cleanImageDataUrl,
  compositeStainCleanResult,
  loadImageElementFromDataUrl,
  renderAutoCleanedCanvas,
} from '@/lib/stain-cleaner';

interface StainCleanerModalProps {
  isOpen: boolean;
  title: string;
  sourceImageUrl: string;
  hasOriginalBackup: boolean;
  totalDocPages: number;
  outputMaxBytes?: number;
  language: Language;
  onClose: () => void;
  onApplySingle: (cleanedDataUrl: string) => Promise<void>;
  onApplyAllPages?: (
    options: StainCleanOptions,
    onProgress: (done: number, total: number) => void
  ) => Promise<void>;
  onResetOriginal?: () => Promise<void>;
}

type ToolMode = 'compare' | 'erase' | 'restore';

export function StainCleanerModal({
  isOpen,
  title,
  sourceImageUrl,
  hasOriginalBackup,
  totalDocPages,
  outputMaxBytes,
  language,
  onClose,
  onApplySingle,
  onApplyAllPages,
  onResetOriginal,
}: StainCleanerModalProps) {
  const isKm = language === 'km';
  const [preset, setPreset] = useState<StainCleanPreset>('auto');
  const [options, setOptions] = useState<StainCleanOptions>({ ...STAIN_CLEAN_PRESETS.auto });
  const [toolMode, setToolMode] = useState<ToolMode>('erase');
  const [brushSizePx, setBrushSizePx] = useState<number>(28);
  const [strokes, setStrokes] = useState<BrushStroke[]>([]);
  const [splitPct, setSplitPct] = useState<number>(50);
  const [showCompareSplit, setShowCompareSplit] = useState<boolean>(false);
  const [holdOriginal, setHoldOriginal] = useState<boolean>(false);
  const [zoomMode, setZoomMode] = useState<'fit' | number>('fit');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isApplying, setIsApplying] = useState<boolean>(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [imageDims, setImageDims] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);

  const originalImgRef = useRef<HTMLImageElement | null>(null);
  const autoCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const compositedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const displayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeStrokeRef = useRef<BrushStroke | null>(null);
  const isDrawingRef = useRef<boolean>(false);
  const isDraggingSplitRef = useRef<boolean>(false);

  const redrawDisplayCanvas = useCallback(() => {
    const display = displayCanvasRef.current;
    const orig = originalImgRef.current;
    const comp = compositedCanvasRef.current;
    if (!display || !orig || !comp) return;

    if (display.width !== comp.width || display.height !== comp.height) {
      display.width = comp.width;
      display.height = comp.height;
    }
    const ctx = display.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, display.width, display.height);

    if (holdOriginal) {
      ctx.drawImage(orig, 0, 0, display.width, display.height);
      return;
    }

    ctx.drawImage(comp, 0, 0);

    if (showCompareSplit && toolMode === 'compare') {
      const splitX = Math.round((splitPct / 100) * display.width);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, splitX, display.height);
      ctx.clip();
      ctx.drawImage(orig, 0, 0, display.width, display.height);
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = Math.max(2, Math.round(display.width / 400));
      ctx.beginPath();
      ctx.moveTo(splitX, 0);
      ctx.lineTo(splitX, display.height);
      ctx.stroke();
      ctx.restore();
    }
  }, [holdOriginal, showCompareSplit, splitPct, toolMode]);

  // Load source image when modal opens or source changes
  useEffect(() => {
    if (!isOpen || !sourceImageUrl) return;
    let cancelled = false;
    setLoadError(null);
    setStrokes([]);
    setPreset('auto');
    setOptions({ ...STAIN_CLEAN_PRESETS.auto });
    setBatchProgress(null);

    void (async () => {
      setIsProcessing(true);
      try {
        const img = await loadImageElementFromDataUrl(sourceImageUrl);
        if (cancelled) return;
        originalImgRef.current = img;
        const autoCanvas = renderAutoCleanedCanvas(img, STAIN_CLEAN_PRESETS.auto, undefined, 1400);
        autoCanvasRef.current = autoCanvas;
        setImageDims({ w: autoCanvas.width, h: autoCanvas.height });
        const comp = compositeStainCleanResult(autoCanvas, img, []);
        compositedCanvasRef.current = comp;
        setIsProcessing(false);
        requestAnimationFrame(() => redrawDisplayCanvas());
      } catch (err) {
        if (!cancelled) {
          setIsProcessing(false);
          setLoadError(err instanceof Error ? err.message : 'Failed to load image.');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, sourceImageUrl]);

  // Re-run auto-filter pass whenever options change
  useEffect(() => {
    const img = originalImgRef.current;
    if (!isOpen || !img) return;
    const timer = setTimeout(() => {
      setIsProcessing(true);
      const autoCanvas = renderAutoCleanedCanvas(
        img,
        options,
        autoCanvasRef.current || undefined,
        1400
      );
      autoCanvasRef.current = autoCanvas;
      setImageDims({ w: autoCanvas.width, h: autoCanvas.height });
      const comp = compositeStainCleanResult(
        autoCanvas,
        img,
        strokes,
        compositedCanvasRef.current || undefined
      );
      compositedCanvasRef.current = comp;
      setIsProcessing(false);
      redrawDisplayCanvas();
    }, 35);

    return () => clearTimeout(timer);
  }, [isOpen, options]);

  // Re-composite when strokes or compare view changes
  useEffect(() => {
    const autoCanvas = autoCanvasRef.current;
    const img = originalImgRef.current;
    if (!isOpen || !autoCanvas || !img) return;
    const comp = compositeStainCleanResult(
      autoCanvas,
      img,
      strokes,
      compositedCanvasRef.current || undefined
    );
    compositedCanvasRef.current = comp;
    redrawDisplayCanvas();
  }, [isOpen, strokes, redrawDisplayCanvas]);

  const getNormalizedPoint = (e: React.PointerEvent<HTMLCanvasElement>): BrushPoint => {
    const canvas = displayCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / Math.max(1, rect.height)));
    return { x, y };
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (toolMode === 'compare') {
      isDraggingSplitRef.current = true;
      setShowCompareSplit(true);
      const pt = getNormalizedPoint(e);
      setSplitPct(Math.round(pt.x * 100));
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    const pt = getNormalizedPoint(e);
    const minCanvasPx = Math.max(200, Math.min(imageDims.w || 800, imageDims.h || 1000));
    const sizeNorm = Math.max(0.005, brushSizePx / minCanvasPx);
    const newStroke: BrushStroke = {
      mode: toolMode === 'restore' ? 'restore' : 'erase',
      sizeNorm,
      points: [pt],
    };
    activeStrokeRef.current = newStroke;
    isDrawingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);

    // Live draw immediate dot
    const display = displayCanvasRef.current;
    const autoCanvas = autoCanvasRef.current;
    const orig = originalImgRef.current;
    if (display && autoCanvas && orig) {
      const comp = compositeStainCleanResult(
        autoCanvas,
        orig,
        [...strokes, newStroke],
        compositedCanvasRef.current || undefined
      );
      compositedCanvasRef.current = comp;
      redrawDisplayCanvas();
    }
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = displayCanvasRef.current;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      setCursorPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }

    if (toolMode === 'compare' && isDraggingSplitRef.current) {
      const pt = getNormalizedPoint(e);
      setSplitPct(Math.round(pt.x * 100));
      return;
    }

    if (!isDrawingRef.current || !activeStrokeRef.current) return;
    const pt = getNormalizedPoint(e);
    activeStrokeRef.current.points.push(pt);

    const autoCanvas = autoCanvasRef.current;
    const orig = originalImgRef.current;
    if (autoCanvas && orig) {
      const comp = compositeStainCleanResult(
        autoCanvas,
        orig,
        [...strokes, activeStrokeRef.current],
        compositedCanvasRef.current || undefined
      );
      compositedCanvasRef.current = comp;
      redrawDisplayCanvas();
    }
  };

  const handleCanvasPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore if already released
    }
    if (isDraggingSplitRef.current) {
      isDraggingSplitRef.current = false;
      return;
    }
    if (!isDrawingRef.current || !activeStrokeRef.current) return;
    isDrawingRef.current = false;
    const finished = activeStrokeRef.current;
    activeStrokeRef.current = null;
    setStrokes((prev) => [...prev, finished]);
  };

  const updateOption = <K extends keyof StainCleanOptions>(
    key: K,
    val: StainCleanOptions[K]
  ) => {
    setPreset('custom');
    setOptions((prev) => ({ ...prev, [key]: val }));
  };

  const handleSelectPreset = (p: Exclude<StainCleanPreset, 'custom'>) => {
    setPreset(p);
    setOptions({ ...STAIN_CLEAN_PRESETS[p] });
  };

  const handleApplyPage = async () => {
    if (!sourceImageUrl || isApplying) return;
    setIsApplying(true);
    try {
      const finalUrl = await cleanImageDataUrl(
        sourceImageUrl,
        options,
        strokes,
        outputMaxBytes,
        1900
      );
      await onApplySingle(finalUrl);
      onClose();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to apply stain cleaning.');
    } finally {
      setIsApplying(false);
    }
  };

  const handleApplyAll = async () => {
    if (!onApplyAllPages || isApplying) return;
    setIsApplying(true);
    setBatchProgress({ done: 0, total: totalDocPages });
    try {
      await onApplyAllPages(options, (done, total) => {
        setBatchProgress({ done, total });
      });
      onClose();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to clean all pages.');
    } finally {
      setIsApplying(false);
      setBatchProgress(null);
    }
  };

  const handleReset = async () => {
    if (!onResetOriginal || isApplying) return;
    setIsApplying(true);
    try {
      await onResetOriginal();
      onClose();
    } finally {
      setIsApplying(false);
    }
  };

  if (!isOpen) return null;

  const presetButtons: Array<{
    id: Exclude<StainCleanPreset, 'custom'>;
    labelEn: string;
    labelKm: string;
  }> = [
    { id: 'auto', labelEn: 'Auto Clean', labelKm: 'សម្អាតស្វ័យប្រវត្តិ' },
    { id: 'white-doc', labelEn: 'Pure White', labelKm: 'ក្រដាសសស្អាត' },
    { id: 'gentle', labelEn: 'Gentle Clean', labelKm: 'សម្អាតស្រាល' },
    { id: 'text-boost', labelEn: 'Text & Seal Boost', labelKm: 'បង្កើនភាពច្បាស់' },
  ];

  // Visual brush ring diameter matching rendered display size
  const getBrushCursorPx = () => {
    const canvas = displayCanvasRef.current;
    if (!canvas || !imageDims.w) return brushSizePx;
    const rect = canvas.getBoundingClientRect();
    const minCanvasPx = Math.max(200, Math.min(imageDims.w, imageDims.h));
    const minRectPx = Math.max(100, Math.min(rect.width, rect.height));
    return Math.max(8, (brushSizePx / minCanvasPx) * minRectPx);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-6xl h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-200 bg-white flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-700 border border-blue-200 flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-900 truncate">
                {isKm ? 'សម្អាតស្នាមប្រឡាក់ និងផ្ទៃខាងក្រោយឯកសារ' : 'Document Stain & Background Cleaner'}
              </h2>
              <p className="text-[11px] text-slate-500 truncate">{title}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {presetButtons.map((btn) => (
              <button
                key={btn.id}
                type="button"
                onClick={() => handleSelectPreset(btn.id)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                  preset === btn.id
                    ? 'border-blue-600 bg-blue-50 text-blue-800'
                    : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {isKm ? btn.labelKm : btn.labelEn}
              </button>
            ))}

            <button
              type="button"
              onClick={onClose}
              className="ml-2 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              title={isKm ? 'បិទ' : 'Close'}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Main Workspace */}
        <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
          {/* Canvas Viewport */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-slate-100">
            {/* Canvas Top Toolbar */}
            <div className="px-3 py-2 bg-white/90 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setToolMode('erase');
                    setShowCompareSplit(false);
                  }}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-medium transition-colors ${
                    toolMode === 'erase'
                      ? 'border-blue-600 bg-blue-50 text-blue-800'
                      : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Eraser className="w-3.5 h-3.5" />
                  <span>{isKm ? 'ជក់លុបស្នាមប្រឡាក់' : 'Erase Stain Brush'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setToolMode('restore');
                    setShowCompareSplit(false);
                  }}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-medium transition-colors ${
                    toolMode === 'restore'
                      ? 'border-amber-600 bg-amber-50 text-amber-800'
                      : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{isKm ? 'ជក់ស្ដារដើម' : 'Restore Brush'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setToolMode('compare');
                    setShowCompareSplit(true);
                  }}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-medium transition-colors ${
                    toolMode === 'compare'
                      ? 'border-slate-800 bg-slate-800 text-white'
                      : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <SplitSquareHorizontal className="w-3.5 h-3.5" />
                  <span>{isKm ? 'ប្រៀបធៀប មុន/ក្រោយ' : 'Before / After Split'}</span>
                </button>

                <button
                  type="button"
                  onMouseDown={() => setHoldOriginal(true)}
                  onMouseUp={() => setHoldOriginal(false)}
                  onMouseLeave={() => setHoldOriginal(false)}
                  onTouchStart={() => setHoldOriginal(true)}
                  onTouchEnd={() => setHoldOriginal(false)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md border font-medium select-none ${
                    holdOriginal
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                  title={isKm ? 'ចុចសង្កត់ដើម្បីមើលរូបភាពដើម' : 'Hold to inspect original'}
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>{isKm ? 'មើលរូបដើម' : 'Hold Original'}</span>
                </button>
              </div>

              <div className="flex items-center gap-1">
                {(['fit', 1, 1.5, 2] as const).map((z) => (
                  <button
                    key={String(z)}
                    type="button"
                    onClick={() => setZoomMode(z)}
                    className={`px-2 py-0.5 rounded font-mono text-[11px] ${
                      zoomMode === z
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:bg-slate-200/70'
                    }`}
                  >
                    {z === 'fit' ? (isKm ? 'សមល្មម' : 'Fit') : `${Math.round(z * 100)}%`}
                  </button>
                ))}
              </div>
            </div>

            {/* Canvas Scroll Container */}
            <div className="flex-1 overflow-auto p-4 sm:p-6 flex items-center justify-center relative">
              {loadError ? (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-xs max-w-md text-center">
                  {loadError}
                </div>
              ) : (
                <div className="relative inline-block shadow-lg border border-slate-300 bg-white">
                  <canvas
                    ref={displayCanvasRef}
                    onPointerDown={handleCanvasPointerDown}
                    onPointerMove={handleCanvasPointerMove}
                    onPointerUp={handleCanvasPointerUp}
                    onPointerLeave={() => setCursorPos(null)}
                    style={{
                      maxHeight: zoomMode === 'fit' ? 'calc(92vh - 210px)' : undefined,
                      maxWidth: zoomMode === 'fit' ? '100%' : undefined,
                      width:
                        zoomMode === 'fit'
                          ? 'auto'
                          : imageDims.w
                          ? `${Math.round(imageDims.w * zoomMode * 0.55)}px`
                          : 'auto',
                      height: 'auto',
                      touchAction: 'none',
                      cursor: toolMode === 'compare' ? 'ew-resize' : 'crosshair',
                    }}
                    className="block select-none"
                  />

                  {cursorPos && toolMode !== 'compare' && (
                    <div
                      aria-hidden="true"
                      style={{
                        left: cursorPos.x,
                        top: cursorPos.y,
                        width: getBrushCursorPx(),
                        height: getBrushCursorPx(),
                        transform: 'translate(-50%, -50%)',
                      }}
                      className={`pointer-events-none absolute rounded-full border-2 ${
                        toolMode === 'restore'
                          ? 'border-amber-600 bg-amber-300/20'
                          : 'border-blue-600 bg-white/40'
                      }`}
                    />
                  )}

                  {showCompareSplit && toolMode === 'compare' && !holdOriginal && (
                    <>
                      <span className="pointer-events-none absolute top-2 left-2 px-2 py-0.5 rounded bg-slate-900/75 text-white text-[10px] font-medium">
                        {isKm ? 'មុនសម្អាត' : 'Original'}
                      </span>
                      <span className="pointer-events-none absolute top-2 right-2 px-2 py-0.5 rounded bg-blue-700/85 text-white text-[10px] font-medium">
                        {isKm ? 'ក្រោយសម្អាត' : 'Cleaned'}
                      </span>
                    </>
                  )}

                  {isProcessing && (
                    <div className="pointer-events-none absolute bottom-2 right-2 bg-slate-900/80 text-white px-2.5 py-1 rounded-md text-[11px] flex items-center gap-1.5">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span>{isKm ? 'កំពុងដំណើរការ...' : 'Processing...'}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right Controls Panel */}
          <aside className="w-full lg:w-80 bg-white border-t lg:border-t-0 lg:border-l border-slate-200 p-4 overflow-y-auto space-y-5 shrink-0">
            {/* Manual Brush Section */}
            <div className="space-y-2.5 pb-4 border-b border-slate-200">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                  <Eraser className="w-3.5 h-3.5 text-blue-700" />
                  <span>{isKm ? 'ជក់សម្អាតដោយដៃ' : 'Manual Spot Eraser'}</span>
                </h3>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={strokes.length === 0}
                    onClick={() => setStrokes((prev) => prev.slice(0, -1))}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-slate-200 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-35"
                    title={isKm ? 'ត្រឡប់ជក់' : 'Undo stroke'}
                  >
                    <Undo2 className="w-3 h-3" />
                    <span>{isKm ? 'ត្រឡប់' : 'Undo'}</span>
                  </button>
                  {strokes.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setStrokes([])}
                      className="px-2 py-0.5 rounded border border-slate-200 text-[11px] text-red-600 hover:bg-red-50"
                    >
                      {isKm ? 'សម្អាតជក់' : 'Clear'}
                    </button>
                  )}
                </div>
              </div>

              <p className="text-[11px] text-slate-500">
                {isKm
                  ? 'គូសផ្ទាល់លើស្នាមប្រឡាក់ ស្នាមដៃ ឬគែមក្រដាសខ្មៅដើម្បីលុបចេញ។'
                  : 'Paint directly over ink smudges, fingerprints, staple marks, or dark spots to erase them cleanly.'}
              </p>

              <label className="block space-y-1">
                <div className="flex justify-between text-[11px] text-slate-600">
                  <span>{isKm ? 'ទំហំជក់' : 'Brush Size'}</span>
                  <span className="font-mono tabular-nums">{brushSizePx} px</span>
                </div>
                <input
                  type="range"
                  min={8}
                  max={85}
                  value={brushSizePx}
                  onChange={(e) => setBrushSizePx(Number(e.target.value))}
                  className="w-full accent-blue-700"
                />
              </label>
            </div>

            {/* Auto Cleanup Sliders */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                <SlidersHorizontal className="w-3.5 h-3.5 text-blue-700" />
                <span>{isKm ? 'កែតម្រូវការសម្អាតស្វ័យប្រវត្តិ' : 'Auto Stain & Shadow Controls'}</span>
              </h3>

              <label className="block space-y-1">
                <div className="flex justify-between text-[11px] text-slate-600">
                  <span>{isKm ? 'ធ្វើឱ្យផ្ទៃក្រដាសស' : 'Paper Whitening'}</span>
                  <span className="font-mono tabular-nums">{options.whiten}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={options.whiten}
                  onChange={(e) => updateOption('whiten', Number(e.target.value))}
                  className="w-full accent-blue-700"
                />
              </label>

              <label className="block space-y-1">
                <div className="flex justify-between text-[11px] text-slate-600">
                  <span>{isKm ? 'បំបាត់ស្នាមប្រឡាក់ និងស្រមោល' : 'Stain & Shadow Removal'}</span>
                  <span className="font-mono tabular-nums">{options.shadowRemoval}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={options.shadowRemoval}
                  onChange={(e) => updateOption('shadowRemoval', Number(e.target.value))}
                  className="w-full accent-blue-700"
                />
              </label>

              <label className="block space-y-1">
                <div className="flex justify-between text-[11px] text-slate-600">
                  <span>{isKm ? 'លុបចំណុចខ្មៅល្អិតៗ' : 'Dust & Speckle Removal'}</span>
                  <span className="font-mono tabular-nums">{options.despeckle}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={options.despeckle}
                  onChange={(e) => updateOption('despeckle', Number(e.target.value))}
                  className="w-full accent-blue-700"
                />
              </label>

              <label className="block space-y-1">
                <div className="flex justify-between text-[11px] text-slate-600">
                  <span>{isKm ? 'បង្កើនភាពច្បាស់អក្សរ' : 'Ink Contrast & Clarity'}</span>
                  <span className="font-mono tabular-nums">{options.contrast}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={options.contrast}
                  onChange={(e) => updateOption('contrast', Number(e.target.value))}
                  className="w-full accent-blue-700"
                />
              </label>

              <label className="block space-y-1">
                <div className="flex justify-between text-[11px] text-slate-600">
                  <span>{isKm ? 'សម្អាតគែមខ្មៅជុំវិញទំព័រ' : 'Clean Dark Outer Borders'}</span>
                  <span className="font-mono tabular-nums">{options.cleanMarginPct}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={6}
                  step={0.5}
                  value={options.cleanMarginPct}
                  onChange={(e) => updateOption('cleanMarginPct', Number(e.target.value))}
                  className="w-full accent-blue-700"
                />
              </label>

              <label className="flex items-start gap-2 pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={options.preserveColorInk}
                  onChange={(e) => updateOption('preserveColorInk', e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                />
                <span className="text-[11px] text-slate-700 leading-snug">
                  {isKm
                    ? 'រក្សាពណ៌ត្រាស្ថាប័ន និងហត្ថលេខាពណ៌ខៀវ/ក្រហមឱ្យនៅច្បាស់ល្អ'
                    : 'Preserve colored official stamps & blue/red ink signatures'}
                </span>
              </label>
            </div>
          </aside>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2">
            {hasOriginalBackup && onResetOriginal && (
              <button
                type="button"
                disabled={isApplying}
                onClick={handleReset}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{isKm ? 'ស្ដាររូបភាពដើមវិញ' : 'Reset to Original'}</span>
              </button>
            )}
            {batchProgress && (
              <span className="text-xs font-medium text-blue-700 flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {isKm
                  ? `កំពុងសម្អាតទំព័រ ${batchProgress.done} / ${batchProgress.total}...`
                  : `Cleaning page ${batchProgress.done} / ${batchProgress.total}...`}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isApplying}
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-md border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              {isKm ? 'បោះបង់' : 'Cancel'}
            </button>

            {totalDocPages > 1 && onApplyAllPages && (
              <button
                type="button"
                disabled={isApplying || Boolean(loadError)}
                onClick={handleApplyAll}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md border border-blue-600 bg-blue-50 text-xs font-semibold text-blue-800 hover:bg-blue-100 disabled:opacity-50"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>
                  {isKm
                    ? `អនុវត្តលើគ្រប់ទំព័រ (${totalDocPages})`
                    : `Apply Filter to All ${totalDocPages} Pages`}
                </span>
              </button>
            )}

            <button
              type="button"
              disabled={isApplying || Boolean(loadError)}
              onClick={handleApplyPage}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-slate-900 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {isApplying && !batchProgress ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
              <span>{isKm ? 'រក្សាទុកលើទំព័រនេះ' : 'Apply to This Page'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
