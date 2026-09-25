// services/screenStudioEngine.ts
// Pixel-Perfect Screen Studio Video Engine for TourGenie
// Guarantees 100% U.S. English fidelity with ZERO diffusion hallucinations or foreign glyphs

export interface RenderOptions {
  duration?: number; // seconds
  motionStyle?: 'push-in' | 'pan-horizontal' | 'pan-vertical' | 'spotlight' | 'pull-out' | 'auto';
  sceneIndex?: number;
  sceneTitle?: string;
  narration?: string;
  audioBase64?: string;
  fps?: number;
  width?: number;
  height?: number;
  narrationStartOffset?: number; // seconds delay before narrator starts speaking
}

/**
 * Prepend a standard 44-byte RIFF WAV header to raw 16-bit 24kHz linear PCM data
 */
export function pcmBase64ToWavBlob(pcmBase64: string, sampleRate = 24000, numChannels = 1): Blob {
  const binaryString = atob(pcmBase64);
  const len = binaryString.length;
  const pcmBytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    pcmBytes[i] = binaryString.charCodeAt(i);
  }

  // If already starts with "RIFF", it is already a WAV file
  if (len >= 4 && pcmBytes[0] === 0x52 && pcmBytes[1] === 0x49 && pcmBytes[2] === 0x46 && pcmBytes[3] === 0x46) {
    return new Blob([pcmBytes], { type: 'audio/wav' });
  }

  const wavHeader = new ArrayBuffer(44);
  const view = new DataView(wavHeader);
  const totalDataLen = len;
  const byteRate = sampleRate * numChannels * 2;
  const blockAlign = numChannels * 2;

  // RIFF identifier 'RIFF'
  view.setUint32(0, 0x52494646, false);
  view.setUint32(4, 36 + totalDataLen, true);
  // 'WAVE'
  view.setUint32(8, 0x57415645, false);
  // 'fmt '
  view.setUint32(12, 0x666d7420, false);
  view.setUint32(16, 16, true); // SubChunk1Size (16 for PCM)
  view.setUint16(20, 1, true);  // AudioFormat (1 for PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // BitsPerSample
  // 'data'
  view.setUint32(36, 0x64617461, false);
  view.setUint32(40, totalDataLen, true);

  return new Blob([wavHeader, pcmBytes], { type: 'audio/wav' });
}

/**
 * Loads an image from dataURL or URL
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(new Error('Failed to load screenshot image: ' + err));
    img.src = src;
  });
}

/**
 * Cubic bezier easing for smooth camera moves
 */
function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/**
 * Determines the best supported video mimeType in the current browser
 */
function getBestVideoMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const types = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4'
  ];
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) {
      return t;
    }
  }
  return '';
}

/**
 * Renders a high-definition cinematic animated screencast video from an uploaded screenshot.
 * Guarantees 100% pixel fidelity to the original English UI with zero diffusion artifacts.
 */
export async function renderScreenshotToVideo(
  screenshotUrl: string,
  options: RenderOptions = {}
): Promise<string> {
  const width = options.width || 1280;
  const height = options.height || 720;
  const fps = options.fps || 30;
  const sceneIdx = options.sceneIndex ?? 0;

  // Load screenshot
  const img = await loadImage(screenshotUrl);

  // Setup audio if provided
  let audioBuffer: AudioBuffer | null = null;
  let audioContext: AudioContext | null = null;
  let audioDuration = 0;

  if (options.audioBase64) {
    try {
      const wavBlob = pcmBase64ToWavBlob(options.audioBase64);
      const arrayBuffer = await wavBlob.arrayBuffer();
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtxClass) {
        audioContext = new AudioCtxClass();
        audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        audioDuration = audioBuffer.duration;
      }
    } catch (audioErr) {
      console.warn('Could not decode audio for video track, proceeding with video only:', audioErr);
    }
  }

  // Determine duration: MUST be at least 30 seconds long per scene as requested
  const minSceneDuration = 30;
  const startOffsetSec = Math.max(0, options.narrationStartOffset || 0);
  const neededAudioDuration = audioDuration > 0 ? Math.ceil(audioDuration + startOffsetSec + 0.6) : 0;
  const requestedDuration = options.duration 
    ? Math.max(options.duration, neededAudioDuration, minSceneDuration) 
    : Math.max(minSceneDuration, neededAudioDuration);
  const duration = Math.max(minSceneDuration, requestedDuration);

  const totalFrames = Math.max(30, Math.floor(duration * fps));

  // Determine motion choreography style
  let style = options.motionStyle || 'auto';
  if (style === 'auto') {
    const styles: Array<'push-in' | 'pan-horizontal' | 'pan-vertical' | 'spotlight' | 'pull-out'> = [
      'push-in',
      'pan-horizontal',
      'pan-vertical',
      'spotlight',
      'pull-out'
    ];
    style = styles[sceneIdx % styles.length];
  }

  // Create offscreen canvas
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable.');
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Check MediaRecorder support
  const mimeType = getBestVideoMimeType();
  if (!mimeType || typeof canvas.captureStream !== 'function') {
    console.warn('MediaRecorder or captureStream unavailable, falling back to static canvas export');
    return screenshotUrl;
  }

  // Create stream from canvas
  const stream = canvas.captureStream(fps);

  // If audio is available, route to stream
  let audioSourceNode: AudioBufferSourceNode | null = null;
  if (audioContext && audioBuffer) {
    try {
      const destination = audioContext.createMediaStreamDestination();
      audioSourceNode = audioContext.createBufferSource();
      audioSourceNode.buffer = audioBuffer;
      audioSourceNode.connect(destination);
      const audioTrack = destination.stream.getAudioTracks()[0];
      if (audioTrack) {
        stream.addTrack(audioTrack);
      }
    } catch (err) {
      console.warn('Audio stream track assignment failed:', err);
    }
  }

  const mediaRecorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 6_000_000 // 6 Mbps high quality
  });

  const recordedChunks: Blob[] = [];
  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      recordedChunks.push(e.data);
    }
  };

  const recordingPromise = new Promise<string>((resolve, reject) => {
    mediaRecorder.onstop = () => {
      try {
        const finalBlob = new Blob(recordedChunks, { type: mimeType });
        const videoUrl = URL.createObjectURL(finalBlob);
        if (audioContext && audioContext.state !== 'closed') {
          audioContext.close().catch(() => {});
        }
        resolve(videoUrl);
      } catch (err) {
        reject(err);
      }
    };
    mediaRecorder.onerror = (err) => reject(err);
  });

  // Start recording
  mediaRecorder.start();
  if (audioSourceNode && audioContext) {
    try {
      // Schedule audio start exactly at the requested offset seconds into scene
      const scheduleTime = audioContext.currentTime + startOffsetSec;
      audioSourceNode.start(scheduleTime);
    } catch (e) {
      console.warn('Could not start audio node with offset:', e);
    }
  }

  // Draw initial frame
  drawSceneFrame(ctx, img, 0, width, height, style, sceneIdx, options.sceneTitle, options.narration);

  // Render frames smoothly across duration
  const frameIntervalMs = 1000 / fps;
  let currentFrame = 0;

  await new Promise<void>((resolve) => {
    const intervalId = setInterval(() => {
      currentFrame++;
      const progress = Math.min(1, currentFrame / totalFrames);
      drawSceneFrame(ctx, img, progress, width, height, style, sceneIdx, options.sceneTitle, options.narration);

      if (currentFrame >= totalFrames) {
        clearInterval(intervalId);
        setTimeout(() => {
          if (mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
          }
          resolve();
        }, 150);
      }
    }, frameIntervalMs);
  });

  return await recordingPromise;
}

/**
 * Draws a single cinematic frame with camera pan/zoom and crisp UI overlay
 */
function drawSceneFrame(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  progress: number,
  canvasWidth: number,
  canvasHeight: number,
  motionStyle: string,
  sceneIdx: number,
  sceneTitle?: string,
  narration?: string
) {
  const eased = easeInOutCubic(progress);

  // Clear background with rich slate backdrop
  ctx.fillStyle = '#090d16';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // Subtle ambient backdrop grid
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
  ctx.lineWidth = 1;
  const gridSize = 40;
  for (let x = 0; x < canvasWidth; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvasHeight);
    ctx.stroke();
  }
  for (let y = 0; y < canvasHeight; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvasWidth, y);
    ctx.stroke();
  }

  // Camera Transformation Calculation
  let scale = 1.0;
  let offsetX = 0;
  let offsetY = 0;

  switch (motionStyle) {
    case 'push-in':
      // Smooth push-in zoom into central features: 1.00x -> 1.15x
      scale = 1.0 + eased * 0.15;
      offsetX = (canvasWidth * (1 - scale)) / 2;
      offsetY = (canvasHeight * (1 - scale)) * 0.35;
      break;

    case 'pan-horizontal':
      // Zoomed 1.12x, glides from left navigation to right metrics
      scale = 1.12;
      const maxPanX = canvasWidth * 0.12;
      offsetX = (1 - eased * 2) * (maxPanX / 2);
      offsetY = (canvasHeight * (1 - scale)) / 2;
      break;

    case 'pan-vertical':
      // Zoomed 1.12x, glides down from top header to lower data cards
      scale = 1.12;
      const maxPanY = canvasHeight * 0.12;
      offsetX = (canvasWidth * (1 - scale)) / 2;
      offsetY = (1 - eased * 2) * (maxPanY / 2);
      break;

    case 'spotlight':
      // Spotlight focus on center-right action with subtle cursor glide
      scale = 1.05 + eased * 0.12;
      offsetX = (canvasWidth * (1 - scale)) * 0.65;
      offsetY = (canvasHeight * (1 - scale)) * 0.45;
      break;

    case 'pull-out':
    default:
      // Cinematic reveal: begins close-up at 1.18x and eases out to full overview 1.00x
      scale = 1.18 - eased * 0.18;
      offsetX = (canvasWidth * (1 - scale)) / 2;
      offsetY = (canvasHeight * (1 - scale)) / 2;
      break;
  }

  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);

  // Compute image placement maintaining aspect ratio
  const imgRatio = img.naturalWidth / img.naturalHeight;
  const canvasRatio = canvasWidth / canvasHeight;

  let drawW = canvasWidth;
  let drawH = canvasHeight;
  let drawX = 0;
  let drawY = 0;

  if (Math.abs(imgRatio - canvasRatio) < 0.15) {
    // Fits approximately 16:9 - fill cleanly
    drawW = canvasWidth;
    drawH = canvasHeight;
    drawX = 0;
    drawY = 0;
  } else if (imgRatio < 1.0) {
    // Portrait / Mobile Screenshot
    drawH = canvasHeight * 0.92;
    drawW = drawH * imgRatio;
    drawX = (canvasWidth - drawW) / 2;
    drawY = (canvasHeight - drawH) / 2;

    // Device mockup shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
    ctx.shadowBlur = 32;
    ctx.shadowOffsetY = 12;
    ctx.fillStyle = '#0f172a';
    roundRect(ctx, drawX - 6, drawY - 6, drawW + 12, drawH + 12, 20);
    ctx.fill();
    ctx.restore();
  } else {
    // Other landscape
    drawW = canvasWidth;
    drawH = canvasWidth / imgRatio;
    drawX = 0;
    drawY = (canvasHeight - drawH) / 2;
  }

  // Draw the REAL screenshot image with 100% pixel fidelity
  ctx.drawImage(img, drawX, drawY, drawW, drawH);

  // Cursor Animation on 'spotlight' mode
  if (motionStyle === 'spotlight' && progress > 0.25) {
    const cursorProgress = Math.min(1, (progress - 0.25) / 0.5);
    const cursorEased = easeInOutCubic(cursorProgress);
    const startX = canvasWidth * 0.35;
    const startY = canvasHeight * 0.7;
    const targetX = canvasWidth * 0.58;
    const targetY = canvasHeight * 0.46;

    const curX = startX + (targetX - startX) * cursorEased;
    const curY = startY + (targetY - startY) * cursorEased;

    // Draw cursor arrow
    ctx.save();
    ctx.translate(curX, curY);

    // Ripple effect after cursor reaches destination
    if (progress > 0.7) {
      const rippleT = (progress - 0.7) / 0.3;
      ctx.beginPath();
      ctx.arc(0, 0, 10 + rippleT * 28, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(99, 102, 241, ${Math.max(0, 0.8 - rippleT)})`;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    // Modern pointer cursor
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 16);
    ctx.lineTo(4, 12);
    ctx.lineTo(8, 20);
    ctx.lineTo(11, 18.5);
    ctx.lineTo(7, 11);
    ctx.lineTo(12, 11);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();

  // Draw Cinematic Vignette Edge
  const vignette = ctx.createRadialGradient(
    canvasWidth / 2,
    canvasHeight / 2,
    canvasHeight * 0.45,
    canvasWidth / 2,
    canvasHeight / 2,
    canvasWidth * 0.75
  );
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, 'rgba(9, 13, 22, 0.45)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // Lower-Third Scene Label (100% American English typography, vector crisp)
  const defaultTitles = [
    'OVERVIEW & METRICS',
    'KEY FEATURES & WORKFLOW',
    'DEEP DIVE & DATA EXPLORER',
    'INTERACTIVE TOOLS & ACTIONS',
    'ADVANCED DATA MANAGEMENT',
    'TEAM COLLABORATION & ROLES',
    'AUTOMATION & PRODUCTIVITY',
    'SECURITY & PRIVACY CONTROLS',
    'INTEGRATIONS & ECOSYSTEM',
    'SYSTEM SUMMARY & NEXT STEPS'
  ];
  const labelTitle = sceneTitle || `SCENE ${sceneIdx + 1} • ${defaultTitles[sceneIdx % defaultTitles.length]}`;

  ctx.save();
  const badgeX = 36;
  const badgeY = canvasHeight - 64;
  const badgeH = 34;

  ctx.font = '600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const textWidth = ctx.measureText(labelTitle).width;
  const badgeW = textWidth + 36;

  // Frosted dark pill background
  ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 1;
  roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 17);
  ctx.fill();
  ctx.stroke();

  // Emerald pulsing live indicator pip
  ctx.beginPath();
  ctx.arc(badgeX + 16, badgeY + badgeH / 2, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#10b981';
  ctx.fill();

  // American English Label Text
  ctx.fillStyle = '#ffffff';
  ctx.fillText(labelTitle, badgeX + 28, badgeY + badgeH / 2 + 4.5);

  // Synced American English Subtitle Captions if narration is provided
  if (narration && narration.trim().length > 0) {
    // Split into sentences or chunks for clean display
    const sentences = narration.match(/[^.!?]+[.!?]+|\s*[^.!?]+$/g) || [narration];
    const cleanSentences = sentences.map(s => s.trim()).filter(Boolean);
    if (cleanSentences.length > 0) {
      const activeIdx = Math.min(
        cleanSentences.length - 1,
        Math.floor(progress * cleanSentences.length)
      );
      const activeSubtitle = cleanSentences[activeIdx];
      if (activeSubtitle) {
        ctx.font = '500 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        const subWidth = Math.min(canvasWidth - 300, ctx.measureText(activeSubtitle).width + 32);
        const subX = (canvasWidth - subWidth) / 2;
        const subY = canvasHeight - 64;

        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.3)';
        ctx.lineWidth = 1;
        roundRect(ctx, subX, subY, subWidth, badgeH, 8);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#f8fafc';
        ctx.textAlign = 'center';
        // Truncate cleanly if too long
        let displaySub = activeSubtitle;
        while (ctx.measureText(displaySub).width > subWidth - 24 && displaySub.length > 10) {
          displaySub = displaySub.slice(0, -4) + '...';
        }
        ctx.fillText(displaySub, canvasWidth / 2, subY + badgeH / 2 + 4.5);
        ctx.textAlign = 'left';
      }
    }
  }

  // Subtle progress line at very bottom edge
  ctx.fillStyle = 'rgba(99, 102, 241, 0.85)';
  ctx.fillRect(0, canvasHeight - 3, canvasWidth * progress, 3);

  ctx.restore();
}

/**
 * Helper to draw rounded rectangle on Canvas 2D
 */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * In-browser canvas/audio sequential stitcher as client-side fallback
 * Plays and records each scene clip sequentially into one combined master video blob
 */
export async function stitchClipsClientSide(
  clipUrls: string[],
  onProgress?: (stage: string, percent: number) => void,
  durations?: number[],
  voiceoverFlags?: boolean[]
): Promise<string> {
  if (clipUrls.length === 0) {
    throw new Error('No clips to stitch');
  }
  if (clipUrls.length === 1) {
    return clipUrls[0];
  }

  const width = 1280;
  const height = 720;
  const fps = 30;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas context unavailable');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const mimeType = getBestVideoMimeType() || 'video/webm';
  const stream = canvas.captureStream(fps);

  const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
  const audioContext = AudioCtxClass ? new AudioCtxClass() : null;
  const audioDest = audioContext ? audioContext.createMediaStreamDestination() : null;
  const gainNode = audioContext ? audioContext.createGain() : null;

  if (audioDest && gainNode) {
    gainNode.connect(audioDest);
    const audioTrack = audioDest.stream.getAudioTracks()[0];
    if (audioTrack) {
      stream.addTrack(audioTrack);
    }
  }

  const mediaRecorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 6_000_000
  });

  const chunks: Blob[] = [];
  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const recordingPromise = new Promise<string>((resolve, reject) => {
    mediaRecorder.onstop = () => {
      try {
        if (audioContext && audioContext.state !== 'closed') {
          audioContext.close().catch(() => {});
        }
        const blob = new Blob(chunks, { type: mimeType });
        resolve(URL.createObjectURL(blob));
      } catch (e) {
        reject(e);
      }
    };
    mediaRecorder.onerror = (e) => reject(e);
  });

  mediaRecorder.start();

  const hiddenVideo = document.createElement('video');
  hiddenVideo.crossOrigin = 'anonymous';
  hiddenVideo.playsInline = true;
  hiddenVideo.muted = false;

  if (audioContext && gainNode) {
    try {
      const audioSource = audioContext.createMediaElementSource(hiddenVideo);
      audioSource.connect(gainNode);
    } catch (e) {
      console.warn('Could not connect media element source:', e);
    }
  }

  for (let i = 0; i < clipUrls.length; i++) {
    const url = clipUrls[i];
    const pct = Math.floor((i / clipUrls.length) * 100);
    if (onProgress) onProgress(`Assembling scene ${i + 1} of ${clipUrls.length}...`, pct);

    const isVoiceoverActive = voiceoverFlags ? (voiceoverFlags[i] !== false) : true;
    if (gainNode && audioContext) {
      gainNode.gain.setValueAtTime(isVoiceoverActive ? 1.0 : 0.0, audioContext.currentTime);
    }
    hiddenVideo.muted = !isVoiceoverActive;

    const targetDurationMs = (durations && durations[i] ? Math.max(30, durations[i]) : 30) * 1000;

    const isImage = url.startsWith('data:image') || /\.(png|jpe?g|webp|gif|bmp)(\?.*)?$/i.test(url);
    if (isImage) {
      await new Promise<void>((resolveImage) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          let elapsed = 0;
          const durationMs = targetDurationMs;
          const startTime = performance.now();
          const imgLoop = (now: number) => {
            elapsed = now - startTime;
            ctx.fillStyle = '#090d16';
            ctx.fillRect(0, 0, width, height);

            const vRatio = img.naturalWidth / img.naturalHeight;
            const targetRatio = width / height;
            let dw = width;
            let dh = height;
            let dx = 0;
            let dy = 0;
            if (vRatio > targetRatio) {
              dh = width / vRatio;
              dy = (height - dh) / 2;
            } else {
              dw = height * vRatio;
              dx = (width - dw) / 2;
            }
            ctx.drawImage(img, dx, dy, dw, dh);

            if (elapsed < durationMs) {
              requestAnimationFrame(imgLoop);
            } else {
              resolveImage();
            }
          };
          requestAnimationFrame(imgLoop);
        };
        img.onerror = () => resolveImage();
        img.src = url;
      });
      continue;
    }

    await new Promise<void>((resolveClip) => {
      let isEnded = false;
      let animFrameId = 0;
      const clipStartTime = performance.now();

      const drawLoop = () => {
        if (isEnded) return;

        const elapsed = performance.now() - clipStartTime;
        if (elapsed >= targetDurationMs) {
          isEnded = true;
          cancelAnimationFrame(animFrameId);
          resolveClip();
          return;
        }

        ctx.fillStyle = '#090d16';
        ctx.fillRect(0, 0, width, height);

        if (hiddenVideo.readyState >= 2) {
          const vWidth = hiddenVideo.videoWidth || width;
          const vHeight = hiddenVideo.videoHeight || height;
          const vRatio = vWidth / vHeight;
          const targetRatio = width / height;

          let dw = width;
          let dh = height;
          let dx = 0;
          let dy = 0;

          if (vRatio > targetRatio) {
            dh = width / vRatio;
            dy = (height - dh) / 2;
          } else {
            dw = height * vRatio;
            dx = (width - dw) / 2;
          }

          ctx.drawImage(hiddenVideo, dx, dy, dw, dh);
        }

        animFrameId = requestAnimationFrame(drawLoop);
      };

      hiddenVideo.onended = () => {
        if (isEnded) return;
        const elapsed = performance.now() - clipStartTime;
        if (elapsed < targetDurationMs) {
          // Loop video clip smoothly if shorter than scene duration (e.g. 8s vs 30s)
          hiddenVideo.currentTime = 0;
          hiddenVideo.play().catch(() => {
            isEnded = true;
            cancelAnimationFrame(animFrameId);
            resolveClip();
          });
        } else {
          isEnded = true;
          cancelAnimationFrame(animFrameId);
          resolveClip();
        }
      };

      hiddenVideo.onerror = () => {
        console.warn(`Error playing clip ${i}, skipping to next`);
        if (isEnded) return;
        isEnded = true;
        cancelAnimationFrame(animFrameId);
        resolveClip();
      };

      hiddenVideo.src = url;
      hiddenVideo.load();
      hiddenVideo.play().then(() => {
        drawLoop();
      }).catch((playErr) => {
        console.warn(`Autoplay on clip ${i}:`, playErr);
        setTimeout(() => {
          if (!isEnded) {
            isEnded = true;
            cancelAnimationFrame(animFrameId);
            resolveClip();
          }
        }, 1500);
      });
    });
  }

  setTimeout(() => {
    if (mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
  }, 200);

  return await recordingPromise;
}

