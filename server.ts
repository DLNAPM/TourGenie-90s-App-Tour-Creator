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

  // 8. Stitch Master Video (All Scenes Concatenated with FFmpeg into a Single Broadcast MP4)
  const uploadDir = path.join(os.tmpdir(), "tourgenie-uploads");
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
  const upload = multer({
    dest: uploadDir,
    limits: { fileSize: 250 * 1024 * 1024 } // 250MB per file
  });

  app.post("/api/stitch-master-video", upload.array("clips"), async (req, res) => {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ error: "No video clips received for stitching." });
    }

    const sessionDir = path.join(os.tmpdir(), `master-stitch-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);
    fs.mkdirSync(sessionDir, { recursive: true });

    try {
      console.log(`[Stitch Engine] Received ${files.length} clips for master video assembly in ${sessionDir}`);
      const normalizedFiles: string[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const normPath = path.join(sessionDir, `norm_${i.toString().padStart(3, '0')}.mp4`);

        // Check if clip has an audio stream using ffprobe
        let hasAudio = false;
        try {
          const { stdout } = await execAsync(`ffprobe -v error -select_streams a -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "${file.path}"`);
          if (stdout.trim().length > 0) {
            hasAudio = true;
          }
        } catch (probeErr) {
          console.warn(`[Stitch Engine] ffprobe audio check warning for clip ${i}:`, probeErr);
        }

        // Standardize each scene to 1280x720 30fps H.264 (yuv420p) + AAC 44.1kHz stereo audio
        let normCmd = '';
        if (hasAudio) {
          normCmd = `ffmpeg -y -i "${file.path}" -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30" -c:v libx264 -preset ultrafast -crf 22 -pix_fmt yuv420p -c:a aac -ar 44100 -ac 2 -b:a 192k "${normPath}"`;
        } else {
          normCmd = `ffmpeg -y -i "${file.path}" -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30" -c:v libx264 -preset ultrafast -crf 22 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest -map 0:v:0 -map 1:a:0 "${normPath}"`;
        }

        await execAsync(normCmd);
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
      console.log(`[Stitch Engine] Master tour generated successfully! Size: ${stat.size} bytes (${files.length} scenes stitched)`);

      const safeTitle = (req.body?.title ? String(req.body.title).replace(/[^a-zA-Z0-9_-]/g, '_') : 'Master_App_Tour');
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.mp4"`);
      res.setHeader("Content-Length", stat.size);

      const stream = fs.createReadStream(masterPath);
      stream.pipe(res);
      stream.on("close", () => {
        try {
          fs.rmSync(sessionDir, { recursive: true, force: true });
          files.forEach(f => {
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
        files.forEach(f => {
          try { fs.unlinkSync(f.path); } catch (e) {}
        });
      } catch (e) {}
      res.status(500).json({ error: err.message || "Failed to stitch master video" });
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
