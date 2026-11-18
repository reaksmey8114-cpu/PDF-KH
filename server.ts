import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '25mb' }));

interface GeminiErrorLike {
  status?: number;
  message?: string;
}

function parseGeminiApiError(error: unknown): { httpStatus: number; clientMessage: string; isTransient: boolean } {
  const errObj = (error && typeof error === 'object' ? error : {}) as GeminiErrorLike;
  const rawMessage = error instanceof Error ? error.message : String(error || 'OCR processing failed');
  let code = typeof errObj.status === 'number' ? errObj.status : 500;
  let apiStatus = '';
  let innerMessage = rawMessage;

  const jsonStart = rawMessage.indexOf('{');
  if (jsonStart !== -1) {
    try {
      const parsed = JSON.parse(rawMessage.slice(jsonStart)) as {
        error?: { code?: number; message?: string; status?: string };
      };
      if (parsed?.error) {
        if (typeof parsed.error.code === 'number') code = parsed.error.code;
        if (parsed.error.status) apiStatus = parsed.error.status;
        if (parsed.error.message) innerMessage = parsed.error.message;
      }
    } catch {
      // Fallback to raw message inspection below
    }
  }

  const upper = `${apiStatus} ${innerMessage}`.toUpperCase();

  if (code === 403 || upper.includes('PERMISSION_DENIED') || upper.includes('BILLING') || upper.includes('FREE TIER IS NOT AVAILABLE')) {
    return {
      httpStatus: 403,
      clientMessage:
        'Gemini OCR is unavailable for the current API project (free tier disabled or permission denied). Please select a billing-enabled API key in Settings > Secrets.',
      isTransient: false,
    };
  }

  if (code === 400 || upper.includes('API_KEY_INVALID') || upper.includes('API KEY NOT VALID')) {
    return {
      httpStatus: 400,
      clientMessage: 'The configured Gemini API key is invalid. Please check your API key in Settings > Secrets.',
      isTransient: false,
    };
  }

  if (code === 429 || upper.includes('RESOURCE_EXHAUSTED')) {
    return {
      httpStatus: 429,
      clientMessage:
        'Gemini OCR rate limit or quota exceeded. Please wait a moment and try again, or select a billing-enabled API key in Settings > Secrets.',
      isTransient: true,
    };
  }

  if (code === 503 || code === 504 || upper.includes('UNAVAILABLE') || upper.includes('DEADLINE_EXCEEDED')) {
    return {
      httpStatus: 503,
      clientMessage: 'Gemini OCR service is temporarily unavailable. Please try again in a few seconds.',
      isTransient: true,
    };
  }

  return {
    httpStatus: code >= 400 && code < 600 ? code : 500,
    clientMessage: innerMessage || 'OCR processing failed.',
    isTransient: false,
  };
}

async function generateOcrWithRetry(
  ai: GoogleGenAI,
  mimeType: string,
  base64Data: string,
  maxAttempts = 3
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64Data,
              },
            },
            {
              text: [
                'Perform high-accuracy OCR on this scanned document image.',
                'Support both Khmer Unicode (preserving exact subjoined consonants, vowel signs, and Khmer punctuation ។ ៕) and English/Latin text.',
                'Preserve document structure using clean semantic HTML tags only: <h1>, <h2>, <h3>, <p>, <ul>, <ol>, <li>, <table>, <thead>, <tbody>, <tr>, <th>, <td>, <strong>, <em>.',
                'Return ONLY raw HTML without markdown code fences or extra commentary.',
              ].join(' '),
            },
          ],
        },
      });
    } catch (error) {
      lastError = error;
      const parsed = parseGeminiApiError(error);
      if (!parsed.isTransient || attempt === maxAttempts) {
        throw error;
      }
      const delayMs = 600 * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

app.post('/api/ocr', async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: 'GEMINI_API_KEY is not configured. Please check Settings > Secrets.' });
      return;
    }

    const body = req.body as { mimeType?: string; base64Data?: string };
    if (!body?.mimeType || !body?.base64Data) {
      res.status(400).json({ error: 'Missing mimeType or base64Data' });
      return;
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const response = await generateOcrWithRetry(ai, body.mimeType, body.base64Data);

    const raw = (response.text || '').trim();
    const cleaned = raw
      .replace(/^```html\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    res.json({
      html: cleaned || '<p>No readable text detected.</p>',
    });
  } catch (error) {
    const parsed = parseGeminiApiError(error);
    if (parsed.httpStatus >= 500) {
      console.error('OCR route error:', parsed.clientMessage);
    } else {
      console.warn(`OCR route returned ${parsed.httpStatus}: ${parsed.clientMessage}`);
    }
    res.status(parsed.httpStatus).json({
      error: parsed.clientMessage,
    });
  }
});

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Document Master server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
