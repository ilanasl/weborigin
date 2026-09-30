// הכנת קובץ לשליחה ל-AI: תמונה מוקטנת ל-2000 פיקסלים בצד הארוך (JPEG).
// צילום אייפון הוא 3–6MB — מוקטן הוא ~0.5MB: מהיר יותר, נכשל פחות וזול יותר, וכתב יד עדיין קריא.
const MAX_SIDE = 2000

const rawBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(String(r.result).split(',')[1])
  r.onerror = reject
  r.readAsDataURL(blob)
})

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e) }
    img.src = url
  })
}

export async function toAIInput(blob, fallbackType = '') {
  const type = blob.type || fallbackType
  if (!/^image\/(jpeg|jpg|png|webp|heic|heif)$/i.test(type)) return { imageBase64: await rawBase64(blob), mimeType: type }
  try {
    const img = await loadImage(blob)
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale)
    const c = document.createElement('canvas')
    c.width = w; c.height = h
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    const data = c.toDataURL('image/jpeg', 0.85).split(',')[1]
    if (!data) throw new Error('empty')
    return { imageBase64: data, mimeType: 'image/jpeg' }
  } catch {
    return { imageBase64: await rawBase64(blob), mimeType: type }
  }
}
