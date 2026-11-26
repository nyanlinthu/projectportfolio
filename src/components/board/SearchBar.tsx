import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { buildIndex, SearchHit, searchIndex } from '@/lib/search'
import { BoardElement, BoardNode } from '@/types'

interface SearchBarProps {
  nodes: Record<string, BoardNode>
  elements: BoardElement[]
  /** `link` = opened with @ on the board: the pick is dropped there as a link instead of being gone to */
  onPick: (hit: SearchHit, mode: 'go' | 'link') => void
  canLink?: boolean
}

/** Always in the header. Searches everything on every board; results drop down over the board, never a new screen. */
export default function SearchBar({ nodes, elements, onPick, canLink }: SearchBarProps): JSX.Element {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState(0)
  const [mode, setMode] = useState<'go' | 'link'>('go')
  const input = useRef<HTMLInputElement>(null)
  // The index is only built while the box is in use, so typing on the board never pays for it.
  const index = useMemo(() => (open ? buildIndex(nodes, elements) : []), [open, nodes, elements])
  const hits = useMemo(() => searchIndex(index, q), [index, q])
  useEffect(() => { setAt(0) }, [q])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const typing = /^(INPUT|TEXTAREA)$/.test((e.target as HTMLElement).tagName)
      const editing = typing || (e.target as HTMLElement).isContentEditable
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !editing)) { e.preventDefault(); setMode('go'); input.current?.focus() }
      // @ on the board (not while typing anywhere): find anything and drop a link to it on the board
      else if (e.key === '@' && !editing && canLink) { e.preventDefault(); setMode('link'); input.current?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canLink])

  const pick = (h: SearchHit): void => { onPick(h, mode); setQ(''); input.current?.blur() }

  return (
    <div className={`wb-search ${open ? 'is-open' : ''} ${open && mode === 'link' ? 'is-link' : ''}`}>
      <Search size={16} className="wb-search-icon" />
      <input ref={input} value={q} placeholder={open && mode === 'link' ? 'Link to… (drops on the board)' : 'Search everything'} aria-label={mode === 'link' ? 'Link to' : 'Search everything'} enterKeyHint="search"
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setOpen(true)} onBlur={() => { setOpen(false); setMode('go') }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setAt((i) => Math.min(hits.length - 1, i + 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((i) => Math.max(0, i - 1)) }
          else if (e.key === 'Enter' && hits[at]) pick(hits[at])
          else if (e.key === 'Escape') { e.stopPropagation(); setQ(''); input.current?.blur() }
        }} />
      {open && q.trim() && (
        <ul className="wb-search-results" role="listbox">
          {hits.length === 0 && <li className="is-empty">Nothing matches “{q.trim()}”</li>}
          {hits.map((h, i) => (
            // pointerdown, not click: the input's blur would close the list before a click lands
            <li key={h.key} role="option" aria-selected={i === at} className={i === at ? 'is-on' : ''}
              onPointerDown={(e) => { e.preventDefault(); pick(h) }} onPointerEnter={() => setAt(i)}>
              <span className="wb-search-kind">{h.kind}</span>
              <span className="wb-search-title">{h.title}</span>
              {h.context && <span className="wb-search-ctx">{h.context}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
