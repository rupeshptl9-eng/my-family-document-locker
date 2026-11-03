/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  DocumentCategory,
  FamilyMember,
  LockerDocument,
  NotificationItem,
  TextNote,
  UserProfile,
  AutoLockInterval
} from './types';
import {
  getStoredUser,
  saveStoredUser,
  getStoredTheme,
  saveStoredTheme,
  getStoredAutoLockInterval
} from './utils/storage';
import { authService } from './services/authService';
import { documentService } from './services/documentService';
import { familyService } from './services/familyService';
import { notificationService } from './services/notificationService';
import { pinService } from './services/pinService';
import { vaultKeyManager } from './services/vaultKeyManager';
import { encryptedIndexedDBService } from './services/encryptedIndexedDBService';
import { migrationService } from './services/migrationService';
import { storageService } from './services/storageService';
import { AndroidContainer } from './components/AndroidContainer';
import { LoginScreen } from './components/LoginScreen';
import { HomeScreen } from './components/HomeScreen';
import { DocumentsScreen } from './components/DocumentsScreen';
import { FamilyScreen } from './components/FamilyScreen';
import { TextLockerScreen } from './components/TextLockerScreen';
import { AIScreen } from './components/AIScreen';
import { ProfileScreen } from './components/ProfileScreen';
import { BottomNavigation, NavTab } from './components/BottomNavigation';
import { AddBottomSheet } from './components/AddBottomSheet';
import { DocumentViewerModal } from './components/DocumentViewerModal';
import { EditDocumentModal } from './components/EditDocumentModal';
import { ScanModal } from './components/ScanModal';
import { AIScanVerifyModal } from './components/AIScanVerifyModal';
import { NotificationDrawer } from './components/NotificationDrawer';
import { PinLockModal } from './components/PinLockModal';
import { CheckCircle2, ChevronLeft } from 'lucide-react';
import { App as CapApp } from '@capacitor/app';
import { aiRouter } from './services/aiRouter';

export default function App() {
  // Global User State
  const [user, setUser] = useState<UserProfile>(getStoredUser);

  // In-Memory Decrypted Data State (populated only when vault is unlocked)
  const [documents, setDocuments] = useState<LockerDocument[]>([]);
  const [isVaultLoading, setIsVaultLoading] = useState<boolean>(false);
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);
  const [textNotes, setTextNotes] = useState<TextNote[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  // Navigation & Screen View
  const [currentTab, setCurrentTab] = useState<NavTab>('home');
  const [activeSubView, setActiveSubView] = useState<'family' | 'text-locker' | null>(null);

  // Filters
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<DocumentCategory | 'All'>('All');

  // Modals & Bottom Sheets
  const [isAddSheetOpen, setIsAddSheetOpen] = useState(false);
  const [viewingDoc, setViewingDoc] = useState<LockerDocument | null>(null);
  const [editingDoc, setEditingDoc] = useState<LockerDocument | null>(null);
  const [replacingDoc, setReplacingDoc] = useState<LockerDocument | null>(null);

  const [scanModalState, setScanModalState] = useState<{
    isOpen: boolean;
    mode: 'camera' | 'upload' | 'ai-scan';
  }>({ isOpen: false, mode: 'upload' });

  const [aiVerifyState, setAiVerifyState] = useState<{
    isOpen: boolean;
    extractedData: any;
    fileInfo: any;
  }>({ isOpen: false, extractedData: null, fileInfo: null });

  const [isNotifDrawerOpen, setIsNotifDrawerOpen] = useState(false);

  // PIN / App Lock State
  const [isAppLocked, setIsAppLocked] = useState<boolean>(true);
  const [pinModalState, setPinModalState] = useState<{
    isOpen: boolean;
    mode: 'unlock' | 'setup' | 'change';
  }>({ isOpen: false, mode: 'unlock' });

  // Android Toast Banner
  const [welcomeBanner, setWelcomeBanner] = useState<string | null>(null);

  // Theme Management
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const stored = getStoredTheme();
    return stored === 'dark' ? 'dark' : 'light';
  });

  // Sync theme to DOM root
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  // Load vault data into memory once unlocked
  const loadVaultData = useCallback(async (userId: string) => {
    if (!vaultKeyManager.isUnlocked()) return;

    setIsVaultLoading(true);
    try {
      // 1. Run migration if legacy localStorage exists
      if (migrationService.hasLegacyPlaintextData()) {
        const migResult = await migrationService.migrateToEncryptedVault();
        if (migResult.success && migResult.needed) {
          setWelcomeBanner('Legacy documents safely encrypted into your secure vault');
          setTimeout(() => setWelcomeBanner(null), 4000);
        }
      }

      // 2. Load documents (from encrypted IndexedDB + Firestore sync)
      const loadedDocs = await documentService.getDocuments(userId);
      setDocuments(loadedDocs);

      // 3. Load family members
      const loadedFamily = await familyService.getFamilyMembers(userId);
      setFamilyMembers(loadedFamily);

      // 4. Load text notes
      const loadedNotes = await encryptedIndexedDBService.getDecryptedItemsByType<TextNote>('note');
      setTextNotes(loadedNotes);

      // 5. Generate notifications
      const notifs = notificationService.generateExpiryNotifications(loadedDocs);
      setNotifications(notifs);

      // 6. Background sync retry
      documentService.processOfflineSyncQueue(userId).catch(() => {});
    } catch (err) {
      console.warn('Error loading decrypted vault data:', err);
    } finally {
      setIsVaultLoading(false);
    }
  }, []);

  // Auth State Listener
  useEffect(() => {
    const unsubscribe = authService.onAuthStateChanged(async (activeUser) => {
      if (activeUser) {
        setUser(activeUser);
        const hasPin = await pinService.hasPinConfigured();
        if (hasPin) {
          setIsAppLocked(true);
          setPinModalState({ isOpen: true, mode: 'unlock' });
        } else {
          // If no PIN yet, prompt to create PIN
          setIsAppLocked(true);
          setPinModalState({ isOpen: true, mode: 'setup' });
        }
      } else {
        // Logged out
        vaultKeyManager.lockVault();
        setDocuments([]);
        setFamilyMembers([]);
        setTextNotes([]);
        setIsAppLocked(false);
        setPinModalState({ isOpen: false, mode: 'unlock' });
      }
    });
    return () => unsubscribe();
  }, []);

  // Lock vault helper
  const handleLockVault = useCallback(() => {
    vaultKeyManager.lockVault();
    setIsAppLocked(true);
    // Mask sensitive document data in UI
    setDocuments((prev) =>
      prev.map((d) => ({
        ...d,
        documentNumber: d.maskedNumber,
        notes: undefined,
        address: undefined
      }))
    );
    setPinModalState({ isOpen: true, mode: 'unlock' });
  }, []);

  // Inactivity Auto-Lock
  const lastActiveRef = useRef<number>(Date.now());
  const handleUserActivity = useCallback(() => {
    lastActiveRef.current = Date.now();
  }, []);

  useEffect(() => {
    window.addEventListener('pointerdown', handleUserActivity);
    window.addEventListener('keydown', handleUserActivity);

    const checkIntervalMs = 10000;
    const interval = setInterval(() => {
      if (user.isLoggedIn && !isAppLocked) {
        const autoLock = user.autoLockInterval || getStoredAutoLockInterval();
        if (autoLock === 'never') return;

        let thresholdMs = 5 * 60 * 1000;
        if (autoLock === 'immediately') thresholdMs = 15000;
        else if (autoLock === '1m') thresholdMs = 60 * 1000;
        else if (autoLock === '5m') thresholdMs = 5 * 60 * 1000;
        else if (autoLock === '15m') thresholdMs = 15 * 60 * 1000;

        const inactiveMs = Date.now() - lastActiveRef.current;
        if (inactiveMs >= thresholdMs) {
          handleLockVault();
        }
      }
    }, checkIntervalMs);

    // Auto-lock when browser window or Android app goes to background
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && user.isLoggedIn && !isAppLocked) {
        const autoLock = user.autoLockInterval || getStoredAutoLockInterval();
        if (autoLock === 'immediately' || autoLock === '1m') {
          handleLockVault();
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Native Capacitor App state listener
    let capListenerSub: any = null;
    try {
      CapApp.addListener('appStateChange', (state) => {
        if (!state.isActive && user.isLoggedIn && !isAppLocked) {
          const autoLock = user.autoLockInterval || getStoredAutoLockInterval();
          if (autoLock === 'immediately') {
            handleLockVault();
          }
        }
      }).then((sub) => {
        capListenerSub = sub;
      });
    } catch {
      // Ignored
    }

    return () => {
      window.removeEventListener('pointerdown', handleUserActivity);
      window.removeEventListener('keydown', handleUserActivity);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(interval);
      if (capListenerSub?.remove) capListenerSub.remove();
    };
  }, [user, isAppLocked, handleUserActivity, handleLockVault]);

  // Theme toggle
  const handleToggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    saveStoredTheme(next);
    const updatedUser = { ...user, theme: next as 'light' | 'dark' };
    setUser(updatedUser);
    saveStoredUser(updatedUser);
  };

  // Login handler
  const handleLoginSuccess = async (newUser: UserProfile) => {
    setUser(newUser);
    saveStoredUser(newUser);
    setWelcomeBanner('Welcome to My Family Locker');
    setTimeout(() => setWelcomeBanner(null), 3500);

    const hasPin = await pinService.hasPinConfigured();
    if (hasPin) {
      setIsAppLocked(true);
      setPinModalState({ isOpen: true, mode: 'unlock' });
    } else {
      setIsAppLocked(true);
      setPinModalState({ isOpen: true, mode: 'setup' });
    }
  };

  // Logout handler
  const handleLogout = async () => {
    await authService.signOut();
    vaultKeyManager.lockVault();
    setUser(getStoredUser());
    setDocuments([]);
    setFamilyMembers([]);
    setTextNotes([]);
    setIsAppLocked(false);
  };

  // Successful PIN/Biometric unlock
  const handleUnlockSuccess = async () => {
    setIsAppLocked(false);
    setPinModalState({ isOpen: false, mode: 'unlock' });
    if (user.uid) {
      await loadVaultData(user.uid);
    }
    // Fast AI Warmup in background (non-blocking)
    aiRouter.warmup();
  };

  // Reset PIN via Google Account
  const handleResetViaAccount = async () => {
    if (user.authProvider === 'firebase-google') {
      try {
        await authService.signInWithGoogle();
        setPinModalState({ isOpen: true, mode: 'setup' });
      } catch (err: any) {
        alert('Could not verify Google account. Please try again.');
      }
    } else {
      alert('Local vault accounts can change PIN from the settings page.');
    }
  };

  // Document Operations
  const handleSaveDocument = async (newDoc: LockerDocument): Promise<LockerDocument> => {
    const targetUserId = user?.uid || 'local-user';
    const saved = await documentService.saveDocument(targetUserId, newDoc);
    setDocuments((prev) => {
      const idx = prev.findIndex((d) => d.id === saved.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = saved;
        return updated;
      }
      return [saved, ...prev];
    });

    // Refresh notifications for any expiring documents
    setNotifications(notificationService.generateExpiryNotifications([saved, ...documents.filter((d) => d.id !== saved.id)]));
    return saved;
  };

  const handleDeleteDocument = async (docId: string) => {
    const toDelete = documents.find((d) => d.id === docId);
    if (!toDelete) return;

    await documentService.deleteDocument(user.uid, toDelete);
    setDocuments((prev) => prev.filter((d) => d.id !== docId));
  };

  const handleToggleFavorite = async (docId: string) => {
    const target = documents.find((d) => d.id === docId);
    if (!target) return;

    const updated = { ...target, isFavorite: !target.isFavorite };
    await handleSaveDocument(updated);
  };

  const handleDownloadDocument = (doc: LockerDocument) => {
    const a = document.createElement('a');
    a.href = doc.fileUrl;
    a.download = doc.fileName || `${doc.name}.${doc.fileType}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleReplaceDocumentFile = (doc: LockerDocument) => {
    setReplacingDoc(doc);
    setScanModalState({ isOpen: true, mode: 'upload' });
  };

  // Family Operations
  const handleAddFamilyMember = async (member: FamilyMember) => {
    await familyService.saveFamilyMember(user.uid, member);
    setFamilyMembers((prev) => [...prev, member]);
  };

  const handleUpdateFamilyMember = async (member: FamilyMember) => {
    await familyService.saveFamilyMember(user.uid, member);
    setFamilyMembers((prev) => prev.map((m) => (m.id === member.id ? member : m)));
  };

  const handleDeleteFamilyMember = async (memberId: string) => {
    await familyService.deleteFamilyMember(user.uid, memberId);
    setFamilyMembers((prev) => prev.filter((m) => m.id !== memberId));
  };

  // Text Notes Operations
  const handleSaveNote = async (note: TextNote) => {
    await encryptedIndexedDBService.putEncryptedItem(note.id, 'note', note);
    setTextNotes((prev) => {
      const idx = prev.findIndex((n) => n.id === note.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = note;
        return updated;
      }
      return [note, ...prev];
    });
  };

  const handleDeleteNote = async (noteId: string) => {
    await encryptedIndexedDBService.deleteItem(noteId);
    setTextNotes((prev) => prev.filter((n) => n.id !== noteId));
  };

  // Retry Cloud Sync
  const handleRetryPendingSync = async () => {
    if (user.uid) {
      const count = await documentService.processOfflineSyncQueue(user.uid);
      await loadVaultData(user.uid);
      setWelcomeBanner(`Cloud sync completed (${count} updated)`);
      setTimeout(() => setWelcomeBanner(null), 3500);
    }
  };

  // Subview Back Handler
  const handleBackToMain = () => {
    setActiveSubView(null);
  };

  return (
    <AndroidContainer
      theme={theme}
      onToggleTheme={handleToggleTheme}
    >
      {/* Toast Welcome Notification */}
      {welcomeBanner && (
        <div className="fixed top-12 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-2xl bg-slate-900/95 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold shadow-2xl flex items-center gap-2 animate-fadeIn border border-white/20">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 dark:text-emerald-600" />
          <span>{welcomeBanner}</span>
        </div>
      )}

      {/* Main App Content Flow */}
      {!user.isLoggedIn ? (
        <LoginScreen onLoginSuccess={handleLoginSuccess} />
      ) : activeSubView === 'family' ? (
        <div className="flex-1 flex flex-col">
          {/* Subview Header */}
          <div className="px-4 py-3 border-b border-slate-100 dark:border-white/10 flex items-center gap-2">
            <button
              onClick={handleBackToMain}
              className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-white/10 text-slate-700 dark:text-slate-200 cursor-pointer"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              Family Management
            </h2>
          </div>
          <FamilyScreen
            familyMembers={familyMembers}
            documents={documents}
            onAddFamilyMember={handleAddFamilyMember}
            onUpdateFamilyMember={handleUpdateFamilyMember}
            onDeleteFamilyMember={handleDeleteFamilyMember}
            onSelectFamilyMember={(_member) => {
              setActiveSubView(null);
              setCurrentTab('documents');
            }}
          />
        </div>
      ) : activeSubView === 'text-locker' ? (
        <div className="flex-1 flex flex-col">
          {/* Subview Header */}
          <div className="px-4 py-3 border-b border-slate-100 dark:border-white/10 flex items-center gap-2">
            <button
              onClick={handleBackToMain}
              className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-white/10 text-slate-700 dark:text-slate-200 cursor-pointer"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              Secure Text Locker
            </h2>
          </div>
          <TextLockerScreen
            notes={textNotes}
            familyMembers={familyMembers}
            onAddNote={handleSaveNote}
            onUpdateNote={handleSaveNote}
            onDeleteNote={handleDeleteNote}
          />
        </div>
      ) : (
        /* Tab Navigation Views */
        <div className="flex-1 flex flex-col overflow-y-auto">
          {currentTab === 'home' && (
            <HomeScreen
              user={user}
              documents={documents}
              familyMembers={familyMembers}
              textNotes={textNotes}
              unreadNotifsCount={notifications.filter((n) => !n.read).length}
              onNavigateToTab={setCurrentTab}
              onNavigateToSubView={setActiveSubView}
              onSelectCategory={(cat) => {
                setSelectedCategoryFilter(cat);
                setCurrentTab('documents');
              }}
              onQuickAction={(action) => {
                if (action === 'camera' || action === 'ai-scan') {
                  setScanModalState({
                    isOpen: true,
                    mode: action === 'camera' ? 'camera' : 'ai-scan'
                  });
                } else if (action === 'upload') {
                  setScanModalState({ isOpen: true, mode: 'upload' });
                } else if (action === 'text') {
                  setActiveSubView('text-locker');
                }
              }}
              onOpenNotifications={() => setIsNotifDrawerOpen(true)}
              onViewDocument={setViewingDoc}
            />
          )}

          {currentTab === 'documents' && (
            <DocumentsScreen
              documents={documents}
              isLoading={isVaultLoading}
              familyMembers={familyMembers}
              selectedCategoryFilter={selectedCategoryFilter}
              onSelectCategoryFilter={setSelectedCategoryFilter}
              onViewDocument={setViewingDoc}
              onEditDocument={setEditingDoc}
              onDeleteDocument={handleDeleteDocument}
              onDownloadDocument={handleDownloadDocument}
              onToggleFavorite={handleToggleFavorite}
              onReplaceDocument={handleReplaceDocumentFile}
              onAddNewDocument={() => setScanModalState({ isOpen: true, mode: 'upload' })}
            />
          )}

          {currentTab === 'ai' && (
            <AIScreen
              documents={documents}
              familyMembers={familyMembers}
              textNotes={textNotes}
              onViewDocumentById={(docId) => {
                const found = documents.find((d) => d.id === docId);
                if (found) setViewingDoc(found);
              }}
            />
          )}

          {currentTab === 'profile' && (
            <ProfileScreen
              user={user}
              familyMembers={familyMembers}
              documents={documents}
              textNotes={textNotes}
              theme={theme}
              onToggleTheme={handleToggleTheme}
              onNavigateToFamily={() => setActiveSubView('family')}
              onNavigateToTextLocker={() => setActiveSubView('text-locker')}
              onOpenPinSetup={() => setPinModalState({ isOpen: true, mode: 'setup' })}
              onLockVaultNow={handleLockVault}
              onLogout={handleLogout}
              onDataReload={() => user.uid && loadVaultData(user.uid)}
              onRetryPendingSync={handleRetryPendingSync}
            />
          )}
        </div>
      )}

      {/* Floating Bottom Navigation (Only visible when user is logged in and not in subview) */}
      {user.isLoggedIn && !activeSubView && (
        <BottomNavigation
          currentTab={currentTab}
          onTabChange={setCurrentTab}
          onOpenAddSheet={() => setIsAddSheetOpen(true)}
        />
      )}

      {/* Add Bottom Sheet */}
      <AddBottomSheet
        isOpen={isAddSheetOpen}
        onClose={() => setIsAddSheetOpen(false)}
        onSelectAction={(action) => {
          setIsAddSheetOpen(false);
          if (action === 'upload' || action === 'camera' || action === 'ai-scan') {
            setScanModalState({ isOpen: true, mode: action });
          } else if (action === 'text') {
            setActiveSubView('text-locker');
          }
        }}
      />

      {/* Document Scanner & OCR Modal */}
      <ScanModal
        isOpen={scanModalState.isOpen}
        initialMode={scanModalState.mode}
        onClose={() => {
          setScanModalState({ isOpen: false, mode: 'upload' });
          setReplacingDoc(null);
        }}
        onProceedToVerify={(extractedData, fileInfo) => {
          setScanModalState({ isOpen: false, mode: 'upload' });
          setAiVerifyState({
            isOpen: true,
            extractedData,
            fileInfo
          });
        }}
      />

      {/* AI Extraction Verification Modal */}
      {aiVerifyState.isOpen && (
        <AIScanVerifyModal
          isOpen={aiVerifyState.isOpen}
          extractedData={aiVerifyState.extractedData}
          fileInfo={aiVerifyState.fileInfo}
          familyMembers={familyMembers}
          onClose={() => {
            setAiVerifyState({ isOpen: false, extractedData: null, fileInfo: null });
            setReplacingDoc(null);
          }}
          onSaveDocument={async (newDoc) => {
            if (replacingDoc) {
              const updated = {
                ...replacingDoc,
                ...newDoc,
                id: replacingDoc.id,
                uploadDate: new Date().toISOString().slice(0, 10)
              };
              await handleSaveDocument(updated);
            } else {
              await handleSaveDocument(newDoc);
            }
            // Navigate to Documents tab and reset category filter so user sees the newly saved document immediately
            setCurrentTab('documents');
            setSelectedCategoryFilter('All');
            setWelcomeBanner(`Document "${newDoc.name}" encrypted & saved to your locker!`);
            setTimeout(() => setWelcomeBanner(null), 4000);
          }}
        />
      )}

      {/* Document Viewer Modal */}
      {viewingDoc && (
        <DocumentViewerModal
          document={viewingDoc}
          onClose={() => setViewingDoc(null)}
          onDownload={handleDownloadDocument}
          onToggleFavorite={handleToggleFavorite}
        />
      )}

      {/* Edit Document Metadata Modal */}
      {editingDoc && (
        <EditDocumentModal
          document={editingDoc}
          familyMembers={familyMembers}
          onClose={() => setEditingDoc(null)}
          onSave={async (updatedDoc) => {
            await handleSaveDocument(updatedDoc);
            setEditingDoc(null);
          }}
        />
      )}

      {/* Notifications Drawer */}
      <NotificationDrawer
        isOpen={isNotifDrawerOpen}
        notifications={notifications}
        onClose={() => setIsNotifDrawerOpen(false)}
        onSelectNotification={(notif) => {
          setIsNotifDrawerOpen(false);
          if (notif.documentId) {
            const found = documents.find((d) => d.id === notif.documentId);
            if (found) setViewingDoc(found);
          }
        }}
        onMarkAllAsRead={() => setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))}
      />

      {/* PIN Lock & Vault Unlock Modal */}
      <PinLockModal
        mode={pinModalState.mode}
        isOpen={pinModalState.isOpen}
        userEmail={user.email}
        onSuccess={handleUnlockSuccess}
        onCancel={
          pinModalState.mode === 'setup'
            ? () => setPinModalState({ isOpen: false, mode: 'unlock' })
            : undefined
        }
        onResetViaAccount={handleResetViaAccount}
      />
    </AndroidContainer>
  );
}
