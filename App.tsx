import React, { useState, useEffect, useMemo, useRef } from 'react';
import { AppInput, Scene, GenerationState, EditorClip, EditorState } from './types';
import { TourService } from './services/geminiService';
import { pcmBase64ToWavBlob, stitchClipsClientSide } from './services/screenStudioEngine';
import { User, onAuthStateChanged } from 'firebase/auth';
import { auth, logoutUser, saveUserSession, getUserSessions, getSessionById, getSessionAudio, SavedProjectSession } from './services/firebase';
import { AuthModal } from './components/AuthModal';
import { SavedSessionsModal } from './components/SavedSessionsModal';
import { SaveSessionDialog } from './components/SaveSessionDialog';
import { MasterVideoPlayer } from './components/MasterVideoPlayer';
import { YouTubePublishModal } from './components/YouTubePublishModal';
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
  ArrowPathIcon,
  UserIcon,
  ArrowRightOnRectangleIcon,
  DocumentArrowUpIcon,
  UserGroupIcon,
  FolderIcon
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

  // YouTube Publishing Modal State
  const [isYouTubeModalOpen, setIsYouTubeModalOpen] = useState(false);
  const [uploadedMasterFile, setUploadedMasterFile] = useState<File | null>(null);
  const masterFileInputRef = useRef<HTMLInputElement>(null);
  
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

  // Firebase Authentication & Session Persistence State
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isSessionsModalOpen, setIsSessionsModalOpen] = useState(false);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [isQuickSaving, setIsQuickSaving] = useState(false);
  const [quickSaveFeedback, setQuickSaveFeedback] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [currentSessionName, setCurrentSessionName] = useState<string>('');
  const [currentProjectName, setCurrentProjectName] = useState<string>('General');
  const [knownProjects, setKnownProjects] = useState<string[]>([]);

  // Subscribe to Firebase Auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
    });
    return () => unsubscribe();
  }, []);

  // Fetch known project names when user logs in
  useEffect(() => {
    if (currentUser?.uid) {
      getUserSessions(currentUser.uid)
        .then((sessions) => {
          const set = new Set<string>();
          sessions.forEach((s) => {
            const p = s.projectName?.trim();
            if (p) set.add(p);
          });
          if (set.size > 0) {
            setKnownProjects(Array.from(set).sort());
          }
        })
        .catch(() => {});
    }
  }, [currentUser]);

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

  // --- Session Management Helpers ---
  // Helper to compile all slides/clips/scenes across editor and tour creator
  const getCompiledProject = () => {
    let clipsToSave: EditorClip[] = [];

    if (editorState.clips && editorState.clips.length > 0) {
      clipsToSave = editorState.clips.map((c, idx) => {
        const matchingScene = state.scenes[idx];
        const screenshot = c.screenshotUrl || c.rawScreenshot || 
          (matchingScene && matchingScene.screenshotIndex !== undefined ? input.screenshots[matchingScene.screenshotIndex] : '') ||
          (input.screenshots[idx % (input.screenshots.length || 1)] || '') ||
          (c.previewUrl?.startsWith('data:image') ? c.previewUrl : '');

        return {
          id: c.id || `clip_${idx}_${Date.now()}`,
          order: idx,
          title: c.title || c.analysis || matchingScene?.visualPrompt || `Slide ${idx + 1}`,
          duration: c.duration || matchingScene?.duration || 15,
          narration: c.narration || matchingScene?.narration || '',
          analysis: c.analysis || c.narration || '',
          cameraMotion: c.cameraMotion || matchingScene?.visualPrompt || 'Slow Zoom In',
          resolution: '1080p Full HD',
          previewUrl: c.previewUrl || matchingScene?.videoUrl || screenshot || '',
          videoUrl: c.videoUrl || matchingScene?.videoUrl || '',
          screenshotUrl: screenshot,
          rawScreenshot: screenshot,
          audioUrl: c.audioUrl || matchingScene?.audioUrl || '',
          status: c.status || 'ready'
        };
      });
    } else if (state.scenes && state.scenes.length > 0) {
      clipsToSave = state.scenes.map((s, idx) => {
        const screenshotIndex = s.screenshotIndex !== undefined 
          ? s.screenshotIndex 
          : (input.screenshots.length > 0 ? (idx % input.screenshots.length) : undefined);
        const screenshot = (screenshotIndex !== undefined && input.screenshots[screenshotIndex])
          ? input.screenshots[screenshotIndex]
          : (input.screenshots.length > 0 ? input.screenshots[idx % input.screenshots.length] : '');

        return {
          id: s.id || `scene_clip_${idx}_${Date.now()}`,
          order: idx,
          title: s.visualPrompt || `Slide ${idx + 1}`,
          duration: s.duration || 15,
          narration: s.narration || '',
          analysis: s.narration || '',
          cameraMotion: s.visualPrompt || 'Slow Zoom In',
          resolution: '1080p Full HD',
          previewUrl: s.videoUrl || screenshot || '',
          videoUrl: s.videoUrl || '',
          screenshotUrl: screenshot,
          rawScreenshot: screenshot,
          audioUrl: s.audioUrl || '',
          status: s.status === 'completed' ? 'ready' : (s.status || 'ready')
        };
      });
    } else if (input.screenshots && input.screenshots.length > 0) {
      clipsToSave = input.screenshots.map((shot, idx) => ({
        id: `draft_slide_${idx}_${Date.now()}`,
        order: idx,
        title: `Slide ${idx + 1}`,
        duration: 15,
        narration: '',
        analysis: '',
        cameraMotion: 'Slow Zoom In',
        resolution: '1080p Full HD',
        previewUrl: shot,
        videoUrl: '',
        screenshotUrl: shot,
        rawScreenshot: shot,
        audioUrl: '',
        status: 'ready'
      }));
    }

    const calculatedDuration = clipsToSave.reduce((sum, c) => sum + (c.duration || 0), 0) || totalDuration;

    return {
      title: currentSessionName || input.name || editorState.youtubeMetadata?.title || 'TourGenie 90s App Tour',
      sessionName: currentSessionName || input.name || 'TourGenie 90s App Tour',
      projectName: currentProjectName || 'General',
      description: input.description || '',
      appUrl: input.url || '',
      script: input.script || '',
      clips: clipsToSave,
      scenes: state.scenes,
      screenshots: input.screenshots,
      totalDuration: calculatedDuration,
      isRendered: editorState.isRendered,
      combinedVideoUrl: editorState.combinedVideoUrl,
      youtubeMetadata: editorState.youtubeMetadata
    };
  };

  const handleQuickSaveSession = () => {
    if (!currentUser) {
      setIsAuthModalOpen(true);
      return;
    }
    setIsSaveDialogOpen(true);
  };

  const handleSaveSessionWithProject = async (sessionName: string, projectName: string) => {
    if (!currentUser) return;
    setIsQuickSaving(true);
    setQuickSaveFeedback(null);
    try {
      const project = getCompiledProject();
      const cleanSessionName = sessionName.trim() || 'TourGenie App Tour';
      const cleanProjectName = projectName.trim() || 'General';

      const sessionId = await saveUserSession(currentUser.uid, {
        id: activeSessionId || `session_${Date.now()}`,
        title: cleanSessionName,
        sessionName: cleanSessionName,
        projectName: cleanProjectName,
        appDescription: input.description || project.description || '',
        appUrl: input.url || project.appUrl || '',
        script: input.script || project.script || '',
        clipsCount: project.clips.length,
        totalDuration: project.totalDuration,
        isRendered: editorState.isRendered,
        combinedVideoUrl: editorState.combinedVideoUrl,
        clips: project.clips,
        scenes: state.scenes,
        screenshots: input.screenshots,
        youtubeMetadata: editorState.youtubeMetadata
      });

      setActiveSessionId(sessionId);
      setCurrentSessionName(cleanSessionName);
      setCurrentProjectName(cleanProjectName);
      setKnownProjects(prev => Array.from(new Set([...prev, cleanProjectName])).sort());
      setQuickSaveFeedback(`Saved to [${cleanProjectName}]!`);
      setTimeout(() => setQuickSaveFeedback(null), 3500);
    } catch (err: any) {
      console.error('Failed to save session:', err);
      setQuickSaveFeedback('Save Failed');
      setTimeout(() => setQuickSaveFeedback(null), 3500);
      throw err;
    } finally {
      setIsQuickSaving(false);
    }
  };

  const handleLoadSession = (session: SavedProjectSession) => {
    if (!session) return;
    const sessionId = session.id || `session_${Date.now()}`;
    setActiveSessionId(sessionId);

    // Track active session & project naming
    const restoredSessionName = session.sessionName || session.title || '';
    const restoredProjectName = session.projectName || 'General';
    setCurrentSessionName(restoredSessionName);
    setCurrentProjectName(restoredProjectName);
    setKnownProjects(prev => Array.from(new Set([...prev, restoredProjectName])).sort());

    // 1. Restore input details (Name, URL, Description, Script, Screenshots)
    const restoredScreenshots: string[] = session.screenshots && session.screenshots.length > 0
      ? session.screenshots
      : (session.clips || []).map((c: any) => c.screenshotUrl || c.rawScreenshot).filter(Boolean);

    setInput({
      name: session.title || '',
      url: session.appUrl || '',
      description: session.appDescription || '',
      script: session.script || '',
      screenshots: restoredScreenshots
    });

    // 2. Restore clips for Video Editor
    let restoredClips: EditorClip[] = [];
    if (session.clips && session.clips.length > 0) {
      restoredClips = session.clips.map((c: any, index: number) => {
        const shotIndex = c?.screenshotIndex !== undefined ? c.screenshotIndex : index;
        const shot = c?.screenshotUrl || c?.rawScreenshot || (restoredScreenshots[shotIndex] || restoredScreenshots[index] || '');
        return {
          id: c?.id || `restored_clip_${index}_${Date.now()}`,
          duration: c?.duration || 15,
          status: 'ready',
          title: c?.title || c?.analysis || `Slide ${index + 1}`,
          narration: c?.narration || '',
          analysis: c?.analysis || c?.narration || '',
          previewUrl: c?.previewUrl || c?.videoUrl || shot || '',
          videoUrl: c?.videoUrl || '',
          screenshotUrl: shot,
          rawScreenshot: shot,
          audioUrl: c?.audioUrl || ''
        };
      });
    } else if (session.scenes && session.scenes.length > 0) {
      // If clips array was empty but scenes existed
      restoredClips = session.scenes.map((s: any, index: number) => {
        const shotIndex = s.screenshotIndex !== undefined ? s.screenshotIndex : index;
        const shot = (restoredScreenshots[shotIndex] || restoredScreenshots[index % (restoredScreenshots.length || 1)]) || '';
        return {
          id: s.id || `restored_scene_${index}_${Date.now()}`,
          duration: s.duration || 15,
          status: 'ready',
          title: s.visualPrompt || `Slide ${index + 1}`,
          narration: s.narration || '',
          analysis: s.visualPrompt || s.narration || '',
          previewUrl: s.videoUrl || shot || '',
          videoUrl: s.videoUrl || '',
          screenshotUrl: shot,
          rawScreenshot: shot,
          audioUrl: s.audioUrl || ''
        };
      });
    }

    if (restoredClips.length > 0) {
      const isStaleBlob = typeof session.combinedVideoUrl === 'string' && session.combinedVideoUrl.startsWith('blob:');
      setEditorState({
        clips: restoredClips,
        isProcessing: false,
        includeVoiceover: true,
        isRendering: false,
        isRendered: !!session.isRendered && !isStaleBlob,
        combinedVideoUrl: isStaleBlob ? undefined : (session.combinedVideoUrl || undefined),
        youtubeMetadata: session.youtubeMetadata || undefined
      });
    }

    // 3. Restore scenes for Tour Creator storyboard
    let restoredScenes: Scene[] = [];
    if (session.scenes && session.scenes.length > 0) {
      restoredScenes = session.scenes.map((s: any, index: number) => {
        const shotIndex = s.screenshotIndex !== undefined ? s.screenshotIndex : index;
        const shot = restoredScreenshots[shotIndex] || restoredScreenshots[index] || '';
        return {
          id: s.id || `restored_scene_${index}`,
          timestamp: s.timestamp || `0:${(index * 15).toString().padStart(2, '0')}`,
          duration: s.duration || 15,
          visualPrompt: s.visualPrompt || `Slide ${index + 1}`,
          narration: s.narration || '',
          videoUrl: s.videoUrl || shot || '',
          audioUrl: s.audioUrl || '',
          status: (s.status as any) || 'completed',
          screenshotIndex: shotIndex
        };
      });
    } else if (restoredClips.length > 0) {
      // Synthesize scenes from restored clips so the storyboard is also complete
      restoredScenes = restoredClips.map((c, index) => ({
        id: c.id || `synth_scene_${index}`,
        timestamp: `0:${(index * 15).toString().padStart(2, '0')}`,
        duration: c.duration || 15,
        visualPrompt: c.title || c.analysis || `Slide ${index + 1}`,
        narration: c.narration || '',
        videoUrl: c.videoUrl || (c.previewUrl?.startsWith('data:video') || c.previewUrl?.endsWith('.mp4') ? c.previewUrl : ''),
        audioUrl: c.audioUrl || '',
        status: 'completed',
        screenshotIndex: index
      }));
    }

    if (restoredScenes.length > 0) {
      setState({
        step: 'final',
        scenes: restoredScenes,
        progress: 100
      });
    } else {
      setState({
        step: 'input',
        scenes: [],
        progress: 0
      });
    }

    // 4. Background rehydration of audio subcollection
    if (sessionId) {
      getSessionAudio(sessionId, session.userId || currentUser?.uid).then((audioMap) => {
        if (audioMap && Object.keys(audioMap).length > 0) {
          setEditorState((prev) => ({
            ...prev,
            clips: prev.clips.map((c, idx) => ({
              ...c,
              audioUrl: c.audioUrl || audioMap[c.id] || audioMap[`clip_${idx}`] || audioMap[`scene_${idx}`] || audioMap[`scene-${idx}`] || ''
            }))
          }));
          setState((prev) => ({
            ...prev,
            scenes: prev.scenes.map((s, idx) => ({
              ...s,
              audioUrl: s.audioUrl || audioMap[s.id] || audioMap[`scene_${idx}`] || audioMap[`scene-${idx}`] || audioMap[`clip_${idx}`] || audioMap[s.id?.replace('scene_', 'clip_')] || audioMap[s.id?.replace('scene-', 'clip-')] || ''
            }))
          }));
        }
      }).catch((e) => console.warn('[TourGenie] Async audio fetch non-fatal:', e));
    }

    // 5. Tab navigation & user feedback
    if (restoredClips.length > 0) {
      setActiveTab('editor');
      setQuickSaveFeedback(`Loaded ${restoredClips.length} slides from "${session.title || 'Tour'}"`);
    } else {
      setActiveTab('creator');
      setQuickSaveFeedback(`Loaded: "${session.title || 'Tour'}" (Draft session without pre-rendered slides)`);
    }
    setTimeout(() => setQuickSaveFeedback(null), 3500);
  };

  // Auto-load shared session from URL if ?session=SESSION_ID is provided
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sharedSessionId = params.get('session');
    if (sharedSessionId) {
      getSessionById(sharedSessionId).then(session => {
        if (session) {
          handleLoadSession(session);
          setQuickSaveFeedback(`Loaded Shared Tour: ${session.title}`);
        }
      }).catch(err => {
        console.warn("Could not load shared session from URL:", err);
      });
    }
  }, []);

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
  const playAudioPreview = async (audioBase64?: string, narrationText?: string, onGenerated?: (audio: string) => void) => {
    let audio = audioBase64;
    if (!audio && narrationText?.trim()) {
      try {
        setQuickSaveFeedback("Generating voiceover audio...");
        audio = await tourService.generateNarration(narrationText);
        if (onGenerated && audio) {
          onGenerated(audio);
        }
        setTimeout(() => setQuickSaveFeedback(null), 1500);
      } catch (synthErr) {
        console.warn("Could not generate voiceover audio on the fly:", synthErr);
      }
    }

    if (!audio) {
      setError("No voiceover audio available for this scene.");
      return;
    }
    try {
      const blob = pcmBase64ToWavBlob(audio);
      const url = URL.createObjectURL(blob);
      const audioEl = new Audio(url);
      audioEl.play().catch(e => console.warn("Audio playback failed:", e));
    } catch (err) {
      console.error("Failed to play audio:", err);
    }
  };

  const downloadAudio = async (audioBase64?: string, sceneIndex: number = 0, narrationText?: string) => {
    let audio = audioBase64;
    if (!audio && narrationText?.trim()) {
      try {
        setQuickSaveFeedback("Generating audio file...");
        audio = await tourService.generateNarration(narrationText);
        setTimeout(() => setQuickSaveFeedback(null), 1500);
      } catch (synthErr) {
        console.warn("Could not generate audio on the fly:", synthErr);
      }
    }

    if (!audio) {
      setError("No voiceover audio available for this scene.");
      return;
    }
    try {
      const blob = pcmBase64ToWavBlob(audio);
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
        const duration = await getVideoDuration(file).catch(() => scene.duration || 25);
        newClips.push({
          id: `scene-clip-${i}-${Date.now()}`,
          file,
          previewUrl: scene.videoUrl,
          duration: duration || scene.duration || 25,
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
        sceneIndex,
        duration: scene.duration
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
  const handleRenderProject = async (options?: { autoOpenPreview?: boolean }): Promise<string | null> => {
    if (!isDurationValid || editorState.clips.length === 0) return null;
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
          let videoUrl = clip.videoUrl || clip.previewUrl;
          const isLikelyImage = !videoUrl || 
            (clip.screenshotUrl && !clip.videoUrl) ||
            (clip.file && clip.file.type.startsWith('image/')) ||
            videoUrl.startsWith('data:image') || 
            /\.(png|jpe?g|webp|gif|bmp)(\?.*)?$/i.test(videoUrl);

          if (isLikelyImage) {
            const shot = clip.screenshotUrl || clip.rawScreenshot || clip.previewUrl;
            if (shot) {
              setRenderStage(`Generating Screen Studio animation for Scene ${i + 1}...`);
              videoUrl = await tourService.generateSceneVideo(
                { id: clip.id, timestamp: '', visualPrompt: clip.title || '', narration: clip.narration || '', status: 'completed' },
                shot,
                { duration: clip.duration || 15, audioBase64: clip.audioUrl, sceneIndex: i }
              );
              clip.videoUrl = videoUrl;
              clip.previewUrl = videoUrl;
            }
          }

          if (videoUrl) {
            const res = await fetch(videoUrl);
            if (!res.ok) {
              throw new Error(`Failed to fetch scene stream: HTTP ${res.status}`);
            }
            let blob = await res.blob();

            // If the fetched blob is still an image, run Screen Studio engine to convert it to a video
            if (blob.type.startsWith('image/')) {
              const shot = clip.screenshotUrl || clip.rawScreenshot || videoUrl;
              if (shot) {
                setRenderStage(`Converting screenshot to HD video for Scene ${i + 1}...`);
                videoUrl = await tourService.generateSceneVideo(
                  { id: clip.id, timestamp: '', visualPrompt: clip.title || '', narration: clip.narration || '', status: 'completed' },
                  shot,
                  { duration: clip.duration || 15, audioBase64: clip.audioUrl, sceneIndex: i }
                );
                clip.videoUrl = videoUrl;
                clip.previewUrl = videoUrl;
                const animatedRes = await fetch(videoUrl);
                if (animatedRes.ok) {
                  blob = await animatedRes.blob();
                }
              }
            }

            if (blob && blob.size > 0) {
              clipBlobs.push(blob);
            }
          }
        } catch (fetchErr) {
          console.warn(`Could not prepare video stream for clip ${i}:`, fetchErr);
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
          let ext = 'mp4';
          if (blob.type.includes('webm')) ext = 'webm';
          else if (blob.type.includes('png')) ext = 'png';
          else if (blob.type.includes('jpeg') || blob.type.includes('jpg')) ext = 'jpg';
          formData.append('clips', blob, `scene-${idx + 1}.${ext}`);
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

      const finalMasterUrl = masterUrl || editorState.clips[0]?.previewUrl || null;
      setRenderProgress(100);
      setRenderStage(`Export Successful! All ${totalClips} scenes stitched.`);

      // Finalize editorState with the true master combinedVideoUrl
      setEditorState(prev => ({
        ...prev,
        isRendering: false,
        isRendered: true,
        combinedVideoUrl: finalMasterUrl || undefined
      }));

      if (options?.autoOpenPreview !== false) {
        setPreviewMode('master');
        setIsPreviewOpen(true);
      }

      return finalMasterUrl;
    } catch (err: any) {
      console.error('Master assembly error:', err);
      setEditorState(prev => ({ ...prev, isRendering: false }));
      setError(err.message || 'Failed to assemble master video');
      return null;
    }
  };

  // --- Real YouTube Data API v3 Publish Flow ---
  const handleUploadedMasterFile = (file: File) => {
    try {
      const url = URL.createObjectURL(file);
      setUploadedMasterFile(file);
      setEditorState(prev => ({
        ...prev,
        combinedVideoUrl: url,
        isRendered: true
      }));
      setPreviewMode('master');
      setIsPreviewOpen(true);
      setError(null);
    } catch (e: any) {
      setError("Could not load master video file.");
    }
  };

  const handleOpenYouTubePublish = () => {
    if (!isDurationValid && !editorState.combinedVideoUrl && !uploadedMasterFile) {
      setError("Please ensure your project clips meet the duration target or upload your downloaded stitched video.");
      return;
    }
    setIsYouTubeModalOpen(true);
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
        setState(prev => ({ 
          ...prev, 
          scenes: [...updatedScenes], 
          progress: 30 + Math.round(((i + 1) / updatedScenes.length) * 65) 
        }));
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
            sceneIndex: i,
            duration: updatedScenes[i].duration
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
        if (clip.status === 'ready' || !clip.file) continue;
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
      <nav className="sticky top-0 z-50 glass border-b border-slate-200/50 px-6 py-3.5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-600/20">
              <SparklesIcon className="w-6 h-6" />
            </div>
            <div>
              <span className="font-extrabold text-xl tracking-tight text-slate-900 block leading-tight">TourGenie</span>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">90s App Tour Studio</span>
            </div>
          </div>
          
          <div className="hidden sm:flex bg-slate-100 p-1 rounded-xl">
            <button onClick={() => setActiveTab('creator')} className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition ${activeTab === 'creator' ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}>Tour Creator</button>
            <button onClick={() => setActiveTab('editor')} className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition ${activeTab === 'editor' ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}>Video Editor</button>
          </div>
        </div>

        {/* Authentication, Cloud Sessions & API Controls */}
        <div className="flex items-center gap-3">
          {currentUser ? (
            <div className="flex items-center gap-2">
              {/* Current Project / Session Badge */}
              <button
                onClick={() => setIsSessionsModalOpen(true)}
                title="Current Session and Project (Click to browse all)"
                className="hidden xl:flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-50/70 dark:bg-slate-800 hover:bg-indigo-100 dark:hover:bg-slate-700 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 border border-indigo-200/80 dark:border-slate-700 transition"
              >
                <FolderIcon className="w-3.5 h-3.5 text-indigo-600" />
                <span className="font-bold text-slate-900 dark:text-white max-w-[110px] truncate">{currentProjectName || "General"}</span>
                <span className="text-slate-400">/</span>
                <span className="text-indigo-600 dark:text-indigo-400 max-w-[120px] truncate">{currentSessionName || input.name || "Untitled Tour"}</span>
              </button>

              {/* Quick Save Project Button */}
              <button
                onClick={handleQuickSaveSession}
                disabled={isQuickSaving}
                title="Save current project to your cloud account"
                className="flex items-center gap-1.5 text-xs font-bold py-2 px-3 rounded-xl border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 transition active:scale-95 shadow-sm"
              >
                {isQuickSaving ? (
                  <ArrowPathIcon className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                ) : quickSaveFeedback ? (
                  <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <DocumentArrowUpIcon className="w-3.5 h-3.5 text-indigo-600" />
                )}
                <span className="hidden md:inline">{quickSaveFeedback || 'Save Session'}</span>
              </button>

              {/* Saved & Shared Tours Button */}
              <button
                onClick={() => setIsSessionsModalOpen(true)}
                title="Browse, share, and collaborate on saved tour projects"
                className="flex items-center gap-1.5 text-xs font-bold py-2 px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition active:scale-95 shadow-sm"
              >
                <UserGroupIcon className="w-3.5 h-3.5 text-indigo-600" />
                <span className="hidden md:inline">Saved & Shared Tours</span>
              </button>

              {/* User Avatar & Logout */}
              <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
                {currentUser.photoURL ? (
                  <img 
                    src={currentUser.photoURL} 
                    alt="User" 
                    referrerPolicy="no-referrer"
                    className="w-8 h-8 rounded-full border border-slate-200 shadow-sm object-cover" 
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-slate-800 text-white font-black text-xs flex items-center justify-center shadow-sm">
                    {currentUser.isAnonymous ? 'G' : (currentUser.email?.[0]?.toUpperCase() || 'U')}
                  </div>
                )}
                
                <div className="hidden lg:block text-left">
                  <div className="text-xs font-bold text-slate-900 leading-tight truncate max-w-[110px]">
                    {currentUser.isAnonymous ? 'Guest User' : (currentUser.displayName || currentUser.email?.split('@')[0])}
                  </div>
                  <div className="text-[10px] font-semibold text-slate-400 leading-tight">
                    {currentUser.isAnonymous ? 'Guest Session' : 'Google Account'}
                  </div>
                </div>

                <button
                  onClick={async () => {
                    await logoutUser();
                    setCurrentUser(null);
                  }}
                  title="Sign Out"
                  className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                >
                  <ArrowRightOnRectangleIcon className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsAuthModalOpen(true)}
                title="Sign in to view and collaborate on shared tours"
                className="flex items-center gap-1.5 text-xs font-bold py-2 px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition active:scale-95 shadow-sm"
              >
                <UserGroupIcon className="w-3.5 h-3.5 text-indigo-600" />
                <span className="hidden sm:inline">Shared Tours</span>
              </button>
              <button
                onClick={() => setIsAuthModalOpen(true)}
                className="flex items-center gap-2 text-xs font-bold py-2 px-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white shadow-sm transition active:scale-95"
              >
                <UserIcon className="w-3.5 h-3.5 text-indigo-400" />
                <span>Sign In / Guest</span>
              </button>
            </div>
          )}

          {/* API Key Status */}
          <button 
            onClick={handleKeySelection} 
            className={`hidden sm:flex items-center gap-2 text-xs font-bold py-2 px-3 rounded-xl border transition ${
              isApiReady 
                ? 'bg-green-50 border-green-200 text-green-700' 
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <div className={`w-2 h-2 rounded-full ${isApiReady ? 'bg-green-500 animate-pulse' : 'bg-slate-300'}`} />
            <span className="hidden lg:inline">{isApiReady ? 'Connected' : 'Connect Key'}</span>
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
                      <div className="flex items-center justify-between mb-2">
                        <label className="block text-sm font-semibold">Tour Script / Key Features</label>
                        <span className="text-[11px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                          Up to 30s per scene
                        </span>
                      </div>
                      <textarea 
                        rows={4} 
                        placeholder="Paste your script or key features here. Scene timings are expanded up to 30 seconds each to accommodate full feature explanations." 
                        className="w-full bg-white border border-slate-200 rounded-xl py-3 px-4 focus:ring-2 focus:ring-indigo-500 outline-none transition" 
                        value={input.script} 
                        onChange={e => setInput({...input, script: e.target.value})} 
                      />
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
                  <div className="bg-white border-2 border-dashed border-slate-200 rounded-3xl p-8 text-center hover:border-indigo-400 transition cursor-pointer group relative">
                    <input type="file" multiple className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleScreenshotUpload} accept="image/*" />
                    <CloudArrowUpIcon className="w-12 h-12 text-indigo-500 mx-auto mb-3" />
                    <h3 className="text-lg font-bold text-slate-900">Upload Screenshots</h3>
                    <p className="text-slate-500 text-sm max-w-sm mx-auto">Upload your app screenshots. TourGenie generates exactly one dedicated scene per screenshot (up to 30s each).</p>
                    <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-50 border border-indigo-100 text-[11px] font-bold text-indigo-700">
                      <SparklesIcon className="w-3.5 h-3.5 text-indigo-600" />
                      1 Scene per Screenshot • Up to 30s per Scene
                    </div>
                  </div>
                  {input.screenshots.length > 0 && (
                    <div className="mt-6 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                          {input.screenshots.length} {input.screenshots.length === 1 ? 'Screenshot' : 'Screenshots'} Uploaded
                        </span>
                        <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                          {input.screenshots.length} {input.screenshots.length === 1 ? 'Scene' : 'Scenes'} (up to 30s each)
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        {input.screenshots.map((src, i) => (
                          <div key={i} className="relative aspect-video rounded-xl overflow-hidden border border-slate-200 group bg-slate-100 shadow-sm">
                            <img src={src} className="w-full h-full object-cover" alt={`Screenshot ${i + 1}`} />
                            <div className="absolute bottom-1 left-1 bg-slate-900/80 backdrop-blur-sm text-[10px] font-bold text-white px-2 py-0.5 rounded">
                              Scene {i + 1}
                            </div>
                            <button 
                              onClick={() => setInput(prev => ({ ...prev, screenshots: prev.screenshots.filter((_, idx) => idx !== i)}))} 
                              className="absolute top-1 right-1 bg-white/90 hover:bg-white text-slate-700 rounded-full p-1 opacity-0 group-hover:opacity-100 transition shadow-sm"
                              title="Remove screenshot"
                            >
                              <PlusIcon className="w-3.5 h-3.5 rotate-45" />
                            </button>
                          </div>
                        ))}
                      </div>
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
                      onClick={async () => {
                        await sendScenesToEditor();
                        if (!currentUser) {
                          setIsAuthModalOpen(true);
                        } else {
                          setIsSessionsModalOpen(true);
                        }
                      }}
                      className="bg-white border border-indigo-200 hover:bg-indigo-50 text-indigo-700 font-bold py-3 px-4 rounded-xl text-sm transition flex items-center gap-1.5 shadow-sm active:scale-95"
                    >
                      <ShareIcon className="w-4 h-4 text-indigo-600" /> Share Tour
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
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] font-semibold text-slate-400">{scene.timestamp || '0:00'}</span>
                              {scene.duration && (
                                <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                                  {scene.duration}s
                                </span>
                              )}
                            </div>
                          </div>
                          <p className="text-slate-700 text-sm mb-4 leading-relaxed font-medium">"{scene.narration}"</p>
                        </div>
                      </div>
                      <div className="p-6 pt-0 space-y-3">
                        {/* Audio controls */}
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => playAudioPreview(scene.audioUrl, scene.narration, (gen) => {
                              setState(prev => ({
                                ...prev,
                                scenes: prev.scenes.map((s, i) => i === idx ? { ...s, audioUrl: gen } : s)
                              }));
                            })}
                            className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 transition"
                          >
                            <SpeakerWaveIcon className="w-3.5 h-3.5 text-indigo-600" /> Play Voiceover
                          </button>
                          <button
                            onClick={() => downloadAudio(scene.audioUrl, idx, scene.narration)}
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
                  Rendering Scene {state.scenes.filter(s => s.status === 'completed').length + 1} of {state.scenes.length || (input.screenshots.length > 0 ? input.screenshots.length : 5)}
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

              <div className="flex items-center gap-3">
                {editorState.clips.length > 0 && (
                  <button 
                    onClick={() => {
                      if (!currentUser) {
                        setIsAuthModalOpen(true);
                      } else {
                        setIsSessionsModalOpen(true);
                      }
                    }}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 transition font-bold text-sm shadow-sm active:scale-95"
                    title="Share this tour session with other users"
                  >
                    <ShareIcon className="w-4 h-4 text-indigo-600" />
                    <span>Share Tour</span>
                  </button>
                )}
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
                {/* Master Tour Broadcast Card (Visible when Master Video is Rendered) */}
                {editorState.isRendered && editorState.combinedVideoUrl && (
                  <div className="bg-slate-950 text-white rounded-3xl p-6 border border-indigo-500/30 shadow-2xl space-y-5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/10">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-indigo-600 to-emerald-500 flex items-center justify-center shadow-lg shadow-indigo-600/30">
                          <PlayIcon className="w-5 h-5 text-white fill-current" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-lg font-black tracking-tight text-white">
                              Master Broadcast Video
                            </h3>
                            <span className="bg-emerald-500/20 text-emerald-300 text-[10px] font-bold px-2.5 py-0.5 rounded-full border border-emerald-500/30 uppercase tracking-wide">
                              All {editorState.clips.length} Scenes Stitched
                            </span>
                          </div>
                          <p className="text-xs text-slate-400">
                            Navigate scenes using Rewind (⟲ 10s, ⟲ 5s), Forward (⟳ 5s, ⟳ 10s), or Scene Jump controls.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            setPreviewMode('master');
                            setIsPreviewOpen(true);
                          }}
                          className="bg-white/10 hover:bg-white/20 text-white px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 border border-white/10 active:scale-95"
                        >
                          <EyeIcon className="w-4 h-4 text-indigo-400" />
                          <span>Fullscreen Modal</span>
                        </button>
                      </div>
                    </div>

                    <MasterVideoPlayer
                      key={editorState.combinedVideoUrl}
                      src={editorState.combinedVideoUrl}
                      clips={editorState.clips}
                      title={editorState.youtubeMetadata?.title || 'TourGenie Master Tour'}
                      autoPlay={false}
                      showSceneBar={true}
                      onDownload={() => {
                        const link = document.createElement('a');
                        link.href = editorState.combinedVideoUrl!;
                        link.download = `${editorState.youtubeMetadata?.title || 'TourGenie_Master_Tour'}.mp4`;
                        link.click();
                      }}
                    />
                  </div>
                )}

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
                            {clip.previewUrl && (clip.previewUrl.startsWith('data:image') || clip.previewUrl.endsWith('.png') || clip.previewUrl.endsWith('.jpg') || clip.previewUrl.endsWith('.jpeg') || clip.previewUrl.endsWith('.webp')) ? (
                              <img src={clip.previewUrl} alt={clip.title || `Slide ${idx + 1}`} className="w-full h-full object-contain" />
                            ) : (
                              <video src={clip.previewUrl} className="w-full h-full object-contain" controls />
                            )}
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

                        {/* Save Session to Cloud Button */}
                        <button
                          onClick={handleQuickSaveSession}
                          disabled={isQuickSaving}
                          className="w-full bg-indigo-600/20 hover:bg-indigo-600/30 py-3.5 rounded-2xl font-bold text-xs tracking-wide transition flex items-center justify-center gap-2 border border-indigo-500/30 text-indigo-200 active:scale-95"
                        >
                          {isQuickSaving ? (
                            <ArrowPathIcon className="w-4 h-4 animate-spin text-indigo-400" />
                          ) : (
                            <DocumentArrowUpIcon className="w-4 h-4 text-indigo-400" />
                          )}
                          <span>
                            {isQuickSaving 
                              ? "Saving to Cloud..." 
                              : quickSaveFeedback 
                                ? quickSaveFeedback 
                                : currentUser 
                                  ? "Save Tour Session to Account" 
                                  : "Sign In / Guest to Save Session"}
                          </span>
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

                        {/* Hidden input to upload downloaded stitched master video */}
                        <input
                          ref={masterFileInputRef}
                          type="file"
                          accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.mkv"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleUploadedMasterFile(file);
                          }}
                          className="hidden"
                        />

                        <button
                          type="button"
                          onClick={() => masterFileInputRef.current?.click()}
                          className="w-full py-3 px-4 rounded-2xl bg-indigo-950/40 hover:bg-indigo-900/50 border border-indigo-500/40 hover:border-indigo-400 text-indigo-300 text-xs font-bold transition flex items-center justify-center gap-2 active:scale-95 shadow-sm"
                        >
                          <CloudArrowUpIcon className="w-4 h-4 text-indigo-400" />
                          <span>{uploadedMasterFile ? `Uploaded Stitched: ${uploadedMasterFile.name.slice(0, 22)}...` : 'Upload Downloaded Stitched Video'}</span>
                        </button>
                        
                        <button 
                          disabled={!isDurationValid && !uploadedMasterFile}
                          onClick={handleOpenYouTubePublish}
                          className={`w-full py-5 rounded-2xl font-black text-sm uppercase tracking-widest transition-all duration-300 flex items-center justify-center gap-3 shadow-2xl ${isDurationValid || uploadedMasterFile ? 'bg-red-600 hover:bg-red-500 text-white active:scale-95 shadow-red-900/40' : 'bg-slate-800 text-slate-600 cursor-not-allowed border border-white/5'}`}
                        >
                          <PlayIcon className="w-6 h-6 fill-current" />
                          Push to YouTube
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
                
                {previewMode === 'master' && editorState.isRendered && editorState.combinedVideoUrl ? (
                  <div className="w-full flex flex-col gap-4">
                    <MasterVideoPlayer
                      key={editorState.combinedVideoUrl}
                      src={editorState.combinedVideoUrl}
                      clips={editorState.clips}
                      title={editorState.youtubeMetadata?.title || 'TourGenie Master App Tour'}
                      autoPlay={true}
                      showSceneBar={true}
                      onDownload={() => {
                        const link = document.createElement('a');
                        link.href = editorState.combinedVideoUrl!;
                        link.download = `${editorState.youtubeMetadata?.title || 'TourGenie_Master_Tour'}.mp4`;
                        link.click();
                      }}
                    />
                  </div>
                ) : (
                  <div className="bg-black rounded-[3rem] overflow-hidden aspect-video border border-white/10 relative shadow-[0_40px_80px_rgba(0,0,0,0.8)] ring-1 ring-white/10 flex items-center justify-center">
                    <div ref={previewScrollRef} className="absolute inset-0 flex flex-col overflow-y-auto snap-y snap-mandatory scroll-smooth hide-scrollbar">
                      {editorState.clips.map((clip, idx) => (
                          <div key={clip.id} className="min-h-full w-full relative snap-start flex items-center justify-center bg-black group/scene">
                              {clip.previewUrl && (clip.previewUrl.startsWith('data:image') || clip.previewUrl.endsWith('.png') || clip.previewUrl.endsWith('.jpg') || clip.previewUrl.endsWith('.jpeg') || clip.previewUrl.endsWith('.webp')) ? (
                                <div className="w-full h-full flex flex-col items-center justify-center relative">
                                  <img src={clip.previewUrl} alt={clip.title || `Slide ${idx + 1}`} className="w-full h-full object-contain" />
                                  {(clip.audioUrl || clip.narration) && (
                                    <div className="absolute bottom-4 left-4 right-4 bg-slate-900/80 backdrop-blur-md px-4 py-2 rounded-xl border border-slate-700/60 flex items-center justify-between gap-3 z-20">
                                      <span className="text-xs text-slate-300 truncate font-medium">Slide {idx + 1} Voiceover</span>
                                      <button
                                        onClick={() => playAudioPreview(clip.audioUrl, clip.narration, (gen) => {
                                          setEditorState(prev => ({
                                            ...prev,
                                            clips: prev.clips.map((c, i) => i === idx ? { ...c, audioUrl: gen } : c)
                                          }));
                                        })}
                                        className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5"
                                      >
                                        <SpeakerWaveIcon className="w-3.5 h-3.5" /> Play Voiceover
                                      </button>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <video 
                                  src={clip.previewUrl || clip.videoUrl} 
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
                              )}
                              
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
                  </div>
                )}
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
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setIsPreviewOpen(false);
                            setIsYouTubeModalOpen(true);
                          }}
                          className="bg-red-600 hover:bg-red-500 text-white font-bold text-xs px-4 py-2 rounded-xl flex items-center gap-2 transition active:scale-95 shadow-lg shadow-red-600/20"
                        >
                          <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                            <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                          </svg>
                          Push to YouTube
                        </button>

                        <a
                          href={editorState.combinedVideoUrl}
                          download={`${editorState.youtubeMetadata?.title || 'TourGenie_Master_Tour'}.mp4`}
                          className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-4 py-2 rounded-xl flex items-center gap-2 transition active:scale-95 shadow-lg"
                        >
                          <ArrowDownTrayIcon className="w-4 h-4" /> Download Master File (All {editorState.clips.length} Scenes)
                        </a>
                      </>
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

      {/* AUTHENTICATION MODAL */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onSuccess={(user) => {
          setCurrentUser(user);
          setQuickSaveFeedback(`Signed in as ${user.displayName || (user.isAnonymous ? 'Guest' : user.email)}`);
          setTimeout(() => setQuickSaveFeedback(null), 3500);
        }}
      />

      {/* SAVE SESSION TO PROJECT DIALOG */}
      <SaveSessionDialog
        isOpen={isSaveDialogOpen}
        onClose={() => setIsSaveDialogOpen(false)}
        onSave={handleSaveSessionWithProject}
        defaultSessionName={currentSessionName || input.name || editorState.youtubeMetadata?.title || 'TourGenie App Tour'}
        defaultProjectName={currentProjectName || 'General'}
        existingProjects={knownProjects}
        slideCount={editorState.clips.length || state.scenes.length || input.screenshots.length || 0}
        totalDuration={totalDuration}
      />

      {/* SAVED SESSIONS MODAL */}
      <SavedSessionsModal
        isOpen={isSessionsModalOpen}
        onClose={() => setIsSessionsModalOpen(false)}
        userId={currentUser?.uid || ''}
        onLoadSession={handleLoadSession}
        currentProject={getCompiledProject()}
        onSessionSaved={(sessionId) => {
          setActiveSessionId(sessionId);
          setQuickSaveFeedback('Project saved to cloud!');
          setTimeout(() => setQuickSaveFeedback(null), 3500);
        }}
      />

      {/* YOUTUBE PUBLISHING MODAL (REAL GOOGLE OAUTH & YOUTUBE DATA API V3) */}
      <YouTubePublishModal
        isOpen={isYouTubeModalOpen}
        onClose={() => setIsYouTubeModalOpen(false)}
        combinedVideoUrl={editorState.combinedVideoUrl || ''}
        defaultTitle={editorState.youtubeMetadata?.title || input.name || 'TourGenie 90s App Tour'}
        defaultDescription={editorState.youtubeMetadata?.description || ''}
        defaultTags={editorState.youtubeMetadata?.tags || ['apptour', 'saas', 'software', 'tutorial']}
        totalClipsCount={editorState.clips.length}
        totalDurationSeconds={totalDuration}
        onRenderMasterProject={() => handleRenderProject({ autoOpenPreview: false })}
        initialUploadedFile={uploadedMasterFile}
        onUploadedMasterVideo={(file, url) => {
          setUploadedMasterFile(file);
          setEditorState(prev => ({ ...prev, combinedVideoUrl: url, isRendered: true }));
        }}
      />

      <footer className="fixed bottom-6 left-6 z-[60] flex gap-3">
        <div className="glass px-4 py-2 rounded-2xl border border-slate-200/50 flex items-center gap-3 shadow-2xl text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-indigo-600 transition-colors cursor-default">
          <div className={`w-2 h-2 rounded-full ${isApiReady ? 'bg-green-500' : 'bg-amber-500'} shadow-lg shadow-current/50`} />
          {isApiReady ? 'AI Engine Linked' : 'System Offline'}
        </div>
      </footer>
    </div>
  );
}
