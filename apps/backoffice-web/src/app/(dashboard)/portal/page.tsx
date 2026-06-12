export default function DeveloperPortalAdmin() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Developer Portal (Admin)</h1>
        <button className="px-4 py-2 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700">
          Upload OpenAPI Spec
        </button>
      </div>
      <p className="text-neutral-400">
        Faça upload dos arquivos `openapi.json` dos seus microsserviços para expor a documentação no portal.
      </p>

      <div className="p-6 bg-neutral-900 border border-neutral-800 rounded-xl space-y-4">
        <h2 className="text-xl font-bold text-white">Documentações Ativas</h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-4 bg-neutral-800 rounded-lg border border-neutral-700">
            <div>
              <h3 className="font-bold text-white">Payment Processor API (v1.2.0)</h3>
              <p className="text-sm text-neutral-400">Atrelado ao serviço: payment-api</p>
            </div>
            <div className="flex items-center gap-4">
              <span className="px-2 py-1 bg-green-900/50 text-green-400 rounded text-xs">Público</span>
              <a href="/docs/123-payment-api" target="_blank" className="text-sm text-blue-400 hover:underline">
                Acessar Portal
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
