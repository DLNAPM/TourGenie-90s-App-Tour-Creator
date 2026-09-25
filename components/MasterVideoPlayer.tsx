import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  PlayIcon,
  PauseIcon,
  SpeakerWaveIcon,
  SpeakerXMarkIcon,
  ArrowsPointingOutIcon,
  ArrowsPointingInIcon,
  ArrowDownTrayIcon,
  ClockIcon,
  FilmIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  SparklesIcon
} from '@heroicons/react/24/solid';

export interface MasterVideoClip {
  id?: string;
  title?: string;
  analysis?: string;
  duration?: number;
  narration?: string;
  previewUrl?: string;
}

interface MasterVideoPlayerProps {
  src: string;
  clips?: MasterVideoClip[];
  title?: string;
  autoPlay?: boolean;
  onDownload?: () => void;
  className?: string;
  showSceneBar?: boolean;
}

export const MasterVideoPlayer: React.FC<MasterVideoPlayerProps> = ({
  src,
  clips = [],
  title = 'Master Broadcast Video',
  autoPlay = false,
  onDownload,
  className = '',
  showSceneBar = true
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverPosition, setHoverPosition] = useState(0);
  const [rippleAction, setRippleAction] = useState<{ type: 'rewind' | 'forward'; label: string; id: number } | null>(null);
  const [videoLoadError, setVideoLoadError] = useState(false);

  useEffect(() => {
    setVideoLoadError(false);
  }, [src]);

  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);

  // Compute scene time boundaries
  const sceneMarkers = useMemo(() => {
    let accumulated = 0;
    return clips.map((clip, idx) => {
      const clipDuration = clip.duration && clip.duration > 0 ? clip.duration : 30;
      const start = accumulated;
      const end = start + clipDuration;
      accumulated = end;
      return {
        index: idx,
        id: clip.id || `scene_${idx}`,
        title: clip.title || clip.analysis || `Scene ${idx + 1}`,
        startTime: start,
        endTime: end,
        duration: clipDuration,
        narration: clip.narration
      };
    });
  }, [clips]);

  const totalCalculatedDuration = useMemo(() => {
    if (sceneMarkers.length === 0) return 0;
    return sceneMarkers[sceneMarkers.length - 1].endTime;
  }, [sceneMarkers]);

  // Effective duration (prefer native video duration once loaded, fallback to scene sum)
  const effectiveDuration = duration > 0 ? duration : (totalCalculatedDuration > 0 ? totalCalculatedDuration : 1);

  // Identify active scene based on currentTime
  const activeScene = useMemo(() => {
    if (sceneMarkers.length === 0) return null;
    const found = sceneMarkers.find(s => currentTime >= s.startTime && currentTime < s.endTime);
    return found || sceneMarkers[sceneMarkers.length - 1];
  }, [sceneMarkers, currentTime]);

  // Format seconds to mm:ss
  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Trigger brief visual ripple for rewind / forward
  const triggerRipple = (type: 'rewind' | 'forward', label: string) => {
    setRippleAction({ type, label, id: Date.now() });
    setTimeout(() => {
      setRippleAction(null);
    }, 650);
  };

  // Rewind by specified seconds (e.g. 10s or 5s)
  const handleRewind = useCallback((seconds: number = 10) => {
    if (!videoRef.current) return;
    const newTime = Math.max(0, videoRef.current.currentTime - seconds);
    videoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
    triggerRipple('rewind', `-${seconds}s`);
  }, []);

  // Fast forward by specified seconds (e.g. 10s or 5s)
  const handleFastForward = useCallback((seconds: number = 10) => {
    if (!videoRef.current) return;
    const maxDur = effectiveDuration;
    const newTime = Math.min(maxDur, videoRef.current.currentTime + seconds);
    videoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
    triggerRipple('forward', `+${seconds}s`);
  }, [effectiveDuration]);

  // Jump to Previous Scene
  const handleJumpPrevScene = useCallback(() => {
    if (!videoRef.current || sceneMarkers.length === 0) return;
    const cur = videoRef.current.currentTime;
    // Find current scene index
    const curIdx = sceneMarkers.findIndex(s => cur >= s.startTime && cur < s.endTime);
    if (curIdx <= 0) {
      videoRef.current.currentTime = 0;
      setCurrentTime(0);
      triggerRipple('rewind', 'Scene 1');
    } else {
      // If we are more than 2s into current scene, jump to start of current scene; otherwise previous
      const currentMarker = sceneMarkers[curIdx];
      let targetIdx = curIdx;
      if (cur - currentMarker.startTime < 2.0 && curIdx > 0) {
        targetIdx = curIdx - 1;
      }
      const targetTime = sceneMarkers[targetIdx].startTime;
      videoRef.current.currentTime = targetTime;
      setCurrentTime(targetTime);
      triggerRipple('rewind', `Scene ${targetIdx + 1}`);
    }
  }, [sceneMarkers]);

  // Jump to Next Scene
  const handleJumpNextScene = useCallback(() => {
    if (!videoRef.current || sceneMarkers.length === 0) return;
    const cur = videoRef.current.currentTime;
    const curIdx = sceneMarkers.findIndex(s => cur >= s.startTime && cur < s.endTime);
    if (curIdx >= 0 && curIdx < sceneMarkers.length - 1) {
      const nextScene = sceneMarkers[curIdx + 1];
      videoRef.current.currentTime = nextScene.startTime;
      setCurrentTime(nextScene.startTime);
      triggerRipple('forward', `Scene ${curIdx + 2}`);
    } else {
      // Near end
      handleFastForward(10);
    }
  }, [sceneMarkers, handleFastForward]);

  // Seek to specific timestamp
  const seekTo = useCallback((targetTime: number) => {
    if (!videoRef.current) return;
    const clamped = Math.max(0, Math.min(effectiveDuration, targetTime));
    videoRef.current.currentTime = clamped;
    setCurrentTime(clamped);
  }, [effectiveDuration]);

  // Play / Pause toggle
  const togglePlay = useCallback(() => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().catch(e => console.warn('Play error:', e));
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  }, []);

  // Toggle Mute
  const toggleMute = () => {
    if (!videoRef.current) return;
    const nextMuted = !isMuted;
    videoRef.current.muted = nextMuted;
    setIsMuted(nextMuted);
  };

  // Change volume
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (videoRef.current) {
      videoRef.current.volume = val;
      if (val === 0) {
        videoRef.current.muted = true;
        setIsMuted(true);
      } else if (isMuted) {
        videoRef.current.muted = false;
        setIsMuted(false);
      }
    }
  };

  // Change playback rate
  const handleRateChange = (rate: number) => {
    setPlaybackRate(rate);
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
    }
  };

  // Fullscreen toggle
  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(err => console.warn('Fullscreen err:', err));
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(err => console.warn('Exit fullscreen err:', err));
      setIsFullscreen(false);
    }
  };

  // Video event handlers
  const handleLoadedMetadata = () => {
    if (!videoRef.current) return;
    const d = videoRef.current.duration;
    if (d === Infinity || isNaN(d)) {
      // Fix for WebM blobs missing duration cues
      videoRef.current.currentTime = 1e101;
      videoRef.current.ontimeupdate = function() {
        this.ontimeupdate = null;
        if (videoRef.current) {
          videoRef.current.currentTime = 0;
          setDuration(videoRef.current.duration || totalCalculatedDuration);
        }
      };
    } else {
      setDuration(d);
    }
  };

  const handleTimeUpdate = () => {
    if (!videoRef.current || isScrubbing) return;
    setCurrentTime(videoRef.current.currentTime);
  };

  const handleVideoEnded = () => {
    setIsPlaying(false);
  };

  // Mouse move control visibility
  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) {
        setShowControls(false);
      }
    }, 3200);
  };

  // Keyboard navigation shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input or textarea
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      if (e.key === ' ' || e.key === 'k') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleRewind(5);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleFastForward(5);
      } else if (e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        handleRewind(10);
      } else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        handleFastForward(10);
      } else if (e.key === '[') {
        e.preventDefault();
        handleJumpPrevScene();
      } else if (e.key === ']') {
        e.preventDefault();
        handleJumpNextScene();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        toggleMute();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, handleRewind, handleFastForward, handleJumpPrevScene, handleJumpNextScene]);

  // Scrub bar interactions
  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const target = pos * effectiveDuration;
    seekTo(target);
  };

  const handleProgressMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverPosition(pos);
    setHoverTime(pos * effectiveDuration);
  };

  const handleProgressMouseLeave = () => {
    setHoverTime(null);
  };

  // Hover scene name
  const hoveredScene = useMemo(() => {
    if (hoverTime === null || sceneMarkers.length === 0) return null;
    return sceneMarkers.find(s => hoverTime >= s.startTime && hoverTime < s.endTime) || null;
  }, [hoverTime, sceneMarkers]);

  // Double click on left / right to rewind or forward
  const handleVideoAreaClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.detail === 2) {
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      if (clickX < rect.width * 0.4) {
        handleRewind(10);
      } else if (clickX > rect.width * 0.6) {
        handleFastForward(10);
      }
    } else if (e.detail === 1) {
      togglePlay();
    }
  };

  return (
    <div className={`flex flex-col gap-4 w-full select-none ${className}`}>
      {/* Master Video Display Box */}
      <div
        ref={containerRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => isPlaying && setShowControls(false)}
        className="relative w-full aspect-video bg-black rounded-3xl overflow-hidden border border-white/10 shadow-2xl group flex items-center justify-center"
      >
        <video
          ref={videoRef}
          src={src}
          className="w-full h-full object-contain cursor-pointer"
          playsInline
          autoPlay={autoPlay}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onEnded={handleVideoEnded}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onError={() => setVideoLoadError(true)}
        />

        {/* Playback Error Overlay */}
        {videoLoadError && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center p-6 text-center bg-black/85 backdrop-blur-md">
            <div className="w-12 h-12 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center mb-3">
              <FilmIcon className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-bold text-white mb-1">
              Video Preview Unavailable
            </h4>
            <p className="text-xs text-slate-300 max-w-md mb-4 leading-relaxed">
              The temporary browser video stream has expired or the file could not be decoded. Please re-stitch your scenes or re-upload your downloaded video file.
            </p>
          </div>
        )}

        {/* Click Area Overlay */}
        <div
          onClick={handleVideoAreaClick}
          className="absolute inset-0 z-10 cursor-pointer"
        />

        {/* Top HUD: Current Scene Info Banner & Badges */}
        <div
          className={`absolute top-4 left-4 right-4 z-20 flex items-center justify-between pointer-events-none transition-opacity duration-300 ${
            showControls ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <div className="flex items-center gap-2">
            <div className="bg-slate-900/85 backdrop-blur-xl px-3.5 py-1.5 rounded-xl border border-white/15 shadow-xl inline-flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[11px] font-black uppercase tracking-wider text-white">
                Master Tour Video
              </span>
              <span className="text-[10px] text-indigo-300 font-bold bg-indigo-500/20 px-2 py-0.5 rounded-md border border-indigo-500/30">
                {clips.length} Scenes
              </span>
            </div>

            {activeScene && (
              <div className="bg-indigo-600/90 backdrop-blur-xl px-3.5 py-1.5 rounded-xl border border-indigo-400/30 text-white shadow-xl hidden sm:inline-flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-200">
                  Scene {activeScene.index + 1}/{sceneMarkers.length}:
                </span>
                <span className="text-xs font-black truncate max-w-[200px] md:max-w-[280px]">
                  {activeScene.title}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 pointer-events-auto">
            {onDownload && (
              <button
                onClick={onDownload}
                title="Download Stitched Master Video"
                className="bg-slate-900/80 hover:bg-slate-800 text-white px-3 py-1.5 rounded-xl text-xs font-bold border border-white/10 backdrop-blur-md flex items-center gap-1.5 transition active:scale-95"
              >
                <ArrowDownTrayIcon className="w-3.5 h-3.5 text-emerald-400" />
                <span className="hidden md:inline">Download MP4</span>
              </button>
            )}
          </div>
        </div>

        {/* Center Ripple Feedback Indicator for Rewind / Forward */}
        {rippleAction && (
          <div
            key={rippleAction.id}
            className={`absolute z-30 pointer-events-none flex flex-col items-center justify-center p-6 rounded-full bg-indigo-600/90 text-white shadow-2xl border-2 border-white/40 animate-out fade-out zoom-out duration-500 ${
              rippleAction.type === 'rewind' ? 'left-1/4' : 'right-1/4'
            }`}
          >
            {rippleAction.type === 'rewind' ? (
              <svg className="w-10 h-10 mb-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.333 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z" />
              </svg>
            ) : (
              <svg className="w-10 h-10 mb-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.934 12.8a1 1 0 000-1.6l-5.334-4A1 1 0 005 8v8a1 1 0 001.6.8l5.334-4zM19.934 12.8a1 1 0 000-1.6l-5.334-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.334-4z" />
              </svg>
            )}
            <span className="text-sm font-black tracking-wider uppercase">{rippleAction.label}</span>
          </div>
        )}

        {/* Big Center Play/Pause button when paused */}
        {!isPlaying && (
          <div
            onClick={togglePlay}
            className="absolute z-20 w-20 h-20 bg-indigo-600/90 hover:bg-indigo-500 text-white rounded-full flex items-center justify-center cursor-pointer shadow-[0_0_50px_rgba(79,70,229,0.6)] border-2 border-white/20 transition transform hover:scale-110 active:scale-95"
          >
            <PlayIcon className="w-10 h-10 translate-x-0.5" />
          </div>
        )}

        {/* Bottom Video Controls Overlay */}
        <div
          className={`absolute bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-slate-950 via-slate-950/80 to-transparent pt-12 pb-4 px-4 md:px-6 space-y-3 transition-opacity duration-300 ${
            showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          {/* Timeline / Progress Bar with Scene Markers */}
          <div
            ref={progressBarRef}
            onClick={handleProgressClick}
            onMouseMove={handleProgressMouseMove}
            onMouseLeave={handleProgressMouseLeave}
            className="relative w-full h-3 bg-white/20 hover:h-4 rounded-full cursor-pointer transition-all duration-150 flex items-center group/scrubber border border-white/10"
          >
            {/* Played Fill */}
            <div
              className="h-full bg-gradient-to-r from-indigo-500 via-indigo-400 to-emerald-400 rounded-full relative"
              style={{ width: `${Math.min(100, (currentTime / effectiveDuration) * 100)}%` }}
            >
              {/* Scrubber Knob */}
              <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-4 h-4 bg-white rounded-full shadow-lg border-2 border-indigo-600 scale-0 group-hover/scrubber:scale-100 transition-transform" />
            </div>

            {/* Scene Chapter Tick Marks */}
            {sceneMarkers.map((marker, idx) => {
              if (idx === 0) return null;
              const leftPercent = (marker.startTime / effectiveDuration) * 100;
              return (
                <div
                  key={marker.id}
                  className="absolute top-0 bottom-0 w-0.5 bg-white/60 pointer-events-none z-10"
                  style={{ left: `${leftPercent}%` }}
                  title={`Scene ${marker.index + 1}: ${marker.title}`}
                />
              );
            })}

            {/* Hover Tooltip */}
            {hoverTime !== null && (
              <div
                className="absolute bottom-6 -translate-x-1/2 pointer-events-none z-30 bg-slate-900/95 text-white border border-white/20 px-2.5 py-1 rounded-lg text-xs font-mono shadow-2xl flex flex-col items-center"
                style={{ left: `${hoverPosition * 100}%` }}
              >
                <span className="font-bold text-indigo-300">{formatTime(hoverTime)}</span>
                {hoveredScene && (
                  <span className="text-[10px] text-slate-300 whitespace-nowrap">
                    Scene {hoveredScene.index + 1}: {hoveredScene.title}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Controls Bottom Bar */}
          <div className="flex items-center justify-between text-white gap-2 flex-wrap sm:flex-nowrap">
            {/* Left Controls: Play/Pause, Rewind (-10s, -5s), Prev Scene, Next Scene, Forward (+5s, +10s) */}
            <div className="flex items-center gap-1.5 md:gap-2">
              {/* Play / Pause */}
              <button
                onClick={togglePlay}
                title={isPlaying ? 'Pause (Space or K)' : 'Play (Space or K)'}
                className="w-10 h-10 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition active:scale-95"
              >
                {isPlaying ? <PauseIcon className="w-5 h-5" /> : <PlayIcon className="w-5 h-5" />}
              </button>

              {/* Jump to Previous Scene */}
              <button
                onClick={handleJumpPrevScene}
                title="Jump to Previous Scene ([)"
                className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-slate-200 hover:text-white flex items-center justify-center transition active:scale-95"
              >
                <ChevronLeftIcon className="w-5 h-5" />
              </button>

              {/* Rewind 10 Seconds */}
              <button
                onClick={() => handleRewind(10)}
                title="Rewind 10 seconds (J or Left Arrow)"
                className="px-2.5 h-9 rounded-xl bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/30 text-indigo-200 hover:text-white flex items-center gap-1 text-xs font-black transition active:scale-95"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.333 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z" />
                </svg>
                <span>-10s</span>
              </button>

              {/* Rewind 5 Seconds */}
              <button
                onClick={() => handleRewind(5)}
                title="Rewind 5 seconds"
                className="px-2 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white flex items-center gap-1 text-[11px] font-bold transition active:scale-95 hidden md:flex"
              >
                <span>-5s</span>
              </button>

              {/* Forward 5 Seconds */}
              <button
                onClick={() => handleFastForward(5)}
                title="Forward 5 seconds"
                className="px-2 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white flex items-center gap-1 text-[11px] font-bold transition active:scale-95 hidden md:flex"
              >
                <span>+5s</span>
              </button>

              {/* Forward 10 Seconds */}
              <button
                onClick={() => handleFastForward(10)}
                title="Fast-forward 10 seconds (L or Right Arrow)"
                className="px-2.5 h-9 rounded-xl bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/30 text-indigo-200 hover:text-white flex items-center gap-1 text-xs font-black transition active:scale-95"
              >
                <span>+10s</span>
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.934 12.8a1 1 0 000-1.6l-5.334-4A1 1 0 005 8v8a1 1 0 001.6.8l5.334-4zM19.934 12.8a1 1 0 000-1.6l-5.334-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.334-4z" />
                </svg>
              </button>

              {/* Jump to Next Scene */}
              <button
                onClick={handleJumpNextScene}
                title="Jump to Next Scene (])"
                className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-slate-200 hover:text-white flex items-center justify-center transition active:scale-95"
              >
                <ChevronRightIcon className="w-5 h-5" />
              </button>

              {/* Timestamp Counter */}
              <div className="flex items-center gap-1 text-xs font-mono text-slate-300 ml-2 font-bold">
                <span className="text-white">{formatTime(currentTime)}</span>
                <span className="text-slate-500">/</span>
                <span>{formatTime(effectiveDuration)}</span>
              </div>
            </div>

            {/* Right Controls: Volume, Speed, Fullscreen */}
            <div className="flex items-center gap-2">
              {/* Volume & Mute */}
              <div className="flex items-center gap-1.5 group/volume">
                <button
                  onClick={toggleMute}
                  title={isMuted ? 'Unmute (M)' : 'Mute (M)'}
                  className="w-8 h-8 rounded-lg hover:bg-white/10 text-slate-300 hover:text-white flex items-center justify-center transition"
                >
                  {isMuted || volume === 0 ? (
                    <SpeakerXMarkIcon className="w-4 h-4 text-red-400" />
                  ) : (
                    <SpeakerWaveIcon className="w-4 h-4" />
                  )}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="w-16 h-1 bg-white/20 rounded-full appearance-none cursor-pointer accent-indigo-500 hidden sm:block"
                />
              </div>

              {/* Playback Speed Selector */}
              <div className="flex bg-white/10 rounded-lg p-0.5 border border-white/10 text-[10px] font-bold">
                {[0.75, 1, 1.25, 1.5].map((rate) => (
                  <button
                    key={rate}
                    onClick={() => handleRateChange(rate)}
                    className={`px-1.5 py-0.5 rounded transition ${
                      playbackRate === rate ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {rate}x
                  </button>
                ))}
              </div>

              {/* Fullscreen Toggle */}
              <button
                onClick={toggleFullscreen}
                title={isFullscreen ? 'Exit Fullscreen (F)' : 'Fullscreen (F)'}
                className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-slate-200 hover:text-white flex items-center justify-center transition active:scale-95"
              >
                {isFullscreen ? (
                  <ArrowsPointingInIcon className="w-5 h-5" />
                ) : (
                  <ArrowsPointingOutIcon className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Multi-Scene Navigation Pill Bar */}
      {showSceneBar && sceneMarkers.length > 0 && (
        <div className="bg-slate-900/60 backdrop-blur-md rounded-2xl p-3 border border-white/10 flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs px-1">
            <div className="flex items-center gap-2">
              <FilmIcon className="w-4 h-4 text-indigo-400" />
              <span className="font-bold text-slate-200 uppercase tracking-wider text-[11px]">
                Scenes in Master Video ({sceneMarkers.length} Total)
              </span>
            </div>
            <span className="text-[10px] text-slate-400">
              Click any scene to jump & control playback • Use <kbd className="bg-white/10 px-1 py-0.5 rounded text-indigo-300 font-mono">←</kbd> <kbd className="bg-white/10 px-1 py-0.5 rounded text-indigo-300 font-mono">→</kbd> to Rewind/Forward
            </span>
          </div>

          {/* Scene Badges */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 hide-scrollbar">
            {sceneMarkers.map((marker) => {
              const isActive = activeScene?.index === marker.index;
              return (
                <button
                  key={marker.id}
                  onClick={() => seekTo(marker.startTime)}
                  className={`flex-shrink-0 px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 border ${
                    isActive
                      ? 'bg-indigo-600 text-white border-indigo-400 shadow-lg shadow-indigo-600/30'
                      : 'bg-white/5 hover:bg-white/10 text-slate-300 border-white/10 hover:text-white'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isActive ? 'bg-emerald-300 animate-pulse' : 'bg-slate-500'
                    }`}
                  />
                  <span className="truncate max-w-[140px]">
                    Scene {marker.index + 1}: {marker.title}
                  </span>
                  <span className="font-mono text-[10px] opacity-75">
                    {formatTime(marker.startTime)}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Active Scene Script / Narration Subtitle Box */}
          {activeScene?.narration && (
            <div className="mt-1 bg-slate-950/70 border border-indigo-500/20 rounded-xl px-4 py-2.5 text-xs text-slate-300 flex items-start gap-2.5">
              <SparklesIcon className="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="font-bold text-indigo-300 mr-2">Scene {activeScene.index + 1} Voiceover:</span>
                <span className="italic text-slate-200">"{activeScene.narration}"</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
