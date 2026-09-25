import React, { useState, useEffect, useRef } from 'react';
import { 
  X, 
  ArrowUp, 
  ArrowDown, 
  Play, 
  Square, 
  RefreshCw, 
  Volume2, 
  Check, 
  AlertCircle, 
  Film, 
  SlidersHorizontal, 
  ArrowRightLeft, 
  Sparkles, 
  FileText, 
  ChevronDown, 
  ChevronUp,
  Clock,
  Layers,
  Wand2
} from 'lucide-react';
import { pcmBase64ToWavBlob } from '../services/screenStudioEngine';

export interface SceneMatchItem {
  id: string;
  title?: string;
  previewUrl: string;
  duration: number;
  narration: string;
  audioUrl?: string;
  screenshotUrl?: string;
  rawScreenshot?: string;
  file?: File;
  videoUrl?: string;
  // Tracking if script was edited or swapped
  isAudioDirty?: boolean;
}

interface SceneScriptMatcherModalProps {
  isOpen: boolean;
  onClose: () => void;
  scenes: SceneMatchItem[];
  onConfirmAndStitch: (matchedScenes: SceneMatchItem[]) => Promise<void>;
  onSaveToTimeline: (matchedScenes: SceneMatchItem[]) => void;
  onGenerateVoiceover?: (narrationText: string) => Promise<string>;
  isStitching?: boolean;
  renderStage?: string;
  renderProgress?: number;
}

export const SceneScriptMatcherModal: React.FC<SceneScriptMatcherModalProps> = ({
  isOpen,
  onClose,
  scenes: initialScenes,
  onConfirmAndStitch,
  onSaveToTimeline,
  onGenerateVoiceover,
  isStitching = false,
  renderStage = '',
  renderProgress = 0
}) => {
  const [items, setItems] = useState<SceneMatchItem[]>([]);
  const [playingAudioIdx, setPlayingAudioIdx] = useState<number | null>(null);
  const [generatingAudioIdx, setGeneratingAudioIdx] = useState<number | null>(null);
  const [isBulkGenerating, setIsBulkGenerating] = useState<boolean>(false);
  const [showBulkPaste, setShowBulkPaste] = useState<boolean>(false);
  const [bulkScriptText, setBulkScriptText] = useState<string>('');
  const [previewVideoIdx, setPreviewVideoIdx] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Initialize or reset internal state when modal opens or initialScenes change
  useEffect(() => {
    if (isOpen && initialScenes) {
      setItems(initialScenes.map(s => ({ ...s, isAudioDirty: !s.audioUrl })));
      setErrorMessage(null);
    }
  }, [isOpen, initialScenes]);

  // Clean up audio playback on unmount or close
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  if (!isOpen) return null;

  // --- Audio Playback ---
  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingAudioIdx(null);
  };

  const playVoiceover = async (idx: number) => {
    const item = items[idx];
    if (!item) return;

    if (playingAudioIdx === idx) {
      stopAudio();
      return;
    }

    stopAudio();

    try {
      let audioBase64 = item.audioUrl;
      // If no audio exists or if it's dirty, generate it if generator available
      if (!audioBase64 && item.narration.trim() && onGenerateVoiceover) {
        setGeneratingAudioIdx(idx);
        audioBase64 = await onGenerateVoiceover(item.narration);
        setItems(prev => prev.map((it, i) => i === idx ? { ...it, audioUrl: audioBase64, isAudioDirty: false } : it));
        setGeneratingAudioIdx(null);
      }

      if (!audioBase64) {
        setErrorMessage(`No voiceover audio generated for Scene ${idx + 1}. Please synthesize voiceover.`);
        return;
      }

      const blob = pcmBase64ToWavBlob(audioBase64);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      setPlayingAudioIdx(idx);

      audio.onended = () => {
        setPlayingAudioIdx(null);
        URL.revokeObjectURL(url);
      };
      audio.onerror = () => {
        setPlayingAudioIdx(null);
        URL.revokeObjectURL(url);
      };

      await audio.play();
    } catch (err: any) {
      console.warn("Could not play audio:", err);
      setGeneratingAudioIdx(null);
      setPlayingAudioIdx(null);
      setErrorMessage(err?.message || "Failed to play voiceover audio.");
    }
  };

  // --- Voiceover Generation ---
  const generateVoiceoverForScene = async (idx: number) => {
    const item = items[idx];
    if (!item || !onGenerateVoiceover || !item.narration.trim()) return;

    setGeneratingAudioIdx(idx);
    setErrorMessage(null);
    try {
      const audioBase64 = await onGenerateVoiceover(item.narration);
      setItems(prev => prev.map((it, i) => i === idx ? { ...it, audioUrl: audioBase64, isAudioDirty: false } : it));
    } catch (err: any) {
      setErrorMessage(`Failed to synthesize voiceover for Scene ${idx + 1}: ${err.message}`);
    } finally {
      setGeneratingAudioIdx(null);
    }
  };

  // --- Bulk Voiceover Sync ---
  const syncAllVoiceovers = async () => {
    if (!onGenerateVoiceover) return;
    setIsBulkGenerating(true);
    setErrorMessage(null);

    const updated = [...items];
    try {
      for (let i = 0; i < updated.length; i++) {
        if (updated[i].narration.trim() && (updated[i].isAudioDirty || !updated[i].audioUrl)) {
          setGeneratingAudioIdx(i);
          const audioBase64 = await onGenerateVoiceover(updated[i].narration);
          updated[i].audioUrl = audioBase64;
          updated[i].isAudioDirty = false;
          setItems([...updated]);
        }
      }
    } catch (err: any) {
      setErrorMessage(`Bulk audio generation interrupted: ${err.message}`);
    } finally {
      setGeneratingAudioIdx(null);
      setIsBulkGenerating(false);
    }
  };

  // --- Scene Reordering ---
  const moveScene = (index: number, direction: 'up' | 'down') => {
    stopAudio();
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= items.length) return;

    setItems(prev => {
      const next = [...prev];
      const temp = next[index];
      next[index] = next[targetIndex];
      next[targetIndex] = temp;
      return next;
    });
  };

  // --- Script Swapping between scenes ---
  const swapScripts = (idxA: number, idxB: number) => {
    if (idxA === idxB || idxA < 0 || idxB < 0 || idxA >= items.length || idxB >= items.length) return;
    stopAudio();

    setItems(prev => {
      const next = [...prev];
      const scriptA = next[idxA].narration;
      const audioA = next[idxA].audioUrl;
      const dirtyA = next[idxA].isAudioDirty;

      next[idxA] = {
        ...next[idxA],
        narration: next[idxB].narration,
        audioUrl: next[idxB].audioUrl,
        isAudioDirty: next[idxB].isAudioDirty
      };

      next[idxB] = {
        ...next[idxB],
        narration: scriptA,
        audioUrl: audioA,
        isAudioDirty: dirtyA
      };

      return next;
    });
  };

  // --- Direct Script Edit ---
  const handleScriptChange = (idx: number, newText: string) => {
    setItems(prev => prev.map((item, i) => {
      if (i === idx) {
        const isChanged = newText.trim() !== item.narration.trim();
        return {
          ...item,
          narration: newText,
          isAudioDirty: isChanged ? true : item.isAudioDirty
        };
      }
      return item;
    }));
  };

  // --- Bulk Script Distribution ---
  const handleDistributeBulkScript = () => {
    if (!bulkScriptText.trim() || items.length === 0) return;
    stopAudio();

    // Split by double newline or numbered items like "1.", "Scene 1:", etc.
    const rawLines = bulkScriptText
      .split(/\n\s*\n|\n(?=\d+[\.\)])|\n(?=Scene\s+\d+:)/i)
      .map(s => s.replace(/^\d+[\.\)]\s*/, '').replace(/^Scene\s+\d+:\s*/i, '').trim())
      .filter(Boolean);

    if (rawLines.length === 0) return;

    setItems(prev => prev.map((item, idx) => {
      if (idx < rawLines.length) {
        const newScript = rawLines[idx];
        const isChanged = newScript !== item.narration;
        return {
          ...item,
          narration: newScript,
          isAudioDirty: isChanged ? true : item.isAudioDirty
        };
      }
      return item;
    }));

    setShowBulkPaste(false);
  };

  // Estimated spoken duration (~2.5 words/sec)
  const estimateDuration = (text: string) => {
    const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
    return Math.max(5, Math.ceil(wordCount / 2.5));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md overflow-y-auto animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700/80 rounded-3xl w-full max-w-6xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        
        {/* Header */}
        <div className="bg-slate-950/80 border-b border-slate-800 p-5 sm:p-6 flex items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <span className="p-2 bg-indigo-500/20 text-indigo-400 rounded-xl border border-indigo-500/30">
                <ArrowRightLeft className="w-5 h-5" />
              </span>
              <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2">
                Match Scenes with Scripts
                <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-indigo-900/60 text-indigo-300 border border-indigo-700/50">
                  {items.length} {items.length === 1 ? 'Scene' : 'Scenes'}
                </span>
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-slate-400">
              Ensure every scene visual matches its corresponding voiceover script before stitching into the master broadcast video.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowBulkPaste(!showBulkPaste)}
              className="hidden sm:flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold border border-slate-700 transition"
              title="Paste a complete script and distribute to scenes"
            >
              <FileText className="w-4 h-4 text-indigo-400" />
              Bulk Script Tool
              {showBulkPaste ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {onGenerateVoiceover && (
              <button
                onClick={syncAllVoiceovers}
                disabled={isBulkGenerating || isStitching}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 border border-indigo-500/40 rounded-xl text-xs font-bold transition disabled:opacity-50"
                title="Synthesize audio for any changed or swapped scripts"
              >
                <Wand2 className={`w-3.5 h-3.5 ${isBulkGenerating ? 'animate-spin' : ''}`} />
                {isBulkGenerating ? 'Syncing...' : 'Sync All Voiceovers'}
              </button>
            )}

            <button
              onClick={() => {
                stopAudio();
                onClose();
              }}
              disabled={isStitching}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Bulk Script Tool Drawer */}
        {showBulkPaste && (
          <div className="bg-slate-950 border-b border-indigo-950 p-4 sm:p-6 space-y-3 animate-in slide-in-from-top duration-300">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-400" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-300">
                  Paste Full Tour Script / Key Features
                </h4>
              </div>
              <span className="text-[11px] text-slate-400">
                Separate scenes with blank lines or numbers (1., 2., 3.)
              </span>
            </div>
            <textarea
              rows={4}
              value={bulkScriptText}
              onChange={(e) => setBulkScriptText(e.target.value)}
              placeholder="Paste your full script here. TourGenie will map paragraph 1 to Scene 1, paragraph 2 to Scene 2, etc..."
              className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-xs text-slate-200 placeholder-slate-500 focus:ring-2 focus:ring-indigo-500 outline-none"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowBulkPaste(false)}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={handleDistributeBulkScript}
                disabled={!bulkScriptText.trim()}
                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition disabled:opacity-50"
              >
                Distribute to Scenes (1..{items.length})
              </button>
            </div>
          </div>
        )}

        {/* Error message banner */}
        {errorMessage && (
          <div className="bg-red-500/10 border-b border-red-500/30 px-6 py-2.5 flex items-center justify-between text-xs text-red-300">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button onClick={() => setErrorMessage(null)} className="text-red-400 hover:text-white text-xs font-bold">
              Dismiss
            </button>
          </div>
        )}

        {/* Stitching Progress Banner */}
        {isStitching && (
          <div className="bg-indigo-950/80 border-b border-indigo-700/50 p-4 px-6 space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-indigo-200">
              <span className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />
                {renderStage || 'Stitching scenes and synchronized voiceovers into Master MP4...'}
              </span>
              <span>{renderProgress}%</span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
              <div 
                className="bg-indigo-500 h-full transition-all duration-300 ease-out"
                style={{ width: `${Math.max(5, renderProgress)}%` }}
              />
            </div>
          </div>
        )}

        {/* Scene List Body */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-4">
          <div className="bg-slate-800/40 border border-slate-800 rounded-2xl p-3.5 flex items-center justify-between text-xs text-slate-300">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-400" />
              <span>
                <strong>Tip:</strong> If visual scenes were captured or uploaded out of order, use the <strong>↑ Move Earlier</strong> / <strong>↓ Move Later</strong> buttons. To reassign which narration plays on each visual, use the <strong>Match Script</strong> dropdown or edit the script directly.
              </span>
            </div>
          </div>

          {items.map((item, idx) => {
            const isVideo = item.previewUrl && !item.previewUrl.startsWith('data:image') && !item.previewUrl.endsWith('.png') && !item.previewUrl.endsWith('.jpg') && !item.previewUrl.endsWith('.jpeg') && !item.previewUrl.endsWith('.webp');
            const hasAudio = !!item.audioUrl;
            const isPlaying = playingAudioIdx === idx;
            const isGeneratingThisAudio = generatingAudioIdx === idx;

            return (
              <div 
                key={item.id || `scene-item-${idx}`}
                className={`bg-slate-800/80 border rounded-2xl p-4 sm:p-5 transition-all ${
                  item.isAudioDirty 
                    ? 'border-amber-500/40 shadow-sm shadow-amber-500/5' 
                    : 'border-slate-700/80 hover:border-slate-600'
                }`}
              >
                <div className="flex flex-col lg:flex-row gap-5">
                  
                  {/* Left Column: Scene Visual & Order Controls */}
                  <div className="w-full lg:w-72 flex-shrink-0 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black uppercase tracking-wider text-indigo-400 flex items-center gap-1.5">
                        <Film className="w-3.5 h-3.5" />
                        Scene {idx + 1} of {items.length}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => moveScene(idx, 'up')}
                          disabled={idx === 0 || isStitching}
                          className="p-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-30 transition"
                          title="Move scene earlier in timeline"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => moveScene(idx, 'down')}
                          disabled={idx === items.length - 1 || isStitching}
                          className="p-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-30 transition"
                          title="Move scene later in timeline"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Visual Media Container */}
                    <div className="relative aspect-video rounded-xl overflow-hidden bg-slate-950 border border-slate-700/60 shadow-inner group">
                      {isVideo ? (
                        <video 
                          src={item.previewUrl} 
                          className="w-full h-full object-contain" 
                          controls={previewVideoIdx === idx}
                          playsInline
                        />
                      ) : (
                        <img 
                          src={item.previewUrl} 
                          alt={item.title || `Scene ${idx + 1}`} 
                          className="w-full h-full object-contain" 
                        />
                      )}
                      
                      <div className="absolute top-2 left-2 bg-black/70 backdrop-blur-sm px-2 py-0.5 rounded text-[10px] font-bold text-white flex items-center gap-1">
                        <Clock className="w-3 h-3 text-indigo-400" />
                        {Math.round(item.duration || 30)}s
                      </div>

                      {isVideo && previewVideoIdx !== idx && (
                        <button
                          onClick={() => setPreviewVideoIdx(idx)}
                          className="absolute inset-0 m-auto w-10 h-10 rounded-full bg-black/60 text-white flex items-center justify-center opacity-70 group-hover:opacity-100 transition shadow-lg"
                          title="Preview video"
                        >
                          <Play className="w-4 h-4 fill-white ml-0.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Right Column: Script Matching & Voiceover */}
                  <div className="flex-1 space-y-3">
                    
                    {/* Header: Script assignment selector & Swap tool */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-700/60">
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                          <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-400" />
                          Matched Script / Narration:
                        </label>
                      </div>

                      {/* Swap script dropdown */}
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-slate-400">Swap with:</span>
                        <select
                          className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200 outline-none hover:border-indigo-500 transition"
                          value=""
                          onChange={(e) => {
                            const targetIdx = parseInt(e.target.value, 10);
                            if (!isNaN(targetIdx)) {
                              swapScripts(idx, targetIdx);
                            }
                          }}
                        >
                          <option value="" disabled>Select scene to swap with...</option>
                          {items.map((other, otherIdx) => {
                            if (otherIdx === idx) return null;
                            const snippet = other.narration ? `"${other.narration.substring(0, 30)}..."` : `(Empty)`;
                            return (
                              <option key={otherIdx} value={otherIdx}>
                                Scene {otherIdx + 1}: {snippet}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                    </div>

                    {/* Script Textarea */}
                    <div className="space-y-1">
                      <textarea
                        rows={3}
                        value={item.narration}
                        onChange={(e) => handleScriptChange(idx, e.target.value)}
                        placeholder={`Enter voiceover script for Scene ${idx + 1}...`}
                        className="w-full bg-slate-900/90 border border-slate-700 rounded-xl p-3 text-xs sm:text-sm text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none leading-relaxed resize-y font-normal"
                      />
                      <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
                        <span>
                          {item.narration.trim().split(/\s+/).filter(Boolean).length} words • ~{estimateDuration(item.narration)}s speech time
                        </span>
                        {item.isAudioDirty ? (
                          <span className="text-amber-400 font-semibold flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" /> Voiceover audio needs re-sync
                          </span>
                        ) : hasAudio ? (
                          <span className="text-emerald-400 font-semibold flex items-center gap-1">
                            <Check className="w-3 h-3" /> Voiceover synced
                          </span>
                        ) : (
                          <span className="text-slate-400">No voiceover audio synthesized</span>
                        )}
                      </div>
                    </div>

                    {/* Audio Preview & Synthesis Buttons */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => playVoiceover(idx)}
                          disabled={!item.narration.trim() || isGeneratingThisAudio}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
                            isPlaying
                              ? 'bg-amber-600 hover:bg-amber-500 text-white'
                              : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
                          } disabled:opacity-40`}
                        >
                          {isPlaying ? (
                            <>
                              <Square className="w-3.5 h-3.5 fill-white" /> Stop
                            </>
                          ) : (
                            <>
                              <Volume2 className="w-3.5 h-3.5 text-indigo-400" /> Play Voiceover
                            </>
                          )}
                        </button>

                        {onGenerateVoiceover && (
                          <button
                            type="button"
                            onClick={() => generateVoiceoverForScene(idx)}
                            disabled={!item.narration.trim() || isGeneratingThisAudio}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                              item.isAudioDirty
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30'
                                : 'bg-slate-700/60 text-slate-300 hover:bg-slate-700'
                            } disabled:opacity-40`}
                            title="Synthesize fresh Gemini voiceover for this script"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingThisAudio ? 'animate-spin' : ''}`} />
                            {isGeneratingThisAudio ? 'Synthesizing...' : (item.isAudioDirty ? 'Re-synthesize Audio' : 'Synthesize Voiceover')}
                          </button>
                        )}
                      </div>

                      {/* Quick assignment button from existing scene scripts */}
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                        <span>Assign script from:</span>
                        <select
                          className="bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-xs text-slate-300 outline-none"
                          value=""
                          onChange={(e) => {
                            const sourceIdx = parseInt(e.target.value, 10);
                            if (!isNaN(sourceIdx) && items[sourceIdx]) {
                              const chosen = items[sourceIdx];
                              handleScriptChange(idx, chosen.narration);
                              // Copy audio if available
                              if (chosen.audioUrl) {
                                setItems(prev => prev.map((it, i) => i === idx ? { ...it, narration: chosen.narration, audioUrl: chosen.audioUrl, isAudioDirty: false } : it));
                              }
                            }
                          }}
                        >
                          <option value="" disabled>Choose...</option>
                          {items.map((it, sIdx) => (
                            <option key={sIdx} value={sIdx}>
                              Scene {sIdx + 1} Script
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="bg-slate-950 border-t border-slate-800 p-4 sm:p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-xs text-slate-400 space-y-0.5">
            <p className="font-semibold text-slate-300 flex items-center gap-1.5">
              <Check className="w-4 h-4 text-emerald-400" />
              100% Sequence Guaranteed
            </p>
            <p>Master video will stitch scenes in the exact 1..{items.length} sequence above with matching voiceovers.</p>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            <button
              onClick={() => {
                stopAudio();
                onSaveToTimeline(items);
                onClose();
              }}
              disabled={isStitching}
              className="flex-1 sm:flex-initial px-4 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition border border-slate-700 disabled:opacity-50"
            >
              Save Order to Timeline
            </button>

            <button
              onClick={async () => {
                stopAudio();
                await onConfirmAndStitch(items);
              }}
              disabled={isStitching || items.length === 0}
              className="flex-1 sm:flex-initial px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/30 transition active:scale-95 disabled:opacity-50"
            >
              <Sparkles className="w-4 h-4" />
              {isStitching ? 'Stitching Master Video...' : `Confirm & Stitch Master Video (${items.length} Scenes)`}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
