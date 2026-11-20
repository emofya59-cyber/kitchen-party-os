const zmw = new Intl.NumberFormat('en-ZM', { style: 'currency', currency: 'ZMW', maximumFractionDigits: 0 })
export const formatZMW = (n: number | null | undefined) => (n == null ? '—' : zmw.format(n).replace('ZMW', 'K').replace(/\s/g, ' '))
export const formatZMWLong = (n: number | null | undefined) => (n == null ? '—' : `ZMW ${Math.round(n).toLocaleString('en-ZM')}`)

/** +260977123456 → +260 97 712 3456 */
export const formatPhone = (p: string | null) =>
  p && /^\+260\d{9}$/.test(p) ? `+260 ${p.slice(4, 6)} ${p.slice(6, 9)} ${p.slice(9)}` : (p ?? '')

export const formatCAT = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lusaka', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) + ' CAT'
    : '—'
