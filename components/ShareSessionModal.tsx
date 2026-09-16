import React, { useState } from "react";
import { 
  SavedProjectSession, 
  shareSessionWithEmail, 
  unshareSessionWithEmail, 
  toggleSessionPublicAccess 
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
  EnvelopeIcon
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
      await shareSessionWithEmail(session.id, cleanEmail);
      const updated = {
        ...session,
        sharedWithEmails: [...sharedEmails, cleanEmail]
      };
      onSessionUpdated(updated);
      setInviteEmail("");
      setSuccessMsg(`Access granted to ${cleanEmail}`);
      setTimeout(() => setSuccessMsg(null), 3500);
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
      await toggleSessionPublicAccess(session.id, nextState);
      const updated = {
        ...session,
        isPublic: nextState
      };
      onSessionUpdated(updated);
      setSuccessMsg(nextState ? "Tour is now discoverable in the Community tab" : "Tour is now private to invited users");
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

        {/* Feedback notices */}
        {errorMsg && (
          <div className="mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-700 animate-in fade-in">
            {errorMsg}
          </div>
        )}
        {successMsg && (
          <div className="mt-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-700 flex items-center gap-1.5 animate-in fade-in">
            <ShieldCheckIcon className="w-4 h-4 text-emerald-600" />
            {successMsg}
          </div>
        )}

        <div className="mt-6 space-y-6 overflow-y-auto pr-1 flex-1">
          
          {/* Option 1: Direct Invite by User Email */}
          <div className="space-y-3">
            <label className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <UserPlusIcon className="w-4 h-4 text-indigo-600" />
              Invite Specific App User by Email
            </label>
            <form onSubmit={handleInvite} className="flex gap-2">
              <div className="relative flex-1">
                <EnvelopeIcon className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
                <input
                  type="email"
                  placeholder="colleague@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="w-full pl-10 pr-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                />
              </div>
              <button
                type="submit"
                disabled={isInviting || !inviteEmail.trim()}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow transition active:scale-95 whitespace-nowrap"
              >
                {isInviting ? "Adding..." : "Grant Access"}
              </button>
            </form>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              When this user logs in with their email, this tour will automatically appear under their <strong>"Shared with Me"</strong> tab.
            </p>

            {/* List of currently invited users */}
            {sharedEmails.length > 0 && (
              <div className="mt-3 p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700/60 space-y-2">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Shared Collaborators ({sharedEmails.length})
                </span>
                <div className="space-y-1.5 max-h-36 overflow-y-auto">
                  {sharedEmails.map((email) => (
                    <div 
                      key={email}
                      className="flex items-center justify-between px-2.5 py-1.5 bg-white dark:bg-slate-900 rounded-lg border border-slate-200/80 dark:border-slate-700/80 text-xs"
                    >
                      <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">{email}</span>
                      <button
                        onClick={() => handleRemoveUser(email)}
                        className="p-1 text-slate-400 hover:text-rose-600 rounded transition"
                        title="Revoke access"
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

          {/* Option 3: Share Session Code & Direct Link */}
          <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
            <label className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <LinkIcon className="w-4 h-4 text-indigo-600" />
              Direct Share Code & Link
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleCopyCode}
                className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700/80 border border-slate-200 dark:border-slate-700 text-left transition flex items-center justify-between"
              >
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">Session ID Code</div>
                  <div className="text-xs font-black text-slate-800 dark:text-slate-200 font-mono truncate max-w-[150px]">
                    {session.id}
                  </div>
                </div>
                <span className="text-xs font-bold text-indigo-600 flex items-center gap-1">
                  {copiedCode ? <CheckIcon className="w-4 h-4 text-emerald-600" /> : <LinkIcon className="w-4 h-4" />}
                  {copiedCode ? "Copied" : "Copy Code"}
                </span>
              </button>

              <button
                type="button"
                onClick={handleCopyLink}
                className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700/80 border border-slate-200 dark:border-slate-700 text-left transition flex items-center justify-between"
              >
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">Direct Share Link</div>
                  <div className="text-xs font-black text-slate-800 dark:text-slate-200 truncate max-w-[150px]">
                    Load into Editor URL
                  </div>
                </div>
                <span className="text-xs font-bold text-indigo-600 flex items-center gap-1">
                  {copiedLink ? <CheckIcon className="w-4 h-4 text-emerald-600" /> : <ShareIcon className="w-4 h-4" />}
                  {copiedLink ? "Copied" : "Copy Link"}
                </span>
              </button>
            </div>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              Users can also paste this Session ID code into the <strong>"Import via Code"</strong> box in the Saved Sessions modal.
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
