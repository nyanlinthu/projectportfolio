import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { OAuth2Client } from 'google-auth-library'
import { initializeApp, getApps } from 'firebase-admin/app'
import { Firestore, getFirestore } from 'firebase-admin/firestore'

/**
 * Firestore with server rights. Credentials come from the environment, never from this repo:
 *  - PP_IMPERSONATE_SA (recommended on a personal machine): act as a dedicated service account that has only
 *    Firestore access, by impersonation through your gcloud login. Your own (owner) credentials never reach the
 *    data, and there is no key file on disk. Setup in README ("A dedicated service account").
 *  - otherwise Application Default Credentials (`gcloud auth application-default login`, or
 *    GOOGLE_APPLICATION_CREDENTIALS pointing at a key kept OUTSIDE the repo, chmod 600), or Cloud Run's identity
 *  - emulator: FIRESTORE_EMULATOR_HOST (no credentials)
 * The project id is required (PP_FIREBASE_PROJECT or GOOGLE_CLOUD_PROJECT): no default, so a missing setting
 * fails loudly instead of quietly pointing at someone else's database.
 *
 * Server rights are NOT subject to firestore.rules. Everything the rules would check is checked in auth.ts and
 * workspace.ts instead.
 */
const projectId = process.env.PP_FIREBASE_PROJECT || process.env.GOOGLE_CLOUD_PROJECT
if (!projectId) throw new Error('Set PP_FIREBASE_PROJECT to your Firebase project id')
const impersonate = process.env.PP_IMPERSONATE_SA ?? ''

/** Tokens from `gcloud auth print-access-token --impersonate-service-account` (refreshed before their 60 min). */
function gcloudImpersonated(sa: string): OAuth2Client {
  const run = promisify(execFile)
  const client = new OAuth2Client()
  client.refreshHandler = async () => {
    const env = { ...process.env }
    delete env.PYTHONPATH // gcloud is Python; an agent's PYTHONPATH can break it
    const { stdout } = await run(process.env.GCLOUD_PATH || 'gcloud', ['auth', 'print-access-token', `--impersonate-service-account=${sa}`, '--verbosity=error'], { env, timeout: 30_000 })
    const token = stdout.trim()
    if (!token) throw new Error('gcloud returned no access token')
    return { access_token: token, expiry_date: Date.now() + 45 * 60_000 }
  }
  return client
}

if (!getApps().length) initializeApp({ projectId })
export const db: Firestore = impersonate && !process.env.FIRESTORE_EMULATOR_HOST
  ? new Firestore({ projectId, authClient: gcloudImpersonated(impersonate) } as ConstructorParameters<typeof Firestore>[0])
  : getFirestore()
// the app's objects leave optional fields undefined (e.g. a cleared priority); store them as absent, as the web SDK does
db.settings({ ignoreUndefinedProperties: true })
