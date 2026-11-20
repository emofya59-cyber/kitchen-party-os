import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** null when env is missing → the app runs in offline demo mode with seed-like mock data. */
export const supabase: SupabaseClient<Database> | null =
  url && anonKey ? createClient<Database>(url, anonKey, { realtime: { params: { eventsPerSecond: 10 } } }) : null

export const isOffline = supabase === null
export const functionsUrl = url ? `${url.replace(/\/$/, '')}/functions/v1` : null
export const supabaseAnonKey = anonKey ?? null
