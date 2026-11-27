import { useEffect } from 'react'
import Whiteboard from '@/components/board/Whiteboard'
import SignIn, { Splash, VerifyEmail } from '@/components/SignIn'
import { signOut, watchSession } from '@/services/cloud'
import { useSession } from '@/store/useSession'
import './App.css'

export default function App(): JSX.Element {
  const status = useSession((s) => s.status)
  const error = useSession((s) => s.error)
  useEffect(() => watchSession(), [])

  if (status === 'local' || status === 'ready') return <Whiteboard />
  if (status === 'signed-out') return <SignIn />
  if (status === 'unverified') return <VerifyEmail />
  if (status === 'error') {
    return (
      <main className="wb-gate"><div className="wb-gate-card">
        <div className="wb-kicker"><span>ProjectPortfolio</span></div>
        <p role="alert">{error ?? 'Something went wrong.'}</p>
        <button className="wb-gate-btn" onClick={() => window.location.reload()}>Try again</button>
        <button className="wb-del" onClick={() => void signOut()}>Sign out</button>
      </div></main>
    )
  }
  return <Splash text={status === 'opening' ? 'Opening your portfolio…' : 'Loading…'} />
}
