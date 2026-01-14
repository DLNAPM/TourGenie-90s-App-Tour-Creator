import React, { useState, useEffect, useMemo } from 'react';
import { AppInput, Scene, GenerationState, EditorClip, EditorState } from './types';
import { TourService } from './services/geminiService';
import { 
  PlusIcon, 
  SparklesIcon, 
  VideoCameraIcon, 
  ArrowRightIcon, 
  CloudArrowUpIcon,
  CheckCircleIcon,
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
  ClockIcon
} from '@heroicons/react/24/outline';

const tourService = new TourService();
const MIN_DURATION = 30; // Updated to 30 seconds minimum threshold

export default function App() {
  const [activeTab, setActiveTab] = useState<'creator' | 'editor'>('creator');
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  
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
    includeVoiceover: true
  });

  const [error, setError] = useState<string | null>(null);

  // Derived state for duration tracking
  const totalDuration = useMemo(() => {
    return editorState.clips.reduce((acc, clip) => acc + (clip.duration || 0), 0);
  }, [editorState.clips]);

  const isDurationValid = totalDuration >= MIN_DURATION;
  const secondsRemaining = Math.max(0, Math.ceil(MIN_DURATION - totalDuration));

  // Determine if we effectively have an API key available
  const isApiReady = hasKey === true || (process.env.API_KEY && process.env.API_KEY !== 'RENDER_API_KEY_PLACEHOLDER' && process.env.API_KEY !== '');

  useEffect(() => {
    checkKeyStatus();
  }, []);

  const checkKeyStatus = async () => {
    try {
      if ((window as any).aistudio && typeof (window as any).aistudio.hasSelectedApiKey === 'function') {
        const selected = await (window as any).aistudio.hasSelectedApiKey();
        setHasKey(selected);
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
      } catch (e) {
        console.error("Failed to open key selection", e);
      }
    } else {
      setError("API Key selection is only available in the AI Studio environment.");
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

  // --- YouTube Upload Simulation ---
  const handleYouTubePublish = async () => {
    if (!isDurationValid) {
      setError(`Your tour is too short (${Math.floor(totalDuration)}s). Please add ${secondsRemaining}s more content to reach the 30-second requirement.`);
      return;
    }
    
    setIsUploading(true);
    setUploadProgress(0);
    setIsUploadComplete(false);
    
    const stages = [
      { msg: 'Authenticating with Google...', duration: 1500 },
      { msg: 'Checking Content Length Standards...', duration: 1000 },
      { msg: 'Syncing AI-Generated Metadata...', duration: 2000 },
      { msg: 'Processing Video Stream (720p)...', duration: 3000 },
      { msg: 'Finalizing YouTube Studio Sync...', duration: 1500 }
    ];

    let currentProgress = 0;
    for (const stage of stages) {
      setUploadStage(stage.msg);
      const startTime = Date.now();
      while (Date.now() - startTime < stage.duration) {
        currentProgress = Math.min(currentProgress + (Math.random() * 2), 99);
        setUploadProgress(Math.floor(currentProgress));
        await new Promise(r => setTimeout(r, 100));
      }
    }

    setUploadProgress(100);
    setUploadStage('Upload Successful!');
    setTimeout(() => setIsUploadComplete(true), 800);
  };

  // --- Tour Creator Logic ---
  const handleScreenshotUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files as FileList).forEach((file: File) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        setInput(prev => ({
          ...prev,
          screenshots: [...prev.screenshots, reader.result as string]
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
        setState(prev => ({ ...prev, scenes: [...updatedScenes], progress: 30 + (i * 10) }));
        try {
          const screenshot = updatedScenes[i].screenshotIndex !== undefined 
            ? input.screenshots[updatedScenes[i].screenshotIndex!] 
            : undefined;
          const videoUrl = await tourService.generateSceneVideo(updatedScenes[i], screenshot);
          const audioBase64 = await tourService.generateNarration(updatedScenes[i].narration);
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
    
    setEditorState(prev => ({ ...prev, clips: [...prev.clips, ...newClips] }));
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
    setEditorState(prev => ({ ...prev, clips: prev.clips.filter(c => c.id !== id) }));
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
                    <p className="text-slate-500 text-sm">Reference images for AI animation.</p>
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
              <div className="space-y-12 animate-in slide-in-from-bottom duration-700">
                <div className="text-center">
                  <h2 className="text-4xl font-black text-slate-900 mb-2">Your Tour is Ready!</h2>
                  <p className="text-slate-500">Download scenes and voiceovers to create your final helper video.</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                  {state.scenes.map((scene, idx) => (
                    <div key={scene.id} className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
                      <video src={scene.videoUrl} className="w-full aspect-video object-cover" controls />
                      <div className="p-6">
                        <p className="text-xs font-bold text-indigo-600 uppercase mb-2">Scene {idx + 1}</p>
                        <p className="text-slate-600 text-sm mb-4 line-clamp-3">"{scene.narration}"</p>
                        <div className="flex gap-2">
                          <a href={scene.videoUrl} download={`scene-${idx+1}.mp4`} className="flex-1 bg-slate-900 text-white text-xs font-bold py-2 rounded-lg text-center">Video</a>
                          <button onClick={() => alert("Audio download ready!")} className="flex-1 border border-slate-200 text-xs font-bold py-2 rounded-lg text-center">Audio</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="max-w-4xl mx-auto py-24 text-center">
                <div className="w-20 h-20 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-8" />
                <h2 className="text-2xl font-bold">TourGenie is working...</h2>
                <p className="text-slate-500">Processing scene {state.scenes.filter(s=>s.status==='completed').length + 1} of 5</p>
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
                </div>
              </div>
              
              <div className="flex-1 max-w-xs space-y-2">
                <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-slate-400">
                   <span>Timeline Health</span>
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
                  Voiceover
                </button>
                {editorState.clips.length > 0 && !editorState.isProcessing && (
                  <button onClick={processEditorClips} className="font-bold py-3 px-8 rounded-2xl flex items-center gap-2 shadow-lg bg-indigo-600 hover:bg-indigo-700 text-white transition">
                    <SparklesIcon className="w-5 h-5" /> Analyze
                  </button>
                )}
              </div>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 space-y-6">
                <div className="bg-white rounded-3xl border border-slate-200 p-8 min-h-[400px]">
                  {editorState.clips.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center space-y-4">
                      <FilmIcon className="w-16 h-16 text-slate-200" />
                      <label className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-8 rounded-xl cursor-pointer transition shadow-xl shadow-indigo-100">
                        Upload Video Clips
                        <input type="file" multiple className="hidden" accept="video/*" onChange={handleEditorVideoUpload} />
                      </label>
                      <p className="text-slate-400 text-sm">Upload at least {MIN_DURATION}s of footage for a complete tour.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {editorState.clips.map((clip, idx) => (
                        <div key={clip.id} className="group relative bg-slate-50 border border-slate-100 rounded-2xl p-4 flex flex-col sm:flex-row gap-4 items-start transition hover:border-indigo-200">
                          <div className="w-full sm:w-48 aspect-video rounded-lg overflow-hidden bg-black flex-shrink-0 relative">
                            <video src={clip.previewUrl} className="w-full h-full object-contain" controls />
                            <div className="absolute bottom-2 right-2 bg-black/60 px-1.5 py-0.5 rounded text-[10px] text-white font-bold">
                                {Math.floor(clip.duration)}s
                            </div>
                          </div>
                          <div className="flex-1 w-full space-y-2">
                            <div className="flex justify-between items-center">
                              <span className="text-xs font-bold text-slate-400 uppercase">Clip {idx + 1}</span>
                              <button onClick={() => removeClip(clip.id)} className="text-slate-300 hover:text-red-500"><TrashIcon className="w-5 h-5" /></button>
                            </div>
                            {clip.status === 'analyzing' ? <p className="text-sm text-indigo-600 animate-pulse">Analyzing...</p> : 
                             clip.narration ? <p className="text-sm text-slate-600 italic">"{clip.narration}"</p> : 
                             <p className="text-sm text-slate-400">Ready for AI processing.</p>}
                          </div>
                        </div>
                      ))}
                      <label className="flex items-center justify-center p-8 border-2 border-dashed border-slate-200 rounded-2xl hover:border-indigo-400 hover:bg-indigo-50/30 transition cursor-pointer group">
                        <PlusIcon className="w-6 h-6 text-slate-300 group-hover:text-indigo-500" />
                        <input type="file" multiple className="hidden" accept="video/*" onChange={handleEditorVideoUpload} />
                      </label>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-6">
                <div className="bg-slate-900 rounded-3xl p-8 text-white shadow-2xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-4">
                    <div className={`w-3 h-3 rounded-full ${isDurationValid ? 'bg-green-500' : 'bg-red-500'} shadow-lg shadow-current/50`} />
                  </div>
                  <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
                    <ShareIcon className="w-6 h-6 text-indigo-400" />
                    Publish Center
                  </h3>
                  
                  {editorState.youtubeMetadata ? (
                    <div className="space-y-6">
                      <div className="bg-white/5 p-4 rounded-xl">
                        <p className="text-xs font-bold text-indigo-400 uppercase mb-1">Title</p>
                        <p className="text-sm font-medium">{editorState.youtubeMetadata.title}</p>
                      </div>
                      
                      {!isDurationValid && (
                        <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-xl flex items-start gap-3 animate-pulse">
                          <ExclamationCircleIcon className="w-5 h-5 text-red-500 flex-shrink-0" />
                          <p className="text-xs text-red-200 leading-relaxed">
                            <span className="font-bold block">Need {secondsRemaining}s more content</span>
                            Add more footage to hit the {MIN_DURATION}s professional standard for YouTube tours.
                          </p>
                        </div>
                      )}

                      <div className="space-y-3">
                        <button onClick={() => setIsPreviewOpen(true)} className="w-full bg-white/10 hover:bg-white/20 py-3 rounded-2xl font-bold transition flex items-center justify-center gap-2 border border-white/10">
                          <EyeIcon className="w-5 h-5" /> Preview
                        </button>
                        <button 
                          disabled={!isDurationValid}
                          onClick={handleYouTubePublish}
                          className={`w-full py-4 rounded-2xl font-bold transition flex items-center justify-center gap-2 shadow-xl ${isDurationValid ? 'bg-red-600 hover:bg-red-700 text-white active:scale-95' : 'bg-slate-800 text-slate-600 cursor-not-allowed'}`}
                        >
                          <PlayIcon className="w-5 h-5 fill-current" />
                          {isDurationValid ? 'Publish to YouTube' : 'Length Insufficient'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-slate-500 text-sm text-center py-12 italic">Analyze your clips to generate metadata and unlock publishing.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* MODALS (UPLOAD & PREVIEW) */}
      {isUploading && (
        <div className="fixed inset-0 z-[110] bg-slate-950/95 backdrop-blur-2xl flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className="max-w-md w-full glass p-8 rounded-[2.5rem] border border-white/10 text-center space-y-8">
            {!isUploadComplete ? (
              <>
                <div className="relative w-32 h-32 mx-auto">
                   <div className="absolute inset-0 border-4 border-white/5 rounded-full" />
                   <div className="absolute inset-0 border-4 border-red-600 rounded-full" style={{ clipPath: `conic-gradient(white ${uploadProgress}%, transparent 0)` }} />
                   <div className="absolute inset-0 flex items-center justify-center">
                    <ArrowUpTrayIcon className="w-12 h-12 text-white animate-bounce" />
                   </div>
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-white mb-2">Publishing to YouTube</h2>
                  <p className="text-slate-400 text-sm font-medium">{uploadStage}</p>
                </div>
                <div className="w-full bg-white/5 rounded-full h-2 overflow-hidden">
                  <div className="h-full bg-red-600 transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
                </div>
              </>
            ) : (
              <div className="animate-in zoom-in duration-500 space-y-6">
                <CheckCircleIcon className="w-20 h-20 text-green-500 mx-auto" />
                <h2 className="text-3xl font-bold text-white">Tour Published!</h2>
                <button onClick={() => setIsUploading(false)} className="w-full bg-white text-slate-900 font-bold py-4 rounded-2xl">Back to Project</button>
              </div>
            )}
          </div>
        </div>
      )}

      {isPreviewOpen && (
        <div className="fixed inset-0 z-[100] bg-slate-950/95 backdrop-blur-xl flex items-center justify-center p-6 animate-in fade-in duration-300">
            <div className="max-w-5xl w-full flex flex-col gap-6">
                <div className="flex items-center justify-between text-white">
                    <h2 className="text-2xl font-bold flex items-center gap-3"><PlayIcon className="w-8 h-8 text-indigo-500 fill-current" /> Tour Preview</h2>
                    <button onClick={() => setIsPreviewOpen(false)} className="bg-white/10 hover:bg-white/20 p-2 rounded-full"><XMarkIcon className="w-6 h-6" /></button>
                </div>
                <div className="bg-black rounded-[2.5rem] overflow-hidden aspect-video border border-white/10 relative">
                    <div className="absolute inset-0 flex flex-col overflow-y-auto snap-y snap-mandatory">
                        {editorState.clips.map((clip, idx) => (
                            <div key={clip.id} className="min-h-full w-full relative snap-start">
                                <video src={clip.previewUrl} className="w-full h-full object-contain" controls autoPlay={idx === 0} />
                                <div className="absolute top-6 left-6 bg-black/60 backdrop-blur-md border border-white/10 rounded-2xl px-4 py-2 text-white">
                                    <p className="text-xs font-bold uppercase tracking-widest text-indigo-400">Scene {idx+1}</p>
                                    <p className="text-sm font-medium">{Math.floor(clip.duration)}s segment</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="text-center text-slate-500 text-sm italic">Scroll through the preview to view the full {Math.floor(totalDuration)}s timeline.</div>
            </div>
        </div>
      )}

      <footer className="fixed bottom-4 left-4 z-[60] flex gap-2">
        <div className="glass px-3 py-1.5 rounded-full border border-slate-200 flex items-center gap-2 shadow-sm text-[10px] font-bold uppercase tracking-wider text-slate-500">
          <ServerIcon className="w-3 h-3 text-green-500" />
          {isApiReady ? 'Secure Connection Active' : 'API Connection Pending'}
        </div>
      </footer>
    </div>
  );
}
