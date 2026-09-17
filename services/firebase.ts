import { initializeApp, getApps, getApp } from "firebase/app";
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signInAnonymously, 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut, 
  onAuthStateChanged,
  User 
} from "firebase/auth";
import { 
  getFirestore, 
  initializeFirestore,
  doc, 
  setDoc, 
  getDoc, 
  getDocFromServer,
  collection, 
  getDocs, 
  query, 
  where,
  orderBy, 
  deleteDoc, 
  serverTimestamp,
  updateDoc,
  arrayUnion,
  arrayRemove
} from "firebase/firestore";
import firebaseConfig from "../firebase-applet-config.json";
import { compressImageForStorage } from "./imageOptimizer";

// Ensure Google Authentication and Firestore use the authorized Firebase project configuration
export const effectiveFirebaseConfig = {
  ...firebaseConfig,
  projectId: firebaseConfig.projectId || "gen-lang-client-0102282465",
  authDomain: firebaseConfig.authDomain || "gen-lang-client-0102282465.firebaseapp.com",
  storageBucket: firebaseConfig.storageBucket || "gen-lang-client-0102282465.firebasestorage.app"
};

// Initialize Firebase
const app = getApps().length === 0 ? initializeApp(effectiveFirebaseConfig) : getApp();
export const auth = getAuth(app);

// Use the designated Firestore Database ID and enforce long-polling transport for iframe sandbox reliability
const dbId = (firebaseConfig as any).firestoreDatabaseId;
let dbInstance;
try {
  dbInstance = initializeFirestore(app, {
    experimentalForceLongPolling: true,
  }, dbId || undefined);
} catch {
  dbInstance = dbId 
    ? getFirestore(app, dbId)
    : getFirestore(app);
}
export const db = dbInstance;

// Standard Google Auth Provider for User Login
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

// Dedicated YouTube Auth Provider for YouTube Publishing flow
export const youtubeAuthProvider = new GoogleAuthProvider();
youtubeAuthProvider.addScope("https://www.googleapis.com/auth/youtube.upload");
youtubeAuthProvider.addScope("https://www.googleapis.com/auth/youtube.readonly");
youtubeAuthProvider.setCustomParameters({ prompt: "select_account" });

// Error handling conforming to Firebase Integration Skill
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

// Local Storage Fallback & Quota Management
const LOCAL_STORAGE_KEY = "tourgenie_local_sessions_v1";

let cloudQuotaExceeded = false;

export function isQuotaError(error: unknown): boolean {
  if (!error) return false;
  const msg = error instanceof Error ? error.message : String(error);
  const code = (error as any)?.code;
  return (
    code === 'resource-exhausted' ||
    msg.includes('resource-exhausted') ||
    msg.includes('Quota limit exceeded') ||
    msg.includes('Quota exceeded') ||
    msg.includes('Write stream exhausted') ||
    msg.includes('daily write units') ||
    msg.includes('maximum allowed queued writes')
  );
}

export function getCloudQuotaExceeded(): boolean {
  return cloudQuotaExceeded || typeof sessionStorage !== 'undefined' && sessionStorage.getItem("tourgenie_cloud_quota_exceeded") === "true";
}

export function setCloudQuotaExceeded(val: boolean): void {
  cloudQuotaExceeded = val;
  if (typeof sessionStorage !== 'undefined') {
    if (val) {
      sessionStorage.setItem("tourgenie_cloud_quota_exceeded", "true");
    } else {
      sessionStorage.removeItem("tourgenie_cloud_quota_exceeded");
    }
  }
}

export function getLocalSessions(): SavedProjectSession[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn("Could not read local sessions:", e);
    return [];
  }
}

export function saveLocalSession(session: SavedProjectSession): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const sessions = getLocalSessions();
    const idx = sessions.findIndex(s => s.id === session.id);
    if (idx >= 0) {
      sessions[idx] = { ...sessions[idx], ...session };
    } else {
      sessions.unshift(session);
    }
    // Cap at 25 most recent sessions
    const capped = sessions.slice(0, 25);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(capped));
  } catch (e) {
    console.warn("Could not save session to localStorage:", e);
  }
}

export function getLocalSessionById(id: string): SavedProjectSession | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const sessions = getLocalSessions();
    return sessions.find(s => s.id === id) || null;
  } catch {
    return null;
  }
}

export function updateLocalSession(id: string, updates: Partial<SavedProjectSession>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const sessions = getLocalSessions();
    const idx = sessions.findIndex(s => s.id === id);
    if (idx >= 0) {
      sessions[idx] = { ...sessions[idx], ...updates };
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(sessions));
    }
  } catch (e) {
    console.warn("Could not update local session:", e);
  }
}

export function removeLocalSession(id: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const sessions = getLocalSessions().filter(s => s.id !== id);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(sessions));
  } catch (e) {
    console.warn("Could not delete from local storage:", e);
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const isQuota = isQuotaError(error);
  const rawMsg = error instanceof Error ? error.message : String(error);

  if (isQuota) {
    setCloudQuotaExceeded(true);
    console.warn(`[TourGenie Firebase] Cloud database daily write quota reached for ${path}. Preserving changes in local storage.`);
    const friendlyMsg = "Cloud write quota reached: The daily free-tier limit for the cloud database is reached for today. Changes are safely saved locally and available for direct sharing.";
    const err = new Error(friendlyMsg);
    (err as any).isQuotaExceeded = true;
    (err as any).originalMessage = rawMsg;
    throw err;
  }

  const errInfo: FirestoreErrorInfo = {
    error: rawMsg,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Connection validation
export async function testConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn("Firestore connection check: client reported offline.");
    }
    return false;
  }
}
testConnection().catch(() => {});

export interface SavedProjectSession {
  id: string;
  userId: string;
  ownerEmail?: string;
  ownerName?: string;
  title: string;
  sessionName?: string;
  projectName?: string;
  appDescription?: string;
  appUrl?: string;
  script?: string;
  clipsCount: number;
  totalDuration: number;
  isRendered: boolean;
  combinedVideoUrl?: string;
  clips: any[];
  scenes?: any[];
  screenshots?: string[];
  youtubeMetadata?: any;
  sharedWithEmails?: string[];
  sharedWithUids?: string[];
  isPublic?: boolean;
  createdAt?: any;
  updatedAt?: any;
}

// Auth Helpers
export async function loginWithGoogle(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  const user = result.user;
  
  // Upsert user profile
  try {
    const userDocRef = doc(db, "users", user.uid);
    await setDoc(userDocRef, {
      userId: user.uid,
      email: user.email || null,
      displayName: user.displayName || "Google User",
      photoURL: user.photoURL || null,
      isAnonymous: false,
      lastLoginAt: serverTimestamp()
    }, { merge: true });
  } catch (err) {
    console.warn("Could not upsert user doc:", err);
  }
  
  return user;
}

export async function authorizeYouTubeChannel(): Promise<{ user: User; accessToken: string }> {
  const result = await signInWithPopup(auth, youtubeAuthProvider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  const accessToken = credential?.accessToken;
  if (!accessToken) {
    throw new Error("Unable to retrieve YouTube authorization. Please allow the Google popup and accept the requested YouTube permissions.");
  }
  return { user: result.user, accessToken };
}

export async function loginAsGuest(): Promise<User> {
  const result = await signInAnonymously(auth);
  const user = result.user;
  
  try {
    const userDocRef = doc(db, "users", user.uid);
    await setDoc(userDocRef, {
      userId: user.uid,
      displayName: "Guest User",
      isAnonymous: true,
      lastLoginAt: serverTimestamp()
    }, { merge: true });
  } catch (err) {
    console.warn("Could not upsert guest doc:", err);
  }
  
  return user;
}

export async function loginWithEmail(email: string, pass: string): Promise<User> {
  const result = await signInWithEmailAndPassword(auth, email, pass);
  return result.user;
}

export async function signupWithEmail(email: string, pass: string): Promise<User> {
  const result = await createUserWithEmailAndPassword(auth, email, pass);
  const user = result.user;
  try {
    const userDocRef = doc(db, "users", user.uid);
    await setDoc(userDocRef, {
      userId: user.uid,
      email: user.email || email,
      displayName: email.split("@")[0],
      isAnonymous: false,
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp()
    }, { merge: true });
  } catch (err) {
    console.warn("Could not create user profile doc:", err);
  }
  return user;
}

export async function logoutUser(): Promise<void> {
  await signOut(auth);
}

// Session Persistence Helpers
export async function getSessionAudio(sessionId: string, userId?: string): Promise<Record<string, string>> {
  try {
    const audioCol = collection(db, "sessions", sessionId, "audio");
    let snap = await getDocs(audioCol);
    if (snap.empty && userId) {
      try {
        const userAudioCol = collection(db, "users", userId, "sessions", sessionId, "audio");
        snap = await getDocs(userAudioCol);
      } catch (userAudioErr) {
        console.warn("Could not fetch user audio subcollection:", userAudioErr);
      }
    }

    const partsMap: Record<string, { totalParts: number; parts: string[] }> = {};
    const directMap: Record<string, string> = {};

    snap.forEach((d) => {
      const data = d.data();
      const rawDocId = d.id;
      // Strip part suffix if present (e.g. scene-0__p0 -> scene-0)
      const clipId = data?.clipId || rawDocId.replace(/__p\d+$/, "");

      if (typeof data?.data === 'string') {
        const total = typeof data.totalParts === 'number' ? data.totalParts : 1;
        const partIdx = typeof data.partIndex === 'number' ? data.partIndex : 0;
        if (!partsMap[clipId]) {
          partsMap[clipId] = { totalParts: total, parts: [] };
        }
        partsMap[clipId].parts[partIdx] = data.data;
      } else if (typeof data?.audioBase64 === 'string') {
        directMap[clipId] = data.audioBase64;
      }
    });

    const resultMap: Record<string, string> = { ...directMap };
    for (const [clipId, info] of Object.entries(partsMap)) {
      if (info.parts.length > 0) {
        const assembled = info.parts.filter(Boolean).join("");
        resultMap[clipId] = assembled;
        // Also map interchangeable hyphen/underscore variants
        if (clipId.includes('-')) {
          resultMap[clipId.replace(/-/g, '_')] = assembled;
        }
        if (clipId.includes('_')) {
          resultMap[clipId.replace(/_/g, '-')] = assembled;
        }
      }
    }
    return resultMap;
  } catch (err) {
    console.warn("Could not fetch session audio chunks:", err);
    return {};
  }
}

export async function saveUserSession(
  userId: string, 
  session: Omit<SavedProjectSession, "userId" | "createdAt" | "updatedAt"> & { sharedWithEmails?: string[]; isPublic?: boolean }
): Promise<string> {
  const sessionId = session.id || `session_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const currentUser = auth.currentUser;
  
  // 1. Process and compress screenshots (the authoritative image source)
  const rawScreenshots = session.screenshots || [];
  let processedScreenshots = await Promise.all(
    rawScreenshots.map(async (shot: string) => {
      if (shot?.startsWith("data:image")) {
        return await compressImageForStorage(shot, 640, 0.58);
      }
      return shot || "";
    })
  );

  // 2. Offload heavy audio (raw PCM TTS can be 1MB+ per clip) into audio subcollection documents
  // Chunking audio into <=400KB parts guarantees every document is strictly under Firestore's 1,048,576 byte limit
  const seenChunkIds = new Set<string>();
  const audioChunksToSave: Array<{ id: string; audioBase64: string }> = [];

  // Process clips: deduplicate images and strip bulky ephemeral data
  const rawClips = session.clips || [];
  const processedClips = await Promise.all(
    rawClips.map(async (c: any, index: number) => {
      const shotIndex = c.screenshotIndex !== undefined ? c.screenshotIndex : index;
      const matchingScreenshot = processedScreenshots[shotIndex] || "";
      const rawShot = c.screenshotUrl || c.rawScreenshot || (c.previewUrl?.startsWith("data:image") ? c.previewUrl : "") || "";
      
      // If clip has a unique screenshot not in processedScreenshots, compress it
      let compressedShot = "";
      if (rawShot && rawShot !== matchingScreenshot) {
        compressedShot = rawShot.startsWith("data:image") 
          ? await compressImageForStorage(rawShot, 640, 0.58) 
          : rawShot;
      }

      // Collect audio chunk for dedicated subcollection storage
      if (c.audioUrl && typeof c.audioUrl === 'string' && c.audioUrl.length > 100) {
        const chunkId = c.id || `clip_${index}`;
        if (!seenChunkIds.has(chunkId)) {
          seenChunkIds.add(chunkId);
          audioChunksToSave.push({ id: chunkId, audioBase64: c.audioUrl });
        }
      }

      return {
        id: c.id || `clip_${index}`,
        order: index,
        title: c.title || c.analysis || `Slide ${index + 1}`,
        duration: c.duration || 15,
        narration: c.narration || "",
        analysis: c.analysis || c.narration || "",
        cameraMotion: c.cameraMotion || "Slow Zoom In",
        resolution: c.resolution || "1080p Full HD",
        // Avoid duplicating large data URLs: reference screenshot or use lightweight compressed shot
        previewUrl: compressedShot ? "" : (c.previewUrl && !c.previewUrl.startsWith("blob:") && !c.previewUrl.startsWith("data:") ? c.previewUrl : ""),
        videoUrl: c.videoUrl && !c.videoUrl.startsWith("blob:") && !c.videoUrl.startsWith("data:") ? c.videoUrl : "",
        screenshotUrl: compressedShot,
        rawScreenshot: "", // Do not duplicate image data
        audioUrl: "", // Offloaded to subcollection / regenerated on the fly
        hasAudio: !!(c.audioUrl && c.audioUrl.length > 100),
        screenshotIndex: shotIndex,
        status: c.status || "ready"
      };
    })
  );

  // 3. Process scenes (if provided)
  const rawScenes = session.scenes || [];
  const processedScenes = rawScenes.map((s: any, index: number) => {
    const sceneShotIndex = s.screenshotIndex !== undefined ? s.screenshotIndex : index;
    if (s.audioUrl && typeof s.audioUrl === 'string' && s.audioUrl.length > 100) {
      const chunkId = s.id || `scene_${index}`;
      if (!seenChunkIds.has(chunkId)) {
        seenChunkIds.add(chunkId);
        audioChunksToSave.push({ id: chunkId, audioBase64: s.audioUrl });
      }
    }

    return {
      id: s.id || `scene_${index}`,
      timestamp: s.timestamp || `0:${(index * 15).toString().padStart(2, '0')}`,
      duration: s.duration || 15,
      visualPrompt: s.visualPrompt || s.title || `Slide ${index + 1}`,
      narration: s.narration || "",
      videoUrl: s.videoUrl && !s.videoUrl.startsWith("blob:") && !s.videoUrl.startsWith("data:") ? s.videoUrl : "",
      audioUrl: "", // Offloaded to subcollection
      hasAudio: !!(s.audioUrl && s.audioUrl.length > 100),
      screenshotIndex: sceneShotIndex,
      status: s.status || "completed"
    };
  });

  const totalDuration = session.totalDuration || processedClips.reduce((sum, c) => sum + (c.duration || 0), 0) || (processedScenes.length * 15);
  const clipsCount = Math.max(processedClips.length, processedScenes.length, processedScreenshots.length, session.clipsCount || 0);

  const effectiveSessionName = session.sessionName?.trim() || session.title?.trim() || "TourGenie Session";
  const effectiveProjectName = session.projectName?.trim() || "Default Project";

  // Sanitize combinedVideoUrl: never store blob URLs or massive base64 video in Firestore
  const safeCombinedVideoUrl = session.combinedVideoUrl && !session.combinedVideoUrl.startsWith("blob:") && !session.combinedVideoUrl.startsWith("data:")
    ? session.combinedVideoUrl
    : "";

  let cleanSessionData: SavedProjectSession = {
    id: sessionId,
    userId,
    ownerEmail: currentUser?.email || session.ownerEmail || "",
    ownerName: currentUser?.displayName || session.ownerName || (currentUser?.isAnonymous ? "Guest User" : "TourGenie Creator"),
    title: effectiveSessionName,
    sessionName: effectiveSessionName,
    projectName: effectiveProjectName,
    appDescription: session.appDescription || "",
    appUrl: session.appUrl || "",
    script: session.script || "",
    clipsCount,
    totalDuration,
    isRendered: !!session.isRendered,
    combinedVideoUrl: safeCombinedVideoUrl,
    youtubeMetadata: session.youtubeMetadata || null,
    sharedWithEmails: session.sharedWithEmails || [],
    sharedWithUids: session.sharedWithUids || [],
    isPublic: !!session.isPublic,
    clips: processedClips,
    scenes: processedScenes,
    screenshots: processedScreenshots,
    updatedAt: serverTimestamp()
  };

  // 4. Strict Document Size Guard (Firestore max: 1,048,576 bytes)
  let estimatedBytes = new Blob([JSON.stringify(cleanSessionData)]).size;
  if (estimatedBytes > 750_000) {
    console.warn(`[TourGenie] Session size ${estimatedBytes} bytes approaches 1MB limit. Running high-efficiency compression...`);
    // Re-compress screenshots aggressively (480px, 0.42 quality)
    cleanSessionData.screenshots = await Promise.all(
      cleanSessionData.screenshots.map(shot => 
        shot?.startsWith("data:image") ? compressImageForStorage(shot, 480, 0.42) : shot
      )
    );
    // Remove any per-clip screenshotUrl strings, letting them reference screenshots array
    cleanSessionData.clips = cleanSessionData.clips.map(c => ({
      ...c,
      screenshotUrl: "",
      previewUrl: ""
    }));
    estimatedBytes = new Blob([JSON.stringify(cleanSessionData)]).size;
    console.log(`[TourGenie] Reduced session size to ${estimatedBytes} bytes.`);
  }

  // Always save to local storage first (instant, 100% resilient)
  saveLocalSession(cleanSessionData);

  // Sync to server store for seamless cross-client and offline backup
  try {
    fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cleanSessionData)
    }).catch(() => {});
  } catch {}

  // If cloud write quota was previously reached today, preserve locally and return without stalling write streams
  if (getCloudQuotaExceeded()) {
    console.warn(`[TourGenie] Cloud quota reached today. Session ${sessionId} safely stored locally.`);
    return sessionId;
  }

  try {
    // Save clean root session document ONLY (single source of truth, eliminates duplicate write volume)
    const globalSessionRef = doc(db, "sessions", sessionId);
    await setDoc(globalSessionRef, cleanSessionData, { merge: true });

    // 5. Save heavy audio chunks to audio subcollections in parallel (single collection)
    if (audioChunksToSave.length > 0) {
      const MAX_AUDIO_PART_SIZE = 400_000;
      Promise.allSettled(
        audioChunksToSave.map(async (chunk) => {
          try {
            const rawAudio = chunk.audioBase64;
            if (!rawAudio) return;

            if (rawAudio.length <= MAX_AUDIO_PART_SIZE) {
              const audioDocRef = doc(db, "sessions", sessionId, "audio", chunk.id);
              await setDoc(audioDocRef, {
                clipId: chunk.id,
                partIndex: 0,
                totalParts: 1,
                data: rawAudio,
                audioBase64: rawAudio,
                updatedAt: serverTimestamp()
              }, { merge: true });
            } else {
              const totalParts = Math.ceil(rawAudio.length / MAX_AUDIO_PART_SIZE);
              for (let p = 0; p < totalParts; p++) {
                const partSlice = rawAudio.slice(p * MAX_AUDIO_PART_SIZE, (p + 1) * MAX_AUDIO_PART_SIZE);
                const partDocId = `${chunk.id}__p${p}`;
                const audioDocRef = doc(db, "sessions", sessionId, "audio", partDocId);
                await setDoc(audioDocRef, {
                  clipId: chunk.id,
                  partIndex: p,
                  totalParts,
                  data: partSlice,
                  updatedAt: serverTimestamp()
                }, { merge: true });
              }
            }
          } catch (audioErr) {
            if (isQuotaError(audioErr)) {
              setCloudQuotaExceeded(true);
            }
          }
        })
      ).catch(() => {});
    }

    return sessionId;
  } catch (error) {
    const rawMsg = error instanceof Error ? error.message : String(error);
    const isOffline = rawMsg.includes("client is offline") || rawMsg.includes("offline");
    if (isQuotaError(error) || isOffline) {
      if (isQuotaError(error)) setCloudQuotaExceeded(true);
      console.warn(`[TourGenie] Cloud database unavailable or offline (${rawMsg}). Session ${sessionId} safely preserved in local and server storage.`);
      return sessionId; // Do not crash the application!
    }
    handleFirestoreError(error, OperationType.WRITE, `sessions/${sessionId}`);
  }
}

export async function getUserSessions(userId: string): Promise<SavedProjectSession[]> {
  const sessionsMap = new Map<string, SavedProjectSession>();

  // 1. Load local sessions first (instant, works offline or under quota throttling)
  try {
    const local = getLocalSessions();
    local.forEach(s => {
      if (!s.userId || s.userId === userId || s.userId.startsWith('guest_') || userId.startsWith('guest_')) {
        sessionsMap.set(s.id, s);
      }
    });
  } catch (e) {
    console.warn("Could not read local sessions:", e);
  }

  // 2. Fetch from Server session store (resilient multi-client sync)
  try {
    const res = await fetch("/api/sessions");
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.sessions)) {
        data.sessions.forEach((s: SavedProjectSession) => {
          if (!s.userId || s.userId === userId || s.userId.startsWith('guest_') || userId.startsWith('guest_') || s.isPublic) {
            sessionsMap.set(s.id, s);
          }
        });
      }
    }
  } catch (e) {
    console.warn("Could not read server sessions:", e);
  }

  // 3. Fetch from Firestore if available
  try {
    const globalCol = collection(db, "sessions");
    const q = query(globalCol, where("userId", "==", userId));
    const snap = await getDocs(q);
    
    snap.forEach((d) => {
      const data = d.data() as SavedProjectSession;
      sessionsMap.set(d.id, {
        ...data,
        id: data?.id || d.id
      });
    });
  } catch (error) {
    const rawMsg = error instanceof Error ? error.message : String(error);
    const isOffline = rawMsg.includes("client is offline") || rawMsg.includes("offline");
    if (isQuotaError(error) || isOffline) {
      if (isQuotaError(error)) setCloudQuotaExceeded(true);
      console.warn(`[TourGenie] Firestore offline or throttled (${rawMsg}); returning local & server sessions.`);
    } else {
      console.warn("Could not query Firestore sessions:", error);
    }
  }

  const list = Array.from(sessionsMap.values());
  list.sort((a, b) => {
    const timeA = a.updatedAt?.seconds || (typeof a.updatedAt === 'number' ? a.updatedAt : 0);
    const timeB = b.updatedAt?.seconds || (typeof b.updatedAt === 'number' ? b.updatedAt : 0);
    return timeB - timeA;
  });
  return list;
}

export async function getSharedWithMeSessions(userEmail: string): Promise<SavedProjectSession[]> {
  if (!userEmail) return [];
  try {
    const globalCol = collection(db, "sessions");
    const q = query(globalCol, where("sharedWithEmails", "array-contains", userEmail.toLowerCase().trim()));
    const snap = await getDocs(q);
    const sessions: SavedProjectSession[] = [];
    snap.forEach((d) => {
      const data = d.data() as SavedProjectSession;
      sessions.push({
        ...data,
        id: data?.id || d.id
      });
    });
    return sessions;
  } catch (error) {
    const rawMsg = error instanceof Error ? error.message : String(error);
    if (rawMsg.includes("client is offline") || rawMsg.includes("offline")) {
      console.warn("[TourGenie] Shared sessions check skipped while offline.");
      return [];
    }
    handleFirestoreError(error, OperationType.LIST, `sessions?sharedWithEmails=${userEmail}`);
  }
}

export async function getPublicSessions(): Promise<SavedProjectSession[]> {
  try {
    const globalCol = collection(db, "sessions");
    const q = query(globalCol, where("isPublic", "==", true));
    const snap = await getDocs(q);
    const sessions: SavedProjectSession[] = [];
    snap.forEach((d) => {
      const data = d.data() as SavedProjectSession;
      sessions.push({
        ...data,
        id: data?.id || d.id
      });
    });
    return sessions;
  } catch (error) {
    const rawMsg = error instanceof Error ? error.message : String(error);
    if (rawMsg.includes("client is offline") || rawMsg.includes("offline")) {
      console.warn("[TourGenie] Public sessions check skipped while offline.");
      return [];
    }
    handleFirestoreError(error, OperationType.LIST, 'sessions?isPublic=true');
  }
}

export async function getSessionById(sessionId: string): Promise<SavedProjectSession | null> {
  // 1. Check local cache first (instant)
  const local = getLocalSessionById(sessionId);
  if (local) {
    return local;
  }

  // 2. Check server session store (resilient cross-client backend fallback)
  try {
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
    if (res.ok) {
      const serverData = await res.json();
      if (serverData && serverData.id) {
        saveLocalSession(serverData);
        return serverData;
      }
    }
  } catch (serverErr) {
    console.warn("[TourGenie] Server sessions lookup failed, trying Firestore:", serverErr);
  }

  // 3. Check Firestore cloud
  try {
    const sessionRef = doc(db, "sessions", sessionId);
    const snap = await getDoc(sessionRef);
    if (snap.exists()) {
      const data = snap.data() as SavedProjectSession;
      
      // Load any audio chunks saved in the subcollection in parallel
      try {
        const audioMap = await getSessionAudio(sessionId, data.userId);
        if (data.clips && Array.isArray(data.clips)) {
          data.clips = data.clips.map((c, idx) => {
            const audio = audioMap[c.id] || audioMap[`clip_${idx}`] || audioMap[`scene_${idx}`] || audioMap[`scene-${idx}`] || c.audioUrl || "";
            const shotIndex = c.screenshotIndex !== undefined ? c.screenshotIndex : idx;
            const shot = c.screenshotUrl || data.screenshots?.[shotIndex] || "";
            return { 
              ...c, 
              audioUrl: audio,
              screenshotUrl: shot,
              previewUrl: c.previewUrl || shot,
              rawScreenshot: c.rawScreenshot || shot
            };
          });
        }
        if (data.scenes && Array.isArray(data.scenes)) {
          data.scenes = data.scenes.map((s, idx) => {
            const audio = audioMap[s.id] || audioMap[`scene_${idx}`] || audioMap[`scene-${idx}`] || audioMap[`clip_${idx}`] || audioMap[s.id?.replace('scene_', 'clip_')] || audioMap[s.id?.replace('scene-', 'clip-')] || s.audioUrl || "";
            return { ...s, audioUrl: audio };
          });
        }
      } catch (subcollectionErr) {
        console.warn("[TourGenie] Could not load audio subcollection chunks:", subcollectionErr);
      }

      const fullSession: SavedProjectSession = {
        ...data,
        id: data?.id || snap.id
      };
      // Cache in local storage
      saveLocalSession(fullSession);
      return fullSession;
    }
    return null;
  } catch (error) {
    const rawMsg = error instanceof Error ? error.message : String(error);
    const isOffline = rawMsg.includes("client is offline") || rawMsg.includes("offline");
    if (isQuotaError(error) || isOffline) {
      if (isQuotaError(error)) setCloudQuotaExceeded(true);
      console.warn(`[TourGenie] Firestore offline or throttled (${rawMsg}) while fetching session ${sessionId}`);
      return local || null;
    }
    handleFirestoreError(error, OperationType.GET, `sessions/${sessionId}`);
  }
}

export async function shareSessionWithEmail(
  sessionId: string, 
  email: string, 
  fallbackSessionData?: SavedProjectSession | null
): Promise<{ success: boolean; cloudSynced: boolean; message?: string }> {
  const normalizedEmail = email.toLowerCase().trim();
  if (!normalizedEmail) return { success: false, cloudSynced: false, message: "Invalid email" };

  // 1. Always update local session first (instant, guaranteed)
  const existingLocal = getLocalSessionById(sessionId) || fallbackSessionData;
  const currentShared = existingLocal?.sharedWithEmails || [];
  const updatedShared = Array.from(new Set([...currentShared, normalizedEmail]));
  
  if (existingLocal) {
    updateLocalSession(sessionId, {
      ...existingLocal,
      sharedWithEmails: updatedShared
    });
  }

  // 2. If cloud quota is known to be exceeded, return success with notice (no write stream stall)
  if (getCloudQuotaExceeded()) {
    return {
      success: true,
      cloudSynced: false,
      message: "Collaborator added locally. (Cloud write quota reached for today; share via Direct Link or Export File)."
    };
  }

  // 3. Lightweight updateDoc: ONLY sends ~40 bytes of data (sharedWithEmails), NEVER massive clips!
  try {
    const sessionRef = doc(db, "sessions", sessionId);
    await updateDoc(sessionRef, {
      sharedWithEmails: arrayUnion(normalizedEmail),
      updatedAt: serverTimestamp()
    });
    return { success: true, cloudSynced: true };
  } catch (error: any) {
    if (isQuotaError(error)) {
      setCloudQuotaExceeded(true);
      return {
        success: true,
        cloudSynced: false,
        message: "Collaborator added locally. (Cloud database write quota reached; share via Direct Link or Export File)."
      };
    }

    // If document is not in cloud root yet (e.g. was saved locally), create a lightweight metadata doc
    if (error?.code === 'not-found' && fallbackSessionData) {
      try {
        const sessionRef = doc(db, "sessions", sessionId);
        await setDoc(sessionRef, {
          id: sessionId,
          userId: fallbackSessionData.userId || auth.currentUser?.uid || 'guest',
          title: fallbackSessionData.title || fallbackSessionData.sessionName || "Tour",
          sharedWithEmails: updatedShared,
          isPublic: !!fallbackSessionData.isPublic,
          updatedAt: serverTimestamp()
        }, { merge: true });
        return { success: true, cloudSynced: true };
      } catch (err2) {
        if (isQuotaError(err2)) {
          setCloudQuotaExceeded(true);
          return {
            success: true,
            cloudSynced: false,
            message: "Collaborator added locally. (Cloud write quota reached; share via Direct Link or Export File)."
          };
        }
      }
    }

    handleFirestoreError(error, OperationType.UPDATE, `sessions/${sessionId}`);
  }
}

export async function unshareSessionWithEmail(sessionId: string, email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();
  const existingLocal = getLocalSessionById(sessionId);
  if (existingLocal && existingLocal.sharedWithEmails) {
    updateLocalSession(sessionId, {
      ...existingLocal,
      sharedWithEmails: existingLocal.sharedWithEmails.filter(e => e.toLowerCase() !== normalizedEmail)
    });
  }

  if (getCloudQuotaExceeded()) return;

  try {
    const sessionRef = doc(db, "sessions", sessionId);
    await updateDoc(sessionRef, {
      sharedWithEmails: arrayRemove(normalizedEmail),
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    if (isQuotaError(error)) {
      setCloudQuotaExceeded(true);
      return;
    }
    handleFirestoreError(error, OperationType.UPDATE, `sessions/${sessionId}`);
  }
}

export async function toggleSessionPublicAccess(
  sessionId: string, 
  isPublic: boolean,
  fallbackSessionData?: SavedProjectSession | null
): Promise<{ success: boolean; cloudSynced: boolean; message?: string }> {
  // 1. Update local session
  const existingLocal = getLocalSessionById(sessionId) || fallbackSessionData;
  if (existingLocal) {
    updateLocalSession(sessionId, {
      ...existingLocal,
      isPublic
    });
  }

  if (getCloudQuotaExceeded()) {
    return { success: true, cloudSynced: false, message: "Visibility updated locally." };
  }

  // 2. Lightweight updateDoc (only ~30 bytes)
  try {
    const sessionRef = doc(db, "sessions", sessionId);
    await updateDoc(sessionRef, {
      isPublic,
      updatedAt: serverTimestamp()
    });
    return { success: true, cloudSynced: true };
  } catch (error) {
    if (isQuotaError(error)) {
      setCloudQuotaExceeded(true);
      return { success: true, cloudSynced: false, message: "Visibility updated locally." };
    }
    if ((error as any)?.code === 'not-found' && fallbackSessionData) {
      try {
        const sessionRef = doc(db, "sessions", sessionId);
        await setDoc(sessionRef, {
          id: sessionId,
          userId: fallbackSessionData.userId || auth.currentUser?.uid || 'guest',
          title: fallbackSessionData.title || fallbackSessionData.sessionName || "Tour",
          isPublic,
          updatedAt: serverTimestamp()
        }, { merge: true });
        return { success: true, cloudSynced: true };
      } catch (e2) {
        if (isQuotaError(e2)) {
          setCloudQuotaExceeded(true);
          return { success: true, cloudSynced: false, message: "Visibility updated locally." };
        }
      }
    }
    handleFirestoreError(error, OperationType.UPDATE, `sessions/${sessionId}`);
  }
}

export async function deleteUserSession(userId: string, sessionId: string): Promise<void> {
  // Always remove locally first
  removeLocalSession(sessionId);

  // Remove from server store
  try {
    fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" }).catch(() => {});
  } catch {}

  if (getCloudQuotaExceeded()) return;

  try {
    const globalSessionRef = doc(db, "sessions", sessionId);
    await deleteDoc(globalSessionRef);
  } catch (error) {
    const rawMsg = error instanceof Error ? error.message : String(error);
    if (isQuotaError(error) || rawMsg.includes("client is offline") || rawMsg.includes("offline")) {
      return;
    }
    handleFirestoreError(error, OperationType.DELETE, `sessions/${sessionId}`);
  }
}

export async function updateSessionOrganization(
  userId: string,
  sessionId: string,
  updates: { sessionName?: string; projectName?: string }
): Promise<void> {
  // Update local session
  updateLocalSession(sessionId, updates);

  // Update server session if available
  try {
    const local = getLocalSessionById(sessionId);
    if (local) {
      fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(local)
      }).catch(() => {});
    }
  } catch {}

  if (getCloudQuotaExceeded()) return;

  const cleanUpdates: Record<string, any> = {
    updatedAt: serverTimestamp()
  };
  if (updates.sessionName !== undefined) {
    const trimmed = updates.sessionName.trim() || "TourGenie Session";
    cleanUpdates.sessionName = trimmed;
    cleanUpdates.title = trimmed;
  }
  if (updates.projectName !== undefined) {
    cleanUpdates.projectName = updates.projectName.trim() || "Default Project";
  }

  try {
    const globalRef = doc(db, "sessions", sessionId);
    await updateDoc(globalRef, cleanUpdates);
  } catch (error) {
    if (isQuotaError(error)) {
      setCloudQuotaExceeded(true);
      return;
    }
    handleFirestoreError(error, OperationType.UPDATE, `sessions/${sessionId}`);
  }
}

export async function duplicateSharedSessionToMyAccount(
  sourceSession: SavedProjectSession, 
  newOwnerUserId: string
): Promise<string> {
  const newName = `${sourceSession.sessionName || sourceSession.title} (Copy)`;
  return await saveUserSession(newOwnerUserId, {
    ...sourceSession,
    id: `session_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    title: newName,
    sessionName: newName,
    projectName: sourceSession.projectName || "Default Project",
    sharedWithEmails: [],
    isPublic: false
  });
}
