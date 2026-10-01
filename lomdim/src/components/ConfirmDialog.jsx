import { useEffect } from 'react'
import Icon from './Icon'

// חלונית אישור בעיצוב האפליקציה (במקום חלונית המערכת האפורה)
export default function ConfirmDialog({ open, icon = 'logout', title, text, confirmLabel = 'אישור', cancelLabel = 'ביטול', danger = false, onConfirm, onCancel }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onCancel?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])
  if (!open) return null
  return (
    <div className="cdlg-wrap" role="dialog" aria-modal="true" aria-labelledby="cdlg-title" onClick={onCancel}>
      <div className="cdlg" onClick={(e) => e.stopPropagation()}>
        <span className="cdlg-icon" style={danger ? { background: 'color-mix(in srgb, var(--bad) 18%, transparent)', color: 'var(--bad)' } : undefined}>
          <Icon name={icon} size={24} />
        </span>
        <div id="cdlg-title" className="font-disp font-extrabold text-[20px] leading-tight">{title}</div>
        {text && <div className="text-muted text-[14px] leading-relaxed">{text}</div>}
        <div className="flex gap-2 w-full mt-2">
          <button type="button" className="btn flex-1" onClick={onCancel} autoFocus>{cancelLabel}</button>
          <button type="button" className="btn flex-1 font-bold" onClick={onConfirm}
            style={danger ? { background: 'var(--bad)', color: 'var(--on-fill)', borderColor: 'transparent' } : undefined}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
