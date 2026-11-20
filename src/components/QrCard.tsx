import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

export function QrCard() {
  const url = `${window.location.origin}/vendor`
  const [src, setSrc] = useState<string>('')
  useEffect(() => { void QRCode.toDataURL(url, { margin: 1, width: 220, color: { dark: '#0a0a0a', light: '#ffffff' } }).then(setSrc) }, [url])
  return (
    <section className="flex items-center gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/80 p-4">
      {src ? <img src={src} alt="QR code to vendor view" className="h-24 w-24 rounded-lg bg-white p-1" /> : <div className="h-24 w-24 rounded-lg bg-zinc-800" />}
      <div className="min-w-0">
        <p className="text-sm font-semibold text-zinc-100">Caterer view (scan on phone)</p>
        <p className="text-xs text-zinc-400">Anna sees food quantities, delivery times and her deposit only. No guest list, no host finances.</p>
        <a href="/vendor" target="_blank" rel="noreferrer" className="mt-1 inline-block break-all text-xs text-sky-400 underline">{url}</a>
      </div>
    </section>
  )
}
