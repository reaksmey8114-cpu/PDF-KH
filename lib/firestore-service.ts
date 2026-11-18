import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  Unsubscribe,
} from 'firebase/firestore';
import { User } from 'firebase/auth';
import { db, handleFirestoreError, OperationType } from '@/lib/firebase';
import { getBinaryRecord, saveBinaryRecord } from '@/lib/local-binary-store';
import {
  Language,
  NumberingConfig,
  PageNumberOverride,
  Project,
  ProjectDocument,
  ProjectVersion,
  UserProfile,
} from '@/types/document';

export function generateSafeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${rand}`.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 120);
}

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();

function clampString(value: string | undefined, maxBytes: number, fallback = ''): string {
  const str = (value ?? '').toString();
  const raw = str.length > 0 ? str : fallback;
  if (raw.length * 3 <= maxBytes) return raw;
  const encoded = utf8Encoder.encode(raw);
  if (encoded.byteLength <= maxBytes) return raw;
  return utf8Decoder.decode(encoded.slice(0, maxBytes)).replace(/\uFFFD+$/g, '');
}

function sanitizeNumberingConfig(cfg: NumberingConfig): NumberingConfig {
  const cleanOverrides: Record<string, PageNumberOverride> = {};
  if (cfg.pageOverrides && typeof cfg.pageOverrides === 'object') {
    for (const [k, ov] of Object.entries(cfg.pageOverrides)) {
      if (!ov || typeof ov !== 'object') continue;
      if (!/^\d{1,4}$/.test(k)) continue;
      const entry: PageNumberOverride = {};
      if (ov.position) entry.position = ov.position;
      if (typeof ov.offsetXPx === 'number' && Number.isFinite(ov.offsetXPx) && ov.offsetXPx !== 0) {
        entry.offsetXPx = Math.max(-1200, Math.min(1200, Math.round(ov.offsetXPx)));
      }
      if (typeof ov.offsetYPx === 'number' && Number.isFinite(ov.offsetYPx) && ov.offsetYPx !== 0) {
        entry.offsetYPx = Math.max(-1600, Math.min(1600, Math.round(ov.offsetYPx)));
      }
      if (ov.hidden) entry.hidden = true;
      if (typeof ov.prefixText === 'string') entry.prefixText = clampString(ov.prefixText, 120, '');
      if (typeof ov.suffixText === 'string') entry.suffixText = clampString(ov.suffixText, 120, '');
      if (Object.keys(entry).length > 0) {
        cleanOverrides[k] = entry;
      }
    }
  }
  return {
    ...cfg,
    prefixText: clampString(cfg.prefixText, 120, ''),
    suffixText: clampString(cfg.suffixText, 120, ''),
    pageOverrides: cleanOverrides,
  };
}

export async function ensureUserProfile(user: User, preferredLanguage: Language = 'en'): Promise<UserProfile> {
  const path = `users/${user.uid}`;
  const userRef = doc(db, 'users', user.uid);
  try {
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      return snap.data() as UserProfile;
    }
    const profilePayload: Record<string, unknown> = {
      uid: user.uid,
      displayName: clampString(user.displayName || user.email?.split('@')[0] || 'User', 120, 'User'),
      email: clampString(user.email || 'user@example.com', 160, 'user@example.com'),
      preferredLanguage,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (user.photoURL) {
      profilePayload.photoURL = clampString(user.photoURL, 500);
    }
    await setDoc(userRef, profilePayload);
    return {
      uid: user.uid,
      displayName: profilePayload.displayName as string,
      email: profilePayload.email as string,
      photoURL: profilePayload.photoURL as string | undefined,
      preferredLanguage,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function updateUserLanguage(uid: string, preferredLanguage: Language): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      preferredLanguage,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export function subscribeProjects(
  ownerId: string,
  onData: (projects: Project[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'projects';
  const q = query(
    collection(db, 'projects'),
    where('ownerId', '==', ownerId),
    orderBy('updatedAt', 'desc')
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const items: Project[] = snapshot.docs.map((d) => d.data() as Project);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (e) {
        if (onError && e instanceof Error) onError(e);
      }
    }
  );
}

export function subscribeProject(
  projectId: string,
  onData: (project: Project | null) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = `projects/${projectId}`;
  return onSnapshot(
    doc(db, 'projects', projectId),
    (snap) => {
      onData(snap.exists() ? (snap.data() as Project) : null);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (e) {
        if (onError && e instanceof Error) onError(e);
      }
    }
  );
}

export function subscribeProjectDocuments(
  projectId: string,
  ownerId: string,
  onData: (docs: ProjectDocument[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = `projects/${projectId}/documents`;
  const q = query(
    collection(db, 'projects', projectId, 'documents'),
    where('ownerId', '==', ownerId),
    orderBy('order', 'asc')
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const items: ProjectDocument[] = snapshot.docs.map((d) => d.data() as ProjectDocument);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (e) {
        if (onError && e instanceof Error) onError(e);
      }
    }
  );
}

export function subscribeProjectVersions(
  projectId: string,
  ownerId: string,
  onData: (versions: ProjectVersion[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = `projects/${projectId}/versions`;
  const q = query(
    collection(db, 'projects', projectId, 'versions'),
    where('ownerId', '==', ownerId),
    orderBy('createdAt', 'desc')
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const items: ProjectVersion[] = snapshot.docs.map((d) => d.data() as ProjectVersion);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (e) {
        if (onError && e instanceof Error) onError(e);
      }
    }
  );
}

export async function createProjectWithDocuments(
  projectInput: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>,
  initialDocs: Array<Omit<ProjectDocument, 'id' | 'projectId' | 'ownerId' | 'createdAt' | 'updatedAt'>>
): Promise<{ projectId: string; docIds: string[] }> {
  const projectId = generateSafeId('proj');
  const projectPath = `projects/${projectId}`;
  try {
    const projectPayload: Record<string, unknown> = {
      id: projectId,
      ownerId: projectInput.ownerId,
      title: clampString(projectInput.title, 200, 'Untitled Project'),
      folder: clampString(projectInput.folder, 100, 'General'),
      status: projectInput.status || 'draft',
      pageSetup: projectInput.pageSetup,
      numberingConfig: sanitizeNumberingConfig(projectInput.numberingConfig),
      headerFooterConfig: projectInput.headerFooterConfig,
      tocConfig: projectInput.tocConfig,
      watermarkConfig: projectInput.watermarkConfig,
      documentCount: initialDocs.length,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (projectInput.description) {
      projectPayload.description = clampString(projectInput.description, 1000);
    }

    await setDoc(doc(db, 'projects', projectId), projectPayload);

    const docIds: string[] = [];
    for (let i = 0; i < initialDocs.length; i++) {
      const d = initialDocs[i];
      const docId = generateSafeId('doc');
      docIds.push(docId);
      await setDoc(doc(db, 'projects', projectId, 'documents', docId), {
        id: docId,
        projectId,
        ownerId: projectInput.ownerId,
        title: clampString(d.title, 200, `Document ${i + 1}`),
        sourceType: d.sourceType,
        order: Math.min(10000, Math.max(0, Math.round(d.order ?? i))),
        selected: Boolean(d.selected),
        contentHtml: clampString(d.contentHtml, 650000, '<p></p>'),
        plainText: clampString(d.plainText, 200000, ''),
        pageCountEstimate: Math.min(5000, Math.max(1, Math.round(d.pageCountEstimate || 1))),
        sectionRestartNumbering: Boolean(d.sectionRestartNumbering),
        comments: (d.comments || []).slice(0, 50),
        bookmarks: (d.bookmarks || []).slice(0, 50),
        signatureText: clampString(d.signatureText, 200, ''),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    return { projectId, docIds };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, projectPath);
  }
}

export async function updateProjectFields(
  projectId: string,
  updates: Partial<
    Pick<
      Project,
      | 'title'
      | 'description'
      | 'folder'
      | 'status'
      | 'pageSetup'
      | 'numberingConfig'
      | 'headerFooterConfig'
      | 'tocConfig'
      | 'watermarkConfig'
      | 'documentCount'
    >
  >
): Promise<void> {
  const path = `projects/${projectId}`;
  try {
    const clean: Record<string, unknown> = { ...updates, updatedAt: serverTimestamp() };
    if (typeof updates.title === 'string') {
      clean.title = clampString(updates.title, 200, 'Untitled Project');
    }
    if (typeof updates.description === 'string') {
      clean.description = clampString(updates.description, 1000);
    }
    if (typeof updates.folder === 'string') {
      clean.folder = clampString(updates.folder, 100, 'General');
    }
    if (updates.numberingConfig) {
      clean.numberingConfig = sanitizeNumberingConfig(updates.numberingConfig);
    }
    await updateDoc(doc(db, 'projects', projectId), clean);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function duplicateProject(project: Project): Promise<string> {
  const path = `projects/${project.id}/documents`;
  try {
    const docsSnap = await getDocs(
      query(
        collection(db, 'projects', project.id, 'documents'),
        where('ownerId', '==', project.ownerId),
        orderBy('order', 'asc')
      )
    );
    const sourceDocs = docsSnap.docs.map((d) => d.data() as ProjectDocument);
    const { projectId, docIds } = await createProjectWithDocuments(
      {
        ownerId: project.ownerId,
        title: clampString(`${project.title} (Copy)`, 200),
        description: project.description,
        folder: project.folder,
        status: 'draft',
        pageSetup: project.pageSetup,
        numberingConfig: project.numberingConfig,
        headerFooterConfig: project.headerFooterConfig,
        tocConfig: project.tocConfig,
        watermarkConfig: project.watermarkConfig,
        documentCount: sourceDocs.length,
      },
      sourceDocs.map((sd, idx) => ({
        title: sd.title,
        sourceType: sd.sourceType,
        order: idx,
        selected: sd.selected,
        contentHtml: sd.contentHtml,
        plainText: sd.plainText,
        pageCountEstimate: sd.pageCountEstimate,
        sectionRestartNumbering: sd.sectionRestartNumbering,
        sectionHeaderOverride: sd.sectionHeaderOverride,
        sectionFooterOverride: sd.sectionFooterOverride,
        comments: sd.comments,
        bookmarks: sd.bookmarks,
        signatureText: sd.signatureText,
      }))
    );

    const oldToNewDocId = new Map<string, string>();
    sourceDocs.forEach((sd, idx) => {
      if (docIds[idx]) {
        oldToNewDocId.set(sd.id, docIds[idx]);
      }
    });

    for (let idx = 0; idx < sourceDocs.length; idx++) {
      const oldId = sourceDocs[idx].id;
      const newId = docIds[idx];
      if (!newId) continue;
      try {
        const bin = await getBinaryRecord(oldId);
        if (!bin) continue;
        const mappedParentId =
          bin.sourceBinaryDocId && oldToNewDocId.has(bin.sourceBinaryDocId)
            ? oldToNewDocId.get(bin.sourceBinaryDocId)
            : undefined;
        if (mappedParentId && mappedParentId !== newId) {
          await saveBinaryRecord({
            docId: newId,
            mimeType: bin.mimeType,
            fileName: bin.fileName,
            pageSizesPt: bin.pageSizesPt,
            sourceBinaryDocId: mappedParentId,
          });
        } else {
          await saveBinaryRecord({
            ...bin,
            docId: newId,
            sourceBinaryDocId: undefined,
          });
        }
      } catch {
        // Non-fatal: continue copying remaining binary records
      }
    }

    return projectId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteProjectRecursive(projectId: string, ownerId: string): Promise<void> {
  const path = `projects/${projectId}`;
  try {
    const docsSnap = await getDocs(
      query(collection(db, 'projects', projectId, 'documents'), where('ownerId', '==', ownerId))
    );
    const versSnap = await getDocs(
      query(collection(db, 'projects', projectId, 'versions'), where('ownerId', '==', ownerId))
    );
    const batch = writeBatch(db);
    docsSnap.docs.forEach((d) => batch.delete(d.ref));
    versSnap.docs.forEach((v) => batch.delete(v.ref));
    batch.delete(doc(db, 'projects', projectId));
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function addProjectDocument(
  projectId: string,
  ownerId: string,
  docInput: Omit<ProjectDocument, 'id' | 'projectId' | 'ownerId' | 'createdAt' | 'updatedAt'>,
  newDocumentCount?: number,
  explicitDocId?: string
): Promise<string> {
  const docId = explicitDocId || generateSafeId('doc');
  const path = `projects/${projectId}/documents/${docId}`;
  try {
    const payload: Record<string, unknown> = {
      id: docId,
      projectId,
      ownerId,
      title: clampString(docInput.title, 200, 'Untitled Section'),
      sourceType: docInput.sourceType,
      order: Math.min(10000, Math.max(0, Math.round(docInput.order))),
      selected: Boolean(docInput.selected),
      contentHtml: clampString(docInput.contentHtml, 650000, '<p></p>'),
      plainText: clampString(docInput.plainText, 200000, ''),
      pageCountEstimate: Math.min(5000, Math.max(1, Math.round(docInput.pageCountEstimate || 1))),
      sectionRestartNumbering: Boolean(docInput.sectionRestartNumbering),
      comments: (docInput.comments || []).slice(0, 50),
      bookmarks: (docInput.bookmarks || []).slice(0, 50),
      signatureText: clampString(docInput.signatureText, 200, ''),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (typeof docInput.sectionHeaderOverride === 'string') {
      payload.sectionHeaderOverride = clampString(docInput.sectionHeaderOverride, 200);
    }
    if (typeof docInput.sectionFooterOverride === 'string') {
      payload.sectionFooterOverride = clampString(docInput.sectionFooterOverride, 200);
    }
    await setDoc(doc(db, 'projects', projectId, 'documents', docId), payload);
    if (typeof newDocumentCount === 'number') {
      await updateDoc(doc(db, 'projects', projectId), {
        documentCount: Math.max(0, Math.round(newDocumentCount)),
        updatedAt: serverTimestamp(),
      });
    }
    return docId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateProjectDocument(
  projectId: string,
  docId: string,
  updates: Partial<
    Pick<
      ProjectDocument,
      | 'title'
      | 'order'
      | 'selected'
      | 'contentHtml'
      | 'plainText'
      | 'pageCountEstimate'
      | 'sectionRestartNumbering'
      | 'sectionHeaderOverride'
      | 'sectionFooterOverride'
      | 'comments'
      | 'bookmarks'
      | 'signatureText'
    >
  >
): Promise<void> {
  const path = `projects/${projectId}/documents/${docId}`;
  try {
    const clean: Record<string, unknown> = { ...updates, updatedAt: serverTimestamp() };
    if (typeof updates.title === 'string') clean.title = clampString(updates.title, 200, 'Untitled');
    if (typeof updates.contentHtml === 'string') clean.contentHtml = clampString(updates.contentHtml, 650000, '<p></p>');
    if (typeof updates.plainText === 'string') clean.plainText = clampString(updates.plainText, 200000, '');
    if (typeof updates.pageCountEstimate === 'number') {
      clean.pageCountEstimate = Math.min(5000, Math.max(1, Math.round(updates.pageCountEstimate)));
    }
    if (typeof updates.order === 'number') clean.order = Math.min(10000, Math.max(0, Math.round(updates.order)));
    if (typeof updates.sectionHeaderOverride === 'string') {
      clean.sectionHeaderOverride = clampString(updates.sectionHeaderOverride, 200);
    }
    if (typeof updates.sectionFooterOverride === 'string') {
      clean.sectionFooterOverride = clampString(updates.sectionFooterOverride, 200);
    }
    if (typeof updates.signatureText === 'string') {
      clean.signatureText = clampString(updates.signatureText, 200);
    }
    if (Array.isArray(updates.comments)) clean.comments = updates.comments.slice(0, 50);
    if (Array.isArray(updates.bookmarks)) clean.bookmarks = updates.bookmarks.slice(0, 50);

    await updateDoc(doc(db, 'projects', projectId, 'documents', docId), clean);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function reorderProjectDocuments(
  projectId: string,
  orderedDocs: ProjectDocument[]
): Promise<void> {
  const path = `projects/${projectId}/documents`;
  try {
    const batch = writeBatch(db);
    orderedDocs.forEach((d, idx) => {
      batch.update(doc(db, 'projects', projectId, 'documents', d.id), {
        order: idx,
        updatedAt: serverTimestamp(),
      });
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteProjectDocument(
  projectId: string,
  docId: string,
  remainingCount: number
): Promise<void> {
  const path = `projects/${projectId}/documents/${docId}`;
  try {
    await deleteDoc(doc(db, 'projects', projectId, 'documents', docId));
    await updateDoc(doc(db, 'projects', projectId), {
      documentCount: Math.max(0, Math.round(remainingCount)),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function createProjectVersion(
  projectId: string,
  ownerId: string,
  label: string,
  documents: ProjectDocument[]
): Promise<string> {
  const versionId = generateSafeId('ver');
  const path = `projects/${projectId}/versions/${versionId}`;
  try {
    const compactDocs = documents.slice(0, 40).map((d) => ({
      id: d.id,
      title: clampString(d.title, 200),
      sourceType: d.sourceType,
      order: d.order,
      selected: d.selected,
      contentHtml: clampString(d.contentHtml, 15000),
      plainText: clampString(d.plainText, 4000),
    }));
    const summary = clampString(
      `${documents.length} sections (${documents.filter((d) => d.selected).length} selected)`,
      500
    );
    await setDoc(doc(db, 'projects', projectId, 'versions', versionId), {
      id: versionId,
      projectId,
      ownerId,
      label: clampString(label, 160, 'Manual Snapshot'),
      snapshotSummary: summary,
      documentsSnapshot: compactDocs,
      createdAt: serverTimestamp(),
    });
    return versionId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function restoreProjectVersion(
  projectId: string,
  ownerId: string,
  version: ProjectVersion,
  currentDocs: ProjectDocument[]
): Promise<void> {
  const path = `projects/${projectId}/documents`;
  try {
    const batch = writeBatch(db);
    currentDocs.forEach((d) => {
      batch.delete(doc(db, 'projects', projectId, 'documents', d.id));
    });
    version.documentsSnapshot.forEach((snapDoc, idx) => {
      const newDocId = generateSafeId('doc');
      batch.set(doc(db, 'projects', projectId, 'documents', newDocId), {
        id: newDocId,
        projectId,
        ownerId,
        title: clampString(snapDoc.title, 200, `Section ${idx + 1}`),
        sourceType: snapDoc.sourceType || 'editor',
        order: idx,
        selected: Boolean(snapDoc.selected),
        contentHtml: clampString(snapDoc.contentHtml, 650000, '<p></p>'),
        plainText: clampString(snapDoc.plainText, 200000, ''),
        pageCountEstimate: 1,
        sectionRestartNumbering: false,
        comments: [],
        bookmarks: [],
        signatureText: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
    batch.update(doc(db, 'projects', projectId), {
      documentCount: version.documentsSnapshot.length,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}
