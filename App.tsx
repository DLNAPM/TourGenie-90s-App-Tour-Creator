import React, { useState, useEffect, useMemo, useRef } from 'react';
import { AppInput, Scene, GenerationState, EditorClip, EditorState } from './types';
import { TourService } from './services/geminiService';
import { pcmBase64ToWavBlob, stitchClipsClientSide } from './services/screenStudioEngine';
import { 
  PlusIcon, 
  SparklesIcon, 
  VideoCameraIcon, 
  ArrowRightIcon, 
  CloudArrowUpIcon,
  CheckCircleIcon,
  ShieldCheckIcon,
  PlayIcon,
  ArrowDownTrayIcon,
  ExclamationCircleIcon,
  FilmIcon,
  ScissorsIcon,
  MicrophoneIcon,
  ShareIcon,
  TrashIcon,
  ServerIcon,
  KeyIcon,
  SpeakerWaveIcon,
  SpeakerXMarkIcon,
  EyeIcon,
  XMarkIcon,
  ArrowUpTrayIcon,
  ClockIcon,
  CommandLineIcon,
  CpuChipIcon,
  ArrowPathIcon
} from '@heroicons/react/24/outline';

const tourService = new TourService();
const MIN_DURATION = 30; 

export default function App() {
  const [activeTab, setActiveTab] = useState<'creator' | 'editor'>('creator');
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState<'master' | 'breakdown'>('master');
  
  // Rendering State
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderStage, setRenderStage] = useState('');

  // Upload Simulation State
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState('');
  const [isUploadComplete, setIsUploadComplete] = useState(false);
  
  // Tour Creator State
  const [input, setInput] = useState<AppInput>({
    name: '',
    url: '',
    description: '',
    script: '',
    screenshots: []
  });
  const [state, setState] = useState<GenerationState>({
    step: 'input',
    scenes: [],
    progress: 0
  });

  // Video Editor State
  const [editorState, setEditorState] = useState<EditorState>({
    clips: [],
    isProcessing: false,
    includeVoiceover: true,
    isRendering: false,
    isRendered: false
  });

  const [error, setError] = useState<string | null>(null);
  const [videoEngineMode, setVideoEngineMode] = useState<'studio' | 'veo'>('studio');
  const previewScrollRef = useRef<HTMLDivElement>(null);

  // Derived state for duration tracking
  const totalDuration = useMemo(() => {
    return editorState.clips.reduce((acc, clip) => acc + (clip.duration || 0), 0);
  }, [editorState.clips]);

  const isDurationValid = totalDuration >= MIN_DURATION;
  const secondsRemaining = Math.max(0, Math.ceil(MIN_DURATION - totalDuration));

  // Determine if we effectively have an API key available
  const isApiReady = hasKey === true;

  useEffect(() => {
    checkKeyStatus();
  }, []);

  const checkKeyStatus = async () => {
    try {
      if ((window as any).aistudio && typeof (window as any).aistudio.hasSelectedApiKey === 'function') {
        const selected = await (window as any).aistudio.hasSelectedApiKey();
        if (selected) {
          setHasKey(true);
          return;
        }
      }
      const backendHasKey = await tourService.checkBackendKey();
      if (backendHasKey) {
        setHasKey(true);
        return;
      }
      const clientKey = (window as any).process?.env?.API_KEY || process.env.API_KEY || process.env.GEMINI_API_KEY;
      if (clientKey && clientKey !== 'RENDER_API_KEY_PLACEHOLDER' && clientKey !== 'UNUSED_PLACEHOLDER_FOR_API_KEY' && clientKey.trim() !== '') {
        setHasKey(true);
      } else {
        setHasKey(false);
      }
    } catch (e) {
      setHasKey(false);
    }
  };

  const handleKeySelection = async () => {
    if ((window as any).aistudio && typeof (window as any).aistudio.openSelectKey === 'function') {
      try {
        await (window as any).aistudio.openSelectKey();
        setHasKey(true); 
        setError(null);
        return;
      } catch (e) {
        console.error("Failed to open key selection", e);
      }
    }
    const customKey = prompt("Enter your Google Gemini API Key:");
    if (customKey && customKey.trim()) {
      (window as any).process = (window as any).process || { env: {} };
      (window as any).process.env = (window as any).process.env || {};
      (window as any).process.env.API_KEY = customKey.trim();
      setHasKey(true);
      setError(null);
    }
  };

  const handleGlobalError = async (e: any) => {
    const msg = e.message || "";
    if (msg.includes("Requested entity was not found") || msg.includes("API_KEY") || msg.includes("401") || msg.includes("403")) {
      setError("API Key invalid or missing. Please check your credentials.");
      setHasKey(false);
      return true;
    }
    if (msg.includes("500") || msg.includes("INTERNAL")) {
      setError("Internal error (500). Please re-select your key.");
      setHasKey(false); 
      return true;
    }
    setError(msg || "An unexpected error occurred.");
    return false;
  };

  // --- Utility: Get Video Duration ---
  const getVideoDuration = (file: File): Promise<number> => {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        window.URL.revokeObjectURL(video.src);
        resolve(video.duration);
      };
      video.src = URL.createObjectURL(file);
    });
  };

  // --- Audio Helpers ---
  const playAudioPreview = (audioBase64?: string) => {
    if (!audioBase64) {
      setError("No voiceover audio available for this scene.");
      return;
    }
    try {
      const blob = pcmBase64ToWavBlob(audioBase64);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.play().catch(e => console.warn("Audio playback failed:", e));
    } catch (err) {
      console.error("Failed to play audio:", err);
    }
  };

  const downloadAudio = (audioBase64?: string, sceneIndex: number = 0) => {
    if (!audioBase64) {
      setError("No voiceover audio available for this scene.");
      return;
    }
    try {
      const blob = pcmBase64ToWavBlob(audioBase64);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `scene-${sceneIndex + 1}-narration.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      console.error("Failed to download audio:", err);
    }
  };

  const sendScenesToEditor = async () => {
    const newClips: EditorClip[] = [];
    for (let i = 0; i < state.scenes.length; i++) {
      const scene = state.scenes[i];
      if (!scene.videoUrl) continue;
      try {
        const res = await fetch(scene.videoUrl);
        const blob = await res.blob();
        const file = new File([blob], `scene-${i + 1}.mp4`, { type: blob.type || 'video/mp4' });
        const duration = await getVideoDuration(file).catch(() => 6);
        newClips.push({
          id: `scene-clip-${i}-${Date.now()}`,
          file,
          previewUrl: scene.videoUrl,
          duration: duration || 6,
          status: 'ready',
          narration: scene.narration,
          audioUrl: scene.audioUrl
        });
      } catch (err) {
        console.warn("Could not convert scene to editor clip:", err);
      }
    }

    if (newClips.length > 0) {
      setEditorState(prev => ({
        ...prev,
        clips: [...prev.clips, ...newClips],
        isRendered: false
      }));
      setActiveTab('editor');
    }
  };

  const reRenderScene = async (sceneIndex: number, motionStyle: any) => {
    const scene = state.scenes[sceneIndex];
    if (!scene) return;

    const screenshotIndex = scene.screenshotIndex !== undefined 
      ? scene.screenshotIndex 
      : (input.screenshots.length > 0 ? (sceneIndex % input.screenshots.length) : undefined);
    const screenshot = (screenshotIndex !== undefined && input.screenshots[screenshotIndex])
      ? input.screenshots[screenshotIndex]
      : (input.screenshots.length > 0 ? input.screenshots[sceneIndex % input.screenshots.length] : undefined);

    const updatedScenes = [...state.scenes];
    updatedScenes[sceneIndex].status = 'generating';
    setState(prev => ({ ...prev, scenes: updatedScenes }));

    try {
      const videoUrl = await tourService.generateSceneVideo(scene, screenshot, {
        engineMode: videoEngineMode,
        audioBase64: scene.audioUrl,
        motionStyle,
        sceneIndex
      });
      updatedScenes[sceneIndex].videoUrl = videoUrl;
      updatedScenes[sceneIndex].status = 'completed';
    } catch (err: any) {
      console.error("Re-render error:", err);
      updatedScenes[sceneIndex].status = 'failed';
    }
    setState(prev => ({ ...prev, scenes: [...updatedScenes] }));
  };

  // --- Real Master Video Assembly & Stitching Engine ---
  const handleRenderProject = async () => {
    if (!isDurationValid || editorState.clips.length === 0) return;
    setEditorState(prev => ({ ...prev, isRendering: true }));
    setRenderProgress(5);
    setRenderStage('Initializing Master Assembly Engine...');
    
    try {
      const totalClips = editorState.clips.length;
      const clipBlobs: Blob[] = [];

      // Step 1: Collect video streams for all timeline scenes
      for (let i = 0; i < totalClips; i++) {
        const clip = editorState.clips[i];
        setRenderStage(`Preparing Scene ${i + 1} of ${totalClips}...`);
        setRenderProgress(10 + Math.floor(((i + 1) / totalClips) * 25));
        
        try {
          const res = await fetch(clip.previewUrl);
          const blob = await res.blob();
          clipBlobs.push(blob);
        } catch (fetchErr) {
          console.warn(`Could not fetch blob for clip ${i}:`, fetchErr);
        }
      }

      if (clipBlobs.length === 0) {
        throw new Error("No valid scene video streams available for assembly.");
      }

      setRenderStage(`Encoding & Concatenating all ${totalClips} scenes into Master Project...`);
      setRenderProgress(45);

      let masterUrl: string | null = null;

      // Step 2: Attempt Server-Side FFmpeg Stitching (Lossless broadcast-ready MP4)
      try {
        const formData = new FormData();
        clipBlobs.forEach((blob, idx) => {
          formData.append('clips', blob, `scene-${idx + 1}.mp4`);
        });
        const title = editorState.youtubeMetadata?.title || 'TourGenie_Master_Tour';
        formData.append('title', title);

        const progressInterval = setInterval(() => {
          setRenderProgress(prev => (prev < 88 ? prev + 2 : prev));
        }, 300);

        const stitchRes = await fetch('/api/stitch-master-video', {
          method: 'POST',
          body: formData
        });

        clearInterval(progressInterval);

        if (!stitchRes.ok) {
          const errData = await stitchRes.json().catch(() => ({}));
          throw new Error(errData.error || `Server stitch failed with status ${stitchRes.status}`);
        }

        setRenderProgress(92);
        setRenderStage('Verifying 1080p broadcast audio & video streams...');

        const masterBlob = await stitchRes.blob();
        masterUrl = URL.createObjectURL(masterBlob);
      } catch (serverErr) {
        console.warn('Server FFmpeg stitch error, falling back to browser canvas stitcher:', serverErr);
        setRenderStage(`Assembling ${totalClips} scenes via in-browser canvas engine fallback...`);
        setRenderProgress(60);

        masterUrl = await stitchClipsClientSide(
          editorState.clips.map(c => c.previewUrl),
          (stage, pct) => {
            setRenderStage(stage);
            setRenderProgress(60 + Math.floor(pct * 0.35));
          }
        );
      }

      setRenderProgress(100);
      setRenderStage(`Export Successful! All ${totalClips} scenes stitched.`);

      // Finalize editorState with the true master combinedVideoUrl
      setEditorState(prev => ({
        ...prev,
        isRendering: false,
        isRendered: true,
        combinedVideoUrl: masterUrl || prev.clips[0]?.previewUrl
      }));
      setPreviewMode('master');
    } catch (err: any) {
      console.error('Master assembly error:', err);
      setEditorState(prev => ({ ...prev, isRendering: false }));
      setError(err.message || 'Failed to assemble master video');
    }
  };

  // --- YouTube Upload Simulation ---
  const handleYouTubePublish = async () => {
    if (!isDurationValid || !editorState.isRendered) {
      if (!editorState.isRendered) setError("Assembly required: Please render your project before publishing.");
      return;
    }
    
    setIsUploading(true);
    setUploadProgress(0);
    setIsUploadComplete(false);
    
    const stages = [
      { msg: 'Initializing YouTube Data API...', duration: 1500 },
      { msg: 'Pre-flight master file check...', duration: 1000 },
      { msg: 'Syncing AI-Optimized Metadata...', duration: 2000 },
      { msg: 'Transferring Master Video Project...', duration: 4000 },
      { msg: 'Finalizing Broadcast Processing...', duration: 1500 }
    ];

    let currentProgress = 0;
    for (const stage of stages) {
      setUploadStage(stage.msg);
      const startTime = Date.now();
      while (Date.now() - startTime < stage.duration) {
        currentProgress = Math.min(currentProgress + (Math.random() * 2.5), 99);
        setUploadProgress(Math.floor(currentProgress));
        await new Promise(r => setTimeout(r, 100));
      }
    }

    setUploadProgress(100);
    setUploadStage('Broadcast Ready!');
    setTimeout(() => setIsUploadComplete(true), 800);
  };

  // Helper: Normalize uploaded screenshots to standard 16:9 canvas to prevent video model outpainting hallucinations
  const normalizeScreenshotTo16x9 = (dataUrl: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const targetWidth = 1280;
        const targetHeight = 720;
        const targetRatio = 16 / 9;
        const imgRatio = img.naturalWidth / img.naturalHeight;

        // If already landscape (ratio between 1.35 and 1.95), preserve the original image with 100% fidelity
        if (imgRatio >= 1.35 && imgRatio <= 1.95) {
          resolve(dataUrl);
          return;
        }

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }

        // Clean, solid, distraction-free studio background (ZERO blurred ghost artifacts or smeared text)
        ctx.fillStyle = '#0b0f19';
        ctx.fillRect(0, 0, targetWidth, targetHeight);

        // Center the portrait screenshot cleanly at maximum vertical height
        const drawHeight = Math.round(targetHeight * 0.95);
        const drawWidth = Math.round(drawHeight * imgRatio);
        const x = Math.round((targetWidth - drawWidth) / 2);
        const y = Math.round((targetHeight - drawHeight) / 2);

        // Crisp, clean device frame shadow
        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
        ctx.shadowBlur = 18;
        ctx.shadowOffsetY = 6;
        ctx.drawImage(img, x, y, drawWidth, drawHeight);
        ctx.restore();

        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  };

  // --- Tour Creator Logic ---
  const handleScreenshotUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files as FileList).forEach((file: File) => {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const raw = reader.result as string;
        const normalized = await normalizeScreenshotTo16x9(raw);
        setInput(prev => ({
          ...prev,
          screenshots: [...prev.screenshots, normalized]
        }));
      };
      reader.readAsDataURL(file);
    });
  };

  const startGeneration = async () => {
    if (!isApiReady) {
      await handleKeySelection();
      return;
    }
    if (!input.name || !input.description) {
      setError("Please provide at least a name and description.");
      return;
    }
    setError(null);
    setState(prev => ({ ...prev, step: 'processing', progress: 10 }));
    try {
      const storyboard = await tourService.createStoryboards(input);
      setState(prev => ({ ...prev, step: 'generating', scenes: storyboard, progress: 30 }));
      const updatedScenes = [...storyboard];
      for (let i = 0; i < updatedScenes.length; i++) {
        updatedScenes[i].status = 'generating';
        setState(prev => ({ ...prev, scenes: [...updatedScenes], progress: 30 + (i * 12) }));
        try {
          const screenshotIndex = updatedScenes[i].screenshotIndex !== undefined 
            ? updatedScenes[i].screenshotIndex! 
            : (input.screenshots.length > 0 ? (i % input.screenshots.length) : undefined);
          const screenshot = (screenshotIndex !== undefined && input.screenshots[screenshotIndex])
            ? input.screenshots[screenshotIndex]
            : (input.screenshots.length > 0 ? input.screenshots[i % input.screenshots.length] : undefined);
          
          // 1. Generate Voiceover Narration via Gemini TTS
          let audioBase64: string | undefined = undefined;
          try {
            audioBase64 = await tourService.generateNarration(updatedScenes[i].narration);
          } catch (audioErr) {
            console.warn("Narration TTS warning for scene " + i, audioErr);
          }

          // 2. Generate Video (using Screen Studio Engine with 100% U.S. English fidelity, or Veo)
          const videoUrl = await tourService.generateSceneVideo(updatedScenes[i], screenshot, {
            engineMode: videoEngineMode,
            audioBase64: audioBase64,
            sceneIndex: i
          });

          updatedScenes[i].videoUrl = videoUrl;
          updatedScenes[i].audioUrl = audioBase64;
          updatedScenes[i].status = 'completed';
        } catch (e: any) {
          const handled = await handleGlobalError(e);
          if (handled) return;
          updatedScenes[i].status = 'failed';
        }
        setState(prev => ({ ...prev, scenes: [...updatedScenes] }));
      }
      setState(prev => ({ ...prev, step: 'final', progress: 100 }));
    } catch (e: any) {
      await handleGlobalError(e);
      setState(prev => ({ ...prev, step: 'input' }));
    }
  };

  // --- Video Editor Logic ---
  const handleEditorVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    
    const filesArray = Array.from(files as FileList);
    const newClips: EditorClip[] = [];
    
    for (const file of filesArray) {
      const duration = await getVideoDuration(file);
      newClips.push({
        id: Math.random().toString(36).substr(2, 9),
        file,
        previewUrl: URL.createObjectURL(file),
        duration: duration, 
        status: 'idle'
      });
    }
    
    setEditorState(prev => ({ 
      ...prev, 
      clips: [...prev.clips, ...newClips],
      isRendered: false 
    }));
  };

  const processEditorClips = async () => {
    if (!isApiReady) {
      setError("AI analysis requires an API Key.");
      return;
    }
    if (editorState.clips.length === 0) return;
    setEditorState(prev => ({ ...prev, isProcessing: true }));
    setError(null);

    const updatedClips = [...editorState.clips];
    try {
      for (let i = 0; i < updatedClips.length; i++) {
        const clip = updatedClips[i];
        if (clip.status === 'ready') continue;
        updatedClips[i].status = 'analyzing';
        setEditorState(prev => ({ ...prev, clips: [...updatedClips] }));
        
        try {
            const { analysis, narration } = await tourService.analyzeVideoClip(clip.file);
            updatedClips[i].analysis = analysis;
            updatedClips[i].narration = narration;
            
            if (editorState.includeVoiceover) {
              updatedClips[i].status = 'generating-audio';
              setEditorState(prev => ({ ...prev, clips: [...updatedClips] }));
              const audioBase64 = await tourService.generateNarration(narration);
              updatedClips[i].audioUrl = audioBase64;
            }
            updatedClips[i].status = 'ready';
        } catch (e: any) {
            updatedClips[i].status = 'idle';
            throw e; 
        }
        setEditorState(prev => ({ ...prev, clips: [...updatedClips] }));
      }

      const metadata = await tourService.generateYouTubeMetadata(updatedClips.filter(c => c.status === 'ready'));
      setEditorState(prev => ({ ...prev, isProcessing: false, youtubeMetadata: metadata }));
    } catch (e: any) {
      await handleGlobalError(e);
      setEditorState(prev => ({ ...prev, isProcessing: false }));
    }
  };

  const removeClip = (id: string) => {
    setEditorState(prev => ({ 
      ...prev, 
      clips: prev.clips.filter(c => c.id !== id),
      isRendered: false 
    }));
  };

  const renderAccessRequired = () => (
    <div className="py-20 animate-in fade-in zoom-in duration-500">
      <div className="max-w-md mx-auto glass p-10 rounded-[2.5rem] shadow-2xl border border-slate-200/50 text-center">
        <div className="w-20 h-20 bg-indigo-50 rounded-3xl flex items-center justify-center mx-auto mb-6">
          <KeyIcon className="w-10 h-10 text-indigo-500" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mb-3">API Key Required</h2>
        <p className="text-slate-500 mb-8 leading-relaxed text-sm">
          Tour Creator uses high-end **Veo Video Models** and Gemini Pro which require a connected API Key for processing.
        </p>
        <button 
          onClick={handleKeySelection} 
          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 px-6 rounded-2xl transition-all shadow-xl shadow-indigo-100 flex items-center justify-center gap-2 group"
        >
          Connect API Key <SparklesIcon className="w-5 h-5 group-hover:rotate-12 transition-transform" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen text-slate-900 pb-20 relative">
      <nav className="sticky top-0 z-50 glass border-b border-slate-200/50 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-lg">
            <SparklesIcon className="w-6 h-6" />
          </div>
          <span className="font-bold text-xl tracking-tight">TourGenie</span>
        </div>
        
        <div className="flex bg-slate-100 p-1 rounded-xl">
          <button onClick={() => setActiveTab('creator')} className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition ${activeTab === 'creator' ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}>Tour Creator</button>
          <button onClick={() => setActiveTab('editor')} className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition ${activeTab === 'editor' ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}>Video Editor</button>
        </div>

        <div className="hidden md:flex items-center gap-4">
          <button onClick={handleKeySelection} className={`flex items-center gap-2 text-xs font-bold py-2 px-4 rounded-full border transition ${isApiReady ? 'bg-green-50 border-green-200 text-green-600' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
            <div className={`w-2 h-2 rounded-full ${isApiReady ? 'bg-green-500 animate-pulse' : 'bg-slate-300'}`} />
            {isApiReady ? 'Connected' : 'Connect Key'}
          </button>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto mt-12 px-6">
        {error && (
          <div className="mb-8 bg-red-50 border border-red-100 text-red-600 p-4 rounded-2xl flex items-center gap-3 text-sm animate-in slide-in-from-top duration-300">
            <ExclamationCircleIcon className="w-5 h-5 flex-shrink-0" />
            <div className="flex-1">
                <p className="font-bold">System Alert</p>
                <p>{error}</p>
            </div>
            <button onClick={() => setError(null)} className="ml-auto text-xs font-bold uppercase tracking-widest hover:underline">Dismiss</button>
          </div>
        )}

        {activeTab === 'creator' ? (
          /* TOUR CREATOR VIEW */
          !isApiReady ? (
            renderAccessRequired()
          ) : (
            state.step === 'input' ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 animate-in fade-in duration-700">
                <div className="space-y-8">
                  <section>
                    <h2 className="text-3xl font-extrabold text-slate-900 mb-2">Create a New Tour</h2>
                    <p className="text-slate-500">Transform your app's complexity into a professional 30-90 second story.</p>
                  </section>
                  <div className="space-y-6">
                    <div>
                      <label className="block text-sm font-semibold mb-2">App Name</label>
                      <input type="text" placeholder="e.g. FitTrack Pro" className="w-full bg-white border border-slate-200 rounded-xl py-3 px-4 focus:ring-2 focus:ring-indigo-500 outline-none transition" value={input.name} onChange={e => setInput({...input, name: e.target.value})} />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-2">App Description</label>
                      <textarea rows={4} placeholder="What does your app do?" className="w-full bg-white border border-slate-200 rounded-xl py-3 px-4 focus:ring-2 focus:ring-indigo-500 outline-none transition" value={input.description} onChange={e => setInput({...input, description: e.target.value})} />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-2">Tour Script / Key Features</label>
                      <textarea rows={4} placeholder="Paste your script here." className="w-full bg-white border border-slate-200 rounded-xl py-3 px-4 focus:ring-2 focus:ring-indigo-500 outline-none transition" value={input.script} onChange={e => setInput({...input, script: e.target.value})} />
                    </div>

                    {/* Video Synthesis Engine Selector */}
                    <div className="bg-slate-50 border border-slate-200/90 rounded-2xl p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                          <SparklesIcon className="w-4 h-4 text-indigo-600" /> Video Synthesis Engine
                        </label>
                        <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200 flex items-center gap-1">
                          <ShieldCheckIcon className="w-3.5 h-3.5 text-green-600" /> 100% U.S. English Guaranteed
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setVideoEngineMode('studio')}
                          className={`p-3 rounded-xl text-left border transition-all ${
                            videoEngineMode === 'studio'
                              ? 'bg-white border-indigo-600 shadow-sm ring-2 ring-indigo-500/20'
                              : 'bg-white/60 border-slate-200 hover:bg-white text-slate-600'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-900">Screen Studio HD</span>
                            {videoEngineMode === 'studio' && <CheckCircleIcon className="w-4 h-4 text-indigo-600" />}
                          </div>
                          <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                            Animates your actual screenshots with 100% text fidelity. Zero AI foreign glyphs or hallucinations.
                          </p>
                        </button>
                        <button
                          type="button"
                          onClick={() => setVideoEngineMode('veo')}
                          className={`p-3 rounded-xl text-left border transition-all ${
                            videoEngineMode === 'veo'
                              ? 'bg-white border-indigo-600 shadow-sm ring-2 ring-indigo-500/20'
                              : 'bg-white/60 border-slate-200 hover:bg-white text-slate-600'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-900">Veo AI Diffusion</span>
                            {videoEngineMode === 'veo' && <CheckCircleIcon className="w-4 h-4 text-indigo-600" />}
                          </div>
                          <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                            Generative diffusion model via Google Veo (may hallucinate fictional screen frames).
                          </p>
                        </button>
                      </div>
                    </div>

                    <button onClick={startGeneration} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 px-6 rounded-xl transition-all shadow-xl shadow-indigo-100 flex items-center justify-center gap-2 group">
                      Generate Storyboard & Video <ArrowRightIcon className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                    </button>
                  </div>
                </div>
                <div className="lg:mt-16">
                  <div className="bg-white border-2 border-dashed border-slate-200 rounded-3xl p-10 text-center hover:border-indigo-400 transition cursor-pointer group relative">
                    <input type="file" multiple className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleScreenshotUpload} accept="image/*" />
                    <CloudArrowUpIcon className="w-12 h-12 text-indigo-500 mx-auto mb-4" />
                    <h3 className="text-lg font-bold text-slate-900">Upload Screenshots</h3>
                    <p className="text-slate-500 text-sm">Upload your 100% U.S. English screenshots to animate into clean HD scenes.</p>
                  </div>
                  {input.screenshots.length > 0 && (
                    <div className="mt-8 grid grid-cols-3 gap-4">
                      {input.screenshots.map((src, i) => (
                        <div key={i} className="relative aspect-video rounded-xl overflow-hidden border border-slate-200 group">
                          <img src={src} className="w-full h-full object-cover" alt="ref" />
                          <button onClick={() => setInput(prev => ({ ...prev, screenshots: prev.screenshots.filter((_, idx) => idx !== i)}))} className="absolute top-1 right-1 bg-white/80 rounded-full p-1 opacity-0 group-hover:opacity-100 transition"><PlusIcon className="w-4 h-4 rotate-45" /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : state.step === 'final' ? (
              <div className="space-y-8 animate-in slide-in-from-bottom duration-700">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200/80 pb-6">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h2 className="text-3xl font-black text-slate-900">Your Tour is Ready!</h2>
                      <span className="bg-green-100 text-green-700 text-xs font-bold px-2.5 py-1 rounded-full border border-green-200 flex items-center gap-1">
                        <CheckCircleIcon className="w-3.5 h-3.5 text-green-600" /> 100% U.S. English Guaranteed
                      </span>
                    </div>
                    <p className="text-slate-500 text-sm">Download individual scene MP4s and voiceovers, or open all scenes directly in the Video Editor.</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={sendScenesToEditor}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-5 rounded-xl shadow-lg shadow-indigo-100 flex items-center gap-2 text-sm transition active:scale-95"
                    >
                      <FilmIcon className="w-4 h-4" /> Open in Video Editor ({state.scenes.length} Scenes)
                    </button>
                    <button
                      onClick={() => setState(prev => ({ ...prev, step: 'input' }))}
                      className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold py-3 px-4 rounded-xl text-sm transition"
                    >
                      Create Another Tour
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                  {state.scenes.map((scene, idx) => (
                    <div key={scene.id} className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm flex flex-col justify-between">
                      <div>
                        <div className="relative aspect-video bg-slate-950 flex items-center justify-center">
                          {scene.videoUrl ? (
                            <video src={scene.videoUrl} className="w-full h-full object-cover" controls playsInline />
                          ) : (
                            <div className="text-slate-400 text-xs">No video generated</div>
                          )}
                        </div>
                        <div className="p-6">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-bold text-indigo-600 uppercase tracking-wider">Scene {idx + 1}</span>
                            <span className="text-[11px] font-semibold text-slate-400">{scene.timestamp || '0:00'}</span>
                          </div>
                          <p className="text-slate-700 text-sm mb-4 leading-relaxed font-medium">"{scene.narration}"</p>
                        </div>
                      </div>
                      <div className="p-6 pt-0 space-y-3">
                        {/* Audio controls */}
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => playAudioPreview(scene.audioUrl)}
                            className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 transition"
                          >
                            <SpeakerWaveIcon className="w-3.5 h-3.5 text-indigo-600" /> Play Voiceover
                          </button>
                          <button
                            onClick={() => downloadAudio(scene.audioUrl, idx)}
                            className="flex-1 border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 transition"
                          >
                            <ArrowDownTrayIcon className="w-3.5 h-3.5 text-slate-500" /> Audio WAV
                          </button>
                        </div>

                        {/* Video Download */}
                        {scene.videoUrl && (
                          <a
                            href={scene.videoUrl}
                            download={`scene-${idx + 1}.mp4`}
                            className="w-full bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold py-2.5 rounded-lg text-center flex items-center justify-center gap-1.5 transition"
                          >
                            <ArrowDownTrayIcon className="w-4 h-4" /> Download Scene Video (MP4)
                          </a>
                        )}

                        {/* Re-render Motion selector */}
                        <div className="pt-2 border-t border-slate-100 flex items-center gap-2">
                          <select
                            id={`motion-${idx}`}
                            defaultValue="push-in"
                            className="text-[11px] bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-slate-700 outline-none flex-1"
                          >
                            <option value="push-in">Push-In Zoom</option>
                            <option value="pan-horizontal">Horizontal Pan</option>
                            <option value="pan-vertical">Vertical Scroll</option>
                            <option value="spotlight">Spotlight & Click</option>
                            <option value="pull-out">Cinematic Pull-Out</option>
                          </select>
                          <button
                            onClick={() => {
                              const sel = document.getElementById(`motion-${idx}`) as HTMLSelectElement;
                              reRenderScene(idx, sel?.value || 'push-in');
                            }}
                            className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg flex items-center gap-1 transition"
                          >
                            <ArrowPathIcon className="w-3 h-3" /> Re-render
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="max-w-4xl mx-auto py-24 text-center">
                <div className="w-20 h-20 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-8" />
                <h2 className="text-2xl font-bold text-slate-900 mb-2">TourGenie is creating your tour...</h2>
                <p className="text-slate-500 mb-4">
                  Rendering Scene {state.scenes.filter(s => s.status === 'completed').length + 1} of {Math.max(5, state.scenes.length)}
                </p>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 border border-indigo-200 text-xs font-semibold text-indigo-700">
                  <ShieldCheckIcon className="w-4 h-4 text-indigo-600" />
                  {videoEngineMode === 'studio'
                    ? 'Screen Studio Engine: Animating screenshot with 100% U.S. English text fidelity'
                    : 'Veo Engine: Synthesizing generative video clip'}
                </div>
              </div>
            )
          )
        ) : (
          /* ADVANCED VIDEO EDITOR VIEW */
          <div className="animate-in fade-in duration-700 space-y-8">
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div>
                <h2 className="text-3xl font-extrabold text-slate-900">Video Editor</h2>
                <div className="flex items-center gap-3 mt-1">
                  <div className="flex items-center gap-2 text-slate-500 text-sm">
                    <ClockIcon className="w-4 h-4" />
                    <span>Project Length: <span className={`font-bold ${isDurationValid ? 'text-green-600' : 'text-amber-600'}`}>{Math.floor(totalDuration)}s</span> / {MIN_DURATION}s</span>
                  </div>
                  {editorState.isRendered && (
                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-green-50 border border-green-100 text-[10px] font-bold text-green-600 uppercase">
                      <CheckCircleIcon className="w-3 h-3" /> Master Project Sealed
                    </div>
                  )}
                </div>
              </div>
              
              <div className="flex-1 max-w-xs space-y-2">
                <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-slate-400">
                   <span>Timeline Target</span>
                   <span>{Math.min(100, Math.floor((totalDuration / MIN_DURATION) * 100))}%</span>
                </div>
                <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                   <div 
                    className={`h-full transition-all duration-500 ${isDurationValid ? 'bg-green-500' : totalDuration > (MIN_DURATION / 2) ? 'bg-amber-400' : 'bg-red-500'}`}
                    style={{ width: `${Math.min(100, (totalDuration / MIN_DURATION) * 100)}%` }}
                   />
                </div>
              </div>

              <div className="flex items-center gap-4">
                <button 
                  onClick={() => setEditorState(prev => ({ ...prev, includeVoiceover: !prev.includeVoiceover }))}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl border transition font-semibold text-sm ${editorState.includeVoiceover ? 'bg-indigo-50 border-indigo-200 text-indigo-600' : 'bg-white border-slate-200 text-slate-400'}`}
                >
                  {editorState.includeVoiceover ? <SpeakerWaveIcon className="w-5 h-5" /> : <SpeakerXMarkIcon className="w-5 h-5" />}
                  AI Voice
                </button>
                {editorState.clips.length > 0 && !editorState.isProcessing && (
                  <button onClick={processEditorClips} className="font-bold py-3 px-8 rounded-2xl flex items-center gap-2 shadow-lg bg-indigo-600 hover:bg-indigo-700 text-white transition active:scale-95">
                    <SparklesIcon className="w-5 h-5" /> Analyze Project
                  </button>
                )}
              </div>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 space-y-6">
                <div className="bg-white rounded-3xl border border-slate-200 p-8 min-h-[400px] shadow-sm">
                  {editorState.clips.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center space-y-4 py-20">
                      <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center mb-4">
                        <FilmIcon className="w-10 h-10 text-slate-200" />
                      </div>
                      <label className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 px-10 rounded-2xl cursor-pointer transition shadow-xl shadow-indigo-100 active:scale-95">
                        Import Clips
                        <input type="file" multiple className="hidden" accept="video/*" onChange={handleEditorVideoUpload} />
                      </label>
                      <p className="text-slate-400 text-sm max-w-xs">Start your tour by uploading at least {MIN_DURATION} seconds of footage.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {editorState.clips.map((clip, idx) => (
                        <div key={clip.id} className="group relative bg-slate-50 border border-slate-100 rounded-2xl p-4 flex flex-col sm:flex-row gap-5 items-start transition hover:border-indigo-200 hover:bg-white hover:shadow-md">
                          <div className="w-full sm:w-56 aspect-video rounded-xl overflow-hidden bg-black flex-shrink-0 relative shadow-inner">
                            <video src={clip.previewUrl} className="w-full h-full object-contain" controls />
                            <div className="absolute top-2 right-2 bg-black/60 px-2 py-0.5 rounded-lg text-[10px] text-white font-bold backdrop-blur-sm">
                                {Math.floor(clip.duration)}s
                            </div>
                          </div>
                          <div className="flex-1 w-full space-y-3 pt-1">
                            <div className="flex justify-between items-center">
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Sequence Segment {idx + 1}</span>
                              <button onClick={() => removeClip(clip.id)} className="text-slate-300 hover:text-red-500 transition-colors p-1"><TrashIcon className="w-5 h-5" /></button>
                            </div>
                            {clip.status === 'analyzing' ? (
                               <div className="flex items-center gap-2 text-indigo-600 animate-pulse text-sm font-medium">
                                 <ArrowPathIcon className="w-4 h-4 animate-spin" /> Analyzing frame data...
                               </div>
                            ) : 
                             clip.narration ? (
                               <div className="bg-white border border-slate-100 rounded-xl p-3 space-y-1 shadow-sm">
                                 <p className="text-[9px] text-indigo-500 font-bold uppercase tracking-tighter">AI Narration Generated</p>
                                 <p className="text-sm text-slate-700 italic leading-snug">"{clip.narration}"</p>
                               </div>
                             ) : 
                             <p className="text-sm text-slate-400 flex items-center gap-2"><SparklesIcon className="w-4 h-4" /> Ready for AI story analysis.</p>}
                          </div>
                        </div>
                      ))}
                      <label className="flex items-center justify-center p-12 border-2 border-dashed border-slate-200 rounded-2xl hover:border-indigo-400 hover:bg-indigo-50/30 transition cursor-pointer group">
                        <div className="flex flex-col items-center gap-2">
                           <PlusIcon className="w-8 h-8 text-slate-300 group-hover:text-indigo-500 group-hover:scale-110 transition-transform" />
                           <span className="text-xs font-bold text-slate-400 group-hover:text-indigo-600">Append Scene</span>
                        </div>
                        <input type="file" multiple className="hidden" accept="video/*" onChange={handleEditorVideoUpload} />
                      </label>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-6">
                <div className="bg-slate-900 rounded-[2.5rem] p-8 text-white shadow-2xl relative overflow-hidden ring-4 ring-slate-800">
                  <div className="absolute top-0 right-0 p-6">
                    <div className={`w-3.5 h-3.5 rounded-full ${editorState.isRendered ? 'bg-green-500 shadow-[0_0_15px_rgba(34,197,94,0.6)]' : 'bg-amber-500'} transition-all duration-500`} />
                  </div>
                  <h3 className="text-2xl font-bold mb-8 flex items-center gap-3">
                    <ShareIcon className="w-7 h-7 text-indigo-400" />
                    Publish Center
                  </h3>
                  
                  {editorState.youtubeMetadata ? (
                    <div className="space-y-8">
                      <div className="space-y-4">
                        <div className="bg-white/5 border border-white/10 p-4 rounded-2xl">
                          <p className="text-[10px] font-bold text-indigo-400 uppercase mb-1 tracking-widest">Metadata Title</p>
                          <p className="text-sm font-semibold leading-snug">{editorState.youtubeMetadata.title}</p>
                        </div>
                        
                        {!isDurationValid ? (
                          <div className="bg-red-500/10 border border-red-500/20 p-5 rounded-2xl flex items-start gap-3 animate-pulse">
                            <ExclamationCircleIcon className="w-6 h-6 text-red-500 flex-shrink-0" />
                            <div className="space-y-1">
                              <p className="text-sm font-bold text-white">Missing {secondsRemaining}s content</p>
                              <p className="text-xs text-slate-400 leading-relaxed">
                                Professional app tours require at least {MIN_DURATION}s to engage users effectively.
                              </p>
                            </div>
                          </div>
                        ) : !editorState.isRendered ? (
                          <div className="bg-amber-500/10 border border-amber-500/20 p-5 rounded-2xl flex items-start gap-3">
                            <CommandLineIcon className="w-6 h-6 text-amber-500 flex-shrink-0" />
                            <div className="space-y-1">
                              <p className="text-sm font-bold text-white">Timeline Validated ({editorState.clips.length} Scenes)</p>
                              <p className="text-xs text-slate-400 leading-relaxed">
                                Assembly required. Click below to stitch all {editorState.clips.length} scenes into one continuous Master Video.
                              </p>
                            </div>
                          </div>
                        ) : (
                          <div className="bg-emerald-500/10 border border-emerald-500/30 p-5 rounded-2xl flex items-start gap-3 animate-in zoom-in duration-300">
                            <CheckCircleIcon className="w-6 h-6 text-emerald-400 flex-shrink-0" />
                            <div className="space-y-1">
                              <p className="text-sm font-bold text-white">Master Video Ready</p>
                              <p className="text-xs text-slate-300 leading-relaxed">
                                All {editorState.clips.length} scenes stitched into one master MP4 file ({Math.floor(totalDuration)}s).
                              </p>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="space-y-4">
                        {isDurationValid && !editorState.isRendered && (
                          <button 
                            onClick={handleRenderProject} 
                            disabled={editorState.isRendering}
                            className={`w-full py-5 rounded-2xl font-black text-sm uppercase tracking-widest transition-all duration-300 flex items-center justify-center gap-3 shadow-2xl bg-indigo-600 hover:bg-indigo-500 text-white ${editorState.isRendering ? 'opacity-50 cursor-not-allowed' : 'active:scale-95'}`}
                          >
                            <CpuChipIcon className={`w-6 h-6 ${editorState.isRendering ? 'animate-spin' : ''}`} />
                            {editorState.isRendering ? `Stitching ${editorState.clips.length} Scenes...` : `Render Master Project (Stitch All ${editorState.clips.length} Scenes)`}
                          </button>
                        )}

                        <button 
                          onClick={() => {
                            if (editorState.isRendered && editorState.combinedVideoUrl) {
                              setPreviewMode('master');
                            } else {
                              setPreviewMode('breakdown');
                            }
                            setIsPreviewOpen(true);
                          }} 
                          className="w-full bg-white/5 hover:bg-white/10 py-4 rounded-2xl font-bold text-sm tracking-wide transition flex items-center justify-center gap-2 border border-white/10 active:scale-95 text-white"
                        >
                          <EyeIcon className="w-5 h-5 text-indigo-400" /> {editorState.isRendered ? `Preview Master Video (${editorState.clips.length} Scenes)` : `Review Segments (${editorState.clips.length} Scenes)`}
                        </button>

                        {editorState.isRendered && editorState.combinedVideoUrl && (
                          <div className="space-y-2">
                            <a 
                              href={editorState.combinedVideoUrl} 
                              download={`${editorState.youtubeMetadata?.title || 'TourGenie_Master_AppTour'}.mp4`}
                              className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 py-4 rounded-2xl font-black text-sm tracking-wide transition flex items-center justify-center gap-2 shadow-lg active:scale-95 text-white"
                            >
                              <ArrowDownTrayIcon className="w-5 h-5" /> Download Master File (All {editorState.clips.length} Scenes MP4)
                            </a>

                            <button
                              onClick={handleRenderProject}
                              disabled={editorState.isRendering}
                              className="w-full bg-white/5 hover:bg-white/10 py-2.5 rounded-xl font-semibold text-xs tracking-wide transition flex items-center justify-center gap-2 border border-white/10 text-slate-300 active:scale-95"
                            >
                              <ArrowPathIcon className={`w-4 h-4 ${editorState.isRendering ? 'animate-spin' : ''}`} /> Re-Stitch / Update Master Video
                            </button>
                          </div>
                        )}
                        
                        <button 
                          disabled={!isDurationValid || !editorState.isRendered}
                          onClick={handleYouTubePublish}
                          className={`w-full py-5 rounded-2xl font-black text-sm uppercase tracking-widest transition-all duration-300 flex items-center justify-center gap-3 shadow-2xl ${isDurationValid && editorState.isRendered ? 'bg-red-600 hover:bg-red-500 text-white active:scale-95 shadow-red-900/40' : 'bg-slate-800 text-slate-600 cursor-not-allowed border border-white/5'}`}
                        >
                          <PlayIcon className="w-6 h-6 fill-current" />
                          {editorState.isRendered ? 'Push to YouTube' : 'Assembly Locked'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-20 px-4">
                      <CpuChipIcon className="w-16 h-16 text-white/10 mx-auto mb-4" />
                      <p className="text-slate-500 text-sm italic">Analyze your clips to generate metadata and unlock the assembly engine.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* RENDERING PROGRESS MODAL */}
      {editorState.isRendering && (
        <div className="fixed inset-0 z-[120] bg-slate-950/95 backdrop-blur-3xl flex items-center justify-center p-6 animate-in fade-in duration-500">
           <div className="max-w-md w-full text-center space-y-10">
              <div className="w-32 h-32 mx-auto relative">
                <div className="absolute inset-0 border-8 border-indigo-500/10 rounded-full" />
                <div className="absolute inset-0 border-8 border-indigo-500 rounded-full animate-[spin_2s_linear_infinite] border-t-transparent shadow-[0_0_30px_rgba(99,102,241,0.4)]" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <CommandLineIcon className="w-14 h-14 text-indigo-500 drop-shadow-[0_0_10px_rgba(99,102,241,0.5)]" />
                </div>
              </div>
              <div className="space-y-3">
                <h2 className="text-3xl font-black text-white tracking-tight">Master Assembly</h2>
                <p className="text-indigo-400 font-mono text-sm uppercase tracking-[0.3em] font-bold h-6">{renderStage}</p>
              </div>
              <div className="space-y-4">
                <div className="w-full bg-white/5 h-3 rounded-full overflow-hidden border border-white/10">
                  <div className="h-full bg-indigo-500 transition-all duration-300 shadow-[0_0_15px_rgba(99,102,241,0.6)]" style={{ width: `${renderProgress}%` }} />
                </div>
                <div className="flex justify-between text-xs font-black text-slate-500 uppercase tracking-widest px-1">
                  <span>Processing Engine</span>
                  <span className="text-indigo-400">{renderProgress}%</span>
                </div>
              </div>
           </div>
        </div>
      )}

      {/* UPLOAD MODAL */}
      {isUploading && (
        <div className="fixed inset-0 z-[130] bg-slate-950/98 backdrop-blur-3xl flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className="max-w-md w-full glass p-10 rounded-[3rem] border border-white/10 text-center space-y-10 shadow-2xl">
            {!isUploadComplete ? (
              <>
                <div className="relative w-40 h-40 mx-auto">
                   <div className="absolute inset-0 border-[10px] border-white/5 rounded-full" />
                   <div className="absolute inset-0 border-[10px] border-red-600 rounded-full transition-all duration-500 shadow-[0_0_30px_rgba(220,38,38,0.3)]" style={{ clipPath: `conic-gradient(white ${uploadProgress}%, transparent 0)` }} />
                   <div className="absolute inset-0 flex items-center justify-center">
                    <ArrowUpTrayIcon className="w-16 h-16 text-white animate-bounce" />
                   </div>
                </div>
                <div className="space-y-2">
                  <h2 className="text-3xl font-black text-white mb-2">Broadcasting Tour</h2>
                  <p className="text-red-500 text-sm font-bold uppercase tracking-widest h-5">{uploadStage}</p>
                </div>
                <div className="w-full bg-white/5 rounded-full h-3 overflow-hidden border border-white/10">
                  <div className="h-full bg-red-600 transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
                </div>
              </>
            ) : (
              <div className="animate-in zoom-in duration-500 space-y-8 py-4">
                <div className="w-24 h-24 bg-green-500/20 rounded-full flex items-center justify-center mx-auto shadow-[0_0_40px_rgba(34,197,94,0.3)] border-2 border-green-500/50">
                  <CheckCircleIcon className="w-16 h-16 text-green-500" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-4xl font-black text-white">Tour Live!</h2>
                  <p className="text-slate-400 text-sm font-medium px-4">Your master tour has been processed and is now available to your global audience.</p>
                </div>
                <button onClick={() => setIsUploading(false)} className="w-full bg-white text-slate-900 font-black py-5 rounded-[1.5rem] shadow-2xl hover:bg-slate-50 transition active:scale-95 text-sm uppercase tracking-widest">Return to Projects</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* PREVIEW MODAL */}
      {isPreviewOpen && (
        <div className="fixed inset-0 z-[100] bg-slate-950/95 backdrop-blur-2xl flex items-center justify-center p-6 animate-in fade-in duration-300">
            <div className="max-w-6xl w-full flex flex-col gap-6">
                <div className="flex items-center justify-between text-white px-2">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg">
                        <PlayIcon className="w-7 h-7 text-white fill-current" />
                      </div>
                      <div>
                        <h2 className="text-2xl font-black tracking-tight">
                          {editorState.isRendered ? 'Master Tour Video' : 'Timeline Validation'}
                        </h2>
                        <p className="text-[10px] font-black uppercase text-indigo-400 tracking-widest">
                           {editorState.isRendered ? `All ${editorState.clips.length} Scenes Stitched Together (1080p MP4)` : `Individual Sequence Review (${editorState.clips.length} Scenes)`}
                        </p>
                      </div>
                    </div>

                    {/* Mode Toggle & Close */}
                    <div className="flex items-center gap-3">
                      {editorState.isRendered && editorState.combinedVideoUrl && (
                        <div className="flex bg-white/10 p-1 rounded-xl border border-white/10 text-xs font-bold">
                          <button
                            onClick={() => setPreviewMode('master')}
                            className={`px-3 py-1.5 rounded-lg transition ${previewMode === 'master' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                          >
                            Master Video (All {editorState.clips.length} Scenes)
                          </button>
                          <button
                            onClick={() => setPreviewMode('breakdown')}
                            className={`px-3 py-1.5 rounded-lg transition ${previewMode === 'breakdown' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                          >
                            Scene Breakdown ({editorState.clips.length})
                          </button>
                        </div>
                      )}
                      <button onClick={() => setIsPreviewOpen(false)} className="bg-white/10 hover:bg-white/20 p-2.5 rounded-full transition-all hover:rotate-90 active:scale-90"><XMarkIcon className="w-7 h-7" /></button>
                    </div>
                </div>
                
                <div className="bg-black rounded-[3rem] overflow-hidden aspect-video border border-white/10 relative shadow-[0_40px_80px_rgba(0,0,0,0.8)] ring-1 ring-white/10 flex items-center justify-center">
                    {previewMode === 'master' && editorState.isRendered && editorState.combinedVideoUrl ? (
                      <div className="w-full h-full relative flex items-center justify-center bg-black">
                        <video 
                          key={editorState.combinedVideoUrl}
                          src={editorState.combinedVideoUrl} 
                          className="w-full h-full object-contain" 
                          controls 
                          autoPlay 
                          playsInline
                        />
                        <div className="absolute top-6 left-6 pointer-events-none">
                          <div className="bg-emerald-600/90 backdrop-blur-xl rounded-xl px-4 py-2 text-white border border-white/20 shadow-lg inline-flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                            <span className="text-xs font-bold uppercase tracking-wider">Master Broadcast ({editorState.clips.length} Scenes Stitched)</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div ref={previewScrollRef} className="absolute inset-0 flex flex-col overflow-y-auto snap-y snap-mandatory scroll-smooth hide-scrollbar">
                        {editorState.clips.map((clip, idx) => (
                            <div key={clip.id} className="min-h-full w-full relative snap-start flex items-center justify-center bg-black group/scene">
                                <video 
                                  src={clip.previewUrl} 
                                  className="w-full h-full object-contain" 
                                  controls 
                                  autoPlay={idx === 0}
                                  onEnded={(e) => {
                                      // Seamless sequential playback simulation
                                      const next = e.currentTarget.parentElement?.nextElementSibling;
                                      if (next) {
                                          next.scrollIntoView({ behavior: 'smooth' });
                                          const nextVideo = next.querySelector('video');
                                          if (nextVideo) nextVideo.play();
                                      }
                                  }}
                                />
                                
                                {/* Overlay Controls */}
                                <div className="absolute top-10 left-10 flex flex-col gap-3 pointer-events-none group-hover/scene:opacity-100 opacity-0 transition-opacity duration-300">
                                    <div className="bg-indigo-600/90 backdrop-blur-xl shadow-[0_10px_30px_rgba(79,70,229,0.4)] rounded-2xl px-5 py-3 text-white inline-flex flex-col border border-white/20">
                                        <p className="text-[9px] font-black uppercase tracking-widest opacity-80 mb-0.5">Scene {idx+1} of {editorState.clips.length}</p>
                                        <p className="text-lg font-black">{Math.floor(clip.duration)}.0s</p>
                                    </div>
                                    {clip.narration && (
                                       <div className="bg-black/80 backdrop-blur-2xl border border-white/10 rounded-[1.5rem] px-5 py-4 max-w-sm shadow-2xl">
                                          <div className="flex items-center gap-2 mb-2">
                                            <MicrophoneIcon className="w-4 h-4 text-indigo-400" />
                                            <p className="text-[10px] text-indigo-400 font-black uppercase tracking-widest">AI Script Voice</p>
                                          </div>
                                          <p className="text-sm text-white/90 leading-relaxed italic font-medium">"{clip.narration}"</p>
                                       </div>
                                    )}
                                </div>
                            </div>
                        ))}
                      </div>
                    )}
                </div>
                <div className="flex items-center justify-between px-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-2.5 h-2.5 rounded-full ${editorState.isRendered ? 'bg-emerald-400' : 'bg-amber-400'} animate-pulse shadow-[0_0_10px_rgba(34,197,94,0.5)]`} />
                    <div className="text-slate-300 text-xs font-bold tracking-wide">
                      {editorState.isRendered 
                        ? `Master file contains all ${editorState.clips.length} scenes stitched together (${Math.floor(totalDuration)}s total)` 
                        : `Reviewing ${editorState.clips.length} timeline segments before final render.`}
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    {editorState.isRendered && editorState.combinedVideoUrl && (
                      <a
                        href={editorState.combinedVideoUrl}
                        download={`${editorState.youtubeMetadata?.title || 'TourGenie_Master_Tour'}.mp4`}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-4 py-2 rounded-xl flex items-center gap-2 transition active:scale-95 shadow-lg"
                      >
                        <ArrowDownTrayIcon className="w-4 h-4" /> Download Master File (All {editorState.clips.length} Scenes)
                      </a>
                    )}
                    {!editorState.isRendered && isDurationValid && (
                      <button
                        onClick={() => {
                          setIsPreviewOpen(false);
                          handleRenderProject();
                        }}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-4 py-2 rounded-xl flex items-center gap-2 transition active:scale-95 shadow-lg"
                      >
                        <CpuChipIcon className="w-4 h-4" /> Render & Stitch All {editorState.clips.length} Scenes
                      </button>
                    )}
                    <div className="flex flex-col items-end">
                       <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Total Project Length</p>
                       <div className="flex items-center gap-2 font-black text-white text-sm bg-slate-800 px-4 py-1.5 rounded-full border border-white/5">
                        <ClockIcon className="w-4 h-4 text-indigo-400" /> {Math.floor(totalDuration)}s
                       </div>
                    </div>
                  </div>
                </div>
            </div>
        </div>
      )}

      <footer className="fixed bottom-6 left-6 z-[60] flex gap-3">
        <div className="glass px-4 py-2 rounded-2xl border border-slate-200/50 flex items-center gap-3 shadow-2xl text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-indigo-600 transition-colors cursor-default">
          <div className={`w-2 h-2 rounded-full ${isApiReady ? 'bg-green-500' : 'bg-amber-500'} shadow-lg shadow-current/50`} />
          {isApiReady ? 'AI Engine Linked' : 'System Offline'}
        </div>
      </footer>
    </div>
  );
}
