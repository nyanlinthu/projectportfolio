import { createContext, useContext, useMemo } from 'react'
import { buildIndex, SearchHit, SearchIndex } from '@/lib/search'
import { BoardElement, BoardNode } from '@/types'

/**
 * What a link cell (or anything else that points at other things) needs from the board: the one search index,
 * so a key can be shown by its current title, and the board's own way of going to a hit. Provided once by the
 * Whiteboard, so tables nested anywhere (on the canvas, in a page, in a Plans sheet) link the same way.
 */
interface LinkTools { byKey: Map<string, SearchHit>; index: SearchIndex; goTo: (h: SearchHit) => void }
const Ctx = createContext<LinkTools>({ byKey: new Map(), index: [], goTo: () => undefined })

export function LinkProvider({ nodes, elements, goTo, children }: { nodes: Record<string, BoardNode>; elements: BoardElement[]; goTo: (h: SearchHit) => void; children: React.ReactNode }): JSX.Element {
  const index = useMemo(() => buildIndex(nodes, elements), [nodes, elements])
  const byKey = useMemo(() => new Map(index.map((h) => [h.key, h])), [index])
  const value = useMemo(() => ({ index, byKey, goTo }), [index, byKey, goTo])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useLinks = (): LinkTools => useContext(Ctx)
