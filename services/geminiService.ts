import { AppInput, Scene, EditorClip } from "../types";
import { renderScreenshotToVideo } from "./screenStudioEngine";

function getClientApiKey(): string {
  if (typeof window !== "undefined") {
    const pEnv = (window as any).process?.env;
    const key = pEnv?.API_KEY || pEnv?.GEMINI_API_KEY;
    if (key && key !== "UNUSED_PLACEHOLDER_FOR_API_KEY" && key !== "RENDER_API_KEY_PLACEHOLDER") {
      return key;
    }
  }
  return "";
}

function getApiHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const key = getClientApiKey();
  if (key) {
    headers["x-gemini-api-key"] = key;
  }
  return headers;
}

function createSceneFallbackCanvas(title: string, subtitle?: string): string {
  if (typeof document === 'undefined') return '';
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    const grad = ctx.createLinearGradient(0, 0, 1280, 720);
    grad.addColorStop(0, '#0f172a');
    grad.addColorStop(0.5, '#1e1b4b');
    grad.addColorStop(1, '#312e81');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1280, 720);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    for (let x = 0; x < 1280; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 720);
      ctx.stroke();
    }
    for (let y = 0; y < 720; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(1280, y);
      ctx.stroke();
    }

    ctx.fillStyle = '#6366f1';
    ctx.beginPath();
    ctx.roundRect(140, 180, 260, 36, 18);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.fillText('AMERICAN ENGLISH • FEATURE TOUR', 156, 203);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 42px Inter, sans-serif';
    ctx.fillText(title.slice(0, 40), 140, 275);

    if (subtitle) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '20px Inter, sans-serif';
      ctx.fillText(subtitle.slice(0, 70), 140, 325);
    }

    return canvas.toDataURL('image/png');
  } catch {
    return '';
  }
}

export class TourService {
  async checkBackendKey(): Promise<boolean> {
    try {
      const res = await fetch("/api/key-status", {
        headers: getApiHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        return Boolean(data.hasKey);
      }
    } catch {
      // Ignore if running without backend
    }
    return Boolean(getClientApiKey());
  }

  async createStoryboards(input: AppInput): Promise<Scene[]> {
    const res = await fetch("/api/generate-storyboard", {
      method: "POST",
      headers: getApiHeaders(),
      body: JSON.stringify({
        name: input.name,
        url: input.url,
        description: input.description,
        script: input.script,
        screenshotCount: input.screenshots.length
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 401) {
        throw new Error(err.error || "Gemini API key is required. Please check your credentials.");
      }
      throw new Error(err.error || `Storyboard request failed with status ${res.status}`);
    }

    const data = await res.json();
    if (data.scenes && Array.isArray(data.scenes)) {
      return data.scenes;
    }

    throw new Error("Invalid storyboard response received from server");
  }

  async generateSceneVideo(
    scene: Scene,
    screenshot?: string,
    options?: {
      engineMode?: 'studio' | 'veo';
      audioBase64?: string;
      motionStyle?: 'push-in' | 'pan-horizontal' | 'pan-vertical' | 'spotlight' | 'pull-out' | 'auto';
      sceneIndex?: number;
      duration?: number;
      narrationStartOffset?: number;
    }
  ): Promise<string> {
    const effectiveDuration = Math.max(30, options?.duration || scene.duration || 30);
    const effectiveStartOffset = Math.max(0, options?.narrationStartOffset ?? scene.narrationStartOffset ?? 0);
    const engineMode = options?.engineMode || (screenshot ? 'studio' : 'veo');
    const effectiveScreenshot = screenshot || createSceneFallbackCanvas(scene.visualPrompt || scene.timestamp || 'Product Tour', scene.narration);

    // 1. Pixel-Perfect Screen Studio Engine (Default mode, or when requested)
    // Preserves 100% of the original English UI screenshot with zero diffusion hallucinations or foreign glyphs
    if (engineMode === 'studio' || (!options?.engineMode && screenshot)) {
      try {
        const videoUrl = await renderScreenshotToVideo(effectiveScreenshot, {
          duration: effectiveDuration,
          sceneIndex: options?.sceneIndex ?? (scene.screenshotIndex ?? 0),
          sceneTitle: scene.timestamp ? `SCENE • ${scene.timestamp}` : undefined,
          narration: scene.narration,
          audioBase64: options?.audioBase64,
          motionStyle: options?.motionStyle || 'auto',
          narrationStartOffset: effectiveStartOffset
        });
        if (videoUrl) {
          return videoUrl;
        }
      } catch (studioErr) {
        console.warn("Screen Studio rendering encountered an error, falling back to Veo:", studioErr);
      }
    }

    // 2. Server-Side Veo Video Generation and Streaming (uses server-side GEMINI_API_KEY)
    let initRes: Response;
    try {
      initRes = await fetch("/api/generate-video", {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({
          visualPrompt: scene.visualPrompt,
          screenshot
        })
      });
    } catch (netErr: any) {
      if (effectiveScreenshot) {
        console.warn("Veo endpoint unreachable, rendering with Screen Studio engine:", netErr);
        return renderScreenshotToVideo(effectiveScreenshot, {
          duration: effectiveDuration,
          sceneIndex: options?.sceneIndex ?? (scene.screenshotIndex ?? 0),
          sceneTitle: scene.timestamp ? `SCENE • ${scene.timestamp}` : undefined,
          narration: scene.narration,
          audioBase64: options?.audioBase64,
          motionStyle: options?.motionStyle || 'auto'
        });
      }
      throw new Error(`Unable to reach video generation service: ${netErr.message}`);
    }

    if (!initRes.ok) {
      const err = await initRes.json().catch(() => ({}));
      if (effectiveScreenshot) {
        console.warn("Veo video generation failed, falling back to Screen Studio engine:", err.error);
        return renderScreenshotToVideo(effectiveScreenshot, {
          duration: effectiveDuration,
          sceneIndex: options?.sceneIndex ?? (scene.screenshotIndex ?? 0),
          sceneTitle: scene.timestamp ? `SCENE • ${scene.timestamp}` : undefined,
          narration: scene.narration,
          audioBase64: options?.audioBase64,
          motionStyle: options?.motionStyle || 'auto'
        });
      }
      throw new Error(err.error || `Video generation failed with status ${initRes.status}.`);
    }

    const { operationName } = await initRes.json();
    if (!operationName) {
      if (effectiveScreenshot) {
        return renderScreenshotToVideo(effectiveScreenshot, {
          duration: effectiveDuration,
          sceneIndex: options?.sceneIndex ?? (scene.screenshotIndex ?? 0),
          sceneTitle: scene.timestamp ? `SCENE • ${scene.timestamp}` : undefined,
          narration: scene.narration,
          audioBase64: options?.audioBase64,
          motionStyle: options?.motionStyle || 'auto'
        });
      }
      throw new Error("No operation name returned from video generation engine.");
    }

    // Poll video operation until complete
    let isDone = false;
    let attempts = 0;
    const maxAttempts = 60; // Up to ~5 minutes

    while (!isDone && attempts < maxAttempts) {
      await new Promise((r) => setTimeout(r, 6000));
      attempts++;

      const statusRes = await fetch("/api/video-status", {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({ operationName })
      });

      if (statusRes.ok) {
        const statusData = await statusRes.json();
        if (statusData.error) {
          if (effectiveScreenshot) {
            console.warn("Veo polling reported error, falling back to Screen Studio:", statusData.error);
            return renderScreenshotToVideo(effectiveScreenshot, {
              duration: effectiveDuration,
              sceneIndex: options?.sceneIndex ?? (scene.screenshotIndex ?? 0),
              sceneTitle: scene.timestamp ? `SCENE • ${scene.timestamp}` : undefined,
              narration: scene.narration,
              audioBase64: options?.audioBase64,
              motionStyle: options?.motionStyle || 'auto'
            });
          }
          throw new Error(`Video generation failed: ${statusData.error.message || JSON.stringify(statusData.error)}`);
        }
        if (statusData.done) {
          isDone = true;
          break;
        }
      }
    }

    if (!isDone) {
      if (effectiveScreenshot) {
        console.warn("Veo generation timed out, falling back to Screen Studio:");
        return renderScreenshotToVideo(effectiveScreenshot, {
          duration: effectiveDuration,
          sceneIndex: options?.sceneIndex ?? (scene.screenshotIndex ?? 0),
          sceneTitle: scene.timestamp ? `SCENE • ${scene.timestamp}` : undefined,
          narration: scene.narration,
          audioBase64: options?.audioBase64,
          motionStyle: options?.motionStyle || 'auto'
        });
      }
      throw new Error("Video generation timed out. Please try again with a simpler prompt.");
    }

    // Download the final MP4 video via server proxy
    // The server fetches the file, extends duration to >=30s to fit the tour script, and muxes narration audio
    const downloadRes = await fetch("/api/video-download", {
      method: "POST",
      headers: getApiHeaders(),
      body: JSON.stringify({ 
        operationName,
        targetDuration: effectiveDuration,
        audioBase64: options?.audioBase64,
        narration: scene.narration,
        narrationStartOffset: effectiveStartOffset
      })
    });

    if (!downloadRes.ok) {
      const errData = await downloadRes.json().catch(() => ({}));
      if (effectiveScreenshot) {
        console.warn("Veo download failed, falling back to Screen Studio:", errData.error);
        return renderScreenshotToVideo(effectiveScreenshot, {
          duration: options?.duration || scene.duration,
          sceneIndex: options?.sceneIndex ?? (scene.screenshotIndex ?? 0),
          sceneTitle: scene.timestamp ? `SCENE • ${scene.timestamp}` : undefined,
          narration: scene.narration,
          audioBase64: options?.audioBase64,
          motionStyle: options?.motionStyle || 'auto'
        });
      }
      throw new Error(errData.error || `Failed to download video file (status ${downloadRes.status})`);
    }

    const videoBlob = await downloadRes.blob();
    if (!videoBlob || videoBlob.size === 0 || videoBlob.type === "application/json") {
      if (effectiveScreenshot) {
        return renderScreenshotToVideo(effectiveScreenshot, {
          duration: options?.duration || scene.duration,
          sceneIndex: options?.sceneIndex ?? (scene.screenshotIndex ?? 0),
          sceneTitle: scene.timestamp ? `SCENE • ${scene.timestamp}` : undefined,
          narration: scene.narration,
          audioBase64: options?.audioBase64,
          motionStyle: options?.motionStyle || 'auto'
        });
      }
      throw new Error("Invalid or empty video file received from generator.");
    }

    return URL.createObjectURL(videoBlob);
  }

  async generateNarration(text: string): Promise<string> {
    const res = await fetch("/api/generate-narration", {
      method: "POST",
      headers: getApiHeaders(),
      body: JSON.stringify({ text })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Narration generation failed with status ${res.status}`);
    }

    const data = await res.json();
    if (!data.base64Audio) {
      throw new Error("No narration audio returned from server");
    }
    return data.base64Audio;
  }

  async analyzeVideoClip(file: File): Promise<{ analysis: string; narration: string }> {
    if (file.size > 15 * 1024 * 1024) {
      throw new Error("Video file too large for direct AI analysis. Please use clips under 15MB.");
    }

    const base64 = await this.fileToBase64(file);
    const res = await fetch("/api/analyze-video", {
      method: "POST",
      headers: getApiHeaders(),
      body: JSON.stringify({ videoBase64: base64, mimeType: file.type })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Video analysis failed with status ${res.status}`);
    }

    const data = await res.json();
    return {
      analysis: data.analysis || "Application interface walkthrough clip.",
      narration: data.narration || "In this walkthrough scene, we examine key product workflows and user interactions."
    };
  }

  async generateYouTubeMetadata(clips: EditorClip[]): Promise<{ title: string; description: string; tags: string[] }> {
    const summary = clips.map(c => c.analysis).filter(Boolean).join(". ");
    const res = await fetch("/api/youtube-metadata", {
      method: "POST",
      headers: getApiHeaders(),
      body: JSON.stringify({ summary })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `YouTube metadata request failed with status ${res.status}`);
    }

    const data = await res.json();
    return {
      title: data.title || "Full Application Feature Tour",
      description: data.description || "A complete 90-second product tour showcasing the key capabilities and workflows.",
      tags: Array.isArray(data.tags) ? data.tags : ["app tour", "software demo", "product walkthrough"]
    };
  }

  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = error => reject(error);
    });
  }
}
