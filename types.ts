
export interface AppInput {
  name: string;
  url: string;
  description: string;
  script: string;
  screenshots: string[]; // base64
}

export interface Scene {
  id: string;
  timestamp: string;
  duration?: number;
  visualPrompt: string;
  narration: string;
  videoUrl?: string;
  audioUrl?: string;
  status: 'pending' | 'generating' | 'completed' | 'failed';
  screenshotIndex?: number;
  useVoiceover?: boolean;
  narrationStartOffset?: number;
}

export interface GenerationState {
  step: 'input' | 'processing' | 'generating' | 'final';
  scenes: Scene[];
  progress: number;
}

export interface EditorClip {
  id: string;
  file?: File;
  previewUrl: string;
  duration: number;
  narration?: string;
  audioUrl?: string;
  analysis?: string;
  status: 'idle' | 'analyzing' | 'generating-audio' | 'ready';
  title?: string;
  order?: number;
  cameraMotion?: string;
  resolution?: string;
  screenshotUrl?: string;
  rawScreenshot?: string;
  videoUrl?: string;
  useVoiceover?: boolean;
  narrationStartOffset?: number;
}

export interface SavedProjectSession {
  id: string;
  userId: string;
  ownerEmail?: string;
  ownerName?: string;
  title: string;
  appDescription?: string;
  appUrl?: string;
  script?: string;
  clipsCount: number;
  totalDuration: number;
  isRendered: boolean;
  combinedVideoUrl?: string;
  clips: any[];
  scenes?: Scene[];
  screenshots?: string[];
  youtubeMetadata?: any;
  sharedWithEmails?: string[];
  sharedWithUids?: string[];
  isPublic?: boolean;
  createdAt?: any;
  updatedAt?: any;
}

export interface EditorState {
  clips: EditorClip[];
  isProcessing: boolean;
  includeVoiceover: boolean;
  isRendering: boolean;
  isRendered: boolean;
  combinedVideoUrl?: string;
  youtubeMetadata?: {
    title: string;
    description: string;
    tags: string[];
  };
}
