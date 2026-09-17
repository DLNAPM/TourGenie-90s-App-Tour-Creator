export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly"
];

export interface YouTubeChannelInfo {
  id: string;
  title: string;
  customUrl?: string;
  avatarUrl?: string;
  description?: string;
  subscriberCount?: string;
  videoCount?: string;
}

export interface YouTubeUploadParams {
  videoBlob: Blob;
  title: string;
  description: string;
  tags?: string[];
  privacyStatus: 'unlisted' | 'public' | 'private';
  accessToken: string;
  onProgress?: (percent: number, stage: string) => void;
}

export interface YouTubeUploadResult {
  videoId: string;
  videoUrl: string;
  title: string;
  privacyStatus: string;
}

// In-memory token storage (never persisted to localStorage/sessionStorage per security guidelines)
let inMemoryAccessToken: string | null = null;
let inMemoryChannelInfo: YouTubeChannelInfo | null = null;

export function getCachedYouTubeToken(): string | null {
  return inMemoryAccessToken;
}

export function setCachedYouTubeToken(token: string | null): void {
  inMemoryAccessToken = token;
  if (!token) {
    inMemoryChannelInfo = null;
  }
}

export function getCachedChannelInfo(): YouTubeChannelInfo | null {
  return inMemoryChannelInfo;
}

export function setCachedChannelInfo(info: YouTubeChannelInfo | null): void {
  inMemoryChannelInfo = info;
}

/**
 * Fetch the authenticated user's YouTube channel profile
 */
export async function fetchMyYouTubeChannel(accessToken: string): Promise<YouTubeChannelInfo | null> {
  try {
    const res = await fetch("/api/youtube-channel", {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${res.status} retrieving YouTube channel`);
    }

    const data = await res.json();
    const item = data.items?.[0];
    if (!item) {
      return null;
    }

    const channelInfo: YouTubeChannelInfo = {
      id: item.id,
      title: item.snippet?.title || "My Channel",
      customUrl: item.snippet?.customUrl,
      avatarUrl: item.snippet?.thumbnails?.default?.url || item.snippet?.thumbnails?.medium?.url,
      description: item.snippet?.description,
      subscriberCount: item.statistics?.subscriberCount,
      videoCount: item.statistics?.videoCount
    };

    inMemoryChannelInfo = channelInfo;
    return channelInfo;
  } catch (err) {
    console.error("Failed to fetch YouTube channel:", err);
    throw err;
  }
}

/**
 * Upload a video file to YouTube via the server-side proxy
 */
export async function uploadVideoToYouTube({
  videoBlob,
  title,
  description,
  tags = [],
  privacyStatus = 'unlisted',
  accessToken,
  onProgress
}: YouTubeUploadParams): Promise<YouTubeUploadResult> {
  if (!accessToken) {
    throw new Error("No YouTube OAuth access token available. Please sign in with your Google Account.");
  }

  const maxAttempts = 2;
  let lastError: any = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (attempt > 1) {
        onProgress?.(20, "Retrying master video upload to YouTube Data API...");
        await new Promise(r => setTimeout(r, 2000));
      } else {
        onProgress?.(15, "Preparing master video payload...");
      }

      const formData = new FormData();
      formData.append("video", videoBlob, "master-tour.mp4");
      formData.append("title", title);
      formData.append("description", description);
      formData.append("tags", JSON.stringify(tags));
      formData.append("privacyStatus", privacyStatus);

      onProgress?.(35, "Streaming video to YouTube broadcast pipeline...");

      const res = await fetch("/api/youtube-upload", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`
        },
        body: formData
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const rawMessage = errData.error || `YouTube upload failed with status ${res.status}`;

        if ((res.status === 502 || res.status === 503 || res.status === 504) && attempt < maxAttempts) {
          console.warn(`[YouTube Upload] Gateway temporarily busy (${res.status}), retrying attempt ${attempt + 1}/${maxAttempts}...`);
          onProgress?.(30, `YouTube gateway busy (${res.status}), automatically retrying upload...`);
          continue;
        }

        let friendlyMessage = rawMessage;
        if (res.status === 502) {
          friendlyMessage = "YouTube upload gateway was temporarily unavailable (502 Bad Gateway). Please ensure your video is valid and try clicking Publish again.";
        } else if (res.status === 401) {
          friendlyMessage = "Your Google session has expired. Please disconnect and reconnect your YouTube account.";
        }
        throw new Error(friendlyMessage);
      }

      onProgress?.(90, "Finalizing broadcast metadata and registering video...");
      const result: YouTubeUploadResult = await res.json();
      onProgress?.(100, "Successfully published to YouTube!");
      return result;
    } catch (err: any) {
      lastError = err;
      if (attempt >= maxAttempts || (err.message && err.message.includes("Google session has expired"))) {
        throw err;
      }
      console.warn(`[YouTube Upload] Attempt ${attempt} failed, retrying...`, err);
    }
  }

  throw lastError || new Error("YouTube upload failed after multiple attempts.");
}
