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
  appDescription?: string;
  clipsCount: number;
  totalDuration: number;
  isRendered: boolean;
  combinedVideoUrl?: string;
  clips: any[];
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
  
  const cleanSessionData: SavedProjectSession = {
    id: sessionId,
    userId,
    ownerEmail: currentUser?.email || session.ownerEmail || "",
    ownerName: currentUser?.displayName || session.ownerName || (currentUser?.isAnonymous ? "Guest User" : "TourGenie Creator"),
    title: session.title || "TourGenie Project",
    appDescription: session.appDescription || "",
    clipsCount: session.clips?.length || 0,
    totalDuration: session.totalDuration || 0,
    isRendered: !!session.isRendered,
    combinedVideoUrl: session.combinedVideoUrl || "",
    youtubeMetadata: session.youtubeMetadata || null,
    sharedWithEmails: session.sharedWithEmails || [],
    sharedWithUids: session.sharedWithUids || [],
    isPublic: !!session.isPublic,
    clips: (session.clips || []).map((c: any, index: number) => ({
      id: c.id || `clip_${index}`,
      order: index,
      title: c.title || `Scene ${index + 1}`,
      duration: c.duration || 9,
      narration: c.narration || "",
      cameraMotion: c.cameraMotion || "Slow Zoom In",
      resolution: c.resolution || "1080p Full HD",
      screenshotUrl: c.screenshotUrl?.startsWith("data:") ? c.screenshotUrl : (c.rawScreenshot || c.screenshotUrl || ""),
      rawScreenshot: c.rawScreenshot || "",
      audioUrl: c.audioUrl || ""
    })),
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
      sessionsMap.set(d.id, d.data() as SavedProjectSession);
    });

    // Also check user subcollection for any older unmigrated records
    try {
      const userCol = collection(db, "users", userId, "sessions");
      const userSnap = await getDocs(userCol);
      userSnap.forEach((d) => {
        if (!sessionsMap.has(d.id)) {
          sessionsMap.set(d.id, d.data() as SavedProjectSession);
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
      sessions.push(d.data() as SavedProjectSession);
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
      sessions.push(d.data() as SavedProjectSession);
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
      return snap.data() as SavedProjectSession;
    }
    return null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `sessions/${sessionId}`);
  }
}

export async function shareSessionWithEmail(sessionId: string, email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();
  if (!normalizedEmail) return;
  try {
    const sessionRef = doc(db, "sessions", sessionId);
    await updateDoc(sessionRef, {
      sharedWithEmails: arrayUnion(normalizedEmail),
      updatedAt: serverTimestamp()
    });

    // Also update if mirrored in owner's subcollection
    const currentUid = auth.currentUser?.uid;
    if (currentUid) {
      try {
        const userSessionRef = doc(db, "users", currentUid, "sessions", sessionId);
        await updateDoc(userSessionRef, {
          sharedWithEmails: arrayUnion(normalizedEmail),
          updatedAt: serverTimestamp()
        });
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
    await updateDoc(sessionRef, {
      sharedWithEmails: arrayRemove(normalizedEmail),
      updatedAt: serverTimestamp()
    });

    const currentUid = auth.currentUser?.uid;
    if (currentUid) {
      try {
        const userSessionRef = doc(db, "users", currentUid, "sessions", sessionId);
        await updateDoc(userSessionRef, {
          sharedWithEmails: arrayRemove(normalizedEmail),
          updatedAt: serverTimestamp()
        });
      } catch (e) {
        // Ignore
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `sessions/${sessionId}`);
  }
}

export async function toggleSessionPublicAccess(sessionId: string, isPublic: boolean): Promise<void> {
  try {
    const sessionRef = doc(db, "sessions", sessionId);
    await updateDoc(sessionRef, {
      isPublic,
      updatedAt: serverTimestamp()
    });

    const currentUid = auth.currentUser?.uid;
    if (currentUid) {
      try {
        const userSessionRef = doc(db, "users", currentUid, "sessions", sessionId);
        await updateDoc(userSessionRef, {
          isPublic,
          updatedAt: serverTimestamp()
        });
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

export async function duplicateSharedSessionToMyAccount(
  sourceSession: SavedProjectSession, 
  newOwnerUserId: string
): Promise<string> {
  const newTitle = `${sourceSession.title} (Copy)`;
  return await saveUserSession(newOwnerUserId, {
    ...sourceSession,
    id: `session_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    title: newTitle,
    sharedWithEmails: [],
    isPublic: false
  });
}
