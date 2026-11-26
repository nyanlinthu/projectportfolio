import { Fragment, KeyboardEvent, useMemo, useState } from 'react'
import { SearchHit, searchIndex } from '@/lib/search'
import { PageLink } from '@/types'
import { sendMention } from '@/services/inbox'
import { useSession } from '@/store/useSession'
import { useLinks } from './LinkContext'

/** Link key prefix for a person mention (the rest is their uid). Never a search key, so never a page link. */
export const PERSON = 'person:'

/** Where a mention of a teammate takes them, and which cards it sits under (checked against what they may see). */
export interface NotifyAt { key: string; title: string; anc: string[] }

/**
 * The one @ picker. Anything that holds free text (page writing, card notes, text, sticky notes, checklist items,
 * kanban cards) plugs this in: typing @ lists everything in the search index; picking one writes `@Title` into the
 * text and records `{ key, title }` in the field's links. A link whose @Title is deleted from the text goes with it.
 * Change how @ works here and it changes everywhere.
 */
export interface MentionOpts {
  text: string
  links: PageLink[]
  onChange: (text: string, links: PageLink[]) => void
  /** never offered (a page does not link to itself) */
  selfKey?: string
  /** offered first, e.g. teammates on a page */
  extra?: (q: string) => SearchHit[]
  /** told about each pick */
  onPicked?: (h: SearchHit) => void
  /** offer teammates who can see this place; picking one notifies them and brings them here */
  notifyAt?: NotifyAt
}

export function useMention({ text, links, onChange, selfKey, extra, onPicked, notifyAt }: MentionOpts) {
  const members = useSession((s) => s.members)
  const meUid = useSession((s) => s.user?.uid)
  const ancKey = notifyAt?.anc.join(',')
  // someone limited to certain cards is only offered when this place sits under one of them (the rules agree)
  const people = useMemo(() => !notifyAt ? [] : members.filter((m) => m.uid !== meUid && (!m.scopes?.length || notifyAt.anc.some((id) => m.scopes!.includes(id)))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [members, meUid, ancKey, !!notifyAt])
  const { index } = useLinks()
  const [query, setQuery] = useState<{ at: number; text: string } | null>(null)
  const [sel, setSel] = useState(0)
  const [el, setEl] = useState<HTMLTextAreaElement | HTMLInputElement | null>(null)

  const matches = useMemo((): SearchHit[] => {
    if (!query) return []
    const q = query.text.toLowerCase()
    const who = people.filter((m) => !q || m.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) || m.email.toLowerCase().startsWith(q))
      .slice(0, 4).map((m): SearchHit => ({ key: `${PERSON}${m.uid}`, kind: 'Person', title: m.name, context: m.email, scopeId: '' }))
    const first = [...who, ...(extra?.(query.text) ?? [])]
    const pool = query.text ? searchIndex(index, query.text, 12) : index.filter((h) => h.nodeId).slice(0, 8)
    return [...first, ...pool.filter((h) => h.key !== selfKey)].slice(0, 8)
  }, [query, index, selfKey, extra, people])

  const onType = (next: string, caretAt: number): void => {
    const m = /(?:^|\s)@([^\s@]{0,40})$/.exec(next.slice(0, caretAt))
    setQuery(m ? { at: caretAt - m[1].length - 1, text: m[1] } : null)
    setSel(0)
    onChange(next, links.filter((l) => next.includes(`@${l.title}`)))
  }
  const pick = (h: SearchHit): void => {
    if (!query) return
    const end = query.at + 1 + query.text.length
    const next = `${text.slice(0, query.at)}@${h.title} ${text.slice(end)}`
    onChange(next, [...links.filter((l) => l.key !== h.key), { key: h.key, title: h.title }])
    onPicked?.(h)
    if (notifyAt && h.key.startsWith(PERSON)) void sendMention(h.key.slice(PERSON.length), notifyAt.key, notifyAt.title, notifyAt.anc)
    setQuery(null)
    const c = query.at + h.title.length + 2
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(c, c) })
  }
  /** true when the key was used by the picker (the field should not act on it) */
  const onKeyDown = (e: KeyboardEvent): boolean => {
    if (!query) return false
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setQuery(null); return true }
    if (!matches.length) return false
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(matches.length - 1, i + 1)); return true }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(0, i - 1)); return true }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); pick(matches[sel]); return true }
    return false
  }
  /** spread on the textarea / input */
  const fieldProps = {
    onChange: (e: { target: HTMLTextAreaElement | HTMLInputElement }) => { setEl(e.target); onType(e.target.value, e.target.selectionStart ?? e.target.value.length) },
    onBlur: () => setQuery(null),
  }
  const list = query ? (
    <ul className="wb-search-results wb-mention-list" role="listbox" aria-label="Link to" onPointerDown={(e) => e.stopPropagation()}>
      {matches.length === 0 && <li className="is-empty">Nothing matches “{query.text}”</li>}
      {matches.map((h, i) => (
        <li key={h.key} role="option" aria-selected={i === sel} className={i === sel ? 'is-on' : ''}
          onPointerDown={(e) => { e.preventDefault(); pick(h) }} onPointerEnter={() => setSel(i)}>
          <span className="wb-search-kind">{h.kind}</span>
          <span className="wb-search-title">{h.title}</span>
          {h.context && <span className="wb-search-ctx">{h.context}</span>}
        </li>
      ))}
    </ul>
  ) : null
  return { onType, onKeyDown, fieldProps, list, open: !!query }
}

/** Text with its @links drawn as gold, tappable names (tap = go there). Everything else stays plain text. */
export function LinkedText({ text, links }: { text: string; links?: PageLink[] }): JSX.Element {
  const { byKey, goTo } = useLinks()
  if (!links?.length) return <>{text}</>
  const titles = [...links].sort((a, b) => b.title.length - a.title.length)
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(@(?:${titles.map((l) => esc(l.title)).join('|')}))`, 'g'))
  return (
    <>
      {parts.map((p, i) => {
        const l = p.startsWith('@') ? links.find((x) => `@${x.title}` === p) : undefined
        const hit = l && byKey.get(l.key)
        if (!l) return <Fragment key={i}>{p}</Fragment>
        if (l.key.startsWith(PERSON)) return <b key={i} className="wb-inlink is-person">{p}</b>
        return (
          <a key={i} className={`wb-inlink ${hit ? '' : 'is-gone'}`} role="link" tabIndex={0}
            onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); if (hit) goTo(hit) }}>{p}</a>
        )
      })}
    </>
  )
}

/** Links of a field as chips (for fields that stay a plain textarea, like card notes). */
export function LinkChips({ links }: { links?: PageLink[] }): JSX.Element | null {
  const { byKey, goTo } = useLinks()
  if (!links?.length) return null
  return (
    <div className="wb-peek-links">
      {links.map((l) => {
        if (l.key.startsWith(PERSON)) return <span key={l.key} className="wb-linkchip is-person"><i>@</i>{l.title}</span>
        const h = byKey.get(l.key)
        return <button key={l.key} className={`wb-linkchip ${h ? '' : 'is-gone'}`} onClick={() => { if (h) goTo(h) }}><i>{h?.kind ?? 'gone'}</i>{h?.title ?? l.title}</button>
      })}
    </div>
  )
}
