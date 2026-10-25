import type { GameApi } from './types';

// Only load the selected adapter: production must not ship the mock answer bank,
// and mock mode must work without Supabase credentials.
export const activeApi: GameApi = import.meta.env.VITE_USE_MOCK === 'true'
  ? (await import('./mockApi')).mockApi
  : (await import('./supabaseApi')).supabaseApi;
