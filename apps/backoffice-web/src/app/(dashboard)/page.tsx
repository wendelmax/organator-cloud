export default function DashboardHome() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Dashboard</h1>
      <p className="text-neutral-400">Visão geral do seu SaaS e Infraestrutura.</p>
      
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="p-6 bg-neutral-900 border border-neutral-800 rounded-xl">
          <h2 className="text-lg font-semibold text-neutral-300">Total Tenants</h2>
          <p className="mt-2 text-4xl font-bold text-blue-400">12</p>
        </div>
        <div className="p-6 bg-neutral-900 border border-neutral-800 rounded-xl">
          <h2 className="text-lg font-semibold text-neutral-300">Microserviços</h2>
          <p className="mt-2 text-4xl font-bold text-purple-400">8</p>
        </div>
        <div className="p-6 bg-neutral-900 border border-neutral-800 rounded-xl">
          <h2 className="text-lg font-semibold text-neutral-300">Receita (Stripe)</h2>
          <p className="mt-2 text-4xl font-bold text-green-400">R$ 14.500</p>
        </div>
      </div>
    </div>
  );
}
