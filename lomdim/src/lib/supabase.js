import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

// אם המפתחות לא הוגדרו עדיין — האפליקציה עולה במצב "לא מוגדר" עם הודעת הסבר,
// כדי שאפשר יהיה לפתח/לפרוס לפני שמכניסים מפתחות.
export const isConfigured = Boolean(url && anon && !url.includes('YOUR-PROJECT'))

export const supabase = isConfigured
  ? createClient(url, anon)
  : null

export const SUPABASE_URL = url
export const SUPABASE_ANON = anon
