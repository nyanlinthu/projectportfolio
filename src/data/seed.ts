import { BoardNode } from '@/types'

/** The board a brand-new browser starts with. None in the real app (a blank portfolio); the demo build swaps this
 *  file for seed.demo.ts, which carries the example portfolio. */
export const startingBoard = (): Record<string, BoardNode> | null => null
