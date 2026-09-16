import { create } from 'zustand'

type SorteoState = {
  /** Edición seleccionada actualmente; null mientras no se elige ninguna. */
  sorteoId: string | null
  setSorteoId: (sorteoId: string | null) => void
}

export const useSorteoStore = create<SorteoState>((set) => ({
  sorteoId: null,
  setSorteoId: (sorteoId) => set({ sorteoId }),
}))
