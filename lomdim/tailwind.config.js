/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        disp: ['Heebo', 'system-ui', 'sans-serif'],
        body: ['Assistant', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        line: 'var(--line)',
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        surface2: 'var(--surface-2)',
        primary: 'var(--primary)',
        good: 'var(--good)',
        bad: 'var(--bad)',
        accent: 'var(--accent)',
        btn: 'var(--btn)',
        'btn-ink': 'var(--btn-ink)',
      },
      borderRadius: { xl2: '18px', xl3: '22px' },
      boxShadow: { soft: 'var(--shadow)' },
    },
  },
  plugins: [],
}
