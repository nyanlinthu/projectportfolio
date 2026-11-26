import { useEffect, useState } from 'react'
import { finishEmailLink, linkEmail, openedFromEmailLink, sendEmailLink, signIn, signInAsTestUser } from '@/services/cloud'
import { usingEmulators } from '@/services/firebase'
import { useSession } from '@/store/useSession'

/** The only thing a signed-out visitor ever sees. No board data is loaded before sign-in.
 *  Two ways in, both verified: Google (Google has verified the address), or a one-time link emailed to you
 *  (opening it proves the inbox is yours, and signs you in). New addresses are signed up on the spot. */
export default function SignIn(): JSX.Element {
  const error = useSession((s) => s.error)
  const fromLink = openedFromEmailLink()
  const [email, setEmail] = useState(fromLink ? linkEmail() : '')
  const [sent, setSent] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Opened from the emailed link in the same browser: finish straight away.
  useEffect(() => { if (fromLink && linkEmail()) { setBusy(true); void finishEmailLink(linkEmail()).finally(() => setBusy(false)) } }, [fromLink])

  if (fromLink) {
    return (
      <main className="wb-gate"><div className="wb-gate-card">
        <div className="wb-kicker"><span>FlowBoard</span></div>
        <h1>Confirm your email</h1>
        <p>{busy ? 'Signing you in…' : 'You opened the link on a different browser or app. Type the address it was sent to.'}</p>
        {!busy && (
          <form className="wb-gate-form" onSubmit={(e) => { e.preventDefault(); setBusy(true); void finishEmailLink(email).finally(() => setBusy(false)) }}>
            <input type="email" inputMode="email" autoComplete="email" value={email} placeholder="you@example.com" aria-label="Email address" onChange={(e) => setEmail(e.target.value)} />
            <button className="wb-gate-btn" type="submit" disabled={!email.trim()}>Sign in</button>
          </form>
        )}
        {error && <div className="wb-gate-err" role="alert">{error}</div>}
        {error && <button className="wb-del" onClick={() => { window.history.replaceState(null, '', '/'); window.location.reload() }}>Start again</button>}
      </div></main>
    )
  }

  return (
    <main className="wb-gate">
      <div className="wb-gate-card">
        <div className="wb-kicker"><span>FlowBoard</span></div>
        <h1>Portfolio work, from the task up.</h1>
        <p>Projects, milestones and tasks on one board. Progress rolls up from the work people actually finish.</p>
        <button className="wb-gate-btn" onClick={() => void signIn()}>Continue with Google</button>
        <div className="wb-gate-or"><span>or sign up with email</span></div>
        {sent ? (
          <div className="wb-gate-sent" role="status">
            <b>Check {sent}</b>
            <p>We sent a sign-in link. Open it on this device to verify your address and get in. It works once and expires in an hour. Not there? Look in spam.</p>
            <button className="wb-del" onClick={() => setSent(null)}>Use a different address</button>
          </div>
        ) : (
          <form className="wb-gate-form" onSubmit={async (e) => { e.preventDefault(); setBusy(true); if (await sendEmailLink(email)) setSent(email.trim().toLowerCase()); setBusy(false) }}>
            <input type="email" inputMode="email" autoComplete="email" value={email} placeholder="you@example.com" aria-label="Email address" onChange={(e) => setEmail(e.target.value)} />
            <button className="wb-gate-btn is-quiet" type="submit" disabled={!email.trim() || busy}>{busy ? 'Sending…' : 'Email me a sign-in link'}</button>
          </form>
        )}
        {error && <div className="wb-gate-err" role="alert">{error}</div>}
        {usingEmulators && (
          <div className="wb-gate-test">
            <span>Local test accounts (emulator only)</span>
            {['manager', 'operator', 'outsider'].map((n) => <button key={n} onClick={() => void signInAsTestUser(n)}>{n}</button>)}
          </div>
        )}
      </div>
    </main>
  )
}

export function Splash({ text }: { text: string }): JSX.Element {
  return <main className="wb-gate"><div className="wb-gate-card"><div className="wb-kicker"><span>FlowBoard</span></div><p>{text}</p></div></main>
}
