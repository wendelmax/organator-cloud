"use client";

import { useEffect, useState } from "react";
import { Button, Card, Input } from "@organator/ui";
import { publicApiUrl } from "../../../lib/public-env";
import { formatPlanPrice, planHighlights, type PublicPlan } from "../../../lib/plans";

const API_URL = publicApiUrl();

export function RegisterClient() {
  const [step, setStep] = useState(1);
  const [isProcessing, setIsProcessing] = useState(false);
  // Planos ativos cadastrados no painel: o preço exibido é o mesmo cobrado no
  // checkout (antes os valores eram fixos na página).
  const [plans, setPlans] = useState<PublicPlan[] | null>(null);
  const [plansError, setPlansError] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/v1/billing/plans`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((data: PublicPlan[]) => setPlans(data.filter((plan) => plan.price > 0)))
      .catch(() => setPlansError(true));
  }, []);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    tenantName: '',
  });

  const handleStripeRedirect = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsProcessing(true);
    
    const form = e.currentTarget;
    const plan = (form.elements.namedItem('plan') as RadioNodeList).value;

    try {
      const res = await fetch(`${API_URL}/v1/onboarding/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: formData.email,
          tenantName: formData.tenantName,
          plan
        })
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert("Erro ao criar checkout");
        setIsProcessing(false);
      }
    } catch (err) {
      alert("Erro de rede");
      setIsProcessing(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-20">
      <div className="text-center mb-16 space-y-4">
        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-white">
          Comece a usar o <span className="text-blue-500">Organator</span> hoje.
        </h1>
        <p className="text-lg text-neutral-400 max-w-2xl mx-auto">
          Cadastre sua organização, conecte seu repositório e receba sua infraestrutura na nuvem pronta para uso em menos de 2 minutos.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-12 items-start">
        {/* Formulário de Cadastro */}
        <div className="space-y-8">
          <div className="flex items-center gap-4">
            <div className={`flex items-center justify-center w-8 h-8 rounded-full ${step >= 1 ? 'bg-blue-600 text-white' : 'bg-neutral-800 text-neutral-500'} font-bold text-sm`}>1</div>
            <h2 className="text-xl font-bold text-white">Crie sua Conta</h2>
          </div>
          
          <Card className="p-6 bg-neutral-900 border-neutral-800">
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setStep(2); }}>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-neutral-300">Primeiro Nome</label>
                  <Input required placeholder="Ex: John" value={formData.firstName} onChange={e => setFormData({...formData, firstName: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-neutral-300">Sobrenome</label>
                  <Input required placeholder="Ex: Doe" value={formData.lastName} onChange={e => setFormData({...formData, lastName: e.target.value})} />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-neutral-300">Email Corporativo</label>
                <Input required type="email" placeholder="john@empresa.com" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-neutral-300">Nome da Organização (Tenant)</label>
                <Input required placeholder="Ex: Acme Corp" value={formData.tenantName} onChange={e => setFormData({...formData, tenantName: e.target.value})} />
              </div>
              <Button type="submit" className="w-full mt-4" disabled={step > 1}>
                Continuar para Planos
              </Button>
            </form>
          </Card>
        </div>

        {/* Seleção de Planos (Stripe) */}
        <div className={`space-y-8 transition-opacity duration-500 ${step >= 2 ? 'opacity-100' : 'opacity-30 pointer-events-none'}`}>
          <div className="flex items-center gap-4">
            <div className={`flex items-center justify-center w-8 h-8 rounded-full ${step >= 2 ? 'bg-blue-600 text-white' : 'bg-neutral-800 text-neutral-500'} font-bold text-sm`}>2</div>
            <h2 className="text-xl font-bold text-white">Escolha um Plano</h2>
          </div>

          <form onSubmit={handleStripeRedirect}>
            <div className="space-y-4">
              {plansError && (
                <p className="text-sm text-red-300">Não foi possível carregar os planos. Tente novamente em instantes.</p>
              )}
              {!plans && !plansError && <p className="text-sm text-neutral-400">Carregando planos...</p>}
              {plans?.length === 0 && (
                <p className="text-sm text-neutral-400">Nenhum plano pago disponível no momento.</p>
              )}
              {plans?.map((plan, index) => (
                <label key={plan.slug} className="block cursor-pointer">
                  <input type="radio" name="plan" value={plan.slug} className="peer sr-only" defaultChecked={index === 0} />
                  <Card className="p-6 bg-neutral-900 border-neutral-800 peer-checked:border-blue-500 peer-checked:ring-1 peer-checked:ring-blue-500 transition-all hover:bg-neutral-800">
                    <div className="flex justify-between items-center gap-4">
                      <div>
                        <h3 className="text-lg font-bold text-white">{plan.name}</h3>
                        <p className="text-sm text-neutral-400">
                          {plan.description || planHighlights(plan.quotas).join(" · ")}
                        </p>
                      </div>
                      <span className="text-xl font-bold text-white whitespace-nowrap">{formatPlanPrice(plan)}</span>
                    </div>
                  </Card>
                </label>
              ))}

              <Button type="submit" size="lg" className="w-full py-6 text-lg mt-6" disabled={isProcessing || !plans?.length}>
                {isProcessing ? "Gerando Checkout..." : "Pagar via Stripe"}
              </Button>
              <p className="text-xs text-center text-neutral-500 mt-4">
                Pagamento processado de forma segura pelo Stripe. 
                Seu banco de dados será provisionado após a aprovação.
              </p>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
