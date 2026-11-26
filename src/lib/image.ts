/** Shrink a pasted or picked image so it fits in browser storage: longest side 1200px, JPEG. */
export async function fileToSmallDataUrl(file: Blob, maxSide = 1200): Promise<{ src: string; w: number; h: number }> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('Could not read that image'))
      i.src = url
    })
    const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k)
    const c = document.createElement('canvas')
    c.width = w; c.height = h
    const ctx = c.getContext('2d')
    if (!ctx) throw new Error('Canvas is not available')
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h) // JPEG has no transparency
    ctx.drawImage(img, 0, 0, w, h)
    // An image is stored inside its board element, and one database document may not exceed 1 MiB.
    let q = 0.8, src = c.toDataURL('image/jpeg', q)
    while (src.length > 700_000 && q > 0.3) { q -= 0.15; src = c.toDataURL('image/jpeg', q) }
    if (src.length > 700_000) throw new Error('That image is too large to store')
    return { src, w, h }
  } finally { URL.revokeObjectURL(url) }
}
