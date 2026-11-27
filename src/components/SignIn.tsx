import { useEffect, useState } from 'react'
import {
  checkVerified, finishEmailLink, linkEmail, openedFromEmailLink, PASSWORD_MIN, resendVerification, resetPassword, sendEmailLink, signIn, signInAsTestUser,
  signInWithPassword, signOut, signUpWithPassword,
} from '@/services/cloud'
import { usingEmulators } from '@/services/firebase'
import { useSession } from '@/store/useSession'
import LoginStage from './LoginStage'

type Mode = 'signin' | 'signup' | 'forgot' | 'link'

/** The only thing a signed-out visitor ever sees. No board data is loaded before sign-in.
 *  Three ways in, all with a confirmed address: Google (Google has verified it), an address + password (confirmed by an
 *  emailed link once, at sign-up), or a one-time link emailed on the spot for anyone who would rather not have a password. */
export default function SignIn(): JSX.Element {
  const error = useSession((s) => s.error)
  const fromLink = openedFromEmailLink()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState(fromLink ? linkEmail() : '')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [sent, setSent] = useState<null | { kind: 'link' | 'reset'; to: string }>(null)
  const [busy, setBusy] = useState(false)

  // Opened from the emailed link in the same browser: finish straight away.
  useEffect(() => { if (fromLink && linkEmail()) { setBusy(true); void finishEmailLink(linkEmail()).finally(() => setBusy(false)) } }, [fromLink])
  // errors belong to the form they came from
  const go = (m: Mode): void => { useSession.setState({ error: null }); setSent(null); setMode(m) }

  if (fromLink) {
    return (
      <main className="wb-gate wb-hero is-narrow"><div className="wb-gate-card">
        <div className="wb-kicker"><span>ProjectPortfolio</span></div>
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

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault(); setBusy(true)
    try {
      if (mode === 'signin') await signInWithPassword(email, password)
      else if (mode === 'signup') await signUpWithPassword(email, password) // success moves to the "confirm your email" screen by itself
      else if (mode === 'forgot') { if (await resetPassword(email)) setSent({ kind: 'reset', to: email.trim().toLowerCase() }) }
      else if (await sendEmailLink(email)) setSent({ kind: 'link', to: email.trim().toLowerCase() })
    } finally { setBusy(false) }
  }

  return (
    <main className="wb-gate wb-hero">
      <LoginStage />
      <div className="wb-gate-card wb-card3d">
        <div className="wb-kicker"><span>ProjectPortfolio</span></div>
        <h1>Portfolio work, from the task up.</h1>
        <p>Projects, milestones and tasks on one board, in swimlanes if you like. Progress rolls up from the work people actually finish.</p>
        <button className="wb-gate-btn wb-google" onClick={() => void signIn()}>Continue with Google</button>
        <p className="wb-gate-fine">Google accounts go straight in: no sign-up step.</p>
        <div className="wb-gate-or"><span>or use your email</span></div>

        {sent ? (
          <div className="wb-gate-sent" role="status">
            <b>Check {sent.to}</b>
            <p>{sent.kind === 'reset'
              ? 'If that address has an account, a link to choose a new password is on its way. It expires in an hour. Not there? Look in spam.'
              : 'We sent a sign-in link. Open it on this device to get in. It works once and expires in an hour. Not there? Look in spam.'}</p>
            <button className="wb-del" onClick={() => go(sent.kind === 'reset' ? 'signin' : 'link')}>{sent.kind === 'reset' ? 'Back to sign in' : 'Use a different address'}</button>
          </div>
        ) : (
          <>
            {(mode === 'signin' || mode === 'signup') && (
              <div className="wb-gate-tabs" role="tablist" aria-label="Email sign in or sign up">
                <button role="tab" aria-selected={mode === 'signin'} className={mode === 'signin' ? 'is-on' : ''} onClick={() => go('signin')}>Sign in</button>
                <button role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'is-on' : ''} onClick={() => go('signup')}>Create account</button>
              </div>
            )}
            {mode === 'forgot' && <p className="wb-gate-fine">Enter your address and we will email you a link to choose a new password.</p>}
            {mode === 'link' && <p className="wb-gate-fine">No password: we email you a one-time link that signs you in. You will need a new one each time.</p>}
            <form className="wb-gate-form" onSubmit={(e) => void submit(e)}>
              <input type="email" inputMode="email" autoComplete="email" value={email} placeholder="you@example.com" aria-label="Email address" onChange={(e) => setEmail(e.target.value)} />
              {(mode === 'signin' || mode === 'signup') && (
                <div className="wb-gate-pw">
                  <input type={show ? 'text' : 'password'} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password}
                    placeholder={mode === 'signup' ? `Password (at least ${PASSWORD_MIN} characters)` : 'Password'} aria-label="Password" onChange={(e) => setPassword(e.target.value)} />
                  <button type="button" className="wb-gate-eye" aria-pressed={show} onClick={() => setShow((v) => !v)}>{show ? 'Hide' : 'Show'}</button>
                </div>
              )}
              <button className="wb-gate-btn is-quiet" type="submit" disabled={!email.trim() || busy || ((mode === 'signin' || mode === 'signup') && !password)}>
                {busy ? 'One moment…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : 'Email me a sign-in link'}
              </button>
            </form>
            {mode === 'signup' && <p className="wb-gate-fine">We will email a link to confirm your address before you can open your portfolio.</p>}
            <div className="wb-gate-links">
              {mode === 'signin' && <button type="button" onClick={() => go('forgot')}>Forgot password?</button>}
              {(mode === 'forgot' || mode === 'link') && <button type="button" onClick={() => go('signin')}>Back to sign in</button>}
              {mode !== 'link' && <button type="button" onClick={() => go('link')}>Email me a one-time link instead</button>}
            </div>
          </>
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

/** Shown to someone who made an account with a password but has not opened the confirmation link yet. */
export function VerifyEmail(): JSX.Element {
  const user = useSession((s) => s.user)
  const error = useSession((s) => s.error)
  const [busy, setBusy] = useState(false)
  const [resent, setResent] = useState(false)
  // opening the link on a phone and coming back here should just work
  useEffect(() => {
    const look = (): void => { void checkVerified(true) }
    window.addEventListener('focus', look)
    const t = window.setInterval(look, 6000)
    return () => { window.removeEventListener('focus', look); window.clearInterval(t) }
  }, [])
  return (
    <main className="wb-gate wb-hero is-narrow"><div className="wb-gate-card wb-card3d">
      <div className="wb-kicker"><span>ProjectPortfolio</span></div>
      <h1>Confirm your email</h1>
      <p>We sent a link to <b className="wb-gate-addr">{user?.email}</b>. Open it to confirm the address, then come back here. It can take a minute; look in spam too.</p>
      <button className="wb-gate-btn" disabled={busy} onClick={() => { setBusy(true); void checkVerified().finally(() => setBusy(false)) }}>{busy ? 'Checking…' : 'Continue'}</button>
      <button className="wb-gate-btn is-quiet" onClick={() => { void resendVerification().then((ok) => setResent(ok)) }}>{resent ? 'Sent again' : 'Send the email again'}</button>
      {error && <div className="wb-gate-err" role="alert">{error}</div>}
      <button className="wb-del" onClick={() => void signOut()}>Use a different address</button>
    </div></main>
  )
}

export function Splash({ text }: { text: string }): JSX.Element {
  return <main className="wb-gate"><div className="wb-gate-card"><div className="wb-kicker"><span>ProjectPortfolio</span></div><p>{text}</p></div></main>
}
