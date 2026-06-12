export default function BillingPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Faturamento & Assinaturas</h1>
        <button className="px-4 py-2 font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700">
          Sincronizar Stripe
        </button>
      </div>
      <p className="text-neutral-400">Integração nativa com Stripe para controle financeiro dos Tenants.</p>

      <div className="p-6 bg-neutral-900 border border-neutral-800 rounded-xl">
        <h2 className="text-lg font-semibold text-white mb-4">Planos Configuráveis</h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-neutral-800 rounded-lg border border-neutral-700">
            <div>
              <h3 className="font-bold text-white">Plano Starter</h3>
              <p className="text-sm text-neutral-400">Price ID: price_1xyz... (Stripe)</p>
            </div>
            <div className="text-right">
              <span className="font-bold text-green-400">R$ 99 / mês</span>
            </div>
          </div>
          <div className="flex items-center justify-between p-4 bg-neutral-800 rounded-lg border border-neutral-700">
            <div>
              <h3 className="font-bold text-white">Plano Enterprise</h3>
              <p className="text-sm text-neutral-400">Price ID: price_2abc... (Stripe)</p>
            </div>
            <div className="text-right">
              <span className="font-bold text-green-400">R$ 499 / mês</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
