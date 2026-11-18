import React, { useState } from 'react';
import { BookOpen, FileText, Globe, Layers, Printer, ShieldCheck } from 'lucide-react';
import { Language } from '@/types/document';
import { getTranslations } from '@/lib/i18n';
import { signInWithGoogle } from '@/lib/firebase';

interface AuthGateProps {
  language: Language;
  onChangeLanguage: (lang: Language) => void;
}

export function AuthGate({ language, onChangeLanguage }: AuthGateProps) {
  const t = getTranslations(language);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="flex items-center justify-between gap-8 px-6 lg:px-10 py-4 bg-white border-b border-slate-200">
        <div className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
          {t.appName}
        </div>
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
          <span className="whitespace-nowrap shrink-0">DOCX · PDF · RTF · TXT</span>
          <span className="whitespace-nowrap shrink-0">{t.khmerLanguageBanner}</span>
          <span className="whitespace-nowrap shrink-0">A4 · A3 · A5 · Letter · Legal</span>
        </nav>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => onChangeLanguage(language === 'en' ? 'km' : 'en')}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            <Globe className="w-3.5 h-3.5" />
            {language === 'en' ? 'ភាសាខ្មែរ' : 'English'}
          </button>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="max-w-5xl w-full grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
          <div className="lg:col-span-7 flex flex-col justify-center">
            <p className="text-xs font-medium text-blue-700 tracking-wide mb-3">
              {t.tagline}
            </p>
            <h1
              className="text-3xl lg:text-4xl font-bold text-slate-900 leading-tight mb-4"
              style={{ textWrap: 'balance' }}
            >
              {t.signInTitle}
            </h1>
            <p className="text-base text-slate-600 leading-relaxed mb-8 max-w-xl">
              {t.signInSubtitle}
            </p>

            <div className="flex flex-wrap items-center gap-4 mb-6">
              <button
                type="button"
                onClick={handleSignIn}
                disabled={loading}
                className="inline-flex items-center gap-3 px-6 py-3 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <ShieldCheck className="w-4 h-4" />
                {loading ? '...' : t.signInGoogle}
              </button>
            </div>

            {error && (
              <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg mb-6 max-w-md">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-6 border-t border-slate-200 text-sm text-slate-700">
              <div className="flex items-start gap-2.5">
                <Layers className="w-4 h-4 text-blue-700 mt-0.5 shrink-0" />
                <div>
                  <div className="font-semibold text-slate-900">Multi-Document Compilation</div>
                  <div className="text-xs text-slate-500">Drag-and-drop reorder, blank pages &amp; section breaks</div>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <BookOpen className="w-4 h-4 text-blue-700 mt-0.5 shrink-0" />
                <div>
                  <div className="font-semibold text-slate-900">Automatic Numbering &amp; TOC</div>
                  <div className="text-xs text-slate-500">1/i/I/A, Page X of Y, cover exclusion, Heading 1–3</div>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <FileText className="w-4 h-4 text-blue-700 mt-0.5 shrink-0" />
                <div>
                  <div className="font-semibold text-slate-900">Khmer Unicode &amp; OCR</div>
                  <div className="text-xs text-slate-500">Khmer OS Siemreap, Battambang, Muol &amp; scanned OCR</div>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <Printer className="w-4 h-4 text-blue-700 mt-0.5 shrink-0" />
                <div>
                  <div className="font-semibold text-slate-900">PDF, DOCX &amp; TXT Export</div>
                  <div className="text-xs text-slate-500">Preserves fonts, margins, borders &amp; headers</div>
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-5 flex items-center justify-center">
            <div className="w-full max-w-sm bg-white border border-slate-200 rounded-xl p-8 shadow-sm">
              <div className="flex items-center justify-between text-[11px] text-slate-400 border-b border-slate-100 pb-3 mb-5">
                <span>ព្រះរាជាណាចក្រកម្ពុជា</span>
                <span className="font-mono tabular-nums">A4 · 210×297 mm</span>
              </div>
              <div className="flex justify-center mb-4">
                <img
                  src="/images/org_seal_emblem.jpg"
                  alt="Institutional Emblem"
                  referrerPolicy="no-referrer"
                  className="w-16 h-16 object-contain rounded"
                />
              </div>
              <div className="text-center mb-6">
                <div className="font-khmer-moul text-sm text-slate-900 mb-1">
                  របាយការណ៍បូកសរុបលទ្ធផលការងារ
                </div>
                <div className="text-xs font-semibold text-slate-600">
                  Compiled Institutional Volume
                </div>
              </div>
              <div className="space-y-2.5 text-xs text-slate-600 border-t border-slate-100 pt-4">
                <div className="flex justify-between">
                  <span className="font-medium text-slate-800">Table of Contents</span>
                  <span className="font-mono tabular-nums text-slate-400">i</span>
                </div>
                <div className="flex justify-between">
                  <span>Chapter 1 · Research Overview</span>
                  <span className="font-mono tabular-nums text-slate-400">1</span>
                </div>
                <div className="flex justify-between">
                  <span>ជំពូកទី ២ · ការវិភាគទិន្នន័យ</span>
                  <span className="font-mono tabular-nums text-slate-400">12</span>
                </div>
                <div className="flex justify-between">
                  <span>Appendix A · Certified Record</span>
                  <span className="font-mono tabular-nums text-slate-400">24</span>
                </div>
              </div>
              <div className="mt-8 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400 font-mono tabular-nums">
                <span>Document Master</span>
                <span>Page 1 of 24</span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
