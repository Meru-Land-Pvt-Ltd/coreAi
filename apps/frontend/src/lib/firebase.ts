import { getApps, initializeApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

export function getFirebaseAuth(): Auth {
  if (typeof window === "undefined") {
    throw new Error("Firebase auth can only run in browser.");
  }

  const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
  };

  if (!firebaseConfig.apiKey) {
    throw new Error("Missing Firebase API key.");
  }

  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

  return getAuth(app);
}
