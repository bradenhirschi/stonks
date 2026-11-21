"use client";

import { getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from "firebase/app";
import {
  GoogleAuthProvider,
  connectAuthEmulator,
  getAuth,
  linkWithPopup,
  onAuthStateChanged,
  signInAnonymously,
  signInWithCredential,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";
import { FirebaseError } from "firebase/app";
import { useEffect, useState } from "react";

/**
 * The Firebase web app config (Project settings → Your apps). These values are public:
 * they ship in the website either way. Access is controlled by firestore.rules.
 */
export const FIREBASE_CONFIG: FirebaseOptions | null = {
  apiKey: "AIzaSyBqSiDo9DRN2DygkzEdlZOMwLPq0sjIy6w",
  authDomain: "braden-board-games.firebaseapp.com",
  projectId: "braden-board-games",
  storageBucket: "braden-board-games.firebasestorage.app",
  messagingSenderId: "435302656355",
  appId: "1:435302656355:web:e4bca1851863a308970b56",
};

/** `NEXT_PUBLIC_FIREBASE_EMULATORS=1` points the app at local emulators (dev and tests). */
const USE_EMULATORS = process.env.NEXT_PUBLIC_FIREBASE_EMULATORS === "1";
const EMULATOR_CONFIG: FirebaseOptions = { apiKey: "demo-key", projectId: "demo-board-games", authDomain: "localhost" };

export const onlineAvailable = USE_EMULATORS || FIREBASE_CONFIG !== null;

let services: { app: FirebaseApp; auth: Auth; db: Firestore } | null = null;

export function firebase() {
  if (services) return services;
  const config = USE_EMULATORS ? EMULATOR_CONFIG : FIREBASE_CONFIG;
  if (!config) throw new Error("Online play isn't set up yet.");
  const app = getApps()[0] ?? initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app);
  if (USE_EMULATORS) {
    const host = typeof window === "undefined" ? "127.0.0.1" : window.location.hostname;
    connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, host, 8085);
  }
  services = { app, auth, db };
  return services;
}

/**
 * The signed-in player. Everyone gets an account without signing up (anonymous sign-in);
 * it lives in this browser until they link it to Google.
 */
export async function ensureUser(): Promise<User> {
  const { auth } = firebase();
  await auth.authStateReady();
  if (auth.currentUser) return auth.currentUser;
  return (await signInAnonymously(auth)).user;
}

/**
 * Sign in with Google (in a popup, which works on Vercel and phone browsers). A guest's
 * account is upgraded in place so it keeps its history; if that Google account already
 * belongs to another player, switch to that one.
 */
export async function signInWithGoogle(): Promise<User> {
  const { auth } = firebase();
  const provider = new GoogleAuthProvider();
  const user = auth.currentUser;
  if (user?.isAnonymous) {
    try {
      return (await linkWithPopup(user, provider)).user;
    } catch (e) {
      if (e instanceof FirebaseError && e.code === "auth/credential-already-in-use") {
        const cred = GoogleAuthProvider.credentialFromError(e);
        if (cred) return (await signInWithCredential(auth, cred)).user;
      }
      throw e;
    }
  }
  return (await signInWithPopup(auth, provider)).user;
}

export async function signOutUser(): Promise<void> {
  await signOut(firebase().auth);
}

/** The current Firebase user (undefined while loading, null when signed out). */
export function useFirebaseUser(enabled = true): User | null | undefined {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled || !onlineAvailable) return;
    return onAuthStateChanged(firebase().auth, setUser);
  }, [enabled]);
  return user;
}

export function authErrorMessage(e: unknown): string {
  if (e instanceof FirebaseError) {
    if (e.code === "auth/popup-closed-by-user" || e.code === "auth/cancelled-popup-request") return "Sign-in was cancelled.";
    if (e.code === "auth/popup-blocked") return "Your browser blocked the sign-in popup. Allow popups for this site and try again.";
    if (e.code === "auth/unauthorized-domain") return "This website isn't on Firebase's list of authorized domains yet.";
  }
  return e instanceof Error ? e.message : "Something went wrong.";
}
