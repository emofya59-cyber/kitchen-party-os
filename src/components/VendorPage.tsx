// /vendor: placeholder vendor portal (phase 2: WoodlandsCatererBot console for Anna).
export function VendorPage() {
  return (
    <div className="grid min-h-screen place-items-center bg-zinc-950 p-6 text-zinc-100">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-amber-600 text-2xl">🧑🏾‍🍳</div>
        <h1 className="text-2xl font-black">Vendor portal</h1>
        <p className="mt-2 text-zinc-400">WoodlandsCatererBot (Anna) will run here: incoming quote requests, auto-quoting from the catalog in ZMW, and Elicate Pay deposits.</p>
        <a href="/" className="mt-6 inline-block rounded-lg bg-zinc-800 px-4 py-2 text-sm hover:bg-zinc-700">← Host dashboard</a>
      </div>
    </div>
  )
}
