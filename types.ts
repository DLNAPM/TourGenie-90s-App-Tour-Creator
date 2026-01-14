
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
  visualPrompt: string;
  narration: string;
  videoUrl?: string;
  audioUrl?: string;
  status: 'pending' | 'generating' | 'completed' | 'failed';
  screenshotIndex?: number;
}

export interface GenerationState {
  step: 'input' | 'processing' | 'generating' | 'final';
  scenes: Scene[];
  progress: number;
}

export interface EditorClip {
  id: string;
  file: File;
  previewUrl: string;
  duration: number;
  narration?: string;
  audioUrl?: string;
  analysis?: string;
  status: 'idle' | 'analyzing' | 'generating-audio' | 'ready';
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
