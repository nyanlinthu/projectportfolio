import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore'
import { db } from './firebase'

// Admin panel data. Only an account with an admins/{uid} document (written from the console, never the app) may
// list users; firestore.rules refuses everyone else.

export interface UserRow {
  uid: string
  email: string
  name: string
  provider?: 'google' | 'email'
  createdAt?: number
  lastActive?: number
  tz?: string
  lang?: string
  device?: string
  created?: number
  workspaceIds?: string[]
}

export async function listUsers(max = 2000): Promise<UserRow[]> {
  if (!db) return []
  const snap = await getDocs(query(collection(db, 'users'), orderBy('createdAt', 'desc'), limit(max)))
  return snap.docs.map((d) => ({ ...(d.data() as Omit<UserRow, 'uid'>), uid: d.id }))
}
