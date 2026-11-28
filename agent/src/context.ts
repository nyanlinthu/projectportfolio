// Side effects a tool asks for that are not board items (today: mention notifications). Collected during one tool
// call and written by workspace.ts only if the call succeeds and passes the permission check.
export type Mention = { to: string; id: string; data: Record<string, unknown> }
let mentions: Mention[] = []
export const queueMention = (to: string, id: string, data: Record<string, unknown>): void => { mentions.push({ to, id, data }) }
export const takeMentions = (): Mention[] => { const m = mentions; mentions = []; return m }
