import React, { useState, useEffect, useMemo } from "react";
import { 
  SavedProjectSession, 
  getUserSessions, 
  getSharedWithMeSessions,
  getPublicSessions,
  getSessionById,
  deleteUserSession, 
  saveUserSession,
  duplicateSharedSessionToMyAccount,
  updateSessionOrganization,
  saveLocalSession,
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
  DocumentDuplicateIcon,
  KeyIcon,
  ArrowRightIcon,
  FolderIcon,
  FolderPlusIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  Squares2X2Icon,
  ListBulletIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CheckIcon,
  ArrowUpTrayIcon,
  ArrowDownTrayIcon
} from "@heroicons/react/24/outline";

interface SavedSessionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  onLoadSession: (session: SavedProjectSession) => void;
  currentProject: {
    title: string;
    sessionName?: string;
    projectName?: string;
    description: string;
    appUrl?: string;
    script?: string;
    clips: any[];
    scenes?: any[];
    screenshots?: string[];
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

  // Saving State with Session Name and Project Name
  const [saveSessionName, setSaveSessionName] = useState(
    currentProject.sessionName || currentProject.title || "TourGenie App Tour"
  );
  const [saveProjectName, setSaveProjectName] = useState(
    currentProject.projectName || "General"
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Organization, Filtering & Search
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProjectFilter, setSelectedProjectFilter] = useState<string>("ALL");
  const [viewMode, setViewMode] = useState<"grouped" | "list">("grouped");
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});

  // Inline Organization Editing State
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [inlineSessionName, setInlineSessionName] = useState("");
  const [inlineProjectName, setInlineProjectName] = useState("");
  const [isUpdatingOrg, setIsUpdatingOrg] = useState(false);

  // General Actions State
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
      setSaveSessionName(currentProject.sessionName || currentProject.title || "TourGenie App Tour");
      setSaveProjectName(currentProject.projectName || "General");
      setSaveSuccess(false);
      setImportError(null);
      setStatusNotice(null);
      setEditingSessionId(null);
    }
  }, [isOpen, userId, currentProject.title, currentProject.sessionName, currentProject.projectName, currentUserEmail]);

  // Extract distinct projects for project filter and suggestions
  const availableProjects = useMemo(() => {
    const set = new Set<string>();
    const currentList = activeTab === "mine" ? mySessions : activeTab === "shared" ? sharedSessions : communitySessions;
    currentList.forEach(s => {
      const p = s.projectName?.trim();
      if (p) set.add(p);
      else set.add("General");
    });
    return Array.from(set).sort();
  }, [activeTab, mySessions, sharedSessions, communitySessions]);

  // Filter sessions by tab, search query, and project filter
  const displayedSessions = useMemo(() => {
    const rawList = activeTab === "mine" ? mySessions : activeTab === "shared" ? sharedSessions : communitySessions;
    return rawList.filter(s => {
      const sName = (s.sessionName || s.title || "").toLowerCase();
      const pName = (s.projectName || "General").toLowerCase();
      const owner = (s.ownerName || s.ownerEmail || "").toLowerCase();
      const q = searchQuery.trim().toLowerCase();

      const matchesSearch = !q || sName.includes(q) || pName.includes(q) || owner.includes(q);
      const matchesProject = selectedProjectFilter === "ALL" || (s.projectName || "General").toLowerCase() === selectedProjectFilter.toLowerCase();

      return matchesSearch && matchesProject;
    });
  }, [activeTab, mySessions, sharedSessions, communitySessions, searchQuery, selectedProjectFilter]);

  // Group sessions by project name for structured folder view
  const groupedSessions = useMemo(() => {
    const groups: Record<string, SavedProjectSession[]> = {};
    displayedSessions.forEach(s => {
      const proj = s.projectName?.trim() || "General";
      if (!groups[proj]) groups[proj] = [];
      groups[proj].push(s);
    });
    return groups;
  }, [displayedSessions]);

  if (!isOpen) return null;

  const handleSaveCurrent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      const slidesCount = Math.max(
        currentProject.clips?.length || 0,
        currentProject.scenes?.length || 0,
        currentProject.screenshots?.length || 0
      );

      const finalSessionName = saveSessionName.trim() || "TourGenie App Tour";
      const finalProjectName = saveProjectName.trim() || "General";

      const newSessionId = await saveUserSession(userId, {
        id: `session_${Date.now()}`,
        title: finalSessionName,
        sessionName: finalSessionName,
        projectName: finalProjectName,
        appDescription: currentProject.description || "",
        appUrl: currentProject.appUrl || "",
        script: currentProject.script || "",
        clipsCount: slidesCount,
        totalDuration: currentProject.totalDuration || 0,
        isRendered: currentProject.isRendered,
        combinedVideoUrl: currentProject.combinedVideoUrl,
        clips: currentProject.clips || [],
        scenes: currentProject.scenes || [],
        screenshots: currentProject.screenshots || [],
        youtubeMetadata: currentProject.youtubeMetadata,
        sharedWithEmails: [],
        isPublic: false
      });

      setSaveSuccess(true);
      setStatusNotice(`Session "${finalSessionName}" saved under project [${finalProjectName}]!`);
      if (onSessionSaved) onSessionSaved(newSessionId);
      await fetchAllData();
      setTimeout(() => {
        setSaveSuccess(false);
        setStatusNotice(null);
      }, 3500);
    } catch (err) {
      console.error("Failed to save project:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const startInlineEdit = (session: SavedProjectSession) => {
    setEditingSessionId(session.id);
    setInlineSessionName(session.sessionName || session.title || "TourGenie Tour");
    setInlineProjectName(session.projectName || "General");
  };

  const handleSaveInlineEdit = async (sessionId: string) => {
    if (!userId) return;
    setIsUpdatingOrg(true);
    try {
      const updatedName = inlineSessionName.trim() || "TourGenie Tour";
      const updatedProject = inlineProjectName.trim() || "General";

      await updateSessionOrganization(userId, sessionId, {
        sessionName: updatedName,
        projectName: updatedProject
      });

      setMySessions(prev => prev.map(s => s.id === sessionId ? {
        ...s,
        sessionName: updatedName,
        title: updatedName,
        projectName: updatedProject
      } : s));

      setStatusNotice(`Updated session to "${updatedName}" in [${updatedProject}]`);
      setEditingSessionId(null);
      setTimeout(() => setStatusNotice(null), 3000);
    } catch (err) {
      console.error("Failed to update session organization:", err);
    } finally {
      setIsUpdatingOrg(false);
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
        setImportError(`Session "${cleanCode}" was not found in cloud, local, or server project storage. If this session was created on another device while offline, you can import it using "Upload .tourgenie" file.`);
        return;
      }
      onLoadSession(session);
      onClose();
    } catch (err: any) {
      let friendlyMsg = "Failed to import session.";
      const raw = err?.message || String(err);
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.error) {
          if (parsed.error.includes("client is offline") || parsed.error.includes("offline")) {
            friendlyMsg = `The cloud database is currently unreachable or offline. Please check your network or import the project file (.tourgenie) directly.`;
          } else {
            friendlyMsg = parsed.error;
          }
        } else {
          friendlyMsg = raw;
        }
      } catch {
        if (raw.includes("client is offline") || raw.includes("offline")) {
          friendlyMsg = `The cloud database is currently unreachable or offline. Please check your network or import the project file (.tourgenie) directly.`;
        } else {
          friendlyMsg = raw;
        }
      }
      setImportError(friendlyMsg);
    } finally {
      setIsImporting(false);
    }
  };

  const handleExportSession = (session: SavedProjectSession) => {
    try {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(session, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      const safeTitle = (session.sessionName || session.title || "tour_project").toLowerCase().replace(/[^a-z0-9]/g, "_");
      downloadAnchor.setAttribute("download", `${safeTitle}_${session.id || 'export'}.tourgenie`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      setStatusNotice(`Exported "${session.sessionName || session.title}" as .tourgenie file!`);
      setTimeout(() => setStatusNotice(null), 4000);
    } catch (err: any) {
      setImportError("Failed to export session file: " + (err.message || String(err)));
    }
  };

  const handleImportByFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text);
        if (!parsed || (!parsed.clips && !parsed.scenes && !parsed.screenshots)) {
          setImportError("Invalid tour file. Please select a valid .tourgenie or .json project file.");
          return;
        }
        // Save to local cache
        saveLocalSession(parsed);
        onLoadSession(parsed);
        onClose();
      } catch (err: any) {
        setImportError("Failed to parse tour file: " + err.message);
      }
    };
    reader.readAsText(file);
  };

  const handleCloneToMyAccount = async (session: SavedProjectSession) => {
    if (!userId) return;
    setCloningId(session.id);
    try {
      const newId = await duplicateSharedSessionToMyAccount(session, userId);
      setStatusNotice(`Saved a personal copy of "${session.sessionName || session.title}" to project [${session.projectName || "General"}]!`);
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

  const toggleCollapseProject = (proj: string) => {
    setCollapsedProjects(prev => ({
      ...prev,
      [proj]: !prev[proj]
    }));
  };

  // Render a single session card
  const renderSessionCard = (s: SavedProjectSession, safeId: string) => {
    const isOwner = s.userId === userId;
    const sharedCount = s.sharedWithEmails?.length || 0;
    const isEditing = editingSessionId === safeId;

    return (
      <div 
        key={safeId}
        className="p-4 bg-white dark:bg-slate-800/80 hover:bg-slate-50/80 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700/80 rounded-2xl transition flex flex-col gap-3 shadow-sm"
      >
        {isEditing ? (
          // Inline Edit Mode for Renaming & Reassigning Project
          <div className="bg-slate-50 dark:bg-slate-900/90 p-3.5 rounded-xl border border-indigo-200 dark:border-indigo-800/60 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-indigo-700 dark:text-indigo-300 flex items-center gap-1.5">
                <PencilSquareIcon className="w-3.5 h-3.5" /> Edit Session & Project Name
              </span>
              <span className="text-[10px] text-slate-400 font-mono">ID: {safeId.substring(0, 14)}...</span>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Session Name</label>
                <input
                  type="text"
                  value={inlineSessionName}
                  onChange={(e) => setInlineSessionName(e.target.value)}
                  placeholder="Session Name"
                  className="w-full px-3 py-1.5 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-medium focus:ring-2 focus:ring-indigo-500 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Project Group</label>
                <input
                  type="text"
                  value={inlineProjectName}
                  onChange={(e) => setInlineProjectName(e.target.value)}
                  placeholder="Project Name (e.g. Acme Mobile)"
                  className="w-full px-3 py-1.5 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-medium focus:ring-2 focus:ring-indigo-500 dark:text-white"
                />
              </div>
            </div>

            {/* Quick project suggestion pills in edit mode */}
            {availableProjects.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                <span className="text-[10px] text-slate-400 font-medium">Quick Assign:</span>
                {availableProjects.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setInlineProjectName(p)}
                    className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800 hover:bg-indigo-100 dark:hover:bg-indigo-900 text-slate-700 dark:text-slate-300 transition"
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setEditingSessionId(null)}
                disabled={isUpdatingOrg}
                className="px-3 py-1 text-xs font-bold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleSaveInlineEdit(safeId)}
                disabled={isUpdatingOrg}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-3.5 py-1.5 rounded-lg shadow-sm transition flex items-center gap-1.5"
              >
                {isUpdatingOrg ? <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" /> : <CheckIcon className="w-3.5 h-3.5" />}
                Save Changes
              </button>
            </div>
          </div>
        ) : (
          // Normal Display Mode
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                {/* Session Name */}
                <h3 className="text-sm font-black text-slate-900 dark:text-white truncate">
                  {s.sessionName || s.title || "Untitled Tour"}
                </h3>

                {/* Project Badge - Click to filter by this project */}
                <button
                  type="button"
                  onClick={() => setSelectedProjectFilter(s.projectName || "General")}
                  title={`Click to filter sessions in project "${s.projectName || "General"}"`}
                  className="bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800 text-[10px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1 transition"
                >
                  <FolderIcon className="w-3 h-3 text-indigo-500" />
                  {s.projectName || "General"}
                </button>

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
                        <GlobeAmericasIcon className="w-3 h-3" /> Public
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

              <div className="flex items-center gap-3 text-xs text-slate-400 dark:text-slate-500 flex-wrap">
                <span className="flex items-center gap-1 font-medium">
                  <FilmIcon className="w-3.5 h-3.5 text-indigo-500" />
                  {s.clips?.length || s.scenes?.length || s.clipsCount || 0} Slides
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

            {/* Action Buttons */}
            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
              {/* Inline rename / reorganize button (for owner) */}
              {isOwner && (
                <button
                  onClick={() => startInlineEdit(s)}
                  className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-slate-700 rounded-xl transition"
                  title="Rename session or change project"
                >
                  <PencilSquareIcon className="w-4 h-4" />
                </button>
              )}

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

              {/* Export as .tourgenie file */}
              <button
                onClick={() => handleExportSession({ ...s, id: safeId })}
                className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-slate-700 rounded-xl transition"
                title="Export session as .tourgenie JSON file"
              >
                <ArrowDownTrayIcon className="w-4 h-4" />
              </button>

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
        )}
      </div>
    );
  };

  return (
    <>
      <div className="fixed inset-0 z-[120] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-4xl w-full p-6 sm:p-8 shadow-2xl relative overflow-hidden flex flex-col max-h-[92vh]">
          
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
            <div>
              <h2 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
                <FilmIcon className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
                TourGenie Cloud Sessions
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Save, categorize, and organize your tour sessions into related projects.
              </p>
            </div>
            <button 
              onClick={onClose}
              className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 transition"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>

          {/* Save Current Session to Project Section */}
          <form onSubmit={handleSaveCurrent} className="mt-4 p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700/60">
            <div className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <FolderPlusIcon className="w-4 h-4 text-indigo-600" />
                Save Current Session to Project
              </span>
              <span className="text-[11px] font-medium text-slate-400">
                {currentProject.clips?.length || currentProject.scenes?.length || currentProject.screenshots?.length || 0} Slides • {Math.floor(currentProject.totalDuration)}s Total
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
              {/* Session Name Input */}
              <div className="sm:col-span-6">
                <input
                  type="text"
                  required
                  value={saveSessionName}
                  onChange={(e) => setSaveSessionName(e.target.value)}
                  placeholder="Session Name (e.g. Onboarding Demo v1)"
                  className="w-full px-3.5 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                />
              </div>

              {/* Project Group Input */}
              <div className="sm:col-span-4 relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <FolderIcon className="w-3.5 h-3.5" />
                </div>
                <input
                  type="text"
                  required
                  value={saveProjectName}
                  onChange={(e) => setSaveProjectName(e.target.value)}
                  placeholder="Project (e.g. Acme Mobile)"
                  className="w-full pl-8 pr-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                />
              </div>

              {/* Submit Button */}
              <div className="sm:col-span-2">
                <button
                  type="submit"
                  disabled={isSaving}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-3 py-2.5 rounded-xl shadow transition active:scale-95 disabled:opacity-60 flex items-center justify-center gap-1.5 whitespace-nowrap"
                >
                  {isSaving ? (
                    <>
                      <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" /> Saving...
                    </>
                  ) : saveSuccess ? (
                    <>
                      <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-300" /> Saved!
                    </>
                  ) : (
                    <>
                      <DocumentArrowUpIcon className="w-3.5 h-3.5" /> Save Session
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Quick existing project selector pills */}
            {availableProjects.length > 0 && (
              <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  Existing Projects:
                </span>
                {availableProjects.map((p) => {
                  const isSelected = saveProjectName.trim().toLowerCase() === p.toLowerCase();
                  return (
                    <button
                      type="button"
                      key={p}
                      onClick={() => setSaveProjectName(p)}
                      className={`text-xs px-2.5 py-0.5 rounded-lg font-bold transition flex items-center gap-1 ${
                        isSelected
                          ? "bg-indigo-600 text-white shadow-sm"
                          : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:border-indigo-400"
                      }`}
                    >
                      <FolderIcon className={`w-3 h-3 ${isSelected ? "text-white" : "text-indigo-500"}`} />
                      {p}
                    </button>
                  );
                })}
              </div>
            )}
          </form>

          {/* Import by Session ID Bar & File Upload */}
          <div className="mt-3 p-3 bg-indigo-50/40 dark:bg-indigo-950/20 rounded-xl border border-indigo-100 dark:border-indigo-900/40 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <form onSubmit={handleImportByCode} className="flex-1 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
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

            <div className="hidden sm:block w-px h-6 bg-slate-200 dark:bg-slate-700" />

            {/* File Upload Button */}
            <label className="cursor-pointer bg-white hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800 text-indigo-600 dark:text-indigo-400 font-bold text-xs px-3 py-1.5 rounded-lg border border-indigo-200 dark:border-indigo-800 transition flex items-center justify-center gap-1.5 whitespace-nowrap shadow-sm">
              <ArrowUpTrayIcon className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              Upload .tourgenie
              <input
                type="file"
                accept=".tourgenie,.json"
                onChange={handleImportByFile}
                className="hidden"
              />
            </label>
          </div>
          {importError && (
            <p className="text-xs font-semibold text-rose-600 mt-1 ml-1">{importError}</p>
          )}
          {statusNotice && (
            <p className="text-xs font-semibold text-emerald-600 mt-1 ml-1 flex items-center gap-1">
              <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-600" /> {statusNotice}
            </p>
          )}

          {/* Navigation Tabs: My Tours, Shared with Me, Community */}
          <div className="mt-4 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setActiveTab("mine");
                  setSelectedProjectFilter("ALL");
                }}
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
                onClick={() => {
                  setActiveTab("shared");
                  setSelectedProjectFilter("ALL");
                }}
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
                onClick={() => {
                  setActiveTab("community");
                  setSelectedProjectFilter("ALL");
                }}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
                  activeTab === "community"
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                <GlobeAmericasIcon className="w-4 h-4" />
                Community ({communitySessions.length})
              </button>
            </div>

            {/* View Mode Toggle: Grouped by Project vs List View */}
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setViewMode("grouped")}
                title="Group sessions by project folder"
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                  viewMode === "grouped"
                    ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm"
                    : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                }`}
              >
                <Squares2X2Icon className="w-3.5 h-3.5" />
                By Project
              </button>
              <button
                type="button"
                onClick={() => setViewMode("list")}
                title="View all sessions in a flat list"
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                  viewMode === "list"
                    ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm"
                    : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                }`}
              >
                <ListBulletIcon className="w-3.5 h-3.5" />
                All List
              </button>
            </div>
          </div>

          {/* Search & Project Filter Bar */}
          <div className="mt-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            {/* Search Input */}
            <div className="relative flex-1">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <MagnifyingGlassIcon className="w-4 h-4" />
              </div>
              <input
                type="text"
                placeholder="Search by session title or project name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-1.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 dark:text-white placeholder:text-slate-400"
              />
            </div>

            {/* Project Filter Chips */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
              <button
                onClick={() => setSelectedProjectFilter("ALL")}
                className={`text-xs px-2.5 py-1 rounded-lg font-bold transition whitespace-nowrap ${
                  selectedProjectFilter === "ALL"
                    ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200"
                }`}
              >
                All Projects
              </button>
              {availableProjects.map((p) => {
                const count = (activeTab === "mine" ? mySessions : activeTab === "shared" ? sharedSessions : communitySessions)
                  .filter(s => (s.projectName || "General").toLowerCase() === p.toLowerCase()).length;
                const isSelected = selectedProjectFilter.toLowerCase() === p.toLowerCase();
                return (
                  <button
                    key={p}
                    onClick={() => setSelectedProjectFilter(p)}
                    className={`text-xs px-2.5 py-1 rounded-lg font-bold transition flex items-center gap-1 whitespace-nowrap ${
                      isSelected
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200"
                    }`}
                  >
                    <FolderIcon className={`w-3 h-3 ${isSelected ? "text-white" : "text-indigo-500"}`} />
                    <span>{p}</span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${isSelected ? "bg-indigo-700 text-indigo-100" : "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300"}`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sessions Content List */}
          <div className="mt-3 flex-1 overflow-y-auto space-y-3 pr-1">
            {loading ? (
              <div className="py-12 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
                <ArrowPathIcon className="w-6 h-6 animate-spin text-indigo-500" />
                <span className="text-xs font-medium">Fetching cloud tour sessions...</span>
              </div>
            ) : displayedSessions.length === 0 ? (
              <div className="py-12 text-center text-slate-400 dark:text-slate-500">
                <FolderIcon className="w-10 h-10 mx-auto opacity-30 mb-2" />
                <p className="text-sm font-semibold">
                  {searchQuery || selectedProjectFilter !== "ALL"
                    ? "No sessions match your search or project filter."
                    : activeTab === "mine" 
                    ? "No saved tour sessions yet." 
                    : activeTab === "shared" 
                    ? "No sessions shared with your email yet." 
                    : "No public community tours yet."}
                </p>
                <p className="text-xs mt-1">
                  {searchQuery || selectedProjectFilter !== "ALL"
                    ? "Try clearing the search or switching project filters."
                    : "Save your current tour session above with a name and project to get organized!"}
                </p>
                {(searchQuery || selectedProjectFilter !== "ALL") && (
                  <button
                    onClick={() => {
                      setSearchQuery("");
                      setSelectedProjectFilter("ALL");
                    }}
                    className="mt-3 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition"
                  >
                    Clear Filters
                  </button>
                )}
              </div>
            ) : viewMode === "grouped" ? (
              // Grouped by Project Folders View
              Object.keys(groupedSessions).map((projectName) => {
                const sessionsInProject = groupedSessions[projectName];
                const isCollapsed = collapsedProjects[projectName];
                return (
                  <div 
                    key={projectName} 
                    className="bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5 space-y-2.5"
                  >
                    {/* Project Folder Header */}
                    <div 
                      onClick={() => toggleCollapseProject(projectName)}
                      className="flex items-center justify-between cursor-pointer select-none group"
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                          <FolderIcon className="w-4 h-4" />
                        </div>
                        <div>
                          <span className="text-sm font-black text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition">
                            {projectName}
                          </span>
                          <span className="ml-2 text-xs font-medium text-slate-400">
                            ({sessionsInProject.length} {sessionsInProject.length === 1 ? "session" : "sessions"})
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300">
                        <span className="text-[11px] font-semibold">{isCollapsed ? "Expand" : "Collapse"}</span>
                        {isCollapsed ? <ChevronRightIcon className="w-4 h-4" /> : <ChevronDownIcon className="w-4 h-4" />}
                      </div>
                    </div>

                    {/* Sessions inside this project */}
                    {!isCollapsed && (
                      <div className="space-y-2 pt-1 pl-1">
                        {sessionsInProject.map((s, idx) => {
                          const safeId = String(s?.id || `session_${projectName}_${idx}`);
                          return renderSessionCard(s, safeId);
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              // Flat List View
              displayedSessions.map((s, idx) => {
                const safeId = String(s?.id || `session_${idx}`);
                return renderSessionCard(s, safeId);
              })
            )}
          </div>

          {/* Footer */}
          <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-between items-center text-[11px] text-slate-400">
            <span>
              {activeTab === "mine" ? `${mySessions.length} total sessions across projects in your account` :
               activeTab === "shared" ? `${sharedSessions.length} sessions shared with you` :
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
