import { FirebaseApp, initializeApp } from 'firebase/app'
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check'
import { Auth, connectAuthEmulator, getAuth } from 'firebase/auth'
import { connectFirestoreEmulator, Firestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore'

// These values are public by design (they identify the project; they are not credentials). Access is decided
// by firestore.rules, never by keeping this config secret.
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
}

/** Local emulators, for development and end-to-end tests only. Never true in a production build. */
export const usingEmulators = import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === '1'
/** Without a project configured the app runs as a single-browser board with no sign-in. */
export const cloudEnabled = usingEmulators || (!!config.apiKey && !!config.projectId)

export const app: FirebaseApp | null = cloudEnabled ? initializeApp(usingEmulators ? { apiKey: 'demo', projectId: 'demo-flowboard', authDomain: 'localhost' } : config) : null
// App Check: every request carries proof it came from this app on a real browser (reCAPTCHA Enterprise,
// invisible), so a script holding the public config can't hammer the database. Site key is public by design.
// Created before any other service so their first requests already carry a token.
const appCheckKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY as string | undefined
if (app && !usingEmulators && appCheckKey) initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(appCheckKey), isTokenAutoRefreshEnabled: true })
export const auth: Auth | null = app ? getAuth(app) : null
export const db: Firestore | null = app
  ? initializeFirestore(app, {
      ignoreUndefinedProperties: true, // optional fields are simply absent
      // offline first: edits are kept on the device and sent when the connection returns
      ...(usingEmulators ? {} : { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }),
    })
  : null

if (usingEmulators && auth && db) {
  // 127.0.0.1, not "localhost": the emulators listen on IPv4 only and some browsers try IPv6 first
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8085)
}
