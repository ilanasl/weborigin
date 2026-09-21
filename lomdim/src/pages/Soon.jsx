export default function Soon({ nav, params }) {
  const { title } = params
  return (
    <div className="pt-2">
      <h1 className="text-[23px] font-black mb-4">{title}</h1>
      <div className="card empty">
        <div className="big">🛠️</div>
        <div className="font-semibold text-ink text-[15px] mb-1">בקרוב</div>
        המסך הזה מתוכנן ובדרך — נבנה אותו בשלב הבא.<br />
        בינתיים אפשר להעלות חומר, לתרגל, ולהשתמש ב"תסביר לי" וב"בדוק תרגיל".
        <div className="mt-4">
          <button className="btn" onClick={() => nav.back()}>→ חזרה</button>
        </div>
      </div>
    </div>
  )
}
