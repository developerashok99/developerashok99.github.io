/**
 * The Firebase project behind sign-in and sync (console: https://console.firebase.google.com/project/mule-learning-web).
 * These values are public by design: what protects the data is the Firestore rules (each person reads and writes only
 * their own progress) and that sign-up is turned off, so only the people added in the console can sign in.
 */
export const firebaseConfig = {
  apiKey: "AIzaSyAnGCviOhiUUKDJdpli6RK_9IL0_RP3c0A",
  authDomain: "mule-learning-web.firebaseapp.com",
  projectId: "mule-learning-web",
  storageBucket: "mule-learning-web.firebasestorage.app",
  messagingSenderId: "1017196461102",
  appId: "1:1017196461102:web:5b7087a84bb65d6f09b3bf",
};
