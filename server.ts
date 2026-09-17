import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import multer from "multer";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type, Modality, GenerateVideosOperation } from "@google/genai";

const execAsync = promisify(exec);

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

  // --- Tour Session Store (Persistent Hybrid Fallback) ---
  const SESSIONS_DIR = path.join(process.cwd(), "sessions_data");
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }

  app.get("/api/sessions", (_req, res) => {
    try {
      const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith(".json"));
      const sessions = [];
      for (const f of files) {
        try {
          const content = fs.readFileSync(path.join(SESSIONS_DIR, f), "utf8");
          sessions.push(JSON.parse(content));
        } catch {}
      }
      res.json({ sessions });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/sessions/:id", (req, res) => {
    try {
      const sessionId = req.params.id;
      const safeId = sessionId.replace(/[^a-zA-Z0-9_\-]/g, "");
      const filePath = path.join(SESSIONS_DIR, `${safeId}.json`);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf8");
        return res.json(JSON.parse(content));
      }
      return res.status(404).json({ error: "Session not found on server store" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/sessions", (req, res) => {
    try {
      const session = req.body;
      if (!session || !session.id) {
        return res.status(400).json({ error: "Invalid session payload" });
      }
      const safeId = String(session.id).replace(/[^a-zA-Z0-9_\-]/g, "");
      const filePath = path.join(SESSIONS_DIR, `${safeId}.json`);
      fs.writeFileSync(filePath, JSON.stringify(session, null, 2), "utf8");
      res.json({ success: true, id: session.id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/sessions/:id", (req, res) => {
    try {
      const sessionId = req.params.id;
      const safeId = sessionId.replace(/[^a-zA-Z0-9_\-]/g, "");
      const filePath = path.join(SESSIONS_DIR, `${safeId}.json`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
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
      const hasScreenshots = screenshotCount > 0;
      // When screenshots are provided, create exactly as many scenes as there are uploaded screenshots.
      const targetSceneCount = hasScreenshots ? screenshotCount : 5;

      const prompt = `
        Act as a professional software video tour director.
        Create an exact ${targetSceneCount}-scene storyboard for the app tour video.
        ${hasScreenshots ? `CRITICAL REQUIREMENT: Exactly ${targetSceneCount} scenes MUST be created. There are ${targetSceneCount} uploaded screenshots. You MUST create exactly ONE scene for each uploaded screenshot in sequence (Scene 1 matches Screenshot 1, Scene 2 matches Screenshot 2, etc.). Return an array with exactly ${targetSceneCount} items.` : `Create a ${targetSceneCount}-scene storyboard.`}

        App Name: ${name || "My App"}
        App URL: ${url || ""}
        Description: ${description || ""}
        Tour Script / Key Features: ${script || ""}
        Screenshots Provided: ${hasScreenshots ? `${screenshotCount} real application screenshots provided in 100% U.S. English` : "None"}

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

      // Ensure exact scene count matching targetSceneCount
      const scenes: any[] = [];
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
          narration: item.narration || `Here in scene ${i + 1}, we explore key application features and productivity workflows designed to empower your team.`,
          status: 'pending',
          screenshotIndex: hasScreenshots ? i : undefined
        });
      }

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

      let finalPrompt: string;
      if (screenshot) {
        // Strip out any accidental mentions of simulated 3D phones, mockups, rooms, or device frames
        let cleanMotion = visualPrompt ? visualPrompt.trim() : "Smooth slow push-in zoom into the interface.";
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
          visualPrompt ? visualPrompt.trim() : "Cinematic digital interface showcase in motion.",
          `Clean modern minimalist interface presentation with crisp typography in standard American English, smooth UI motion graphics, professional product demo.`
        ].join(" ");
      }

      let payloadImage: any = undefined;
      if (screenshot) {
        const mimeMatch = screenshot.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
        const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
        const rawBase64 = screenshot.includes(',') ? screenshot.split(',')[1] : screenshot;
        payloadImage = {
          imageBytes: rawBase64,
          mimeType: mimeType
        };
      }

      let operation: any;
      try {
        // Prefer flagship veo-3.1-generate-preview for superior fidelity and crisp text
        operation = await ai.models.generateVideos({
          model: 'veo-3.1-generate-preview',
          prompt: finalPrompt,
          config,
          ...(payloadImage ? { image: payloadImage } : {})
        });
      } catch (tierErr: any) {
        console.warn("veo-3.1-generate-preview fallback to lite:", tierErr?.message);
        operation = await ai.models.generateVideos({
          model: 'veo-3.1-lite-generate-preview',
          prompt: finalPrompt,
          config,
          ...(payloadImage ? { image: payloadImage } : {})
        });
      }
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

      // Fetch video using x-goog-api-key header - API key is never passed in the URL
      const videoRes = await fetch(uri, {
        headers: { 'x-goog-api-key': apiKey }
      });

      if (!videoRes.ok) {
        const errText = await videoRes.text();
        console.error("Google Files download failed:", videoRes.status, errText);
        return res.status(videoRes.status).json({ error: `Video download failed (${videoRes.status}): ${errText}` });
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
      } catch (e) {
        // Fallback to gemini-2.5-flash-preview-tts if 3.1 tts is not yet available in current region
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

      const rawBase64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!rawBase64Audio) {
        return res.status(500).json({ error: "TTS generation failed - no audio data returned" });
      }

      // Convert raw 16-bit 24kHz linear PCM to standard RIFF WAV so browsers can play it natively
      let base64Audio = rawBase64Audio;
      try {
        const pcmBuffer = Buffer.from(rawBase64Audio, 'base64');
        // If not already starting with RIFF header, wrap with 44-byte WAV header
        if (pcmBuffer.length > 4 && pcmBuffer.slice(0, 4).toString() !== 'RIFF') {
          const sampleRate = 24000;
          const numChannels = 1;
          const wavHeader = Buffer.alloc(44);
          const totalDataLen = pcmBuffer.length;
          const byteRate = sampleRate * numChannels * 2;
          const blockAlign = numChannels * 2;

          wavHeader.write('RIFF', 0);
          wavHeader.writeUInt32LE(36 + totalDataLen, 4);
          wavHeader.write('WAVE', 8);
          wavHeader.write('fmt ', 12);
          wavHeader.writeUInt32LE(16, 16);
          wavHeader.writeUInt16LE(1, 20); // PCM
          wavHeader.writeUInt16LE(numChannels, 22);
          wavHeader.writeUInt32LE(sampleRate, 24);
          wavHeader.writeUInt32LE(byteRate, 28);
          wavHeader.writeUInt16LE(blockAlign, 32);
          wavHeader.writeUInt16LE(16, 34); // 16-bit
          wavHeader.write('data', 36);
          wavHeader.writeUInt32LE(totalDataLen, 40);

          base64Audio = Buffer.concat([wavHeader, pcmBuffer]).toString('base64');
        }
      } catch (wavErr) {
        console.warn("Could not wrap PCM in WAV header, returning raw PCM:", wavErr);
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

      const metadata = JSON.parse(response.text || "{}");
      res.json(metadata);
    } catch (err: any) {
      console.error("Error in /api/youtube-metadata:", err);
      res.status(500).json({ error: err.message || "Failed to generate YouTube metadata" });
    }
  });

  // Helper: Inspect media header bytes to identify images, WebM, MP4, etc.
  function inspectMediaFile(filePath: string, mimeType?: string, originalName?: string): { isImage: boolean; isVideo: boolean; ext: string } {
    try {
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        if (stat.size > 0) {
          const buf = Buffer.alloc(Math.min(64, stat.size));
          const fd = fs.openSync(filePath, 'r');
          const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
          fs.closeSync(fd);

          // PNG: 89 50 4E 47
          if (bytesRead >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
            return { isImage: true, isVideo: false, ext: '.png' };
          }
          // JPEG: FF D8 FF
          if (bytesRead >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) {
            return { isImage: true, isVideo: false, ext: '.jpg' };
          }
          // WebP: RIFF .... WEBP
          if (bytesRead >= 12 && buf.toString('utf8', 0, 4) === 'RIFF' && buf.toString('utf8', 8, 12) === 'WEBP') {
            return { isImage: true, isVideo: false, ext: '.webp' };
          }
          // WebM / MKV: 1A 45 DF A3
          if (bytesRead >= 4 && buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) {
            return { isImage: false, isVideo: true, ext: '.webm' };
          }
          // MP4 / MOV: ftyp or moov
          if (bytesRead >= 12 && (buf.toString('utf8', 4, 8) === 'ftyp' || buf.toString('utf8', 4, 8) === 'moov' || buf.toString('utf8', 0, 4) === 'moov')) {
            return { isImage: false, isVideo: true, ext: '.mp4' };
          }
        }
      }
    } catch (e) {}

    if (mimeType?.startsWith('image/') || originalName?.match(/\.(png|jpe?g|webp|bmp|gif)$/i)) {
      const ext = originalName?.match(/\.(png|jpe?g|webp|bmp|gif)$/i)?.[0]?.toLowerCase() || '.png';
      return { isImage: true, isVideo: false, ext };
    }
    if (mimeType?.includes('webm') || originalName?.endsWith('.webm')) {
      return { isImage: false, isVideo: true, ext: '.webm' };
    }
    return { isImage: false, isVideo: true, ext: '.mp4' };
  }

  // 8. Stitch Master Video (All Scenes Concatenated with FFmpeg into a Single Broadcast MP4)
  const uploadDir = path.join(os.tmpdir(), "tourgenie-uploads");
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
  const upload = multer({
    dest: uploadDir,
    limits: { fileSize: 250 * 1024 * 1024 } // 250MB per file
  });

  app.post("/api/stitch-master-video", upload.any(), async (req, res) => {
    const allFiles = (req.files as Express.Multer.File[]) || [];
    if (!allFiles || allFiles.length === 0) {
      return res.status(400).json({ error: "No video clips received for stitching." });
    }

    // Separate clips and optional synchronized audio tracks
    const clips = allFiles.filter(f => f.fieldname === 'clips' || !f.fieldname.includes('audio'));
    const audios = allFiles.filter(f => f.fieldname === 'audios' || f.fieldname.includes('audio'));

    if (clips.length === 0) {
      return res.status(400).json({ error: "No video clips found in payload." });
    }

    // Sort clips deterministically based on originalname (e.g. scene-1.mp4, scene-2.mp4)
    clips.sort((a, b) => {
      const matchA = a.originalname.match(/scene-(\d+)/i);
      const matchB = b.originalname.match(/scene-(\d+)/i);
      if (matchA && matchB) {
        return parseInt(matchA[1], 10) - parseInt(matchB[1], 10);
      }
      return 0;
    });

    const sessionDir = path.join(os.tmpdir(), `master-stitch-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);
    fs.mkdirSync(sessionDir, { recursive: true });

    try {
      console.log(`[Stitch Engine] Received ${clips.length} clips and ${audios.length} synchronized audios in ${sessionDir}`);
      const normalizedFiles: string[] = [];

      for (let i = 0; i < clips.length; i++) {
        const file = clips[i];
        const normPath = path.join(sessionDir, `norm_${i.toString().padStart(3, '0')}.mp4`);
        const mediaInfo = inspectMediaFile(file.path, file.mimetype, file.originalname);
        const typedInputPath = path.join(sessionDir, `input_${i}${mediaInfo.ext}`);

        // Provide typed file extension so FFmpeg demuxer recognizes input accurately
        try {
          fs.copyFileSync(file.path, typedInputPath);
        } catch (copyErr) {
          console.warn(`[Stitch Engine] Could not copy input to typed path for clip ${i}:`, copyErr);
        }
        const effectiveInput = fs.existsSync(typedInputPath) ? typedInputPath : file.path;

        // Check if there is an explicit audio track provided for this scene (e.g., scene-1.wav)
        const clipMatch = file.originalname.match(/scene-(\d+)/i);
        const targetSceneNum = clipMatch ? clipMatch[1] : `${i + 1}`;
        const matchingAudio = audios.find(a => {
          const aMatch = a.originalname.match(/scene-(\d+)/i);
          return aMatch && aMatch[1] === targetSceneNum;
        }) || (audios[i] && !clipMatch ? audios[i] : null);

        let effectiveAudioPath: string | null = null;
        if (matchingAudio) {
          const typedAudioPath = path.join(sessionDir, `audio_${i}.wav`);
          try {
            fs.copyFileSync(matchingAudio.path, typedAudioPath);
            if (fs.existsSync(typedAudioPath) && fs.statSync(typedAudioPath).size > 100) {
              effectiveAudioPath = typedAudioPath;
              console.log(`[Stitch Engine] Muxing synchronized voiceover audio for Scene ${targetSceneNum}`);
            }
          } catch (aErr) {
            console.warn(`[Stitch Engine] Warning copying audio for scene ${i}:`, aErr);
          }
        }

        let normalizedSuccessfully = false;

        // Case A: Input is a static image or screenshot - convert to MP4 loop animation with matched audio or silence
        if (mediaInfo.isImage) {
          try {
            console.log(`[Stitch Engine] Clip ${i} detected as image (${mediaInfo.ext}), generating loop animation`);
            let imgCmd = '';
            if (effectiveAudioPath) {
              imgCmd = `ffmpeg -y -loop 1 -i "${effectiveInput}" -i "${effectiveAudioPath}" -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30" -c:v libx264 -preset ultrafast -crf 22 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest -map 0:v:0 -map 1:a:0 "${normPath}"`;
            } else {
              imgCmd = `ffmpeg -y -loop 1 -t 10 -i "${effectiveInput}" -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30" -c:v libx264 -preset ultrafast -crf 22 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest -map 0:v:0 -map 1:a:0 "${normPath}"`;
            }
            await execAsync(imgCmd);
            normalizedSuccessfully = true;
          } catch (imgErr: any) {
            console.warn(`[Stitch Engine] Image loop conversion warning for clip ${i}:`, imgErr?.message || imgErr);
          }
        } else {
          // Case B: Video input - probe audio stream or use explicit voiceover audio
          let hasInternalAudio = false;
          if (!effectiveAudioPath) {
            try {
              const { stdout } = await execAsync(`ffprobe -v error -select_streams a -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "${effectiveInput}"`);
              if (stdout.trim().length > 0) {
                hasInternalAudio = true;
              }
            } catch (probeErr) {
              console.warn(`[Stitch Engine] ffprobe audio check warning for clip ${i}:`, probeErr);
            }
          }

          // Primary normalization attempt with error tolerance
          try {
            let normCmd = '';
            if (effectiveAudioPath) {
              // Mux explicit matched narration voiceover directly into the scene video
              normCmd = `ffmpeg -y -err_detect ignore_err -i "${effectiveInput}" -i "${effectiveAudioPath}" -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30" -c:v libx264 -preset ultrafast -crf 22 -pix_fmt yuv420p -c:a aac -ar 44100 -ac 2 -b:a 192k -map 0:v:0 -map 1:a:0 -shortest "${normPath}"`;
            } else if (hasInternalAudio) {
              normCmd = `ffmpeg -y -err_detect ignore_err -i "${effectiveInput}" -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30" -c:v libx264 -preset ultrafast -crf 22 -pix_fmt yuv420p -c:a aac -ar 44100 -ac 2 -b:a 192k "${normPath}"`;
            } else {
              normCmd = `ffmpeg -y -err_detect ignore_err -i "${effectiveInput}" -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30" -c:v libx264 -preset ultrafast -crf 22 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest -map 0:v:0 -map 1:a:0 "${normPath}"`;
            }
            await execAsync(normCmd);
            normalizedSuccessfully = true;
          } catch (primaryErr: any) {
            console.warn(`[Stitch Engine] Primary normalization failed for clip ${i}, attempting secondary demux:`, primaryErr?.message || primaryErr);

            // Secondary fallback: Explicit Matroska/WebM demuxer
            try {
              const fallbackCmd = `ffmpeg -y -err_detect ignore_err -f matroska,webm -i "${effectiveInput}" -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30" -c:v libx264 -preset ultrafast -crf 22 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest -map 0:v:0 -map 1:a:0 "${normPath}"`;
              await execAsync(fallbackCmd);
              normalizedSuccessfully = true;
            } catch (fallbackErr: any) {
              console.warn(`[Stitch Engine] Demux fallback also failed for clip ${i}:`, fallbackErr?.message || fallbackErr);
            }
          }
        }

        // Final safeguard: If normalization couldn't process this single clip, generate a 5-second graceful scene
        if (!normalizedSuccessfully || !fs.existsSync(normPath) || fs.statSync(normPath).size < 100) {
          console.warn(`[Stitch Engine] Generating graceful recovery scene for clip ${i} to guarantee complete master tour`);
          const recoveryCmd = `ffmpeg -y -f lavfi -i color=c=0x0b0f19:s=1280x720:r=30 -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -t 5 -c:v libx264 -preset ultrafast -crf 22 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest "${normPath}"`;
          await execAsync(recoveryCmd);
        }

        normalizedFiles.push(normPath);
      }

      // Create concat list file
      const listFilePath = path.join(sessionDir, "concat_list.txt");
      const listContent = normalizedFiles.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join("\n");
      fs.writeFileSync(listFilePath, listContent, "utf-8");

      // Concat all normalized files into master MP4
      const masterPath = path.join(sessionDir, "master.mp4");
      const concatCmd = `ffmpeg -y -f concat -safe 0 -i "${listFilePath}" -c copy -movflags +faststart "${masterPath}"`;
      await execAsync(concatCmd);

      if (!fs.existsSync(masterPath)) {
        throw new Error("Master video file was not generated by FFmpeg");
      }

      const stat = fs.statSync(masterPath);
      console.log(`[Stitch Engine] Master tour generated successfully! Size: ${stat.size} bytes (${clips.length} scenes stitched)`);

      const safeTitle = (req.body?.title ? String(req.body.title).replace(/[^a-zA-Z0-9_-]/g, '_') : 'Master_App_Tour');
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.mp4"`);
      res.setHeader("Content-Length", stat.size);

      const stream = fs.createReadStream(masterPath);
      stream.pipe(res);
      stream.on("close", () => {
        try {
          fs.rmSync(sessionDir, { recursive: true, force: true });
          allFiles.forEach(f => {
            try { fs.unlinkSync(f.path); } catch (e) {}
          });
        } catch (cleanupErr) {
          console.warn("[Stitch Engine] Cleanup error:", cleanupErr);
        }
      });
    } catch (err: any) {
      console.error("[Stitch Engine] Error in /api/stitch-master-video:", err);
      try {
        fs.rmSync(sessionDir, { recursive: true, force: true });
        allFiles.forEach(f => {
          try { fs.unlinkSync(f.path); } catch (e) {}
        });
      } catch (e) {}
      res.status(500).json({ error: `Master stitching failed: ${err.message}` });
    }
  });

  // 9. Fetch Authenticated YouTube Channel
  app.get("/api/youtube-channel", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: "Missing Authorization header with Google OAuth Bearer token." });
    }

    try {
      const ytRes = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true", {
        headers: {
          Authorization: authHeader
        }
      });

      const data = await ytRes.json();
      if (!ytRes.ok) {
        return res.status(ytRes.status).json({
          error: data.error?.message || "Failed to fetch YouTube channel info."
        });
      }

      res.json(data);
    } catch (err: any) {
      console.error("Error in /api/youtube-channel:", err);
      res.status(500).json({ error: err.message || "Failed to contact YouTube Data API" });
    }
  });

  // 10. Real YouTube Video Upload (Resumable Upload Protocol)
  app.post("/api/youtube-upload", upload.single("video"), async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      if (req.file) {
        try { fs.unlinkSync(req.file.path); } catch (e) {}
      }
      return res.status(401).json({ error: "Missing Authorization header with Google OAuth Bearer token." });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No video file provided for YouTube upload." });
    }

    try {
      const title = String(req.body.title || "TourGenie 90s App Tour").slice(0, 100);
      const description = String(req.body.description || "Created with TourGenie App Tour Studio").slice(0, 5000);
      let tags: string[] = [];
      if (req.body.tags) {
        try {
          const parsedTags = JSON.parse(req.body.tags);
          if (Array.isArray(parsedTags)) {
            tags = parsedTags.map(t => String(t).trim()).filter(Boolean).slice(0, 30);
          }
        } catch (e) {
          if (typeof req.body.tags === 'string') {
            tags = req.body.tags.split(',').map((t: string) => t.trim()).filter(Boolean).slice(0, 30);
          }
        }
      }
      const privacyStatus = ['public', 'private', 'unlisted'].includes(req.body.privacyStatus) 
        ? req.body.privacyStatus 
        : 'unlisted';

      console.log(`[YouTube API] Initiating resumable upload for "${title}" (${file.size} bytes, privacy: ${privacyStatus})...`);

      // Step 1: Initiate Resumable Upload Session
      const initRes = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Length": String(file.size),
          "X-Upload-Content-Type": "video/mp4"
        },
        body: JSON.stringify({
          snippet: {
            title,
            description,
            tags,
            categoryId: "28" // Science & Technology
          },
          status: {
            privacyStatus,
            selfDeclaredMadeForKids: false
          }
        })
      });

      if (!initRes.ok) {
        const errData = await initRes.json().catch(() => ({}));
        try { fs.unlinkSync(file.path); } catch (e) {}
        console.error("[YouTube API] Initiation failed:", errData);
        return res.status(initRes.status).json({
          error: errData.error?.message || "YouTube upload initiation failed"
        });
      }

      const uploadUrl = initRes.headers.get("location");
      if (!uploadUrl) {
        try { fs.unlinkSync(file.path); } catch (e) {}
        throw new Error("YouTube did not provide a resumable upload location URL.");
      }

      console.log("[YouTube API] Upload session initialized, sending video stream...");

      // Step 2: Transfer Video Binary
      const videoBuffer = fs.readFileSync(file.path);
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          Authorization: authHeader,
          "Content-Type": "video/mp4",
          "Content-Length": String(videoBuffer.length)
        },
        body: videoBuffer
      });

      // Cleanup local temp file
      try { fs.unlinkSync(file.path); } catch (e) {}

      const uploadData = await uploadRes.json().catch(() => ({}));
      if (!uploadRes.ok) {
        console.error("[YouTube API] Video transfer failed:", uploadData);
        return res.status(uploadRes.status).json({
          error: uploadData.error?.message || "YouTube video processing failed"
        });
      }

      const videoId = uploadData.id;
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
      console.log(`[YouTube API] Video published successfully! ID: ${videoId} -> ${videoUrl}`);

      res.json({
        success: true,
        videoId,
        videoUrl,
        title: uploadData.snippet?.title || title,
        privacyStatus: uploadData.status?.privacyStatus || privacyStatus
      });
    } catch (err: any) {
      if (req.file) {
        try { fs.unlinkSync(req.file.path); } catch (e) {}
      }
      console.error("[YouTube API] Error:", err);
      res.status(500).json({ error: err.message || "Failed to upload video to YouTube" });
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
