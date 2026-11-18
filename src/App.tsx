import React, { useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, signOutUser, testFirestoreConnection } from '@/lib/firebase';
import {
  ensureUserProfile,
  subscribeProjects,
  updateUserLanguage,
} from '@/lib/firestore-service';
import { Language, Project } from '@/types/document';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AuthGate } from '@/components/AuthGate';
import { Dashboard } from '@/components/Dashboard';
import { DocumentEditorWorkspace } from '@/components/DocumentEditorWorkspace';

function DocumentMasterApp() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [language, setLanguage] = useState<Language>('en');
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadedForUid, setLoadedForUid] = useState<string | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  useEffect(() => {
    testFirestoreConnection();
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setAuthReady(true);
      if (firebaseUser) {
        try {
          const profile = await ensureUserProfile(firebaseUser, 'en');
          if (profile.preferredLanguage === 'km' || profile.preferredLanguage === 'en') {
            setLanguage(profile.preferredLanguage);
          }
        } catch (err) {
          console.error('Profile sync error:', err);
        }
      } else {
        setProjects([]);
        setLoadedForUid(null);
        setActiveProjectId(null);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authReady || !user) {
      return;
    }
    const uid = user.uid;
    const unsub = subscribeProjects(
      uid,
      (list) => {
        setProjects(list);
        setLoadedForUid(uid);
      },
      (err) => {
        console.error('Projects subscription error:', err);
        setLoadedForUid(uid);
      }
    );
    return () => unsub();
  }, [authReady, user]);

  const projectsLoading = Boolean(authReady && user && loadedForUid !== user.uid);

  const handleChangeLanguage = async (nextLang: Language) => {
    setLanguage(nextLang);
    if (user) {
      try {
        await updateUserLanguage(user.uid, nextLang);
      } catch (err) {
        console.error('Language preference save error:', err);
      }
    }
  };

  if (!authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-sm text-slate-500">
        Initializing Document Master...
      </div>
    );
  }

  if (!user) {
    return <AuthGate language={language} onChangeLanguage={handleChangeLanguage} />;
  }

  if (activeProjectId) {
    return (
      <DocumentEditorWorkspace
        user={user}
        projectId={activeProjectId}
        language={language}
        onChangeLanguage={handleChangeLanguage}
        onBackToDashboard={() => setActiveProjectId(null)}
      />
    );
  }

  return (
    <Dashboard
      user={user}
      projects={projects}
      loading={projectsLoading}
      language={language}
      onChangeLanguage={handleChangeLanguage}
      onOpenProject={(id) => setActiveProjectId(id)}
      onSignOut={() => signOutUser()}
    />
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <DocumentMasterApp />
    </ErrorBoundary>
  );
}
