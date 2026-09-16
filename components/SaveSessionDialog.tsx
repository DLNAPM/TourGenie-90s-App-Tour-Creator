import React, { useState, useEffect } from 'react';
import {
  XMarkIcon,
  FolderIcon,
  FilmIcon,
  ClockIcon,
  DocumentArrowUpIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  PlusIcon
} from '@heroicons/react/24/outline';

interface SaveSessionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (sessionName: string, projectName: string) => Promise<void>;
  defaultSessionName: string;
  defaultProjectName: string;
  existingProjects: string[];
  slideCount: number;
  totalDuration: number;
}

export const SaveSessionDialog: React.FC<SaveSessionDialogProps> = ({
  isOpen,
  onClose,
  onSave,
  defaultSessionName,
  defaultProjectName,
  existingProjects,
  slideCount,
  totalDuration
}) => {
  const [sessionName, setSessionName] = useState(defaultSessionName || 'TourGenie App Tour');
  const [projectName, setProjectName] = useState(defaultProjectName || 'General');
  const [isSaving, setIsSaving] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSessionName(defaultSessionName || 'TourGenie App Tour');
      setProjectName(defaultProjectName || 'General');
      setIsSuccess(false);
      setError(null);
    }
  }, [isOpen, defaultSessionName, defaultProjectName]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalSessionName = sessionName.trim() || 'TourGenie App Tour';
    const finalProjectName = projectName.trim() || 'General';

    setIsSaving(true);
    setError(null);
    try {
      await onSave(finalSessionName, finalProjectName);
      setIsSuccess(true);
      setTimeout(() => {
        setIsSuccess(false);
        onClose();
      }, 1000);
    } catch (err: any) {
      setError(err?.message || 'Failed to save session. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[130] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-lg w-full p-6 sm:p-7 shadow-2xl relative overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-900/40 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
              <FolderIcon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-900 dark:text-white">Save Session to Project</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">Organize your sessions into related projects</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Project Summary info badge */}
        <div className="mt-4 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700/60 flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
          <span className="flex items-center gap-1.5 font-bold">
            <FilmIcon className="w-4 h-4 text-indigo-500" />
            {slideCount} Slides Included
          </span>
          <span className="flex items-center gap-1.5 font-bold">
            <ClockIcon className="w-4 h-4 text-slate-400" />
            {Math.floor(totalDuration)}s Total Duration
          </span>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {/* Session Name Input */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
              Session Name <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              placeholder="e.g. Onboarding Walkthrough v1, Checkout Demo"
              className="w-full px-4 py-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white placeholder:text-slate-400"
            />
            <p className="text-[11px] text-slate-400 mt-1">Specific name describing this walkthrough or version.</p>
          </div>

          {/* Project Name Input & Suggestions */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                Related Project <span className="text-rose-500">*</span>
              </label>
              <span className="text-[11px] text-slate-400">Used for grouping</span>
            </div>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <FolderIcon className="w-4 h-4" />
              </div>
              <input
                type="text"
                required
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="e.g. Acme Mobile App, Q3 Marketing Tours"
                className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white placeholder:text-slate-400"
              />
            </div>

            {/* Quick Project selector chips */}
            {existingProjects.length > 0 && (
              <div className="mt-2.5">
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                  Or select existing project:
                </p>
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                  {existingProjects.map((p) => {
                    const isSelected = projectName.trim().toLowerCase() === p.toLowerCase();
                    return (
                      <button
                        type="button"
                        key={p}
                        onClick={() => setProjectName(p)}
                        className={`text-xs px-2.5 py-1 rounded-lg font-bold transition flex items-center gap-1.5 ${
                          isSelected
                            ? 'bg-indigo-600 text-white shadow-sm'
                            : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        <FolderIcon className={`w-3 h-3 ${isSelected ? 'text-white' : 'text-indigo-500'}`} />
                        {p}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/40 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400">
              {error}
            </div>
          )}

          {/* Action Buttons */}
          <div className="pt-2 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || isSuccess}
              className="bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-bold text-xs px-5 py-2.5 rounded-xl shadow transition flex items-center gap-2 disabled:opacity-60"
            >
              {isSaving ? (
                <>
                  <ArrowPathIcon className="w-4 h-4 animate-spin" /> Saving...
                </>
              ) : isSuccess ? (
                <>
                  <CheckCircleIcon className="w-4 h-4 text-emerald-300" /> Saved!
                </>
              ) : (
                <>
                  <DocumentArrowUpIcon className="w-4 h-4" /> Save to Project
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
