/**
 * Image optimization utilities for cloud persistence.
 * Resizes and compresses base64 data URLs to ensure documents stay well within Firestore's 1MB limit.
 */

export async function compressImageForStorage(
  dataUrl: string,
  maxDimension = 960,
  quality = 0.72
): Promise<string> {
  if (!dataUrl) return "";

  // If already an HTTP/HTTPS remote URL or blob URL, or not an image data URL, return as-is
  if (!dataUrl.startsWith("data:image")) {
    return dataUrl;
  }

  // If already small (< 65KB base64), no need to compress further
  if (dataUrl.length < 85_000) {
    return dataUrl;
  }

  // If running in an environment without DOM/Image support, return dataUrl
  if (typeof window === "undefined" || typeof document === "undefined") {
    return dataUrl;
  }

  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          let { width, height } = img;
          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }

          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, width);
          canvas.height = Math.max(1, height);
          const ctx = canvas.getContext("2d");

          if (!ctx) {
            resolve(dataUrl);
            return;
          }

          ctx.drawImage(img, 0, 0, width, height);
          const compressed = canvas.toDataURL("image/jpeg", quality);
          resolve(compressed);
        } catch {
          resolve(dataUrl);
        }
      };

      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    } catch {
      resolve(dataUrl);
    }
  });
}
