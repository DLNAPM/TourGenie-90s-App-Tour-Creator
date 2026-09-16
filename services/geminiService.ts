import { GoogleGenAI, Type, Modality } from "@google/genai";
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
    // 1. Server-Side API (reads API_KEY from Render environment)
    try {
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

      if (res.ok) {
        const data = await res.json();
        if (data.scenes && Array.isArray(data.scenes)) {
          return data.scenes;
        }
      } else {
        const err = await res.json().catch(() => ({}));
        if (res.status === 401) {
          throw new Error(err.error || "Gemini API key is required. Please set 'API_KEY' in Render.com's environment variables.");
        }
        throw new Error(err.error || `Storyboard request failed: ${res.status}`);
      }
    } catch (e: any) {
      if (e.message?.includes("API key") || e.message?.includes("required") || e.message?.includes("failed")) {
        throw e;
      }
      console.warn("Backend /api/generate-storyboard unavailable, attempting client fallback...", e);
    }

    // 2. Client-side SDK Fallback (if client key is explicitly present)
    const apiKey = getClientApiKey();
    if (!apiKey) {
      throw new Error("Gemini API key is missing. Please configure 'API_KEY' in Render.com environment variables.");
    }

    const ai = new GoogleGenAI({ apiKey });
    const hasScreenshots = input.screenshots && input.screenshots.length > 0;
    const targetSceneCount = hasScreenshots ? input.screenshots.length : 5;

    const prompt = `
      Act as a professional software video tour director.
      Create an exact ${targetSceneCount}-scene storyboard for the app tour video.
      ${hasScreenshots ? `CRITICAL REQUIREMENT: Exactly ${targetSceneCount} scenes MUST be created. There are ${targetSceneCount} uploaded screenshots. You MUST create exactly ONE scene for each uploaded screenshot in sequence (Scene 1 matches Screenshot 1, Scene 2 matches Screenshot 2, etc.). Return an array with exactly ${targetSceneCount} items.` : `Create a ${targetSceneCount}-scene storyboard.`}

      App Name: ${input.name}
      App URL: ${input.url}
      Description: ${input.description}
      Tour Script / Key Features Provided: ${input.script}
      Screenshots Provided: ${hasScreenshots ? `${input.screenshots.length} real application screenshots provided in 100% U.S. English` : "None"}

      CRITICAL TIMING & LENGTH REQUIREMENT:
      - Timing of EACH scene must be up to 30-seconds (typically 15 to 30 seconds per scene, maximum 30 seconds) to thoroughly accommodate the length and depth of the Tour Script / Key Features provided by the user.
      - For each scene, write an in-depth, engaging voiceover narration in fluent American English that thoroughly explains the key features and workflow shown in that screen. The narration should be substantial enough to speak naturally over up to 30 seconds (~40 to 75 spoken words per scene).
      - In the "timestamp" field, provide sequential time ranges reflecting this timing (e.g. "0:00 - 0:25", "0:25 - 0:52", etc.), where each scene duration is between 15 and 30 seconds (maximum 30 seconds).
      - In the "duration" field, provide the estimated duration in seconds (an integer between 15 and 30, maximum 30).

      CRITICAL REQUIREMENT - 100% U.S. ENGLISH ONLY:
      - Everything generated MUST be strictly in 100% fluent American English.
      - ${hasScreenshots 
          ? `IMPORTANT: The user has provided real application screenshots in 100% U.S. English. In each "visualPrompt", describe ONLY 2D camera motions across that specific interface screencast (for example: "Smooth slow push-in zoom into the main dashboard metrics", "Gentle horizontal pan across the navigation items from left to right", "Smooth vertical glide down the detail view", "Slow steady zoom-out revealing the full interface layout"). DO NOT mention physical rooms, offices, gyms, smartphones, 3D devices, floating phones, or hand-held mockups. The video is a clean, direct 2D screen tour of the user's software.`
          : `In each "visualPrompt", specify clean modern 2D software interface presentations with sleek motion graphics and crisp American English typography (e.g. 'DASHBOARD', 'ANALYTICS', 'SETTINGS').`
        }
      - In each "narration", write natural, engaging voiceover script in 100% fluent American English that thoroughly covers the features shown.

      For each scene, provide:
      1. "timestamp": Sequential time range (e.g. "0:00 - 0:25", max 30s per scene)
      2. "duration": Duration in seconds (integer between 15 and 30, max 30)
      3. "visualPrompt": Describing 2D screencast camera movement across the interface in crisp focus.
      4. "narration": Voiceover script in fluent U.S. English (~40-75 words, sized for up to 30 seconds of speech).

      Return as a JSON array of exactly ${targetSceneCount} objects.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              timestamp: { type: Type.STRING },
              duration: { type: Type.INTEGER },
              visualPrompt: { type: Type.STRING },
              narration: { type: Type.STRING }
            },
            required: ["timestamp", "visualPrompt", "narration"],
            propertyOrdering: ["timestamp", "duration", "visualPrompt", "narration"]
          }
        }
      }
    });

    const parsed = JSON.parse(response.text || "[]");
    const baseScenes = Array.isArray(parsed) ? parsed : [];
    const scenes: Scene[] = [];
    let currentOffsetSec = 0;

    for (let i = 0; i < targetSceneCount; i++) {
      const item = baseScenes[i] || {};
      let sceneDuration = typeof item.duration === 'number' && item.duration > 0
        ? Math.min(30, Math.max(10, Math.round(item.duration)))
        : 25; // default 25s (up to 30s)

      const startSec = currentOffsetSec;
      const endSec = startSec + sceneDuration;
      currentOffsetSec = endSec;

      const startMinStr = `${Math.floor(startSec / 60)}:${(startSec % 60).toString().padStart(2, '0')}`;
      const endMinStr = `${Math.floor(endSec / 60)}:${(endSec % 60).toString().padStart(2, '0')}`;
      const timestamp = item.timestamp || `${startMinStr} - ${endMinStr}`;

      scenes.push({
        id: `scene-${i}`,
        timestamp,
        duration: sceneDuration,
        visualPrompt: item.visualPrompt || `Smooth 2D camera glide across interface screen ${i + 1}.`,
        narration: item.narration || `Here in scene ${i + 1}, we explore key application features and workflows.`,
        status: 'pending',
        screenshotIndex: hasScreenshots ? i : undefined
      });
    }

    return scenes;
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
    }
  ): Promise<string> {
    const engineMode = options?.engineMode || (screenshot ? 'studio' : 'veo');

    // 1. Pixel-Perfect Screen Studio Engine (Default for uploaded screenshots)
    // Preserves 100% of the original English UI screenshot with zero diffusion hallucinations or foreign glyphs
    if (screenshot && engineMode === 'studio') {
      try {
        const videoUrl = await renderScreenshotToVideo(screenshot, {
          duration: options?.duration || scene.duration,
          sceneIndex: options?.sceneIndex ?? (scene.screenshotIndex ?? 0),
          sceneTitle: scene.timestamp ? `SCENE • ${scene.timestamp}` : undefined,
          narration: scene.narration,
          audioBase64: options?.audioBase64,
          motionStyle: options?.motionStyle || 'auto'
        });
        if (videoUrl) {
          return videoUrl;
        }
      } catch (studioErr) {
        console.warn("Screen Studio rendering encountered an error, falling back to Veo:", studioErr);
      }
    }

    // 2. Server-Side Veo Video Generation and Streaming (uses Render.com API_KEY)
    let initRes: Response | null = null;
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
      console.warn("Could not reach /api/generate-video backend:", netErr);
    }

    if (initRes) {
      if (initRes.ok) {
        const { operationName } = await initRes.json();
        if (!operationName) {
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
              throw new Error(`Video generation failed: ${statusData.error.message || JSON.stringify(statusData.error)}`);
            }
            if (statusData.done) {
              isDone = true;
              break;
            }
          }
        }

        if (!isDone) {
          throw new Error("Video generation timed out. Please try again with a simpler prompt.");
        }

        // Download the final MP4 video via server proxy
        // The server fetches the file using headers and streams raw bytes to the browser.
        // The API key is NEVER passed in the URL.
        const downloadRes = await fetch("/api/video-download", {
          method: "POST",
          headers: getApiHeaders(),
          body: JSON.stringify({ operationName })
        });

        if (!downloadRes.ok) {
          const errData = await downloadRes.json().catch(() => ({}));
          throw new Error(errData.error || `Failed to download video file (status ${downloadRes.status})`);
        }

        const videoBlob = await downloadRes.blob();
        if (!videoBlob || videoBlob.size === 0 || videoBlob.type === "application/json") {
          throw new Error("Invalid or empty video file received from generator.");
        }

        return URL.createObjectURL(videoBlob);
      } else {
        const err = await initRes.json().catch(() => ({}));
        throw new Error(err.error || `Video generation failed with status ${initRes.status}. Ensure 'API_KEY' is set in Render.com.`);
      }
    }

    // 2. Client-side SDK Fallback (Only if direct client key is explicitly configured)
    const clientKey = getClientApiKey();
    if (!clientKey) {
      throw new Error("Gemini API Key is missing. Please configure the 'API_KEY' environment variable in your Render.com dashboard.");
    }

    const ai = new GoogleGenAI({ apiKey: clientKey });
    const config: any = {
      numberOfVideos: 1,
      resolution: '720p',
      aspectRatio: '16:9'
    };
    let finalPrompt: string;
    if (screenshot) {
      // Strip out any accidental mentions of simulated 3D phones, mockups, rooms, or device frames
      let cleanMotion = scene.visualPrompt ? scene.visualPrompt.trim() : "Smooth slow push-in zoom into the interface.";
      cleanMotion = cleanMotion
        .replace(/(?:sleek\s+)?smartphones?|(?:3d\s+)?mockups?|devices?|floating\s+(?:phone|device)|in[- ]hand/gi, "interface")
        .replace(/(?:ambient|studio|gym|office)\s+(?:aesthetic\s+)?background/gi, "display")
        .replace(/foreign\s+artifacts|pseudo-symbols|non-english/gi, "")
        .trim();

      finalPrompt = [
        `Commercial 2D screencast animation of the application interface.`,
        `CAMERA MOTION: ${cleanMotion}`,
        `DIRECTIVES: Flat 2D screencast video, steady smooth camera glide across the screen, razor-sharp focus on the original English text and UI elements, zero 3D perspective distortion.`
      ].join(" ");
    } else {
      finalPrompt = [
        scene.visualPrompt ? scene.visualPrompt.trim() : "Cinematic digital interface showcase in motion.",
        `Clean modern minimalist interface presentation with crisp typography in standard American English, smooth UI motion graphics, professional product demo.`
      ].join(" ");
    }

    let payloadImage: any = undefined;
    if (screenshot) {
      const mimeMatch = screenshot.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
      const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
      payloadImage = {
        imageBytes: screenshot.includes(',') ? screenshot.split(',')[1] : screenshot,
        mimeType: mimeType
      };
    }

    let operation: any;
    try {
      operation = await ai.models.generateVideos({
        model: 'veo-3.1-generate-preview',
        prompt: finalPrompt,
        config,
        ...(payloadImage ? { image: payloadImage } : {})
      });
    } catch (tierErr: any) {
      console.warn("veo-3.1-generate-preview fallback to lite in client SDK:", tierErr?.message);
      operation = await ai.models.generateVideos({
        model: 'veo-3.1-lite-generate-preview',
        prompt: finalPrompt,
        config,
        ...(payloadImage ? { image: payloadImage } : {})
      });
    }
    while (!operation.done) {
      await new Promise(resolve => setTimeout(resolve, 8000));
      operation = await ai.operations.getVideosOperation({ operation: operation });
    }

    const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (!downloadLink) throw new Error("Video generation failed - no video URI returned by Veo.");

    // Fetch video using header only - NEVER pass the API key in the URL
    const response = await fetch(downloadLink, {
      headers: { "x-goog-api-key": clientKey }
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Video download failed (HTTP ${response.status}): ${errText}`);
    }

    const blob = await response.blob();
    if (blob.size === 0 || blob.type === "application/json") {
      throw new Error("Received empty or corrupt video content.");
    }
    return URL.createObjectURL(blob);
  }

  async generateNarration(text: string): Promise<string> {
    // 1. Server-Side API
    try {
      const res = await fetch("/api/generate-narration", {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({ text })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.base64Audio) {
          return data.base64Audio;
        }
      }
    } catch {
      // Fall through
    }

    // 2. Client-side SDK Fallback
    const apiKey = getClientApiKey();
    if (!apiKey) {
      throw new Error("Gemini API Key missing. Please set 'API_KEY' in Render.com.");
    }
    const ai = new GoogleGenAI({ apiKey });
    
    let response;
    try {
      response = await ai.models.generateContent({
        model: "gemini-3.1-flash-tts-preview",
        contents: [{ parts: [{ text: `Say clearly and professionally in fluent American English: ${text}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });
    } catch {
      response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `Say clearly and professionally in fluent American English: ${text}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });
    }

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) throw new Error("TTS narration audio generation failed");
    return base64Audio;
  }

  async analyzeVideoClip(file: File): Promise<{ analysis: string; narration: string }> {
    if (file.size > 15 * 1024 * 1024) {
      throw new Error("Video file too large for direct AI analysis. Please use clips under 15MB.");
    }

    const base64 = await this.fileToBase64(file);

    // 1. Server-Side API
    try {
      const res = await fetch("/api/analyze-video", {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({ videoBase64: base64, mimeType: file.type })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.analysis && data.narration) {
          return data;
        }
      }
    } catch {
      // Fall through
    }

    // 2. Client-side SDK Fallback
    const apiKey = getClientApiKey();
    if (!apiKey) {
      throw new Error("Gemini API Key missing. Please set 'API_KEY' in Render.com.");
    }
    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: {
        parts: [
          {
            inlineData: {
              data: base64,
              mimeType: file.type
            }
          },
          {
            text: "Analyze this video clip. Provide a brief 1-sentence description in 100% fluent English and write a professional 10-second narration script in 100% fluent English. Ensure all output is strictly in English. Return as JSON."
          }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            analysis: { type: Type.STRING },
            narration: { type: Type.STRING }
          },
          required: ["analysis", "narration"]
        }
      }
    });

    return JSON.parse(response.text || "{}");
  }

  async generateYouTubeMetadata(clips: EditorClip[]): Promise<{ title: string; description: string; tags: string[] }> {
    const summary = clips.map(c => c.analysis).join(". ");

    // 1. Server-Side API
    try {
      const res = await fetch("/api/youtube-metadata", {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({ summary })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.title && data.description) {
          return data;
        }
      }
    } catch {
      // Fall through
    }

    // 2. Client-side SDK Fallback
    const apiKey = getClientApiKey();
    if (!apiKey) {
      throw new Error("Gemini API Key missing. Please set 'API_KEY' in Render.com.");
    }
    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: `Generate YouTube metadata strictly in 100% English for a video based on these scene analyses: ${summary}. Include a catchy title in English, a full description in English with timestamps, and 10 relevant English tags. All outputs must be 100% English.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            tags: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["title", "description", "tags"]
        }
      }
    });

    return JSON.parse(response.text || "{}");
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
