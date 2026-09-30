// שומר יציאה: מסך שעובד על משהו שיאבד ביציאה (למשל ניתוח חומר) מדליק אותו,
// וכל מעבר מסך באפליקציה שואל קודם אם לצאת.
let message = null
export const setLeaveGuard = (msg) => { message = msg || null }
export const confirmLeave = () => {
  if (!message) return true
  if (!window.confirm(message)) return false
  message = null
  return true
}
