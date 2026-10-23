import type { GameApi } from './types';
import { mockApi } from './mockApi';
import { supabaseApi } from './supabaseApi';

// Switch between MockApi and SupabaseApi with an env flag (VITE_USE_MOCK=true)
const useMock = import.meta.env.VITE_USE_MOCK === 'true';

export const activeApi: GameApi = useMock ? mockApi : supabaseApi;
export { mockApi, supabaseApi };
