export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-neutral-950 text-white">
      {/* Sidebar Simples */}
      <aside className="w-64 bg-neutral-900 border-r border-neutral-800 p-6 flex flex-col gap-6">
        <div className="text-2xl font-bold tracking-tight bg-gradient-to-r from-blue-500 to-cyan-400 bg-clip-text text-transparent">
          Organator
        </div>
        <nav className="flex flex-col gap-2">
          <a href="/tenants" className="px-4 py-2 rounded-md hover:bg-neutral-800 transition">Tenants</a>
          <a href="/services" className="px-4 py-2 rounded-md hover:bg-neutral-800 transition">Services Catalog</a>
          <a href="/portal" className="px-4 py-2 rounded-md hover:bg-neutral-800 transition text-blue-400">Developer Portal</a>
          <a href="/billing" className="px-4 py-2 rounded-md hover:bg-neutral-800 transition">Billing (Stripe)</a>
        </nav>
      </aside>
      
      {/* Main Content */}
      <main className="flex-1 p-8 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
