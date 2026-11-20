// Elicate Pay client stub for *initiating* a mobile-money collection (deposit request).
// ⚠️ Everything Elicate-specific is a placeholder. Fill it in from Elicate's merchant API docs.
//
// Intended flow:
//   1. Host taps "Request deposit". The app inserts public.payments (status 'pending', provider_ref = our reference).
//   2. An edge function calls requestCollection() → Elicate prompts the payer's phone (+260...) for mobile money.
//   3. Elicate calls elicate-webhook → payment status updates → Realtime pushes it to the dashboard.

export type CollectionRequest = {
  reference: string    // our payments.provider_ref (or the id Elicate returns, if they assign it)
  amountZmw: number
  payerPhone: string   // +260XXXXXXXXX
  description: string  // e.g. "Deposit: Ba Mwape's Kitchen, Mutale's Kitchen Party"
}

export async function requestCollection(_req: CollectionRequest): Promise<{ providerRef: string }> {
  const base = Deno.env.get('ELICATE_API_BASE') // TODO(elicate): real base URL (sandbox vs live)
  const key = Deno.env.get('ELICATE_API_KEY')   // TODO(elicate): real auth scheme (API key? OAuth? merchant id + secret?)
  if (!base || !key) throw new Error('Elicate Pay is not configured (ELICATE_API_BASE / ELICATE_API_KEY)')
  // TODO(elicate): endpoint path, request body fields, network selection (MTN/Airtel/Zamtel), callback URL registration.
  throw new Error('requestCollection: TODO(elicate). Implement using Elicate Pay merchant API docs')
}
