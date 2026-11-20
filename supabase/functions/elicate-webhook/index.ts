// Supabase Edge Function: elicate-webhook
// Receives Elicate Pay (mobile money) payment notifications and updates public.payments.
// Deploy with JWT verification OFF (Elicate can't send a Supabase JWT):
//   supabase functions deploy elicate-webhook --no-verify-jwt
//
// ⚠️ PLACEHOLDERS: Elicate Pay's real webhook contract (header names, signature
// algorithm, payload field names, status values) is NOT encoded here. Every spot
// that depends on it is marked `TODO(elicate)`. Fill these in from Elicate's
// merchant docs or sandbox before going live. Don't guess.
//
// Secrets: ELICATE_WEBHOOK_SECRET (TODO(elicate): confirm how Elicate signs webhooks)
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected by Supabase automatically.

import { createClient } from 'npm:@supabase/supabase-js@2'

type PaymentStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'refunded' | 'cancelled'

// TODO(elicate): replace with the real header name Elicate uses for the signature.
const SIGNATURE_HEADER = 'x-elicate-signature'

// TODO(elicate): map Elicate's real status strings to ours. These keys are placeholders.
const STATUS_MAP: Record<string, PaymentStatus> = {
  PLACEHOLDER_SUCCESS: 'succeeded',
  PLACEHOLDER_FAILED: 'failed',
  PLACEHOLDER_PENDING: 'processing',
  PLACEHOLDER_REFUNDED: 'refunded',
  PLACEHOLDER_CANCELLED: 'cancelled',
}

type NormalisedEvent = {
  providerRef: string
  status: PaymentStatus
  amountZmw: number | null
  payerPhone: string | null
  paidAt: string | null
}

// Normalise Zambian MSISDNs to +260XXXXXXXXX (payments.payer_phone has a CHECK constraint).
function toE164Zm(raw: unknown): string | null {
  if (raw == null) return null
  const d = String(raw).replace(/\D/g, '')
  if (/^260\d{9}$/.test(d)) return `+${d}`
  if (/^0\d{9}$/.test(d)) return `+260${d.slice(1)}`
  if (/^\d{9}$/.test(d)) return `+260${d}`
  return null
}

// TODO(elicate): read the real field names from Elicate's payload. The paths below are placeholders.
function normalise(payload: Record<string, any>): NormalisedEvent | null {
  const providerRef = payload?.PLACEHOLDER_reference ?? payload?.reference ?? null
  const rawStatus = payload?.PLACEHOLDER_status ?? payload?.status ?? null
  if (!providerRef || !rawStatus) return null
  const status = STATUS_MAP[String(rawStatus)]
  if (!status) return null
  return {
    providerRef: String(providerRef),
    status,
    amountZmw: payload?.PLACEHOLDER_amount != null ? Number(payload.PLACEHOLDER_amount) : null,
    payerPhone: toE164Zm(payload?.PLACEHOLDER_msisdn),
    paidAt: status === 'succeeded' ? new Date().toISOString() : null,
  }
}

// TODO(elicate): confirm the signing scheme. This assumes hex HMAC-SHA256 of the raw body,
// which is common but NOT confirmed for Elicate Pay.
async function verifySignature(rawBody: string, signature: string | null, secret: string): Promise<boolean> {
  if (!signature) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)))
  const expected = Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('')
  if (expected.length !== signature.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  return diff === 0
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })

  const rawBody = await req.text()
  const secret = Deno.env.get('ELICATE_WEBHOOK_SECRET')
  if (!secret) return new Response('ELICATE_WEBHOOK_SECRET not set', { status: 500 })
  if (!(await verifySignature(rawBody, req.headers.get(SIGNATURE_HEADER), secret))) {
    return new Response('invalid signature', { status: 401 })
  }

  let payload: Record<string, any>
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return new Response('invalid JSON', { status: 400 })
  }

  const evt = normalise(payload)
  if (!evt) return new Response('unrecognised payload (see TODO(elicate) in normalise())', { status: 422 })

  // Service role bypasses RLS: only this webhook may move a payment out of 'pending'.
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  const { data: existing, error: findErr } = await admin
    .from('payments')
    .select('id, status, amount_zmw')
    .eq('provider_ref', evt.providerRef)
    .maybeSingle()
  if (findErr) return new Response(findErr.message, { status: 500 })
  if (!existing) return new Response('unknown provider_ref', { status: 404 })

  // Idempotency: don't regress a final state.
  if (['succeeded', 'refunded'].includes(existing.status) && evt.status !== 'refunded') {
    return new Response(JSON.stringify({ ok: true, idempotent: true }), { headers: { 'Content-Type': 'application/json' } })
  }
  if (evt.amountZmw != null && Number(existing.amount_zmw) !== evt.amountZmw) {
    // TODO(elicate): decide policy for partial/over payments (fees may change the amount)
    console.warn('amount mismatch', { ref: evt.providerRef, expected: existing.amount_zmw, got: evt.amountZmw })
  }

  const { error: updErr } = await admin
    .from('payments')
    .update({
      status: evt.status,
      raw_payload: payload,
      paid_at: evt.paidAt,
      payer_phone: evt.payerPhone ?? undefined,
    })
    .eq('id', existing.id)
  if (updErr) return new Response(updErr.message, { status: 500 })

  // payments is in the supabase_realtime publication → the host dashboard updates live.
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } })
})
