import { create } from 'zustand'
import type { Tables } from '../lib/database.types'

type SorteoId = Tables<'sorteos'>['id']

type SorteoState = {
  /** Edición seleccionada actualmente; null mientras no se elige ninguna. */
  sorteoId: SorteoId | null
  setSorteoId: (sorteoId: SorteoId | null) => void
}

export const useSorteoStore = create<SorteoState>((set) => ({
  sorteoId: null,
  setSorteoId: (sorteoId) => set({ sorteoId }),
}))
