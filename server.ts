import express from "express";
import cors from "cors";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type, Modality, GenerateVideosOperation } from "@google/genai";

function getApiKey(req: express.Request): string {
  // 1. Fetch API key from Render.com's environment variable "API_KEY"
  const envKey = process.env.API_KEY || process.env.GEMINI_API_KEY || '';
  if (envKey && envKey !== 'UNUSED_PLACEHOLDER_FOR_API_KEY' && envKey !== 'RENDER_API_KEY_PLACEHOLDER') {
    return envKey;
  }
  // 2. Client-provided header fallback
  const headerKey = req.headers['x-gemini-api-key'] as string;
  if (headerKey && headerKey !== 'UNUSED_PLACEHOLDER_FOR_API_KEY' && headerKey !== 'RENDER_API_KEY_PLACEHOLDER') {
    return headerKey;
  }
  return '';
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // --- API Routes ---
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/key-status", (req, res) => {
    const key = getApiKey(req);
    res.json({ hasKey: Boolean(key) });
  });

  // 1. Generate Storyboards
  app.post("/api/generate-storyboard", async (req, res) => {
    try {
      const apiKey = getApiKey(req);
      if (!apiKey) {
        return res.status(401).json({ error: "Gemini API Key is missing or not configured." });
      }
      const ai = new GoogleGenAI({ apiKey });
      const { name, url, description, script, screenshotCount = 0 } = req.body;

      const prompt = `
        Act as a world-class video director. Create a 5-scene storyboard for a 90-second app tour video.
        App Name: ${name || "My App"}
        App URL: ${url || ""}
        Description: ${description || ""}
        Tour Script / Key Features: ${script || ""}

        For each scene, provide:
        1. A timestamp (e.g. 0:00 - 0:15)
        2. A "visualPrompt" describing exactly what should happen in a 5-10 second video clip. Focus on professional UI animation, cinematic camera moves, and sleek transitions.
        3. A "narration" text that will be converted to speech.

        Return as a JSON array of objects with keys: timestamp, visualPrompt, narration.
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

      const parsed = JSON.parse(response.text || "[]");
      const scenes = parsed.map((s: any, i: number) => ({
        ...s,
        id: `scene-${i}`,
        status: 'pending',
        screenshotIndex: i < screenshotCount ? i : undefined
      }));

      res.json({ scenes });
    } catch (err: any) {
      console.error("Error in /api/generate-storyboard:", err);
      res.status(500).json({ error: err.message || "Failed to generate storyboard" });
    }
  });

  // 2. Start Video Generation (Veo)
  app.post("/api/generate-video", async (req, res) => {
    try {
      const apiKey = getApiKey(req);
      if (!apiKey) {
        return res.status(401).json({ error: "Gemini API Key is missing or not configured." });
      }
      const ai = new GoogleGenAI({ apiKey });
      const { visualPrompt, screenshot } = req.body;

      const config: any = {
        numberOfVideos: 1,
        resolution: '720p',
        aspectRatio: '16:9'
      };

      const payload: any = {
        model: 'veo-3.1-lite-generate-preview',
        prompt: visualPrompt || 'Cinematic clean mobile and desktop app interface interaction in motion',
        config
      };

      if (screenshot) {
        const rawBase64 = screenshot.includes(',') ? screenshot.split(',')[1] : screenshot;
        payload.image = {
          imageBytes: rawBase64,
          mimeType: 'image/png'
        };
      }

      const operation = await ai.models.generateVideos(payload);
      if (!operation || !operation.name) {
        return res.status(500).json({ error: "Failed to initialize video generation operation" });
      }

      res.json({ operationName: operation.name });
    } catch (err: any) {
      console.error("Error in /api/generate-video:", err);
      res.status(500).json({ error: err.message || "Failed to start video generation" });
    }
  });

  // 3. Poll Video Status
  app.post("/api/video-status", async (req, res) => {
    try {
      const apiKey = getApiKey(req);
      if (!apiKey) {
        return res.status(401).json({ error: "Gemini API Key is missing or not configured." });
      }
      const ai = new GoogleGenAI({ apiKey });
      const { operationName } = req.body;

      if (!operationName) {
        return res.status(400).json({ error: "operationName is required" });
      }

      const op = new GenerateVideosOperation();
      op.name = operationName;
      const updated = await ai.operations.getVideosOperation({ operation: op });

      res.json({
        done: Boolean(updated.done),
        error: updated.error || null
      });
    } catch (err: any) {
      console.error("Error in /api/video-status:", err);
      res.status(500).json({ error: err.message || "Failed to check video status" });
    }
  });

  // 4. Download Video (Streams real MP4 back to browser)
  app.post("/api/video-download", async (req, res) => {
    try {
      const apiKey = getApiKey(req);
      if (!apiKey) {
        return res.status(401).json({ error: "Gemini API Key is missing or not configured." });
      }
      const ai = new GoogleGenAI({ apiKey });
      const { operationName } = req.body;

      if (!operationName) {
        return res.status(400).json({ error: "operationName is required" });
      }

      const op = new GenerateVideosOperation();
      op.name = operationName;
      const updated = await ai.operations.getVideosOperation({ operation: op });

      if (!updated.done) {
        return res.status(400).json({ error: "Video generation is not completed yet" });
      }

      const uri = updated.response?.generatedVideos?.[0]?.video?.uri;
      if (!uri) {
        return res.status(404).json({ error: "No video download URI found in completed operation" });
      }

      // Try fetching using x-goog-api-key header first
      let videoRes = await fetch(uri, {
        headers: { 'x-goog-api-key': apiKey }
      });

      // If header rejected or 400+, fallback to query parameter
      if (!videoRes.ok) {
        const fallbackUrl = uri.includes('?') ? `${uri}&key=${apiKey}` : `${uri}?key=${apiKey}`;
        videoRes = await fetch(fallbackUrl);
      }

      if (!videoRes.ok) {
        const errText = await videoRes.text();
        console.error("Google Files download failed:", videoRes.status, errText);
        return res.status(videoRes.status).json({ error: `Video download failed: ${errText}` });
      }

      const contentType = videoRes.headers.get("content-type") || "video/mp4";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", "inline; filename=scene.mp4");

      const arrayBuffer = await videoRes.arrayBuffer();
      res.send(Buffer.from(arrayBuffer));
    } catch (err: any) {
      console.error("Error in /api/video-download:", err);
      res.status(500).json({ error: err.message || "Failed to download video" });
    }
  });

  // 5. Generate Narration Speech (TTS)
  app.post("/api/generate-narration", async (req, res) => {
    try {
      const apiKey = getApiKey(req);
      if (!apiKey) {
        return res.status(401).json({ error: "Gemini API Key is missing or not configured." });
      }
      const ai = new GoogleGenAI({ apiKey });
      const { text } = req.body;

      if (!text) {
        return res.status(400).json({ error: "Text is required for narration" });
      }

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
      } catch (e) {
        // Fallback to gemini-2.5-flash-preview-tts if 3.1 tts is not yet available in current region
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
      if (!base64Audio) {
        return res.status(500).json({ error: "TTS generation failed - no audio data returned" });
      }

      res.json({ base64Audio });
    } catch (err: any) {
      console.error("Error in /api/generate-narration:", err);
      res.status(500).json({ error: err.message || "Failed to generate narration" });
    }
  });

  // 6. Analyze Video Clip
  app.post("/api/analyze-video", async (req, res) => {
    try {
      const apiKey = getApiKey(req);
      if (!apiKey) {
        return res.status(401).json({ error: "Gemini API Key is missing or not configured." });
      }
      const ai = new GoogleGenAI({ apiKey });
      const { videoBase64, mimeType } = req.body;

      if (!videoBase64) {
        return res.status(400).json({ error: "videoBase64 is required" });
      }

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: {
          parts: [
            {
              inlineData: {
                data: videoBase64,
                mimeType: mimeType || 'video/mp4'
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

      const result = JSON.parse(response.text || "{}");
      res.json(result);
    } catch (err: any) {
      console.error("Error in /api/analyze-video:", err);
      res.status(500).json({ error: err.message || "Failed to analyze video" });
    }
  });

  // 7. YouTube Metadata
  app.post("/api/youtube-metadata", async (req, res) => {
    try {
      const apiKey = getApiKey(req);
      if (!apiKey) {
        return res.status(401).json({ error: "Gemini API Key is missing or not configured." });
      }
      const ai = new GoogleGenAI({ apiKey });
      const { summary } = req.body;

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

      const metadata = JSON.parse(response.text || "{}");
      res.json(metadata);
    } catch (err: any) {
      console.error("Error in /api/youtube-metadata:", err);
      res.status(500).json({ error: err.message || "Failed to generate YouTube metadata" });
    }
  });

  // --- Vite Middleware for Development / Static serving for Production ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
