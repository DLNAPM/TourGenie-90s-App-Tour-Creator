import { GoogleGenAI, Type, Modality } from "@google/genai";
import { AppInput, Scene, EditorClip } from "../types";

function getClientApiKey(): string {
  if (typeof window !== "undefined") {
    const pEnv = (window as any).process?.env;
    const key = pEnv?.API_KEY || pEnv?.GEMINI_API_KEY;
    if (key && key !== "UNUSED_PLACEHOLDER_FOR_API_KEY" && key !== "RENDER_API_KEY_PLACEHOLDER") {
      return key;
    }
  }
  const directKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
  if (directKey && directKey !== "UNUSED_PLACEHOLDER_FOR_API_KEY" && directKey !== "RENDER_API_KEY_PLACEHOLDER") {
    return directKey;
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
    // 1. Try Server-Side API first
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
          throw new Error(err.error || "Gemini API key is required. Please connect your key.");
        }
        if (res.status >= 400 && res.status < 500) {
          throw new Error(err.error || `Storyboard request failed: ${res.status}`);
        }
      }
    } catch (e: any) {
      // If error was an explicit key error, rethrow
      if (e.message?.includes("API key") || e.message?.includes("key is required")) {
        throw e;
      }
      console.warn("Backend /api/generate-storyboard unavailable, trying direct SDK fallback...", e);
    }

    // 2. Client-side SDK Fallback
    const apiKey = getClientApiKey();
    const ai = new GoogleGenAI({ apiKey: apiKey || undefined });
    const prompt = `
      Act as a world-class video director. Create a 5-scene storyboard for a 90-second app tour video.
      App Name: ${input.name}
      App URL: ${input.url}
      Description: ${input.description}
      Tour Script Provided: ${input.script}

      For each scene, provide:
      1. A timestamp (e.g. 0:00 - 0:15)
      2. A "visualPrompt" describing exactly what should happen in a 5-10 second video clip. Focus on professional UI animation, cinematic camera moves, and sleek transitions.
      3. A "narration" text that will be converted to speech.

      Return as a JSON array.
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
              visualPrompt: { type: Type.STRING },
              narration: { type: Type.STRING }
            },
            required: ["timestamp", "visualPrompt", "narration"],
            propertyOrdering: ["timestamp", "visualPrompt", "narration"]
          }
        }
      }
    });

    const scenes = JSON.parse(response.text || "[]");
    return scenes.map((s: any, i: number) => ({
      ...s,
      id: `scene-${i}`,
      status: 'pending',
      screenshotIndex: i < input.screenshots.length ? i : undefined
    }));
  }

  async generateSceneVideo(scene: Scene, screenshot?: string): Promise<string> {
    // 1. Try Server-Side API first (recommended for Veo video streaming)
    try {
      const initRes = await fetch("/api/generate-video", {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({
          visualPrompt: scene.visualPrompt,
          screenshot
        })
      });

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

        // Download the final MP4 video via server proxy (which attaches valid authorization)
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
      } else if (initRes.status === 401) {
        const err = await initRes.json().catch(() => ({}));
        throw new Error(err.error || "API Key required for video generation. Please connect your key.");
      }
    } catch (e: any) {
      if (e.message?.includes("API Key required") || e.message?.includes("timed out") || e.message?.includes("Invalid or empty")) {
        throw e;
      }
      console.warn("Backend video generation failed or not available, attempting client-side fallback...", e);
    }

    // 2. Client-side SDK Fallback
    const clientKey = getClientApiKey();
    if (!clientKey) {
      throw new Error("A valid Gemini API Key is required to generate videos. Please connect your API key.");
    }

    const ai = new GoogleGenAI({ apiKey: clientKey });
    const config: any = {
      numberOfVideos: 1,
      resolution: '720p',
      aspectRatio: '16:9'
    };
    const payload: any = {
      model: 'veo-3.1-lite-generate-preview',
      prompt: scene.visualPrompt,
      config
    };

    if (screenshot) {
      payload.image = {
        imageBytes: screenshot.includes(',') ? screenshot.split(',')[1] : screenshot,
        mimeType: 'image/png'
      };
    }

    let operation = await ai.models.generateVideos(payload);
    while (!operation.done) {
      await new Promise(resolve => setTimeout(resolve, 8000));
      operation = await ai.operations.getVideosOperation({ operation: operation });
    }

    const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (!downloadLink) throw new Error("Video generation failed - no video URI returned by Veo.");

    // Secure fetch using authorization header or fallback to key param
    let response = await fetch(downloadLink, {
      headers: { "x-goog-api-key": clientKey }
    });

    if (!response.ok) {
      const fallbackUrl = downloadLink.includes('?') ? `${downloadLink}&key=${clientKey}` : `${downloadLink}?key=${clientKey}`;
      response = await fetch(fallbackUrl);
    }

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
    // 1. Try Server-Side API first
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
      // Fall through to client SDK
    }

    // 2. Client-side SDK Fallback
    const apiKey = getClientApiKey();
    const ai = new GoogleGenAI({ apiKey: apiKey || undefined });
    
    let response;
    try {
      response = await ai.models.generateContent({
        model: "gemini-3.1-flash-tts-preview",
        contents: [{ parts: [{ text: `Say clearly and professionally: ${text}` }] }],
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
        contents: [{ parts: [{ text: `Say clearly and professionally: ${text}` }] }],
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

    // 1. Try Server-Side API first
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
      // Fall through to client SDK
    }

    // 2. Client-side SDK Fallback
    const apiKey = getClientApiKey();
    const ai = new GoogleGenAI({ apiKey: apiKey || undefined });

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
            text: "Analyze this video clip. Provide a brief 1-sentence description of what's happening and write a professional 10-second narration script for it. Return as JSON."
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

    // 1. Try Server-Side API first
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
      // Fall through to client SDK
    }

    // 2. Client-side SDK Fallback
    const apiKey = getClientApiKey();
    const ai = new GoogleGenAI({ apiKey: apiKey || undefined });

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: `Generate YouTube metadata for a video based on these scene analyses: ${summary}. Include a catchy title, a full description with timestamps, and 10 relevant tags.`,
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
