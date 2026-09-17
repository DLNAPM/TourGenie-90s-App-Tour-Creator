import React, { useState } from "react";
import { 
  loginWithGoogle, 
  loginAsGuest, 
  loginWithEmail, 
  signupWithEmail 
} from "../services/firebase";
import firebaseConfig from "../firebase-applet-config.json";
import { 
  XMarkIcon, 
  SparklesIcon, 
  LockClosedIcon, 
  EnvelopeIcon, 
  KeyIcon,
  ShieldCheckIcon,
  UserIcon,
  ClipboardDocumentIcon,
  ClipboardDocumentCheckIcon,
  ArrowTopRightOnSquareIcon,
  ExclamationTriangleIcon
} from "@heroicons/react/24/outline";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (user: any) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [tab, setTab] = useState<"quick" | "email">("quick");
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unauthorizedDomain, setUnauthorizedDomain] = useState<string | null>(null);
  const [copiedDomain, setCopiedDomain] = useState(false);

  if (!isOpen) return null;

  const currentHostname = typeof window !== "undefined" ? window.location.hostname : "";
  const projectId = firebaseConfig.projectId || "gen-lang-client-0102282465";
  const firebaseSettingsUrl = `https://console.firebase.google.com/project/${projectId}/authentication/settings`;

  const handleCopyDomain = () => {
    if (!currentHostname) return;
    navigator.clipboard.writeText(currentHostname);
    setCopiedDomain(true);
    setTimeout(() => setCopiedDomain(false), 3000);
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    setUnauthorizedDomain(null);
    try {
      const user = await loginWithGoogle();
      onSuccess(user);
      onClose();
    } catch (err: any) {
      console.error("Google login error:", err);
      const isUnauthorizedDomain = err.code === "auth/unauthorized-domain" || 
        (err.message && err.message.includes("unauthorized-domain"));

      if (isUnauthorizedDomain) {
        setUnauthorizedDomain(currentHostname || "this domain");
      } else if (err.code === "auth/invalid-continue-uri" || (err.message && err.message.includes("invalid-continue-uri"))) {
        setUnauthorizedDomain(currentHostname || "this domain");
        setError("Firebase configuration mismatch (auth/invalid-continue-uri). The authentication domain must be authorized in Firebase Console.");
      } else if (err.code === "auth/popup-blocked") {
        setError("Popup was blocked by browser. Please allow popups or use Google Login ID / PW below.");
      } else if (err.code === "auth/popup-closed-by-user") {
        setError("Login popup was closed before completing authentication.");
      } else {
        setError(err.message || "Unable to sign in with Google.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGuestLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const user = await loginAsGuest();
      onSuccess(user);
      onClose();
    } catch (err: any) {
      console.error("Guest login error:", err);
      setError(err.message || "Failed to continue as Guest.");
    } finally {
      setLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Please provide both email and password.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let user;
      if (isSignUp) {
        user = await signupWithEmail(email, password);
      } else {
        user = await loginWithEmail(email, password);
      }
      onSuccess(user);
      onClose();
    } catch (err: any) {
      console.error("Email auth error:", err);
      if (err.code === "auth/user-not-found" || err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") {
        setError("Invalid email or password. You can also sign up a new account.");
      } else if (err.code === "auth/email-already-in-use") {
        setError("This email is already in use. Please sign in instead.");
      } else if (err.code === "auth/weak-password") {
        setError("Password should be at least 6 characters.");
      } else {
        setError(err.message || "Authentication failed.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-md w-full p-8 shadow-2xl relative overflow-hidden">
        
        {/* Close Button */}
        <button 
          onClick={onClose}
          className="absolute top-6 right-6 p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 transition"
        >
          <XMarkIcon className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="mb-6">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mb-4">
            <SparklesIcon className="w-6 h-6" />
          </div>
          <h2 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
            Sign In to TourGenie
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Authenticate to save your generated video projects and sessions across devices.
          </p>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 mb-6">
          <button
            type="button"
            onClick={() => { setTab("quick"); setError(null); }}
            className={`pb-3 text-xs font-bold uppercase tracking-wider flex-1 text-center border-b-2 transition ${
              tab === "quick" 
                ? "border-indigo-600 text-indigo-600 dark:text-indigo-400" 
                : "border-transparent text-slate-400 hover:text-slate-600"
            }`}
          >
            Google & Guest
          </button>
          <button
            type="button"
            onClick={() => { setTab("email"); setError(null); }}
            className={`pb-3 text-xs font-bold uppercase tracking-wider flex-1 text-center border-b-2 transition ${
              tab === "email" 
                ? "border-indigo-600 text-indigo-600 dark:text-indigo-400" 
                : "border-transparent text-slate-400 hover:text-slate-600"
            }`}
          >
            ID & Password
          </button>
        </div>

        {/* Unauthorized Domain Resolution Banner */}
        {unauthorizedDomain && (
          <div className="mb-5 p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-2xl text-amber-900 dark:text-amber-200 text-xs">
            <div className="flex items-start gap-2.5 mb-2.5">
              <ExclamationTriangleIcon className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-extrabold text-sm block">Domain Authorization Required for Google Login</span>
                <span className="text-[11px] text-amber-700 dark:text-amber-300">
                  Firebase requires external deployment domains to be allowlisted before Google OAuth popups can connect.
                </span>
              </div>
            </div>

            <div className="bg-white/80 dark:bg-slate-900/80 p-3 rounded-xl border border-amber-200/70 dark:border-amber-900/60 mb-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] font-bold text-slate-800 dark:text-slate-200 truncate">
                  {unauthorizedDomain}
                </span>
                <button
                  type="button"
                  onClick={handleCopyDomain}
                  className="flex items-center gap-1 bg-amber-100 hover:bg-amber-200 dark:bg-amber-900/60 dark:hover:bg-amber-800 text-amber-900 dark:text-amber-200 font-bold px-2.5 py-1 rounded-lg transition active:scale-95 text-[10px]"
                >
                  {copiedDomain ? (
                    <>
                      <ClipboardDocumentCheckIcon className="w-3.5 h-3.5 text-emerald-600" /> Copied!
                    </>
                  ) : (
                    <>
                      <ClipboardDocumentIcon className="w-3.5 h-3.5" /> Copy Domain
                    </>
                  )}
                </button>
              </div>

              <div className="text-[11px] text-slate-600 dark:text-slate-400 space-y-1 pt-1 border-t border-amber-100 dark:border-amber-900/40">
                <p><strong>To enable Google OAuth:</strong></p>
                <ol className="list-decimal pl-4 space-y-0.5">
                  <li>Open the Firebase Authentication Settings.</li>
                  <li>Under <strong>Authorized domains</strong>, click <strong>Add domain</strong>.</li>
                  <li>Paste <code className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded font-mono">{unauthorizedDomain}</code> and save.</li>
                </ol>
              </div>

              <a
                href={firebaseSettingsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 w-full flex items-center justify-center gap-1.5 bg-amber-600 hover:bg-amber-500 text-white font-bold py-2 px-3 rounded-xl transition shadow-sm text-xs"
              >
                <span>Open Firebase Console Settings</span>
                <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
              </a>
            </div>

            <div className="pt-2 border-t border-amber-200/60 dark:border-amber-800/40 text-[11px] flex flex-col gap-2">
              <span className="font-bold text-amber-800 dark:text-amber-300">
                Don't want to configure Firebase right now?
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleGuestLogin}
                  className="flex-1 bg-slate-900 hover:bg-slate-800 text-white font-bold py-2 px-3 rounded-xl transition text-xs flex items-center justify-center gap-1.5"
                >
                  <UserIcon className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Use Guest (Instant)</span>
                </button>
                <button
                  type="button"
                  onClick={() => { setTab("email"); setUnauthorizedDomain(null); }}
                  className="flex-1 bg-white hover:bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-white border border-slate-300 dark:border-slate-700 font-bold py-2 px-3 rounded-xl transition text-xs"
                >
                  ID & Password
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Error Alert */}
        {error && !unauthorizedDomain && (
          <div className="mb-5 p-3.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 rounded-2xl text-rose-700 dark:text-rose-300 text-xs font-medium flex items-start gap-2">
            <span className="font-bold">Error:</span>
            <span>{error}</span>
          </div>
        )}

        {tab === "quick" ? (
          <div className="space-y-4">
            {/* Google Login Button */}
            <button
              onClick={handleGoogleLogin}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/80 text-slate-800 dark:text-white font-bold py-3.5 px-4 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm transition active:scale-[0.98] disabled:opacity-60"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
              </svg>
              <span>{loading ? "Connecting..." : "Sign in with Google"}</span>
            </button>

            <div className="relative flex py-2 items-center">
              <div className="flex-grow border-t border-slate-200 dark:border-slate-800"></div>
              <span className="flex-shrink mx-4 text-[11px] font-bold uppercase tracking-wider text-slate-400">or</span>
              <div className="flex-grow border-t border-slate-200 dark:border-slate-800"></div>
            </div>

            {/* Guest Login Button */}
            <button
              onClick={handleGuestLogin}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold py-3.5 px-4 rounded-2xl transition active:scale-[0.98] disabled:opacity-60 border border-transparent dark:border-slate-700/50"
            >
              <UserIcon className="w-5 h-5 text-slate-400" />
              <span>{loading ? "Starting session..." : "Continue as Guest"}</span>
            </button>

            <p className="text-[11px] text-center text-slate-400 dark:text-slate-500 pt-2 flex items-center justify-center gap-1">
              <ShieldCheckIcon className="w-4 h-4 text-emerald-500 inline" />
              Guest accounts automatically persist sessions in this browser.
            </p>
          </div>
        ) : (
          <form onSubmit={handleEmailAuth} className="space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1.5">
                Email / Login ID
              </label>
              <div className="relative">
                <EnvelopeIcon className="w-5 h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full pl-11 pr-4 py-3 bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1.5">
                Password
              </label>
              <div className="relative">
                <KeyIcon className="w-5 h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-11 pr-4 py-3 bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg transition active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-2"
            >
              <LockClosedIcon className="w-4 h-4" />
              <span>{loading ? "Processing..." : isSignUp ? "Create Account" : "Sign In"}</span>
            </button>

            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => { setIsSignUp(!isSignUp); setError(null); }}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline font-semibold"
              >
                {isSignUp ? "Already have an account? Sign In" : "Need an account? Sign Up with Email"}
              </button>
            </div>
          </form>
        )}

      </div>
    </div>
  );
};
