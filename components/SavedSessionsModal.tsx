import React, { useState, useEffect } from "react";
import { 
  SavedProjectSession, 
  getUserSessions, 
  getSharedWithMeSessions,
  getPublicSessions,
  getSessionById,
  deleteUserSession, 
  saveUserSession,
  duplicateSharedSessionToMyAccount,
  auth
} from "../services/firebase";
import { ShareSessionModal } from "./ShareSessionModal";
import { 
  XMarkIcon, 
  ClockIcon, 
  TrashIcon, 
  FilmIcon, 
  ArrowPathIcon,
  CheckCircleIcon,
  DocumentArrowUpIcon,
  ShareIcon,
  UserGroupIcon,
  GlobeAmericasIcon,
  ArrowDownTrayIcon,
  DocumentDuplicateIcon,
  SparklesIcon,
  KeyIcon,
  ArrowRightIcon
} from "@heroicons/react/24/outline";

interface SavedSessionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  onLoadSession: (session: SavedProjectSession) => void;
  currentProject: {
    title: string;
    description: string;
    clips: any[];
    totalDuration: number;
    isRendered: boolean;
    combinedVideoUrl?: string;
    youtubeMetadata?: any;
  };
  onSessionSaved?: (sessionId: string) => void;
}

export const SavedSessionsModal: React.FC<SavedSessionsModalProps> = ({
  isOpen,
  onClose,
  userId,
  onLoadSession,
  currentProject,
  onSessionSaved
}) => {
  const [activeTab, setActiveTab] = useState<"mine" | "shared" | "community">("mine");
  const [mySessions, setMySessions] = useState<SavedProjectSession[]>([]);
  const [sharedSessions, setSharedSessions] = useState<SavedProjectSession[]>([]);
  const [communitySessions, setCommunitySessions] = useState<SavedProjectSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [saveTitle, setSaveTitle] = useState(currentProject.title || "TourGenie 90s App Tour");
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [importCode, setImportCode] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [selectedSessionForSharing, setSelectedSessionForSharing] = useState<SavedProjectSession | null>(null);
  const [cloningId, setCloningId] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const currentUserEmail = auth.currentUser?.email || "";

  const fetchAllData = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      // 1. Fetch user's own sessions
      const own = await getUserSessions(userId);
      setMySessions(own);

      // 2. Fetch sessions shared with user's email
      if (currentUserEmail) {
        const shared = await getSharedWithMeSessions(currentUserEmail);
        setSharedSessions(shared.filter(s => s.userId !== userId));
      }

      // 3. Fetch community & team public tours
      const pub = await getPublicSessions();
      setCommunitySessions(pub.filter(s => s.userId !== userId));
    } catch (err) {
      console.error("Failed to fetch sessions:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && userId) {
      fetchAllData();
      setSaveTitle(currentProject.title || "TourGenie 90s App Tour");
      setSaveSuccess(false);
      setImportError(null);
      setStatusNotice(null);
    }
  }, [isOpen, userId, currentProject.title, currentUserEmail]);

  if (!isOpen) return null;

  const handleSaveCurrent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      const newSessionId = await saveUserSession(userId, {
        id: `session_${Date.now()}`,
        title: saveTitle.trim() || "TourGenie App Tour",
        appDescription: currentProject.description || "",
        clipsCount: currentProject.clips?.length || 0,
        totalDuration: currentProject.totalDuration || 0,
        isRendered: currentProject.isRendered,
        combinedVideoUrl: currentProject.combinedVideoUrl,
        clips: currentProject.clips || [],
        youtubeMetadata: currentProject.youtubeMetadata,
        sharedWithEmails: [],
        isPublic: false
      });
      setSaveSuccess(true);
      if (onSessionSaved) onSessionSaved(newSessionId);
      await fetchAllData();
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error("Failed to save project:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!userId) return;
    setDeletingId(id);
    try {
      await deleteUserSession(userId, id);
      setMySessions((prev) => prev.filter((s) => s.id !== id));
      setStatusNotice("Tour session deleted successfully.");
      setTimeout(() => setStatusNotice(null), 3000);
    } catch (err) {
      console.error("Failed to delete session:", err);
    } finally {
      setDeletingId(null);
    }
  };

  const handleImportByCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = importCode.trim();
    if (!cleanCode) return;
    setIsImporting(true);
    setImportError(null);

    try {
      const session = await getSessionById(cleanCode);
      if (!session) {
        setImportError("Session not found. Please verify the Session ID code or link.");
        return;
      }
      onLoadSession(session);
      onClose();
    } catch (err: any) {
      setImportError(err.message || "Failed to import session.");
    } finally {
      setIsImporting(false);
    }
  };

  const handleCloneToMyAccount = async (session: SavedProjectSession) => {
    if (!userId) return;
    setCloningId(session.id);
    try {
      const newId = await duplicateSharedSessionToMyAccount(session, userId);
      setStatusNotice(`Saved a personal copy of "${session.title}" to your account!`);
      await fetchAllData();
      setActiveTab("mine");
      setTimeout(() => setStatusNotice(null), 3500);
    } catch (err) {
      console.error("Failed to duplicate session:", err);
    } finally {
      setCloningId(null);
    }
  };

  const handleSessionUpdated = (updatedSession: SavedProjectSession) => {
    setMySessions(prev => prev.map(s => s.id === updatedSession.id ? updatedSession : s));
    setSelectedSessionForSharing(updatedSession);
  };

  const displayedSessions = 
    activeTab === "mine" ? mySessions :
    activeTab === "shared" ? sharedSessions : communitySessions;

  return (
    <>
      <div className="fixed inset-0 z-[120] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-3xl w-full p-6 sm:p-8 shadow-2xl relative overflow-hidden flex flex-col max-h-[90vh]">
          
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
            <div>
              <h2 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
                <FilmIcon className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
                TourGenie Cloud Sessions
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Manage, collaborate, and share your tour video projects with other users.
              </p>
            </div>
            <button 
              onClick={onClose}
              className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 transition"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>

          {/* Quick Save Current Session Section */}
          <form onSubmit={handleSaveCurrent} className="mt-4 p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700/60">
            <div className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2 flex items-center justify-between">
              <span>Save Current Project</span>
              <span className="text-[11px] font-medium text-slate-400">
                {currentProject.clips.length} Scenes • {Math.floor(currentProject.totalDuration)}s Total
              </span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={saveTitle}
                onChange={(e) => setSaveTitle(e.target.value)}
                placeholder="e.g. Acme Mobile Tour v1"
                className="flex-1 px-3.5 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
              />
              <button
                type="submit"
                disabled={isSaving}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-4 py-2 rounded-xl shadow transition active:scale-95 disabled:opacity-60 flex items-center gap-1.5 whitespace-nowrap"
              >
                {isSaving ? (
                  <>
                    <ArrowPathIcon className="w-4 h-4 animate-spin" /> Saving...
                  </>
                ) : saveSuccess ? (
                  <>
                    <CheckCircleIcon className="w-4 h-4 text-emerald-300" /> Saved!
                  </>
                ) : (
                  <>
                    <DocumentArrowUpIcon className="w-4 h-4" /> Save Session
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Import by Session ID Bar */}
          <form onSubmit={handleImportByCode} className="mt-3 p-3 bg-indigo-50/40 dark:bg-indigo-950/20 rounded-xl border border-indigo-100 dark:border-indigo-900/40 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-indigo-700 dark:text-indigo-300 whitespace-nowrap">
              <KeyIcon className="w-4 h-4 text-indigo-600" />
              Import Shared Tour:
            </div>
            <input
              type="text"
              placeholder="Paste Session ID (e.g. session_1726...)"
              value={importCode}
              onChange={(e) => setImportCode(e.target.value)}
              className="flex-1 px-3 py-1.5 bg-white dark:bg-slate-900 border border-indigo-200 dark:border-slate-700 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
            />
            <button
              type="submit"
              disabled={isImporting || !importCode.trim()}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-3 py-1.5 rounded-lg shadow-sm transition active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1 whitespace-nowrap"
            >
              {isImporting ? <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" /> : <ArrowRightIcon className="w-3.5 h-3.5" />}
              Import & Load
            </button>
          </form>
          {importError && (
            <p className="text-xs font-semibold text-rose-600 mt-1 ml-1">{importError}</p>
          )}
          {statusNotice && (
            <p className="text-xs font-semibold text-emerald-600 mt-1 ml-1 flex items-center gap-1">
              <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-600" /> {statusNotice}
            </p>
          )}

          {/* Tabs: My Tours, Shared with Me, Community */}
          <div className="mt-5 flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
            <button
              onClick={() => setActiveTab("mine")}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
                activeTab === "mine"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              }`}
            >
              <FilmIcon className="w-4 h-4" />
              My Saved Tours ({mySessions.length})
            </button>

            <button
              onClick={() => setActiveTab("shared")}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
                activeTab === "shared"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              }`}
            >
              <UserGroupIcon className="w-4 h-4" />
              Shared with Me ({sharedSessions.length})
            </button>

            <button
              onClick={() => setActiveTab("community")}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
                activeTab === "community"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              }`}
            >
              <GlobeAmericasIcon className="w-4 h-4" />
              Community & Team ({communitySessions.length})
            </button>
          </div>

          {/* Sessions List */}
          <div className="mt-4 flex-1 overflow-y-auto space-y-3 pr-1">
            {loading ? (
              <div className="py-12 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
                <ArrowPathIcon className="w-6 h-6 animate-spin text-indigo-500" />
                <span className="text-xs font-medium">Fetching cloud tour sessions...</span>
              </div>
            ) : displayedSessions.length === 0 ? (
              <div className="py-12 text-center text-slate-400 dark:text-slate-500">
                <FilmIcon className="w-10 h-10 mx-auto opacity-30 mb-2" />
                <p className="text-sm font-semibold">
                  {activeTab === "mine" 
                    ? "No saved tour sessions yet." 
                    : activeTab === "shared" 
                    ? "No sessions shared with your email yet." 
                    : "No public community tours yet."}
                </p>
                <p className="text-xs mt-1">
                  {activeTab === "mine" 
                    ? "Save your current tour above to keep it in the cloud and share with others." 
                    : activeTab === "shared" 
                    ? "When other users grant access to your email, their tours will appear here." 
                    : "Make your tours public to share them with other users across the app."}
                </p>
              </div>
            ) : (
              displayedSessions.map((s, idx) => {
                const safeId = s.id || `session_${idx}`;
                const isOwner = s.userId === userId;
                const sharedCount = s.sharedWithEmails?.length || 0;
                return (
                  <div 
                    key={safeId}
                    className="p-4 bg-white dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700/80 rounded-2xl transition flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-black text-slate-900 dark:text-white truncate">
                          {s.title || "Untitled Tour"}
                        </h3>
                        {s.isRendered && (
                          <span className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-400 text-[10px] font-black px-2 py-0.5 rounded-full">
                            Rendered
                          </span>
                        )}
                        {/* Sharing badges */}
                        {isOwner && (
                          <>
                            {s.isPublic && (
                              <span className="bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-400 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                                <GlobeAmericasIcon className="w-3 h-3" /> Public in App
                              </span>
                            )}
                            {sharedCount > 0 && (
                              <span className="bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-400 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                                <UserGroupIcon className="w-3 h-3" /> Shared ({sharedCount})
                              </span>
                            )}
                          </>
                        )}
                        {!isOwner && (
                          <span className="bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300 text-[10px] font-bold px-2 py-0.5 rounded-full">
                            By {s.ownerName || s.ownerEmail || "Collaborator"}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 text-xs text-slate-400 dark:text-slate-500 mt-1 flex-wrap">
                        <span className="flex items-center gap-1 font-medium">
                          <FilmIcon className="w-3.5 h-3.5 text-indigo-500" />
                          {s.clipsCount || (s.clips?.length || 0)} Scenes
                        </span>
                        <span>•</span>
                        <span className="flex items-center gap-1 font-medium">
                          <ClockIcon className="w-3.5 h-3.5 text-slate-400" />
                          {Math.floor(s.totalDuration || 0)}s
                        </span>
                        <span>•</span>
                        <span className="font-mono text-[10px] text-slate-400">
                          ID: {safeId.length > 16 ? `${safeId.substring(0, 16)}...` : safeId}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                      {/* Share button for owner */}
                      {isOwner && (
                        <button
                          onClick={() => setSelectedSessionForSharing({ ...s, id: safeId })}
                          className="bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold text-xs px-3 py-2 rounded-xl transition flex items-center gap-1.5"
                          title="Share with other users"
                        >
                          <ShareIcon className="w-3.5 h-3.5 text-indigo-600" />
                          Share
                        </button>
                      )}

                      {/* Duplicate / Save Copy button for non-owner */}
                      {!isOwner && (
                        <button
                          onClick={() => handleCloneToMyAccount({ ...s, id: safeId })}
                          disabled={cloningId === safeId}
                          className="bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold text-xs px-3 py-2 rounded-xl transition flex items-center gap-1.5 disabled:opacity-50"
                          title="Save a copy of this tour to your account"
                        >
                          <DocumentDuplicateIcon className="w-3.5 h-3.5 text-indigo-600" />
                          {cloningId === safeId ? "Copying..." : "Save a Copy"}
                        </button>
                      )}

                      {/* Load into Editor */}
                      <button
                        onClick={() => {
                          onLoadSession({ ...s, id: safeId });
                          onClose();
                        }}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-3.5 py-2 rounded-xl transition active:scale-95 shadow"
                      >
                        Load Project
                      </button>

                      {/* Delete button (owner only) */}
                      {isOwner && (
                        <button
                          onClick={() => handleDelete(safeId)}
                          disabled={deletingId === safeId}
                          title="Delete session"
                          className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-xl transition"
                        >
                          <TrashIcon className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-between items-center text-[11px] text-slate-400">
            <span>
              {activeTab === "mine" ? `${mySessions.length} projects in your account` :
               activeTab === "shared" ? `${sharedSessions.length} projects shared with you` :
               `${communitySessions.length} community tours`}
            </span>
            <button 
              onClick={fetchAllData}
              className="hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center gap-1 font-semibold"
            >
              <ArrowPathIcon className="w-3.5 h-3.5" /> Refresh List
            </button>
          </div>

        </div>
      </div>

      {/* Share Session Modal */}
      {selectedSessionForSharing && (
        <ShareSessionModal
          isOpen={!!selectedSessionForSharing}
          onClose={() => setSelectedSessionForSharing(null)}
          session={selectedSessionForSharing}
          onSessionUpdated={handleSessionUpdated}
        />
      )}
    </>
  );
};
