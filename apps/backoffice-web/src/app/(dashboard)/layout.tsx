import Link from "next/link";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-neutral-950 text-white">
      {/* Sidebar Simples */}
      <aside className="w-64 bg-neutral-900 border-r border-neutral-800 p-6 flex flex-col gap-6">
        <div className="text-2xl font-bold tracking-tight bg-gradient-to-r from-blue-500 to-cyan-400 bg-clip-text text-transparent">
          Organator
        </div>
        <nav className="flex flex-col gap-2">
          <Link href="/tenants" className="px-4 py-2 rounded-md hover:bg-neutral-800 transition">Tenants</Link>
          <Link href="/services" className="px-4 py-2 rounded-md hover:bg-neutral-800 transition">Services Catalog</Link>
          <Link href="/portal" className="px-4 py-2 rounded-md hover:bg-neutral-800 transition text-blue-400">Developer Portal</Link>
          <Link href="/billing" className="px-4 py-2 rounded-md hover:bg-neutral-800 transition">Billing (Stripe)</Link>
        </nav>
      </aside>
      
      {/* Main Content */}
      <main className="flex-1 p-8 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
