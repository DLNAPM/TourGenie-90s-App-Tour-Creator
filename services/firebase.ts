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
export async function saveUserSession(
  userId: string, 
  session: Omit<SavedProjectSession, "userId" | "createdAt" | "updatedAt"> & { sharedWithEmails?: string[]; isPublic?: boolean }
): Promise<string> {
  const sessionId = session.id || `session_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const currentUser = auth.currentUser;
  
  // 1. Process clips with image compression and robust field mapping
  const rawClips = session.clips || [];
  const processedClips = await Promise.all(
    rawClips.map(async (c: any, index: number) => {
      const screenshot = c.screenshotUrl || c.rawScreenshot || (c.previewUrl?.startsWith("data:image") ? c.previewUrl : "") || "";
      const compressedShot = screenshot.startsWith("data:image") ? await compressImageForStorage(screenshot) : screenshot;
      
      return {
        id: c.id || `clip_${index}`,
        order: index,
        title: c.title || c.analysis || `Slide ${index + 1}`,
        duration: c.duration || 15,
        narration: c.narration || "",
        analysis: c.analysis || c.narration || "",
        cameraMotion: c.cameraMotion || "Slow Zoom In",
        resolution: c.resolution || "1080p Full HD",
        previewUrl: c.previewUrl || c.videoUrl || compressedShot || "",
        videoUrl: c.videoUrl || "",
        screenshotUrl: compressedShot,
        rawScreenshot: compressedShot,
        audioUrl: c.audioUrl || "",
        status: c.status || "ready"
      };
    })
  );

  // 2. Process scenes (if provided)
  const rawScenes = session.scenes || [];
  const processedScenes = rawScenes.map((s: any, index: number) => ({
    id: s.id || `scene_${index}`,
    timestamp: s.timestamp || `0:${(index * 15).toString().padStart(2, '0')}`,
    duration: s.duration || 15,
    visualPrompt: s.visualPrompt || s.title || `Slide ${index + 1}`,
    narration: s.narration || "",
    videoUrl: s.videoUrl || "",
    audioUrl: s.audioUrl || "",
    screenshotIndex: s.screenshotIndex !== undefined ? s.screenshotIndex : index,
    status: s.status || "completed"
  }));

  // 3. Process screenshots (if provided)
  const rawScreenshots = session.screenshots || [];
  const processedScreenshots = await Promise.all(
    rawScreenshots.map(async (shot: string) => {
      if (shot?.startsWith("data:image")) {
        return await compressImageForStorage(shot);
      }
      return shot || "";
    })
  );

  const totalDuration = session.totalDuration || processedClips.reduce((sum, c) => sum + (c.duration || 0), 0) || (processedScenes.length * 15);
  const clipsCount = Math.max(processedClips.length, processedScenes.length, processedScreenshots.length, session.clipsCount || 0);

  const effectiveSessionName = session.sessionName?.trim() || session.title?.trim() || "TourGenie Session";
  const effectiveProjectName = session.projectName?.trim() || "Default Project";

  const cleanSessionData: SavedProjectSession = {
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
    combinedVideoUrl: session.combinedVideoUrl || "",
    youtubeMetadata: session.youtubeMetadata || null,
    sharedWithEmails: session.sharedWithEmails || [],
    sharedWithUids: session.sharedWithUids || [],
    isPublic: !!session.isPublic,
    clips: processedClips,
    scenes: processedScenes,
    screenshots: processedScreenshots,
    updatedAt: serverTimestamp()
  };

  try {
    // Save to shared top-level collection
    const globalSessionRef = doc(db, "sessions", sessionId);
    await setDoc(globalSessionRef, cleanSessionData, { merge: true });

    // Also mirror to user subcollection for fast local retrieval
    const userSessionRef = doc(db, "users", userId, "sessions", sessionId);
    await setDoc(userSessionRef, cleanSessionData, { merge: true });

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
