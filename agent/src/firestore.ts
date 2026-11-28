import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

/**
 * Firestore with the admin SDK. Credentials come from the environment, never from this repo:
 *  - local / self-hosted: Application Default Credentials (`gcloud auth application-default login`, or
 *    GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account key kept OUTSIDE the repo, chmod 600)
 *  - Cloud Run: the service's own identity
 *  - emulator: set FIRESTORE_EMULATOR_HOST (no credentials needed)
 * The project id is required (PP_FIREBASE_PROJECT or GOOGLE_CLOUD_PROJECT): no default, so a missing setting
 * fails loudly instead of quietly pointing at someone else's database.
 *
 * The admin SDK is NOT subject to firestore.rules. Everything the rules would check is checked in auth.ts and
 * workspace.ts instead.
 */
const projectId = process.env.PP_FIREBASE_PROJECT || process.env.GOOGLE_CLOUD_PROJECT
if (!projectId) throw new Error('Set PP_FIREBASE_PROJECT to your Firebase project id')
if (!getApps().length) initializeApp({ projectId })
export const db: Firestore = getFirestore()
// the app's objects leave optional fields undefined (e.g. a cleared priority); store them as absent, as the web SDK does
db.settings({ ignoreUndefinedProperties: true })
