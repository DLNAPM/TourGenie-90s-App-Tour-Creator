import React, { useState, useEffect } from "react";
import { 
  SavedProjectSession, 
  getUserSessions, 
  deleteUserSession, 
  saveUserSession 
} from "../services/firebase";
import { 
  XMarkIcon, 
  ClockIcon, 
  TrashIcon, 
  FilmIcon, 
  ArrowPathIcon,
  PlusIcon,
  CheckCircleIcon,
  DocumentArrowUpIcon
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
  const [sessions, setSessions] = useState<SavedProjectSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [saveTitle, setSaveTitle] = useState(currentProject.title || "TourGenie 90s App Tour");
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchSessions = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const data = await getUserSessions(userId);
      setSessions(data);
    } catch (err) {
      console.error("Failed to fetch sessions:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && userId) {
      fetchSessions();
      setSaveTitle(currentProject.title || "TourGenie 90s App Tour");
      setSaveSuccess(false);
    }
  }, [isOpen, userId, currentProject.title]);

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
        youtubeMetadata: currentProject.youtubeMetadata
      });
      setSaveSuccess(true);
      if (onSessionSaved) onSessionSaved(newSessionId);
      await fetchSessions();
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
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      console.error("Failed to delete session:", err);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-2xl w-full p-8 shadow-2xl relative overflow-hidden flex flex-col max-h-[85vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
              <FilmIcon className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
              Saved Tour Sessions
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Access and manage your cloud-saved tour video projects.
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
              className="flex-1 px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
            />
            <button
              type="submit"
              disabled={isSaving}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow transition active:scale-95 disabled:opacity-60 flex items-center gap-1.5 whitespace-nowrap"
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

        {/* Sessions List */}
        <div className="mt-6 flex-1 overflow-y-auto space-y-3 pr-1">
          {loading ? (
            <div className="py-12 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
              <ArrowPathIcon className="w-6 h-6 animate-spin text-indigo-500" />
              <span className="text-xs font-medium">Fetching saved sessions...</span>
            </div>
          ) : sessions.length === 0 ? (
            <div className="py-12 text-center text-slate-400 dark:text-slate-500">
              <FilmIcon className="w-10 h-10 mx-auto opacity-30 mb-2" />
              <p className="text-sm font-semibold">No saved sessions found yet.</p>
              <p className="text-xs mt-1">Use the form above to save your current tour project to your account.</p>
            </div>
          ) : (
            sessions.map((s) => (
              <div 
                key={s.id}
                className="p-4 bg-white dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700/80 rounded-2xl transition flex items-center justify-between gap-4 shadow-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-black text-slate-900 dark:text-white truncate">
                      {s.title}
                    </h3>
                    {s.isRendered && (
                      <span className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-400 text-[10px] font-black px-2 py-0.5 rounded-full">
                        Rendered
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-400 dark:text-slate-500 mt-1">
                    <span className="flex items-center gap-1 font-medium">
                      <FilmIcon className="w-3.5 h-3.5 text-indigo-500" />
                      {s.clipsCount || (s.clips?.length || 0)} Scenes
                    </span>
                    <span>•</span>
                    <span className="flex items-center gap-1 font-medium">
                      <ClockIcon className="w-3.5 h-3.5 text-slate-400" />
                      {Math.floor(s.totalDuration || 0)}s
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      onLoadSession(s);
                      onClose();
                    }}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-3.5 py-2 rounded-xl transition active:scale-95 shadow"
                  >
                    Load Project
                  </button>
                  <button
                    onClick={() => handleDelete(s.id)}
                    disabled={deletingId === s.id}
                    title="Delete session"
                    className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-xl transition"
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-between items-center text-[11px] text-slate-400">
          <span>{sessions.length} Saved {sessions.length === 1 ? 'project' : 'projects'} in your cloud storage</span>
          <button 
            onClick={fetchSessions}
            className="hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center gap-1 font-semibold"
          >
            <ArrowPathIcon className="w-3.5 h-3.5" /> Refresh List
          </button>
        </div>

      </div>
    </div>
  );
};
