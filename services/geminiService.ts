import { GoogleGenAI, Type, Modality } from "@google/genai";
import { AppInput, Scene, EditorClip } from "../types";

export class TourService {
  /**
   * Note: As per SDK guidelines, we instantiate GoogleGenAI immediately before each call 
   * to ensure it uses the most current process.env.API_KEY injected by the environment.
   */

  async createStoryboards(input: AppInput): Promise<Scene[]> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
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
      model: 'gemini-3-flash-preview',
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
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const config: any = {
      numberOfVideos: 1,
      resolution: '720p',
      aspectRatio: '16:9'
    };
    const payload: any = {
      model: 'veo-3.1-fast-generate-preview',
      prompt: scene.visualPrompt,
      config
    };

    if (screenshot) {
      payload.image = {
        imageBytes: screenshot.split(',')[1],
        mimeType: 'image/png'
      };
    }

    let operation = await ai.models.generateVideos(payload);
    while (!operation.done) {
      await new Promise(resolve => setTimeout(resolve, 8000));
      operation = await ai.operations.getVideosOperation({ operation: operation });
    }

    const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (!downloadLink) throw new Error("Video generation failed - no URI");
    const response = await fetch(`${downloadLink}&key=${process.env.API_KEY}`);
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  }

  async generateNarration(text: string): Promise<string> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
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

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) throw new Error("TTS generation failed");
    return base64Audio;
  }

  async analyzeVideoClip(file: File): Promise<{ analysis: string; narration: string }> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const base64 = await this.fileToBase64(file);
    
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          {
            inlineData: {
              data: base64,
              mimeType: file.type
            }
          },
          {
            text: "Analyze this video clip. Provide a brief 1-sentence description of what's happening and write a professional 10-15 second narration script for it that explains the UI action shown."
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
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const summary = clips.map(c => c.analysis).join(". ");
    
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
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