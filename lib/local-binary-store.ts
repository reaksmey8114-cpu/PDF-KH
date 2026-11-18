const DB_NAME = 'document_master_binaries';
const STORE_NAME = 'files';
const DB_VERSION = 1;

export interface StoredBinaryRecord {
  docId: string;
  mimeType: string;
  fileName: string;
  bytes?: ArrayBuffer;
  thumbnailDataUrl?: string;
  pageDataUrls?: string[];
  originalPageDataUrls?: string[];
  cleanedPageNumbers?: number[];
  originalImageDataUrl?: string;
  pageSizesPt?: Array<{ widthPt: number; heightPt: number }>;
  sourceBinaryDocId?: string;
}

const memoryBinaryStore = new Map<string, StoredBinaryRecord>();

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB not available'));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'docId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putInIdb(db: IDBDatabase, record: StoredBinaryRecord): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

async function getFromIdb(docId: string): Promise<StoredBinaryRecord | null> {
  try {
    const db = await openDatabase();
    return await new Promise<StoredBinaryRecord | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(docId);
      req.onsuccess = () => resolve((req.result as StoredBinaryRecord) || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function saveBinaryRecord(record: StoredBinaryRecord): Promise<void> {
  memoryBinaryStore.set(record.docId, record);

  try {
    const db = await openDatabase();
    try {
      await putInIdb(db, record);
    } catch (primaryErr) {
      // If storing rendered pageDataUrls alongside raw PDF bytes exceeds IndexedDB quota,
      // persist the raw bytes + metadata (keeping cleaned pages only if no raw bytes exist).
      if (record.bytes && record.pageDataUrls && record.pageDataUrls.length > 0) {
        const compactRecord: StoredBinaryRecord = {
          docId: record.docId,
          mimeType: record.mimeType,
          fileName: record.fileName,
          bytes: record.bytes,
          thumbnailDataUrl: record.thumbnailDataUrl,
          cleanedPageNumbers: record.cleanedPageNumbers,
          originalImageDataUrl: record.originalImageDataUrl,
          pageSizesPt: record.pageSizesPt,
          sourceBinaryDocId: record.sourceBinaryDocId,
        };
        await putInIdb(db, compactRecord);
      } else {
        throw primaryErr;
      }
    }
  } catch (err) {
    console.warn('Could not persist binary to IndexedDB (using in-memory session cache):', err);
  }
}

export async function getBinaryRecord(docId: string): Promise<StoredBinaryRecord | null> {
  const mem = memoryBinaryStore.get(docId) || null;
  const record = mem || (await getFromIdb(docId));
  if (!record) return null;

  if (!mem) {
    memoryBinaryStore.set(docId, record);
  }

  if (record.sourceBinaryDocId && record.sourceBinaryDocId !== docId) {
    const parent =
      memoryBinaryStore.get(record.sourceBinaryDocId) ||
      (await getFromIdb(record.sourceBinaryDocId));
    if (parent) {
      return {
        ...parent,
        ...record,
        bytes: record.bytes || parent.bytes,
        pageDataUrls: record.pageDataUrls || parent.pageDataUrls,
        originalPageDataUrls: record.originalPageDataUrls || parent.originalPageDataUrls,
        cleanedPageNumbers: record.cleanedPageNumbers || parent.cleanedPageNumbers,
        originalImageDataUrl: record.originalImageDataUrl || parent.originalImageDataUrl,
        pageSizesPt: record.pageSizesPt || parent.pageSizesPt,
        thumbnailDataUrl: record.thumbnailDataUrl || parent.thumbnailDataUrl,
      };
    }
  }

  return record;
}
