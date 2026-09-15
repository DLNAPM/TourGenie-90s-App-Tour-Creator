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
    const prompt = `
      Act as a world-class commercial video director. Create a 5-scene storyboard for a 90-second app tour video.
      App Name: ${input.name}
      App URL: ${input.url}
      Description: ${input.description}
      Tour Script Provided: ${input.script}
      Screenshots Provided: ${hasScreenshots ? `${input.screenshots.length} real application screenshots provided (100% U.S. English)` : "None (synthesizing UI)"}

      CRITICAL REQUIREMENT - 100% U.S. ENGLISH ONLY:
      - Everything generated MUST be strictly in 100% fluent American English.
      - ${hasScreenshots 
          ? `IMPORTANT: The user has provided real app screenshots in 100% U.S. English. In each "visualPrompt", describe cinematic camera motions (e.g. slow zoom-in, smooth horizontal pan, tilt, subtle lighting sweep, floating perspective) that showcase the user's real screenshot. Instruct the video generator to preserve the original English text and UI elements with 100% fidelity, strictly forbidding any foreign glyphs, Asian characters, or text alteration.`
          : `In each "visualPrompt", specify clean modern 3D device mockups with sleek motion graphics. Any on-screen typography must be minimal, bold, 100% U.S. English only (e.g. 'DASHBOARD', 'ANALYTICS', 'SETTINGS'). Strictly forbid foreign characters, Asian scripts, Cyrillic, or pseudo-symbols.`
        }
      - In each "narration", write natural, engaging voiceover script in 100% fluent American English.

      For each scene, provide:
      1. A timestamp (e.g. 0:00 - 0:18)
      2. A "visualPrompt" describing the camera motion, lighting, and visual focus for a 5-10 second video clip, ensuring 100% U.S. English text fidelity.
      3. A "narration" text that will be converted to speech in 100% fluent U.S. English.

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
      screenshotIndex: hasScreenshots ? (i % input.screenshots.length) : undefined
    }));
  }

  async generateSceneVideo(scene: Scene, screenshot?: string): Promise<string> {
    // 1. Server-Side Video Generation and Streaming (uses Render.com API_KEY)
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
      finalPrompt = [
        `Cinematic animation of the provided application screenshot.`,
        `CAMERA MOTION: ${scene.visualPrompt ? scene.visualPrompt.trim() : "Smooth cinematic camera glide across the interface with subtle zoom, elegant panning, and soft studio lighting sweep."}`,
        `CRITICAL REQUIREMENT - PRESERVE 100% U.S. ENGLISH SOURCE IMAGE:`,
        `- The input reference image is already 100% U.S. English. You MUST preserve all existing English words, labels, buttons, typography, and interface layout exactly as shown in the source image with 100% fidelity.`,
        `- DO NOT alter, replace, warp, translate, or redraw any text from the reference image.`,
        `- DO NOT generate foreign characters, Asian glyphs, Chinese, Japanese, Korean, Cyrillic, or alien pseudo-language symbols.`,
        `- Animate strictly using camera motion (slow push-in zoom, gentle horizontal pan, subtle tilt, floating parallax, soft light reflection) without generating new synthetic text.`,
        `- All existing English text from the input screenshot must remain crisp, razor-sharp, and fully legible throughout the video.`
      ].join(" ");
    } else {
      finalPrompt = [
        scene.visualPrompt ? scene.visualPrompt.trim() : "Cinematic modern digital interface showcase in motion.",
        `CRITICAL REQUIREMENT - 100% U.S. ENGLISH ONLY:`,
        `- All on-screen elements, labels, and text must be rendered strictly in 100% standard American English.`,
        `- Absolutely NO foreign characters, Asian glyphs, Chinese, Japanese, Korean, Cyrillic, Arabic, or distorted pseudo-text symbols.`,
        `- Keep on-screen typography minimal, clean, bold, and modern (e.g. single words like 'DASHBOARD', 'START', 'METRICS'). Avoid dense blocks of small text.`,
        `- Focus on clean modern 3D device mockups, motion graphics, abstract charts, and smooth UI transitions.`
      ].join(" ");
    }

    const payload: any = {
      model: 'veo-3.1-lite-generate-preview',
      prompt: finalPrompt,
      config
    };

    if (screenshot) {
      const mimeMatch = screenshot.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
      const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
      payload.image = {
        imageBytes: screenshot.includes(',') ? screenshot.split(',')[1] : screenshot,
        mimeType: mimeType
      };
    }

    let operation = await ai.models.generateVideos(payload);
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
