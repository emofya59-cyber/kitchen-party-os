import type { GuestRow } from '../types/database'

export type Lang = 'en' | 'bem'

/** Template reminder generator (used when Grok is unavailable). English or Bemba-friendly mix. */
export function reminderText(g: Pick<GuestRow, 'full_name' | 'rsvp_status'>, ev: { title: string; when: string; venue: string }, lang: Lang): string {
  const first = g.full_name.replace(/^(Mrs|Mr|Ms)\s+/, '').split(' ')[0]
  if (lang === 'bem') {
    return g.rsvp_status === 'confirmed'
      ? `Muli shani ${first}! Natotela ukuti mukesa ku ${ev.title} pa ${ev.when}, ku ${ev.venue}. Mwisa ne nsansa! 🎉`
      : `Muli shani ${first}! Twalimitumine invitation ku ${ev.title} pa ${ev.when}, ku ${ev.venue}. Napapata, tulandeni nga mukesa (reply YES/NO). Natotela!`
  }
  return g.rsvp_status === 'confirmed'
    ? `Hi ${first}, thank you for confirming! See you at ${ev.title} on ${ev.when} at ${ev.venue}. 🎉`
    : `Hi ${first}, a gentle reminder: you're invited to ${ev.title} on ${ev.when} at ${ev.venue}. Please reply YES or NO so we can plan food. Natotela!`
}

export const waLink = (phone: string | null, text: string) =>
  phone ? `https://wa.me/${phone.replace(/^\+/, '')}?text=${encodeURIComponent(text)}` : '#'
