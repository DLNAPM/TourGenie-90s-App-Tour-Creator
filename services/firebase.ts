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
  collection, 
  getDocs, 
  query, 
  orderBy, 
  deleteDoc, 
  serverTimestamp 
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

export interface SavedProjectSession {
  id: string;
  userId: string;
  title: string;
  appDescription?: string;
  clipsCount: number;
  totalDuration: number;
  isRendered: boolean;
  combinedVideoUrl?: string;
  clips: any[];
  youtubeMetadata?: any;
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
export async function saveUserSession(userId: string, session: Omit<SavedProjectSession, "userId" | "createdAt" | "updatedAt">): Promise<string> {
  const sessionId = session.id || `session_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const sessionRef = doc(db, "users", userId, "sessions", sessionId);
  
  const cleanSessionData: any = {
    id: sessionId,
    userId,
    title: session.title || "TourGenie Project",
    appDescription: session.appDescription || "",
    clipsCount: session.clips?.length || 0,
    totalDuration: session.totalDuration || 0,
    isRendered: !!session.isRendered,
    combinedVideoUrl: session.combinedVideoUrl || "",
    youtubeMetadata: session.youtubeMetadata || null,
    // Store clip configuration (sanitize blob URLs since blob URLs are temporary to the current tab)
    clips: (session.clips || []).map((c: any, index: number) => ({
      id: c.id || `clip_${index}`,
      order: index,
      title: c.title || `Scene ${index + 1}`,
      duration: c.duration || 9,
      narration: c.narration || "",
      cameraMotion: c.cameraMotion || "Slow Zoom In",
      resolution: c.resolution || "1080p Full HD",
      // Save screenshot base64 or source if available
      screenshotUrl: c.screenshotUrl?.startsWith("data:") ? c.screenshotUrl : (c.rawScreenshot || c.screenshotUrl || ""),
      rawScreenshot: c.rawScreenshot || "",
      // Retain previewUrl if it's not a temporary blob, or keep audioUrl
      audioUrl: c.audioUrl || ""
    })),
    updatedAt: serverTimestamp()
  };

  await setDoc(sessionRef, cleanSessionData, { merge: true });
  return sessionId;
}

export async function getUserSessions(userId: string): Promise<SavedProjectSession[]> {
  const sessionsCol = collection(db, "users", userId, "sessions");
  const q = query(sessionsCol, orderBy("updatedAt", "desc"));
  
  try {
    const snap = await getDocs(q);
    const sessions: SavedProjectSession[] = [];
    snap.forEach((d) => {
      sessions.push(d.data() as SavedProjectSession);
    });
    return sessions;
  } catch (err) {
    // If composite index is pending, fallback to un-ordered query
    console.warn("Ordered query failed, falling back to direct collection fetch:", err);
    const snap = await getDocs(sessionsCol);
    const sessions: SavedProjectSession[] = [];
    snap.forEach((d) => {
      sessions.push(d.data() as SavedProjectSession);
    });
    return sessions;
  }
}

export async function deleteUserSession(userId: string, sessionId: string): Promise<void> {
  const sessionRef = doc(db, "users", userId, "sessions", sessionId);
  await deleteDoc(sessionRef);
}

export async function getUserSession(userId: string, sessionId: string): Promise<SavedProjectSession | null> {
  const sessionRef = doc(db, "users", userId, "sessions", sessionId);
  const snap = await getDoc(sessionRef);
  if (snap.exists()) {
    return snap.data() as SavedProjectSession;
  }
  return null;
}
