import React, { useState } from "react";
import { 
  SavedProjectSession, 
  shareSessionWithEmail, 
  unshareSessionWithEmail, 
  toggleSessionPublicAccess,
  getCloudQuotaExceeded 
} from "../services/firebase";
import { 
  XMarkIcon, 
  ShareIcon, 
  UserPlusIcon, 
  GlobeAmericasIcon, 
  LinkIcon, 
  CheckIcon, 
  TrashIcon,
  SparklesIcon,
  ShieldCheckIcon,
  EnvelopeIcon,
  ArrowDownTrayIcon
} from "@heroicons/react/24/outline";

interface ShareSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  session: SavedProjectSession | null;
  onSessionUpdated: (updatedSession: SavedProjectSession) => void;
}

export const ShareSessionModal: React.FC<ShareSessionModalProps> = ({
  isOpen,
  onClose,
  session,
  onSessionUpdated
}) => {
  const [inviteEmail, setInviteEmail] = useState("");
  const [isInviting, setIsInviting] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!isOpen || !session) return null;

  const sharedEmails = session.sharedWithEmails || [];
  const isPublic = !!session.isPublic;
  const isQuotaReached = getCloudQuotaExceeded();

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = inviteEmail.trim().toLowerCase();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!cleanEmail) return;
    if (!cleanEmail.includes("@") || !cleanEmail.includes(".")) {
      setErrorMsg("Please enter a valid email address.");
      return;
    }

    if (sharedEmails.includes(cleanEmail)) {
      setErrorMsg("This user already has access to this tour.");
      return;
    }

    setIsInviting(true);
    try {
      const res = await shareSessionWithEmail(session.id, cleanEmail, session);
      const updated = {
        ...session,
        sharedWithEmails: [...sharedEmails, cleanEmail]
      };
      onSessionUpdated(updated);
      setInviteEmail("");
      if (res && res.message) {
        setSuccessMsg(res.message);
      } else {
        setSuccessMsg(`Access granted to ${cleanEmail}`);
      }
      setTimeout(() => setSuccessMsg(null), 4500);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to share tour with user.");
    } finally {
      setIsInviting(false);
    }
  };

  const handleRemoveUser = async (emailToRemove: string) => {
    setErrorMsg(null);
    try {
      await unshareSessionWithEmail(session.id, emailToRemove);
      const updated = {
        ...session,
        sharedWithEmails: sharedEmails.filter(e => e !== emailToRemove)
      };
      onSessionUpdated(updated);
      setSuccessMsg(`Access revoked for ${emailToRemove}`);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg("Failed to remove user access.");
    }
  };

  const handleTogglePublic = async () => {
    const nextState = !isPublic;
    setErrorMsg(null);
    try {
      const res = await toggleSessionPublicAccess(session.id, nextState, session);
      const updated = {
        ...session,
        isPublic: nextState
      };
      onSessionUpdated(updated);
      if (res && res.message) {
        setSuccessMsg(res.message);
      } else {
        setSuccessMsg(nextState ? "Tour is now discoverable in the Community tab" : "Tour is now private to invited users");
      }
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg("Failed to update visibility settings.");
    }
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(session.id);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2500);
  };

  const handleCopyLink = () => {
    const shareUrl = `${window.location.origin}${window.location.pathname}?session=${encodeURIComponent(session.id)}`;
    navigator.clipboard.writeText(shareUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const handleDownloadTourFile = () => {
    try {
      const exportData = {
        ...session,
        exportedAt: new Date().toISOString(),
        tourGenieVersion: "2.0"
      };
      const jsonStr = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeTitle = (session.sessionName || session.title || "TourGenie_Tour").replace(/[^a-zA-Z0-9_-]/g, "_");
      a.download = `${safeTitle}.tourgenie`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSuccessMsg("Tour project file (.tourgenie) downloaded! Teammates can load this anytime.");
      setTimeout(() => setSuccessMsg(null), 3500);
    } catch (err: any) {
      setErrorMsg("Could not download tour file: " + err.message);
    }
  };

  return (
    <div className="fixed inset-0 z-[140] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-xl w-full p-6 sm:p-8 shadow-2xl relative overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-start justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
              <ShareIcon className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-900 dark:text-white">
                Share Tour Session
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-sm">
                {session.title} • {session.clipsCount || session.clips?.length || 0} Scenes ({Math.floor(session.totalDuration || 0)}s)
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 transition"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Cloud Quota Status Notice */}
        {isQuotaReached && (
          <div className="mt-4 p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2.5">
            <div className="px-1.5 py-0.5 rounded bg-amber-200 dark:bg-amber-900 text-amber-900 dark:text-amber-200 font-black text-[9px] uppercase tracking-wider shrink-0 mt-0.5">
              Cloud Quota
            </div>
            <div className="space-y-1">
              <p className="font-bold text-amber-900 dark:text-amber-100 text-xs">
                Free-tier daily write limit reached for cloud database
              </p>
              <p className="text-[11px] text-amber-800/90 dark:text-amber-300/90 leading-relaxed">
                Your tour session is safely preserved in local storage. You can invite collaborators, send them the <strong>Direct Link / Code</strong>, or download the <strong>.tourgenie file</strong> below.
              </p>
            </div>
          </div>
        )}

        {/* Feedback notices */}
        {errorMsg && (
          <div className="mt-4 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs font-semibold text-rose-700 dark:text-rose-300 animate-in fade-in">
            {errorMsg}
          </div>
        )}
        {successMsg && (
          <div className="mt-4 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs font-semibold text-emerald-700 dark:text-emerald-300 flex items-center gap-2 animate-in fade-in">
            <CheckIcon className="w-4 h-4 shrink-0" />
            {successMsg}
          </div>
        )}

        {/* Content body */}
        <div className="mt-5 space-y-6 overflow-y-auto pr-1">
          
          {/* Option 1: Invite Collaborator */}
          <div className="space-y-3">
            <label className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <UserPlusIcon className="w-4 h-4 text-indigo-600" />
              Invite Team Member / Collaborator
            </label>
            <form onSubmit={handleInvite} className="flex gap-2">
              <div className="relative flex-1">
                <EnvelopeIcon className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input 
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="colleague@company.com"
                  className="w-full pl-10 pr-3 py-2.5 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                />
              </div>
              <button
                type="submit"
                disabled={isInviting || !inviteEmail.trim()}
                className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-sm"
              >
                {isInviting ? "Inviting..." : "Grant Access"}
              </button>
            </form>

            {/* List of currently shared users */}
            {sharedEmails.length > 0 && (
              <div className="mt-3 space-y-1.5">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  People with access ({sharedEmails.length})
                </span>
                <div className="max-h-28 overflow-y-auto space-y-1">
                  {sharedEmails.map((email) => (
                    <div 
                      key={email}
                      className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 text-xs"
                    >
                      <span className="text-slate-700 dark:text-slate-300 font-medium truncate max-w-[280px]">
                        {email}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveUser(email)}
                        className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition"
                        title="Remove user"
                      >
                        <TrashIcon className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Option 2: Public / Community Discovery Toggle */}
          <div className="p-4 bg-indigo-50/60 dark:bg-slate-800/60 rounded-2xl border border-indigo-100 dark:border-slate-700/80 flex items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 mt-0.5">
                <GlobeAmericasIcon className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
                  Discoverable in Community & Team Feed
                </h4>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 max-w-sm">
                  Allow any user in the app to discover, preview, and load this tour into their editor.
                </p>
              </div>
            </div>
            <button
              onClick={handleTogglePublic}
              type="button"
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                isPublic ? "bg-indigo-600" : "bg-slate-300 dark:bg-slate-700"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  isPublic ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {/* Option 3: Share Session Code, Direct Link & File Export */}
          <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
            <label className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <LinkIcon className="w-4 h-4 text-indigo-600" />
              Direct Share Code, Link & File
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={handleCopyCode}
                className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700/80 border border-slate-200 dark:border-slate-700 text-left transition flex flex-col justify-between"
              >
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">Session ID Code</div>
                  <div className="text-xs font-black text-slate-800 dark:text-slate-200 font-mono truncate max-w-[130px]">
                    {session.id}
                  </div>
                </div>
                <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1 mt-2">
                  {copiedCode ? <CheckIcon className="w-4 h-4 text-emerald-600" /> : <LinkIcon className="w-4 h-4" />}
                  {copiedCode ? "Copied" : "Copy Code"}
                </span>
              </button>

              <button
                type="button"
                onClick={handleCopyLink}
                className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700/80 border border-slate-200 dark:border-slate-700 text-left transition flex flex-col justify-between"
              >
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">Direct Share Link</div>
                  <div className="text-xs font-black text-slate-800 dark:text-slate-200 truncate max-w-[130px]">
                    Load into Editor URL
                  </div>
                </div>
                <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1 mt-2">
                  {copiedLink ? <CheckIcon className="w-4 h-4 text-emerald-600" /> : <ShareIcon className="w-4 h-4" />}
                  {copiedLink ? "Copied" : "Copy Link"}
                </span>
              </button>

              <button
                type="button"
                onClick={handleDownloadTourFile}
                className="p-3 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/40 hover:bg-indigo-100/70 dark:hover:bg-indigo-900/50 border border-indigo-200 dark:border-indigo-800/80 text-left transition flex flex-col justify-between"
              >
                <div>
                  <div className="text-[10px] font-bold uppercase text-indigo-600 dark:text-indigo-400">Export File</div>
                  <div className="text-xs font-black text-slate-800 dark:text-slate-200 truncate max-w-[130px]">
                    .tourgenie file
                  </div>
                </div>
                <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1 mt-2">
                  <ArrowDownTrayIcon className="w-4 h-4" />
                  Download
                </span>
              </button>
            </div>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              Anyone can import this tour using the <strong>Session ID Code</strong> or by opening the <strong>.tourgenie file</strong> in their Saved Sessions.
            </p>
          </div>

        </div>

        {/* Footer */}
        <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs transition"
          >
            Done
          </button>
        </div>

      </div>
    </div>
  );
};
