import React, { useEffect, useRef, useState } from 'react';
import { Extension } from '@tiptap/core';
import { useEditor, EditorContent } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { TextAlign } from '@tiptap/extension-text-align';
import {
  BackgroundColor,
  Color,
  FontFamily,
  FontSize,
  LineHeight,
  TextStyle,
} from '@tiptap/extension-text-style';
import { Highlight } from '@tiptap/extension-highlight';
import { Image as TiptapImage } from '@tiptap/extension-image';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import { Placeholder } from '@tiptap/extension-placeholder';
import { Subscript } from '@tiptap/extension-subscript';
import { Superscript } from '@tiptap/extension-superscript';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  FilePlus2,
  Highlighter,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Redo2,
  Replace,
  ScanText,
  Search,
  SeparatorHorizontal,
  Shield,
  SpellCheck,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Table as TableIcon,
  Underline as UnderlineIcon,
  Undo2,
  X,
} from 'lucide-react';
import {
  FONT_OPTIONS,
  Language,
  Project,
  ProjectDocument,
  getEffectivePaperMm,
} from '@/types/document';
import { getTranslations } from '@/lib/i18n';
import { formatNumberValue, mmToPx } from '@/lib/pagination-engine';
import { runOcrOnImageDataUrl } from '@/lib/document-processor';

interface RichTextEditorProps {
  project: Project;
  documentItem: ProjectDocument;
  language: Language;
  externalSyncKey?: number;
  compiledPageLabel?: string;
  onChangeContent: (html: string, plainText: string) => void;
}

const makeStyleAttr = (attrName: string, cssProp: string, styleKey: keyof CSSStyleDeclaration) => ({
  [attrName]: {
    default: null as string | null,
    parseHTML: (element: HTMLElement) => {
      const val = element.style[styleKey];
      return typeof val === 'string' && val.trim() ? val.trim() : null;
    },
    renderHTML: (attributes: Record<string, unknown>) => {
      const val = attributes[attrName];
      return typeof val === 'string' && val ? { style: `${cssProp}: ${val}` } : {};
    },
  },
});

const PreserveImportedLayoutStyles = Extension.create({
  name: 'preserveImportedLayoutStyles',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading', 'blockquote', 'listItem'],
        attributes: {
          ...makeStyleAttr('marginLeft', 'margin-left', 'marginLeft'),
          ...makeStyleAttr('marginRight', 'margin-right', 'marginRight'),
          ...makeStyleAttr('textIndent', 'text-indent', 'textIndent'),
          ...makeStyleAttr('marginTop', 'margin-top', 'marginTop'),
          ...makeStyleAttr('marginBottom', 'margin-bottom', 'marginBottom'),
          ...makeStyleAttr('lineHeightStyle', 'line-height', 'lineHeight'),
          ...makeStyleAttr('blockBgColor', 'background-color', 'backgroundColor'),
          ...makeStyleAttr('blockPadding', 'padding', 'padding'),
          ...makeStyleAttr('blockPaddingLeft', 'padding-left', 'paddingLeft'),
          ...makeStyleAttr('blockBorderTop', 'border-top', 'borderTop'),
          ...makeStyleAttr('blockBorderBottom', 'border-bottom', 'borderBottom'),
          ...makeStyleAttr('blockBorderLeft', 'border-left', 'borderLeft'),
          ...makeStyleAttr('blockBorderRight', 'border-right', 'borderRight'),
        },
      },
      {
        types: ['orderedList', 'bulletList'],
        attributes: {
          ...makeStyleAttr('listMarginLeft', 'margin-left', 'marginLeft'),
          ...makeStyleAttr('listStyleType', 'list-style-type', 'listStyleType'),
        },
      },
      {
        types: ['table'],
        attributes: {
          ...makeStyleAttr('tableWidth', 'width', 'width'),
          ...makeStyleAttr('tableBorderCollapse', 'border-collapse', 'borderCollapse'),
          ...makeStyleAttr('tableMarginLeft', 'margin-left', 'marginLeft'),
          ...makeStyleAttr('tableMarginRight', 'margin-right', 'marginRight'),
        },
      },
      {
        types: ['tableCell', 'tableHeader'],
        attributes: {
          ...makeStyleAttr('cellBgColor', 'background-color', 'backgroundColor'),
          ...makeStyleAttr('cellVerticalAlign', 'vertical-align', 'verticalAlign'),
          ...makeStyleAttr('cellTextAlign', 'text-align', 'textAlign'),
          ...makeStyleAttr('cellWidth', 'width', 'width'),
          ...makeStyleAttr('cellBorder', 'border', 'border'),
          ...makeStyleAttr('cellBorderTop', 'border-top', 'borderTop'),
          ...makeStyleAttr('cellBorderBottom', 'border-bottom', 'borderBottom'),
          ...makeStyleAttr('cellBorderLeft', 'border-left', 'borderLeft'),
          ...makeStyleAttr('cellBorderRight', 'border-right', 'borderRight'),
        },
      },
      {
        types: ['textStyle'],
        attributes: {
          ...makeStyleAttr('textTransform', 'text-transform', 'textTransform'),
          ...makeStyleAttr('fontVariant', 'font-variant', 'fontVariant'),
        },
      },
    ];
  },
});

export function RichTextEditor({
  project,
  documentItem,
  language,
  externalSyncKey = 0,
  compiledPageLabel,
  onChangeContent,
}: RichTextEditorProps) {
  const t = getTranslations(language);
  const [spellCheck, setSpellCheck] = useState(true);
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrNotice, setOcrNotice] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const lastDocIdRef = useRef<string>(documentItem.id);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false },
        horizontalRule: { HTMLAttributes: { class: 'page-break-marker' } },
      }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TextStyle,
      Color,
      BackgroundColor,
      FontFamily,
      FontSize,
      LineHeight,
      PreserveImportedLayoutStyles,
      Highlight.configure({ multicolor: true }),
      TiptapImage.configure({ allowBase64: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Subscript,
      Superscript,
      Placeholder.configure({
        placeholder:
          language === 'km'
            ? 'សូមវាយអត្ថបទ ឬកែសម្រួលឯកសារនៅទីនេះ...'
            : 'Start typing or editing document content here...',
      }),
    ],
    content: documentItem.contentHtml || '<p></p>',
    editorProps: {
      attributes: {
        class: 'dm-prose min-h-[520px] focus:outline-none',
      },
    },
    onUpdate: ({ editor: ed }) => {
      const html = ed.getHTML();
      const plain = ed.getText();
      onChangeContent(html, plain);
    },
  });

  const lastSyncKeyRef = useRef<number>(externalSyncKey);

  useEffect(() => {
    if (!editor) return;
    const docChanged = lastDocIdRef.current !== documentItem.id;
    const syncChanged = lastSyncKeyRef.current !== externalSyncKey;
    if (docChanged || syncChanged) {
      lastDocIdRef.current = documentItem.id;
      lastSyncKeyRef.current = externalSyncKey;
      const nextHtml = documentItem.contentHtml || '<p></p>';
      if (docChanged || editor.getHTML() !== nextHtml) {
        editor.commands.setContent(nextHtml, { emitUpdate: false });
      }
    }
  }, [documentItem.id, documentItem.contentHtml, externalSyncKey, editor]);

  const handleInsertImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editor) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      editor.chain().focus().setImage({ src: dataUrl, alt: file.name }).run();
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleApplyLink = () => {
    if (!editor) return;
    const trimmed = linkUrl.trim();
    if (trimmed) {
      editor.chain().focus().setLink({ href: trimmed }).run();
    } else {
      editor.chain().focus().unsetLink().run();
    }
    setLinkUrl('');
    setShowLinkInput(false);
  };

  const handleReplaceAll = () => {
    if (!editor || !findText) return;
    const currentHtml = editor.getHTML();
    const escaped = findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'g');
    const updatedHtml = currentHtml.replace(regex, replaceText);
    editor.commands.setContent(updatedHtml, { emitUpdate: true });
  };

  const handleInsertFootnote = () => {
    if (!editor) return;
    const footnoteNum = (editor.getText().match(/\[\d+\]/g)?.length || 0) + 1;
    editor.chain().focus().insertContent(`<sup>[${footnoteNum}]</sup>`).run();
  };

  const handleInsertPageBreak = () => {
    if (!editor) return;
    editor.chain().focus().insertContent('<hr class="page-break-marker" /><p></p>').run();
  };

  const handleRunOcr = async () => {
    if (!editor) return;
    setOcrLoading(true);
    setOcrError(null);
    setOcrNotice(null);
    try {
      const html = editor.getHTML();
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      const imgs = Array.from(tmp.querySelectorAll('img'))
        .map((img) => img.getAttribute('src') || '')
        .filter((src) => src.startsWith('data:image/'));

      if (imgs.length === 0) {
        setOcrError('No embedded scanned image found in this section.');
        return;
      }

      const extractedChunks: string[] = [];
      let latestNotice: string | null = null;
      for (const dataUrl of imgs) {
        const result = await runOcrOnImageDataUrl(dataUrl);
        extractedChunks.push(result.html);
        if (result.notice) {
          latestNotice = result.notice;
        }
      }

      if (latestNotice) {
        setOcrNotice(latestNotice);
      }

      const appended = `${html}\n<hr class="page-break-marker" />\n${extractedChunks.join('\n')}`;
      editor.commands.setContent(appended, { emitUpdate: true });
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : 'OCR failed');
    } finally {
      setOcrLoading(false);
    }
  };

  const { widthMm, heightMm } = getEffectivePaperMm(project.pageSetup);
  const widthPx = mmToPx(widthMm);
  const heightPx = mmToPx(heightMm);
  const marginTopPx = mmToPx(project.pageSetup.marginTopMm);
  const marginBottomPx = mmToPx(project.pageSetup.marginBottomMm);
  const marginLeftPx = mmToPx(project.pageSetup.marginLeftMm);
  const marginRightPx = mmToPx(project.pageSetup.marginRightMm);

  const hasEmbeddedScan =
    documentItem.sourceType === 'image' ||
    documentItem.sourceType === 'pdf' ||
    documentItem.contentHtml.includes('data:image/');

  if (!editor) {
    return <div className="p-10 text-sm text-slate-500 text-center">Loading editor...</div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-slate-200 px-3 py-2 flex flex-wrap items-center gap-1.5 sticky top-0 z-20">
        <button
          type="button"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          title="Undo"
          className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-35 text-slate-700"
        >
          <Undo2 className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          title="Redo"
          className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-35 text-slate-700"
        >
          <Redo2 className="w-4 h-4" />
        </button>

        <div className="w-px h-5 bg-slate-200 mx-1" />

        <select
          value={
            editor.isActive('heading', { level: 1 })
              ? 'h1'
              : editor.isActive('heading', { level: 2 })
              ? 'h2'
              : editor.isActive('heading', { level: 3 })
              ? 'h3'
              : 'p'
          }
          onChange={(e) => {
            const val = e.target.value;
            if (val === 'p') editor.chain().focus().setParagraph().run();
            else if (val === 'h1') editor.chain().focus().toggleHeading({ level: 1 }).run();
            else if (val === 'h2') editor.chain().focus().toggleHeading({ level: 2 }).run();
            else if (val === 'h3') editor.chain().focus().toggleHeading({ level: 3 }).run();
          }}
          className="text-xs border border-slate-200 rounded px-2 py-1 bg-white text-slate-800 focus:outline-none focus:border-blue-600"
        >
          <option value="p">Normal Text</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
        </select>

        <select
          value={editor.getAttributes('textStyle').fontFamily || ''}
          onChange={(e) => {
            const val = e.target.value;
            if (val) editor.chain().focus().setFontFamily(val).run();
            else editor.chain().focus().unsetFontFamily().run();
          }}
          className="text-xs border border-slate-200 rounded px-2 py-1 bg-white text-slate-800 max-w-[165px] focus:outline-none focus:border-blue-600"
        >
          <option value="">Default Font</option>
          {FONT_OPTIONS.map((f) => (
            <option key={f.label} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>

        <select
          value={editor.getAttributes('textStyle').fontSize || ''}
          onChange={(e) => {
            const val = e.target.value;
            if (val) editor.chain().focus().setFontSize(val).run();
            else editor.chain().focus().unsetFontSize().run();
          }}
          className="text-xs border border-slate-200 rounded px-2 py-1 bg-white text-slate-800 w-18 focus:outline-none focus:border-blue-600"
        >
          <option value="">Size</option>
          {['9pt', '10pt', '11pt', '12pt', '14pt', '16pt', '18pt', '22pt', '26pt'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <div className="w-px h-5 bg-slate-200 mx-1" />

        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`p-1.5 rounded ${editor.isActive('bold') ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
          title="Bold"
        >
          <Bold className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`p-1.5 rounded ${editor.isActive('italic') ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
          title="Italic"
        >
          <Italic className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          className={`p-1.5 rounded ${editor.isActive('underline') ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
          title="Underline"
        >
          <UnderlineIcon className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleSubscript().run()}
          className={`p-1.5 rounded ${editor.isActive('subscript') ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
          title="Subscript"
        >
          <SubscriptIcon className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleSuperscript().run()}
          className={`p-1.5 rounded ${editor.isActive('superscript') ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
          title="Superscript / Footnote"
        >
          <SuperscriptIcon className="w-4 h-4" />
        </button>

        <label className="inline-flex items-center gap-1 px-1.5 py-1 rounded hover:bg-slate-100 cursor-pointer text-xs text-slate-700" title="Text Color">
          <span className="font-semibold underline decoration-2">A</span>
          <input
            type="color"
            value={editor.getAttributes('textStyle').color || '#0f172a'}
            onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
            className="w-4 h-4 border-0 p-0 bg-transparent cursor-pointer"
          />
        </label>

        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHighlight({ color: '#fef08a' }).run()}
          className={`p-1.5 rounded ${editor.isActive('highlight') ? 'bg-amber-200 text-slate-900' : 'text-slate-700 hover:bg-slate-100'}`}
          title="Highlight"
        >
          <Highlighter className="w-4 h-4" />
        </button>

        <div className="w-px h-5 bg-slate-200 mx-1" />

        <button
          type="button"
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
          className={`p-1.5 rounded ${editor.isActive({ textAlign: 'left' }) ? 'bg-slate-200 text-slate-900' : 'text-slate-700 hover:bg-slate-100'}`}
          title="Align Left"
        >
          <AlignLeft className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
          className={`p-1.5 rounded ${editor.isActive({ textAlign: 'center' }) ? 'bg-slate-200 text-slate-900' : 'text-slate-700 hover:bg-slate-100'}`}
          title="Align Center"
        >
          <AlignCenter className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
          className={`p-1.5 rounded ${editor.isActive({ textAlign: 'right' }) ? 'bg-slate-200 text-slate-900' : 'text-slate-700 hover:bg-slate-100'}`}
          title="Align Right"
        >
          <AlignRight className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().setTextAlign('justify').run()}
          className={`p-1.5 rounded ${editor.isActive({ textAlign: 'justify' }) ? 'bg-slate-200 text-slate-900' : 'text-slate-700 hover:bg-slate-100'}`}
          title="Justify"
        >
          <AlignJustify className="w-4 h-4" />
        </button>

        <div className="w-px h-5 bg-slate-200 mx-1" />

        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={`p-1.5 rounded ${editor.isActive('bulletList') ? 'bg-slate-200 text-slate-900' : 'text-slate-700 hover:bg-slate-100'}`}
          title="Bulleted List"
        >
          <List className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={`p-1.5 rounded ${editor.isActive('orderedList') ? 'bg-slate-200 text-slate-900' : 'text-slate-700 hover:bg-slate-100'}`}
          title="Numbered List"
        >
          <ListOrdered className="w-4 h-4" />
        </button>

        <div className="w-px h-5 bg-slate-200 mx-1" />

        <button
          type="button"
          onClick={() =>
            editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
          }
          className="p-1.5 rounded text-slate-700 hover:bg-slate-100"
          title="Insert Table"
        >
          <TableIcon className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => imageInputRef.current?.click()}
          className="p-1.5 rounded text-slate-700 hover:bg-slate-100"
          title="Insert Image"
        >
          <ImagePlus className="w-4 h-4" />
        </button>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={handleInsertImageFile}
        />
        <button
          type="button"
          onClick={() =>
            editor.chain().focus().setImage({ src: '/images/org_seal_emblem.jpg', alt: 'Institutional Seal' }).run()
          }
          className="p-1.5 rounded text-slate-700 hover:bg-slate-100"
          title="Insert Institutional Seal"
        >
          <Shield className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => setShowLinkInput((v) => !v)}
          className={`p-1.5 rounded ${editor.isActive('link') ? 'bg-slate-200 text-slate-900' : 'text-slate-700 hover:bg-slate-100'}`}
          title="Insert Hyperlink"
        >
          <Link2 className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={handleInsertPageBreak}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded whitespace-nowrap shrink-0"
          title="Insert Page Break"
        >
          <SeparatorHorizontal className="w-3.5 h-3.5" />
          Break
        </button>
        <button
          type="button"
          onClick={handleInsertFootnote}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded whitespace-nowrap shrink-0"
          title="Insert Footnote Marker"
        >
          <FilePlus2 className="w-3.5 h-3.5" />
          Note
        </button>

        <div className="w-px h-5 bg-slate-200 mx-1" />

        <button
          type="button"
          onClick={() => setShowFindReplace((v) => !v)}
          className={`p-1.5 rounded ${showFindReplace ? 'bg-slate-200 text-slate-900' : 'text-slate-700 hover:bg-slate-100'}`}
          title={t.findAndReplace}
        >
          <Search className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => setSpellCheck((v) => !v)}
          className={`p-1.5 rounded ${spellCheck ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-100'}`}
          title="Toggle Spell Check"
        >
          <SpellCheck className="w-4 h-4" />
        </button>

        {hasEmbeddedScan && (
          <button
            type="button"
            onClick={handleRunOcr}
            disabled={ocrLoading}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            <ScanText className="w-3.5 h-3.5" />
            {ocrLoading ? t.ocrProcessing : t.ocrExtract}
          </button>
        )}
      </div>

      {showLinkInput && (
        <div className="bg-slate-50 border-b border-slate-200 px-4 py-2 flex items-center gap-2 text-xs">
          <span className="font-medium text-slate-700">URL:</span>
          <input
            type="url"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://example.org"
            className="flex-1 max-w-sm border border-slate-300 rounded px-2.5 py-1 bg-white text-slate-900 focus:outline-none focus:border-blue-600"
          />
          <button
            type="button"
            onClick={handleApplyLink}
            className="px-3 py-1 bg-slate-900 text-white rounded font-medium hover:bg-slate-800"
          >
            Apply
          </button>
          <button
            type="button"
            onClick={() => setShowLinkInput(false)}
            className="p-1 text-slate-500 hover:text-slate-800"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {showFindReplace && (
        <div className="bg-slate-50 border-b border-slate-200 px-4 py-2 flex flex-wrap items-center gap-2 text-xs">
          <Replace className="w-3.5 h-3.5 text-slate-500" />
          <input
            type="text"
            value={findText}
            onChange={(e) => setFindText(e.target.value)}
            placeholder={t.findLabel}
            className="border border-slate-300 rounded px-2.5 py-1 bg-white text-slate-900 focus:outline-none focus:border-blue-600"
          />
          <input
            type="text"
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            placeholder={t.replaceLabel}
            className="border border-slate-300 rounded px-2.5 py-1 bg-white text-slate-900 focus:outline-none focus:border-blue-600"
          />
          <button
            type="button"
            onClick={handleReplaceAll}
            className="px-3 py-1 bg-slate-900 text-white rounded font-medium hover:bg-slate-800"
          >
            {t.replaceAllBtn}
          </button>
          <button
            type="button"
            onClick={() => setShowFindReplace(false)}
            className="ml-auto p-1 text-slate-500 hover:text-slate-800"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {ocrNotice && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-xs text-amber-800 flex items-center justify-between gap-2">
          <span>{ocrNotice}</span>
          <button type="button" onClick={() => setOcrNotice(null)} className="text-amber-600 hover:text-amber-900 shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {ocrError && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2 text-xs text-red-700 flex items-center justify-between gap-2">
          <span>{ocrError}</span>
          <button type="button" onClick={() => setOcrError(null)} className="text-red-500 hover:text-red-800 shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="flex-1 overflow-auto bg-slate-100 p-6 lg:p-10 flex justify-center">
        <div
          style={{
            width: `${widthPx}px`,
            minHeight: `${heightPx}px`,
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
          className="shadow-sm relative shrink-0 flex flex-col justify-between box-border"
        >
          {project.headerFooterConfig.headerEnabled && (
            <div className="flex items-center justify-between text-[11px] text-slate-400 border-b border-slate-100 pb-2 mb-4 select-none">
              <div className="flex items-center gap-2">
                {project.headerFooterConfig.logoUrl && (
                  <img
                    src={project.headerFooterConfig.logoUrl}
                    alt="Seal"
                    referrerPolicy="no-referrer"
                    className="w-4 h-4 object-contain"
                  />
                )}
                <span>
                  {project.headerFooterConfig.headerLeft
                    .replace(/\{org\}/gi, project.headerFooterConfig.organizationName)
                    .replace(/\{title\}/gi, documentItem.title)}
                </span>
              </div>
              <span>
                {documentItem.sectionHeaderOverride ||
                  project.headerFooterConfig.headerRight
                    .replace(/\{org\}/gi, project.headerFooterConfig.organizationName)
                    .replace(/\{title\}/gi, documentItem.title)}
              </span>
            </div>
          )}

          <div
            className="flex-1 text-slate-900"
            spellCheck={spellCheck}
            style={{
              textIndent: project.pageSetup.firstLineIndentMm
                ? `${mmToPx(project.pageSetup.firstLineIndentMm)}px`
                : undefined,
            }}
          >
            <EditorContent editor={editor} />
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-100 pt-2 mt-6 select-none tabular-nums">
            <span>
              {project.headerFooterConfig.footerLeft
                .replace(/\{org\}/gi, project.headerFooterConfig.organizationName)
                .replace(/\{title\}/gi, documentItem.title)}
            </span>
            <span>{documentItem.title}</span>
            <span style={{ fontFamily: project.numberingConfig.fontFamily }}>
              {project.numberingConfig.enabled
                ? compiledPageLabel ||
                  (project.numberingConfig.displayPattern === 'page-x-of-y'
                    ? language === 'km' ||
                      project.numberingConfig.format === 'km' ||
                      project.numberingConfig.format === 'km-alpha'
                      ? `ទំព័រ ${formatNumberValue(project.numberingConfig.startPage || 1, project.numberingConfig.format)} នៃ ...`
                      : `Page ${formatNumberValue(project.numberingConfig.startPage || 1, project.numberingConfig.format)} of ...`
                    : formatNumberValue(project.numberingConfig.startPage || 1, project.numberingConfig.format))
                : ''}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
