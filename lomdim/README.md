# לומדים ביחד 📚

אפליקציית הכנה למבחנים אישית (React + Vite + Tailwind + Supabase + Gemini).
מובייל‑first, עברית/RTL, מצב בהיר וכהה. נפרסת **חינם**.

> זהו ה‑MVP: התחברות · מקצועות · העלאת צילום → סיכום ושאלות מ‑Gemini · תרגול עם רישום תשובות ומודל שליטה.
> שאר הפיצ׳רים (מתכנן מבחנים, "לחיזוק", כרטיסיות, מבחנים שעברו, דוח הורה) — בסכימה ובתוכנית, ייבנו בהמשך.

---

## הרצה מקומית

```bash
cd lomdim
npm install
cp .env.example .env.local   # מלאו את המפתחות
npm run dev
```

## הגדרה (חד‑פעמי, הכל חינם)

### 1. מפתח Gemini
- היכנסו ל‑https://aistudio.google.com/apikey → צרו API key (חינם).

### 2. פרויקט Supabase
- צרו פרויקט ב‑https://supabase.com (חינם).
- **Project Settings → API** → העתיקו את `Project URL` ואת `anon public` ל‑`.env.local`:
  ```
  VITE_SUPABASE_URL=https://xxxx.supabase.co
  VITE_SUPABASE_ANON_KEY=eyJ...
  ```
- **SQL Editor** → הדביקו והריצו את `supabase/schema.sql` (יוצר טבלאות, RLS, ובאקט תמונות).

### 3. פונקציית Gemini (Edge Function)
מסתירה את מפתח ה‑API מהדפדפן.
```bash
npm i -g supabase
supabase login
supabase link --project-ref <PROJECT_REF>
supabase functions deploy gemini --no-verify-jwt
supabase secrets set GEMINI_API_KEY=<המפתח מ-AI Studio>
```
(אופציונלי: `supabase secrets set GEMINI_MODEL=gemini-2.0-flash`)

### 4. אימות (Auth)
- **Authentication → Providers → Email**: מופעל.
- לנוחות בהתחלה אפשר לכבות "Confirm email" (Authentication → Settings), כדי להתחבר מיד.
- צרו משתמש לבן (הרשמה מתוך האפליקציה, או Authentication → Add user).

---

## פריסה חינם (מחר)
כל שירות סטטי מתאים. לדוגמה **Netlify** או **Vercel**:
- Build command: `npm run build`
- Publish/Output dir: `dist`
- הוסיפו את משתני הסביבה (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) בהגדרות הפרויקט.

ה‑Supabase והפונקציה כבר בענן — הפריסה היא רק של הפרונט הסטטי. אין עלות חודשית קבועה; יש רק עלות שימוש קטנה של Gemini (מסלול חינמי נדיב).

---

## מבנה
```
lomdim/
  src/
    lib/        supabase, gemini (קריאות לפונקציה), mastery (מודל השליטה)
    context/    AuthContext
    pages/      Login, Home, Subject, Upload, Practice
    App.jsx     ניווט + shell
  supabase/
    schema.sql            סכימת ה-DB + RLS + storage
    functions/gemini/     ה-Edge Function שמדברת עם Gemini
```

התוכנית הוויזואלית המלאה (כל המסכים) קיימת כאב‑טיפוס נפרד ומשמשת כמפרט.
