import React, { useState, useEffect } from "react";
import { 
  YouTubeChannelInfo, 
  YouTubeUploadResult, 
  uploadVideoToYouTube, 
  fetchMyYouTubeChannel,
  getCachedYouTubeToken,
  setCachedYouTubeToken,
  getCachedChannelInfo,
  setCachedChannelInfo
} from "../services/youtubeService";
import { authorizeYouTubeChannel, auth } from "../services/firebase";
import { 
  XMarkIcon, 
  ArrowTopRightOnSquareIcon,
  CheckIcon, 
  ArrowPathIcon,
  SparklesIcon,
  ShieldCheckIcon,
  VideoCameraIcon,
  GlobeAmericasIcon,
  LockClosedIcon,
  EyeIcon,
  ArrowUpTrayIcon
} from "@heroicons/react/24/outline";

interface YouTubePublishModalProps {
  isOpen: boolean;
  onClose: () => void;
  combinedVideoUrl: string;
  defaultTitle: string;
  defaultDescription: string;
  defaultTags?: string[];
  totalClipsCount: number;
  totalDurationSeconds: number;
}

export const YouTubePublishModal: React.FC<YouTubePublishModalProps> = ({
  isOpen,
  onClose,
  combinedVideoUrl,
  defaultTitle,
  defaultDescription,
  defaultTags = [],
  totalClipsCount,
  totalDurationSeconds
}) => {
  const [accessToken, setAccessToken] = useState<string | null>(getCachedYouTubeToken());
  const [channelInfo, setChannelInfo] = useState<YouTubeChannelInfo | null>(getCachedChannelInfo());
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Form Fields
  const [title, setTitle] = useState(defaultTitle || "TourGenie 90s App Tour");
  const [description, setDescription] = useState(defaultDescription || "");
  const [tags, setTags] = useState<string[]>(defaultTags);
  const [tagInput, setTagInput] = useState("");
  const [privacyStatus, setPrivacyStatus] = useState<'unlisted' | 'public' | 'private'>('unlisted');
  
  // Confirmation & Upload State
  const [showConfirm, setShowConfirm] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<YouTubeUploadResult | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // Synchronize defaults when modal opens
  useEffect(() => {
    if (isOpen) {
      if (defaultTitle) setTitle(defaultTitle);
      if (defaultDescription) setDescription(defaultDescription);
      if (defaultTags && defaultTags.length > 0) setTags(defaultTags);
      setUploadError(null);
      setUploadResult(null);
      setShowConfirm(false);
      
      const cached = getCachedYouTubeToken();
      if (cached) {
        setAccessToken(cached);
        if (!channelInfo) {
          fetchMyYouTubeChannel(cached)
            .then(info => {
              if (info) setChannelInfo(info);
            })
            .catch(err => {
              console.warn("Could not retrieve channel info with cached token:", err);
            });
        }
      }
    }
  }, [isOpen, defaultTitle, defaultDescription, defaultTags]);

  if (!isOpen) return null;

  const handleConnectGoogle = async () => {
    setIsAuthenticating(true);
    setAuthError(null);
    try {
      const { user, accessToken: token } = await authorizeYouTubeChannel();
      setAccessToken(token);
      setCachedYouTubeToken(token);

      // Fetch YouTube channel details
      try {
        const channel = await fetchMyYouTubeChannel(token);
        if (channel) {
          setChannelInfo(channel);
        } else {
          setChannelInfo({
            id: user.uid,
            title: user.displayName || user.email || "My Google Account",
            avatarUrl: user.photoURL || undefined
          });
        }
      } catch (channelErr: any) {
        console.warn("Channel info warning:", channelErr);
        setChannelInfo({
          id: user.uid,
          title: user.displayName || user.email || "Google Account",
          avatarUrl: user.photoURL || undefined
        });
      }
    } catch (err: any) {
      console.error("Google/YouTube auth error:", err);
      setAuthError(err.message || "Failed to authenticate with Google & YouTube.");
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleDisconnect = () => {
    setAccessToken(null);
    setChannelInfo(null);
    setCachedYouTubeToken(null);
    setCachedChannelInfo(null);
  };

  const handleAddTag = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const val = tagInput.trim().replace(/^#/, "");
      if (val && !tags.includes(val) && tags.length < 30) {
        setTags([...tags, val]);
        setTagInput("");
      }
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter(t => t !== tagToRemove));
  };

  const handleStartPublish = async () => {
    if (!accessToken) {
      setUploadError("Please connect your Google / YouTube account before publishing.");
      return;
    }

    if (!title.trim()) {
      setUploadError("Please provide a video title.");
      return;
    }

    if (!combinedVideoUrl) {
      setUploadError("No rendered master video found. Please render the project first.");
      return;
    }

    setShowConfirm(false);
    setIsUploading(true);
    setUploadProgress(5);
    setUploadStage("Extracting master video binary stream...");
    setUploadError(null);

    try {
      // 1. Fetch the master video Blob from the combinedVideoUrl
      const videoRes = await fetch(combinedVideoUrl);
      if (!videoRes.ok) {
        throw new Error("Failed to load master video stream for broadcast.");
      }
      const videoBlob = await videoRes.blob();

      // 2. Upload to YouTube API
      const result = await uploadVideoToYouTube({
        videoBlob,
        title: title.trim(),
        description: description.trim(),
        tags,
        privacyStatus,
        accessToken,
        onProgress: (pct, stage) => {
          setUploadProgress(pct);
          setUploadStage(stage);
        }
      });

      setUploadResult(result);
    } catch (err: any) {
      console.error("YouTube upload failed:", err);
      setUploadError(err.message || "Failed to publish video to YouTube.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleCopyLink = () => {
    if (uploadResult?.videoUrl) {
      navigator.clipboard.writeText(uploadResult.videoUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    }
  };

  return (
    <div className="fixed inset-0 z-[150] bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-2xl w-full p-6 sm:p-8 shadow-2xl relative overflow-hidden flex flex-col max-h-[92vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/60 flex items-center justify-center text-red-600 shadow-sm">
              <svg className="w-6 h-6 fill-current" viewBox="0 0 24 24">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-900 dark:text-white flex items-center gap-2">
                Push to YouTube
                <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
                  Data API v3
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Publish your compiled 90-second tour directly to your YouTube Channel
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            disabled={isUploading}
            className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 transition"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Content Area */}
        <div className="mt-5 space-y-6 overflow-y-auto pr-1">

          {/* SUCCESS SCREEN */}
          {uploadResult ? (
            <div className="py-6 text-center space-y-5 animate-in zoom-in-95 duration-300">
              <div className="w-20 h-20 bg-emerald-50 dark:bg-emerald-950/60 rounded-full flex items-center justify-center mx-auto text-emerald-600 border-2 border-emerald-500/50 shadow-lg shadow-emerald-500/20">
                <CheckIcon className="w-10 h-10" />
              </div>
              <div className="space-y-1">
                <h3 className="text-2xl font-black text-slate-900 dark:text-white">
                  Published to YouTube!
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                  Your tour was uploaded to YouTube as <strong className="uppercase font-bold text-indigo-600 dark:text-indigo-400">{uploadResult.privacyStatus}</strong>. It is now processing and ready for viewing.
                </p>
              </div>

              <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700 text-left max-w-lg mx-auto space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-500 dark:text-slate-400">Video Title</span>
                  <span className="font-semibold text-slate-900 dark:text-white truncate max-w-[260px]">{uploadResult.title}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-500 dark:text-slate-400">YouTube URL</span>
                  <span className="font-mono text-indigo-600 dark:text-indigo-400 font-bold truncate max-w-[260px]">{uploadResult.videoUrl}</span>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
                <a
                  href={uploadResult.videoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full sm:w-auto px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-xl shadow-lg shadow-red-600/20 transition flex items-center justify-center gap-2"
                >
                  <ArrowTopRightOnSquareIcon className="w-4 h-4" />
                  Watch on YouTube
                </a>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="w-full sm:w-auto px-5 py-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-xl transition flex items-center justify-center gap-2"
                >
                  {copiedLink ? <CheckIcon className="w-4 h-4 text-emerald-600" /> : <SparklesIcon className="w-4 h-4" />}
                  {copiedLink ? "Link Copied!" : "Copy Link"}
                </button>
              </div>
            </div>
          ) : isUploading ? (
            /* UPLOADING PROGRESS SCREEN */
            <div className="py-10 text-center space-y-6">
              <div className="relative w-32 h-32 mx-auto">
                <div className="absolute inset-0 border-[8px] border-slate-100 dark:border-slate-800 rounded-full" />
                <div 
                  className="absolute inset-0 border-[8px] border-red-600 rounded-full transition-all duration-500 shadow-md"
                  style={{ clipPath: `conic-gradient(white ${uploadProgress}%, transparent 0)` }}
                />
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <ArrowUpTrayIcon className="w-8 h-8 text-red-600 animate-bounce" />
                  <span className="text-xs font-black text-slate-800 dark:text-white mt-1">{uploadProgress}%</span>
                </div>
              </div>

              <div className="space-y-2 max-w-md mx-auto">
                <h3 className="text-lg font-black text-slate-900 dark:text-white">
                  Broadcasting Master Video to YouTube
                </h3>
                <p className="text-xs text-red-600 dark:text-red-400 font-bold tracking-wide animate-pulse">
                  {uploadStage}
                </p>
                <p className="text-[11px] text-slate-400">
                  Uploading {totalClipsCount} scenes ({Math.floor(totalDurationSeconds)}s) with AI-generated metadata.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* STEP 1: AUTHENTICATION / ACCOUNT IDENTIFIER */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <ShieldCheckIcon className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    YouTube Channel / User Account
                  </label>
                  {accessToken && (
                    <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                      Connected
                    </span>
                  )}
                </div>

                {!accessToken ? (
                  <div className="space-y-3">
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      To publish this video, sign in with the Google Account that owns your YouTube channel. TourGenie uses your authorized account to upload the master file and apply title, description, and tags.
                    </p>
                    
                    {authError && (
                      <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs font-semibold text-rose-700 dark:text-rose-300">
                        {authError}
                      </div>
                    )}

                    {/* Official Sign in with Google Button */}
                    <button
                      type="button"
                      onClick={handleConnectGoogle}
                      disabled={isAuthenticating}
                      className="w-full sm:w-auto px-5 py-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 font-bold text-xs shadow-sm flex items-center justify-center gap-3 transition active:scale-95 disabled:opacity-50"
                    >
                      {isAuthenticating ? (
                        <ArrowPathIcon className="w-4 h-4 animate-spin text-indigo-600" />
                      ) : (
                        <svg className="w-4 h-4" viewBox="0 0 48 48">
                          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                        </svg>
                      )}
                      {isAuthenticating ? "Connecting Google Account..." : "Connect Google & YouTube Channel"}
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3 p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
                    <div className="flex items-center gap-3">
                      {channelInfo?.avatarUrl ? (
                        <img 
                          src={channelInfo.avatarUrl} 
                          alt={channelInfo.title} 
                          className="w-10 h-10 rounded-full border border-slate-200 dark:border-slate-700 object-cover" 
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-950 text-red-600 flex items-center justify-center font-bold text-sm">
                          YT
                        </div>
                      )}
                      <div>
                        <div className="text-xs font-black text-slate-900 dark:text-white flex items-center gap-1.5">
                          {channelInfo?.title || "Connected YouTube Channel"}
                          {channelInfo?.customUrl && (
                            <span className="text-[11px] font-normal text-slate-400">
                              ({channelInfo.customUrl})
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          Posting directly to this channel
                          {channelInfo?.videoCount ? ` • ${channelInfo.videoCount} existing videos` : ""}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleDisconnect}
                      className="text-[11px] font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:underline px-2 py-1"
                    >
                      Switch Account
                    </button>
                  </div>
                )}
              </div>

              {/* STEP 2: METADATA & BROADCAST CONFIGURATION */}
              <div className="space-y-4">
                {/* Title */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      Video Title <span className="text-red-500">*</span>
                    </label>
                    <span className="text-[10px] text-slate-400">
                      {title.length}/100
                    </span>
                  </div>
                  <input
                    type="text"
                    maxLength={100}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="TourGenie 90s App Tour"
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>

                {/* Description */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      Description & Timestamps
                    </label>
                    <span className="text-[10px] text-slate-400">
                      {description.length}/5000
                    </span>
                  </div>
                  <textarea
                    rows={4}
                    maxLength={5000}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="App overview, timestamps, and feature breakdown..."
                    className="w-full p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500 font-sans leading-relaxed"
                  />
                </div>

                {/* Tags */}
                <div>
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1.5">
                    SEO Tags (press Enter or comma)
                  </label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {tags.map((tag) => (
                      <span 
                        key={tag}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-[11px] font-bold border border-indigo-200 dark:border-indigo-800"
                      >
                        #{tag}
                        <button 
                          type="button"
                          onClick={() => handleRemoveTag(tag)}
                          className="hover:text-red-500"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={handleAddTag}
                    placeholder="Add tags (e.g. apptour, react, tutorial)..."
                    className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>

                {/* Privacy Status */}
                <div>
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-2">
                    Visibility / Privacy Status
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setPrivacyStatus('unlisted')}
                      className={`p-3 rounded-xl border text-left transition flex flex-col justify-between ${
                        privacyStatus === 'unlisted'
                          ? 'bg-red-50 dark:bg-red-950/40 border-red-500 text-red-900 dark:text-red-200'
                          : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-bold text-xs">
                        <EyeIcon className="w-4 h-4 text-red-600" />
                        Unlisted
                      </div>
                      <span className="text-[10px] opacity-80 mt-1">Recommended for review before launch</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setPrivacyStatus('public')}
                      className={`p-3 rounded-xl border text-left transition flex flex-col justify-between ${
                        privacyStatus === 'public'
                          ? 'bg-red-50 dark:bg-red-950/40 border-red-500 text-red-900 dark:text-red-200'
                          : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-bold text-xs">
                        <GlobeAmericasIcon className="w-4 h-4 text-red-600" />
                        Public
                      </div>
                      <span className="text-[10px] opacity-80 mt-1">Visible to all and searchable on YouTube</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setPrivacyStatus('private')}
                      className={`p-3 rounded-xl border text-left transition flex flex-col justify-between ${
                        privacyStatus === 'private'
                          ? 'bg-red-50 dark:bg-red-950/40 border-red-500 text-red-900 dark:text-red-200'
                          : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-bold text-xs">
                        <LockClosedIcon className="w-4 h-4 text-red-600" />
                        Private
                      </div>
                      <span className="text-[10px] opacity-80 mt-1">Only viewable by your account</span>
                    </button>
                  </div>
                </div>

                {uploadError && (
                  <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs font-semibold text-rose-700 dark:text-rose-300">
                    {uploadError}
                  </div>
                )}
              </div>

              {/* MANDATORY USER CONFIRMATION BANNER */}
              {showConfirm ? (
                <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 space-y-3 animate-in fade-in">
                  <div className="flex items-start gap-2.5">
                    <VideoCameraIcon className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <h4 className="text-xs font-black text-amber-900 dark:text-amber-200 uppercase tracking-wide">
                        Confirm YouTube Broadcast
                      </h4>
                      <p className="text-xs text-amber-800 dark:text-amber-300">
                        You are about to upload this master video ({totalClipsCount} scenes, {Math.floor(totalDurationSeconds)}s) to YouTube channel: <strong>{channelInfo?.title || "your connected account"}</strong> as <strong>{privacyStatus.toUpperCase()}</strong>.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setShowConfirm(false)}
                      className="px-4 py-2 rounded-xl bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold border border-slate-200 dark:border-slate-700 hover:bg-slate-100"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleStartPublish}
                      className="px-5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-black shadow-md flex items-center gap-1.5"
                    >
                      Confirm & Broadcast Now
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          )}

        </div>

        {/* Footer Buttons */}
        {!uploadResult && !isUploading && (
          <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div className="text-[11px] text-slate-400">
              {accessToken ? `Ready to publish as ${channelInfo?.title || "Google User"}` : "Sign in required to publish"}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs transition"
              >
                Cancel
              </button>
              
              {!showConfirm && (
                <button
                  type="button"
                  onClick={() => {
                    if (!accessToken) {
                      handleConnectGoogle();
                    } else {
                      setShowConfirm(true);
                    }
                  }}
                  className="px-6 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-black text-xs shadow-lg shadow-red-600/20 transition active:scale-95 flex items-center gap-2"
                >
                  <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                  </svg>
                  {accessToken ? "Publish to YouTube" : "Connect & Publish"}
                </button>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
