import { useAuth } from '../context/AuthContext'

// פנייה לפי מין הלומד/ת (מההגדרות): g('תרגל', 'תרגלי'). בלי הגדרה — לשון זכר (או ניסוח שלישי אם ניתן)
export function useG() {
  const { profile } = useAuth()
  return (male, female, neutral) =>
    profile?.gender === 'בת' ? female : profile?.gender === 'בן' ? male : (neutral ?? male)
}
