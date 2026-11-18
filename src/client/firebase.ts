/**
 * The Firebase side of accounts (loaded on demand by account.ts, so people who never sign in don't download it).
 * Firestore with live listeners: who's online and watch-together invites arrive as they happen.
 *   progress/{uid}  everything that syncs, one JSON string per key, plus when each key changed (only the owner can read it)
 *   profiles/{uid}  the counts on the Friends page (any signed-in friend can read them)
 */
import { initializeApp } from "firebase/app";
import {
  EmailAuthProvider, browserLocalPersistence, indexedDBLocalPersistence, initializeAuth, onAuthStateChanged,
  reauthenticateWithCredential, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, updatePassword, updateProfile, type User,
} from "firebase/auth";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, getFirestore, onSnapshot, query, setDoc, updateDoc, where } from "firebase/firestore";
import { firebaseConfig } from "../lib/firebase-config";
import { nameFromEmail, type ProfileSummary, type Snapshot } from "../lib/sync";
import type { AccountUser, Backend, Invite, McqDoc, Presence } from "./account";

const app = initializeApp(firebaseConfig);
// no popup/redirect resolver: email + password only, which also works inside the Android app's WebView
const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
const db = getFirestore(app);

const toUser = (u: User): AccountUser => ({ uid: u.uid, email: u.email ?? "", name: u.displayName || nameFromEmail(u.email ?? "") });
/** Firestore field names: "mls.completed" → "completed" (dots mean nesting there) */
const field = (key: string) => key.replace(/^mls\./, "");

export const firebaseBackend: Backend = {
  onUser(cb) {
    onAuthStateChanged(auth, (u) => cb(u ? toUser(u) : null));
  },
  async signIn(email, password) {
    const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
    return toUser(cred.user);
  },
  async signOut() {
    await signOut(auth);
  },
  async resetPassword(email) {
    await sendPasswordResetEmail(auth, email.trim());
  },
  async changePassword(current, next) {
    const u = auth.currentUser;
    if (!u?.email) throw Object.assign(new Error("not signed in"), { code: "auth/requires-recent-login" });
    await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, current));
    await updatePassword(u, next);
  },
  async setName(name) {
    if (auth.currentUser) await updateProfile(auth.currentUser, { displayName: name });
  },
  async getProgress(uid) {
    const snap = await getDoc(doc(db, "progress", uid));
    if (!snap.exists()) return null;
    const raw = snap.data() as { data?: Record<string, string>; at?: Record<string, number> };
    const out: Snapshot = { data: {}, at: {} };
    for (const [f, json] of Object.entries(raw.data ?? {})) {
      try {
        out.data[`mls.${f}`] = JSON.parse(json) as unknown;
      } catch {
        /* a damaged entry is skipped; the next sync rewrites it */
      }
    }
    for (const [f, t] of Object.entries(raw.at ?? {})) if (typeof t === "number") out.at[`mls.${f}`] = t;
    return out;
  },
  async putProgress(uid, snap) {
    const data: Record<string, string> = {};
    const at: Record<string, number> = {};
    for (const [k, v] of Object.entries(snap.data)) data[field(k)] = JSON.stringify(v ?? null);
    for (const [k, t] of Object.entries(snap.at)) if (typeof t === "number") at[field(k)] = t;
    await setDoc(doc(db, "progress", uid), { data, at, updated: Date.now() });
  },
  async putProfile(uid, p) {
    await setDoc(doc(db, "profiles", uid), p);
  },
  async getSiteKey() {
    const snap = await getDoc(doc(db, "config", "site"));
    const key = snap.exists() ? (snap.data() as { key?: unknown }).key : null;
    return typeof key === "string" ? key : null;
  },
  async listMcqs() {
    const all = await getDocs(collection(db, "mcqs"));
    return all.docs.map((d) => ({ ...(d.data() as McqDoc), id: d.id }));
  },
  async saveMcq(id, d) {
    if (id) {
      await setDoc(doc(db, "mcqs", id), d);
      return id;
    }
    return (await addDoc(collection(db, "mcqs"), d)).id;
  },
  async deleteMcq(id) {
    await deleteDoc(doc(db, "mcqs", id));
  },
  async setPresence(p) {
    await setDoc(doc(db, "presence", p.uid), p);
  },
  watchPresence(cb) {
    return onSnapshot(collection(db, "presence"), (snap) => cb(snap.docs.map((d) => ({ ...(d.data() as Presence), uid: d.id }))), (e) => console.warn("presence unavailable", e));
  },
  async sendInvite(i) {
    return (await addDoc(collection(db, "invites"), i)).id;
  },
  watchInvites(uid, cb) {
    // two queries (sent and received); the rules let you read only invites you're part of
    let got: Record<string, Invite[]> = { to: [], from: [] };
    const emit = () => cb([...got.to, ...got.from.filter((i) => i.to !== uid)]);
    const subs = (["to", "from"] as const).map((field) => onSnapshot(query(collection(db, "invites"), where(field, "==", uid)), (snap) => {
      got = { ...got, [field]: snap.docs.map((d) => ({ ...(d.data() as Omit<Invite, "id">), id: d.id })) };
      emit();
    }, (e) => console.warn("invites unavailable", e)));
    return () => subs.forEach((u) => u());
  },
  async answerInvite(id, status) {
    await updateDoc(doc(db, "invites", id), { status });
  },
  async deleteInvite(id) {
    await deleteDoc(doc(db, "invites", id));
  },
  async listProfiles() {
    const all = await getDocs(collection(db, "profiles"));
    return all.docs.map((d) => ({ ...(d.data() as ProfileSummary), uid: d.id }));
  },
};
