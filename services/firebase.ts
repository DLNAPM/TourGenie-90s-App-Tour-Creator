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

// Initialize Firebase
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);

// Use the designated Firestore Database ID
export const db = firebaseConfig.firestoreDatabaseId 
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

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

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
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
export async function getSessionAudio(sessionId: string): Promise<Record<string, string>> {
  try {
    const audioCol = collection(db, "sessions", sessionId, "audio");
    const snap = await getDocs(audioCol);
    const map: Record<string, string> = {};
    snap.forEach((d) => {
      const data = d.data();
      if (data?.audioBase64) {
        map[d.id] = data.audioBase64;
      }
    });
    return map;
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
  // Each subcollection doc gets its own 1MB limit, keeping the main session doc tiny (~100KB)
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
        audioChunksToSave.push({ id: chunkId, audioBase64: c.audioUrl });
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
      audioChunksToSave.push({ id: chunkId, audioBase64: s.audioUrl });
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

  try {
    // Save clean root session document
    const globalSessionRef = doc(db, "sessions", sessionId);
    await setDoc(globalSessionRef, cleanSessionData, { merge: true });

    // Mirror to user subcollection
    const userSessionRef = doc(db, "users", userId, "sessions", sessionId);
    await setDoc(userSessionRef, cleanSessionData, { merge: true });

    // 5. Save heavy audio chunks to audio subcollections in parallel (non-blocking)
    if (audioChunksToSave.length > 0) {
      Promise.allSettled(
        audioChunksToSave.map(async (chunk) => {
          try {
            const audioDocRef = doc(db, "sessions", sessionId, "audio", chunk.id);
            await setDoc(audioDocRef, {
              clipId: chunk.id,
              audioBase64: chunk.audioBase64,
              updatedAt: serverTimestamp()
            }, { merge: true });

            if (userId) {
              const userAudioDocRef = doc(db, "users", userId, "sessions", sessionId, "audio", chunk.id);
              await setDoc(userAudioDocRef, {
                clipId: chunk.id,
                audioBase64: chunk.audioBase64,
                updatedAt: serverTimestamp()
              }, { merge: true });
            }
          } catch (audioErr) {
            console.warn(`Could not save audio chunk ${chunk.id}:`, audioErr);
          }
        })
      ).catch(() => {});
    }

    return sessionId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `sessions/${sessionId}`);
  }
}

export async function getUserSessions(userId: string): Promise<SavedProjectSession[]> {
  try {
    const globalCol = collection(db, "sessions");
    const q = query(globalCol, where("userId", "==", userId));
    const snap = await getDocs(q);
    const sessionsMap = new Map<string, SavedProjectSession>();
    
    snap.forEach((d) => {
      const data = d.data() as SavedProjectSession;
      sessionsMap.set(d.id, {
        ...data,
        id: data?.id || d.id
      });
    });

    // Also check user subcollection for any older unmigrated records
    try {
      const userCol = collection(db, "users", userId, "sessions");
      const userSnap = await getDocs(userCol);
      userSnap.forEach((d) => {
        if (!sessionsMap.has(d.id)) {
          const data = d.data() as SavedProjectSession;
          sessionsMap.set(d.id, {
            ...data,
            id: data?.id || d.id
          });
        }
      });
    } catch (e) {
      // Non-fatal
    }

    const list = Array.from(sessionsMap.values());
    list.sort((a, b) => {
      const timeA = a.updatedAt?.seconds || (typeof a.updatedAt === 'number' ? a.updatedAt : 0);
      const timeB = b.updatedAt?.seconds || (typeof b.updatedAt === 'number' ? b.updatedAt : 0);
      return timeB - timeA;
    });
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, `sessions?userId=${userId}`);
  }
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
    handleFirestoreError(error, OperationType.LIST, 'sessions?isPublic=true');
  }
}

export async function getSessionById(sessionId: string): Promise<SavedProjectSession | null> {
  try {
    const sessionRef = doc(db, "sessions", sessionId);
    const snap = await getDoc(sessionRef);
    if (snap.exists()) {
      const data = snap.data() as SavedProjectSession;
      
      // Load any audio chunks saved in the subcollection in parallel
      try {
        const audioMap = await getSessionAudio(sessionId);
        if (data.clips && Array.isArray(data.clips)) {
          data.clips = data.clips.map((c, idx) => {
            const audio = audioMap[c.id] || audioMap[`clip_${idx}`] || c.audioUrl || "";
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
            const audio = audioMap[s.id] || audioMap[`scene_${idx}`] || audioMap[s.id?.replace('scene_', 'clip_')] || s.audioUrl || "";
            return { ...s, audioUrl: audio };
          });
        }
      } catch (subcollectionErr) {
        console.warn("[TourGenie] Could not load audio subcollection chunks:", subcollectionErr);
      }

      return {
        ...data,
        id: data?.id || snap.id
      };
    }
    return null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `sessions/${sessionId}`);
  }
}

export async function shareSessionWithEmail(
  sessionId: string, 
  email: string, 
  fallbackSessionData?: SavedProjectSession | null
): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();
  if (!normalizedEmail) return;
  const currentUid = auth.currentUser?.uid;
  const currentEmail = auth.currentUser?.email;

  try {
    const sessionRef = doc(db, "sessions", sessionId);
    const updatePayload: Record<string, any> = {
      id: sessionId,
      sharedWithEmails: arrayUnion(normalizedEmail),
      updatedAt: serverTimestamp()
    };

    // If fallback session data was provided (e.g. from user state or older subcollection),
    // ensure base properties exist so document creation succeeds if missing in top-level collection
    if (fallbackSessionData) {
      if (fallbackSessionData.title) updatePayload.title = fallbackSessionData.title;
      if (fallbackSessionData.userId) updatePayload.userId = fallbackSessionData.userId;
      else if (currentUid) updatePayload.userId = currentUid;
      if (fallbackSessionData.ownerEmail) updatePayload.ownerEmail = fallbackSessionData.ownerEmail;
      else if (currentEmail) updatePayload.ownerEmail = currentEmail;
      if (fallbackSessionData.clips) updatePayload.clips = fallbackSessionData.clips;
      if (fallbackSessionData.clipsCount !== undefined) updatePayload.clipsCount = fallbackSessionData.clipsCount;
      if (fallbackSessionData.totalDuration !== undefined) updatePayload.totalDuration = fallbackSessionData.totalDuration;
      if (fallbackSessionData.isRendered !== undefined) updatePayload.isRendered = fallbackSessionData.isRendered;
      if (fallbackSessionData.combinedVideoUrl) updatePayload.combinedVideoUrl = fallbackSessionData.combinedVideoUrl;
    } else if (currentUid) {
      updatePayload.userId = currentUid;
      if (currentEmail) updatePayload.ownerEmail = currentEmail;
    }

    await setDoc(sessionRef, updatePayload, { merge: true });

    // Also update if mirrored in owner's subcollection
    if (currentUid) {
      try {
        const userSessionRef = doc(db, "users", currentUid, "sessions", sessionId);
        await setDoc(userSessionRef, {
          sharedWithEmails: arrayUnion(normalizedEmail),
          updatedAt: serverTimestamp()
        }, { merge: true });
      } catch (e) {
        // Ignored if user doc was not yet mirrored
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `sessions/${sessionId}`);
  }
}

export async function unshareSessionWithEmail(sessionId: string, email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();
  try {
    const sessionRef = doc(db, "sessions", sessionId);
    await setDoc(sessionRef, {
      sharedWithEmails: arrayRemove(normalizedEmail),
      updatedAt: serverTimestamp()
    }, { merge: true });

    const currentUid = auth.currentUser?.uid;
    if (currentUid) {
      try {
        const userSessionRef = doc(db, "users", currentUid, "sessions", sessionId);
        await setDoc(userSessionRef, {
          sharedWithEmails: arrayRemove(normalizedEmail),
          updatedAt: serverTimestamp()
        }, { merge: true });
      } catch (e) {
        // Ignore
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `sessions/${sessionId}`);
  }
}

export async function toggleSessionPublicAccess(
  sessionId: string, 
  isPublic: boolean,
  fallbackSessionData?: SavedProjectSession | null
): Promise<void> {
  const currentUid = auth.currentUser?.uid;
  const currentEmail = auth.currentUser?.email;

  try {
    const sessionRef = doc(db, "sessions", sessionId);
    const updatePayload: Record<string, any> = {
      id: sessionId,
      isPublic,
      updatedAt: serverTimestamp()
    };

    if (fallbackSessionData) {
      if (fallbackSessionData.title) updatePayload.title = fallbackSessionData.title;
      if (fallbackSessionData.userId) updatePayload.userId = fallbackSessionData.userId;
      else if (currentUid) updatePayload.userId = currentUid;
      if (fallbackSessionData.ownerEmail) updatePayload.ownerEmail = fallbackSessionData.ownerEmail;
      else if (currentEmail) updatePayload.ownerEmail = currentEmail;
      if (fallbackSessionData.clips) updatePayload.clips = fallbackSessionData.clips;
    } else if (currentUid) {
      updatePayload.userId = currentUid;
      if (currentEmail) updatePayload.ownerEmail = currentEmail;
    }

    await setDoc(sessionRef, updatePayload, { merge: true });

    if (currentUid) {
      try {
        const userSessionRef = doc(db, "users", currentUid, "sessions", sessionId);
        await setDoc(userSessionRef, {
          isPublic,
          updatedAt: serverTimestamp()
        }, { merge: true });
      } catch (e) {
        // Ignore
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `sessions/${sessionId}`);
  }
}

export async function deleteUserSession(userId: string, sessionId: string): Promise<void> {
  try {
    const globalSessionRef = doc(db, "sessions", sessionId);
    await deleteDoc(globalSessionRef);

    const sessionRef = doc(db, "users", userId, "sessions", sessionId);
    await deleteDoc(sessionRef);

    // Clean up audio subcollection documents in background
    try {
      const audioCol = collection(db, "sessions", sessionId, "audio");
      const audioSnap = await getDocs(audioCol);
      await Promise.allSettled(audioSnap.docs.map(d => deleteDoc(d.ref)));
    } catch {
      // Non-critical
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `sessions/${sessionId}`);
  }
}

export async function updateSessionOrganization(
  userId: string,
  sessionId: string,
  updates: { sessionName?: string; projectName?: string }
): Promise<void> {
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

    if (userId) {
      try {
        const userRef = doc(db, "users", userId, "sessions", sessionId);
        await updateDoc(userRef, cleanUpdates);
      } catch (e) {
        // User subcollection might be absent or mirrored
      }
    }
  } catch (error) {
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
