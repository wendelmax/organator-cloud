"use client";

import { useEffect, useState } from "react";
import { Button, Card, Input } from "@organator/ui";
import { publicApiUrl } from "../../../lib/public-env";
import { formatPlanPrice, planHighlights, type PublicPlan } from "../../../lib/plans";
import { apiErrorMessage } from "../../../lib/api-error";

const API_URL = publicApiUrl();

export function RegisterClient() {
  const [step, setStep] = useState(1);
  const [isProcessing, setIsProcessing] = useState(false);
  // Planos ativos cadastrados no painel: o preço exibido é o mesmo cobrado no
  // checkout (antes os valores eram fixos na página).
  const [plans, setPlans] = useState<PublicPlan[] | null>(null);
  const [plansError, setPlansError] = useState(false);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [signupDone, setSignupDone] = useState(false);
  const [coupon, setCoupon] = useState("");
  const [couponInfo, setCouponInfo] = useState<{ ok: boolean; text: string } | null>(null);
  const selectedPlan = plans?.find((plan) => plan.slug === selectedSlug) ?? null;
  const isFreePlan = selectedPlan ? selectedPlan.price === 0 : false;

  useEffect(() => {
    fetch(`${API_URL}/v1/billing/plans`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((data: PublicPlan[]) => {
        setPlans(data);
        // Pré-seleciona o primeiro plano pago (o gratuito continua disponível).
        setSelectedSlug((data.find((plan) => plan.price > 0) ?? data[0])?.slug ?? null);
      })
      .catch(() => setPlansError(true));
  }, []);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    tenantName: '',
  });

  // Mostra o desconto do cupom para o plano escolhido antes do checkout.
  async function checkCoupon() {
    if (!coupon.trim() || !selectedPlan) return setCouponInfo(null);
    const res = await fetch(
      `${API_URL}/v1/onboarding/coupons/${encodeURIComponent(coupon.trim())}?plan=${selectedPlan.slug}`,
    );
    if (!res.ok) {
      setCouponInfo({ ok: false, text: await apiErrorMessage(res, "Cupom inválido.") });
      return;
    }
    const data = await res.json();
    const off =
      data.percentOff !== null
        ? `${data.percentOff}% de desconto`
        : `${(data.amountOff / 100).toFixed(2)} ${data.currency.toUpperCase()} de desconto`;
    const period =
      data.duration === "forever" ? "em todas as cobranças" : data.duration === "repeating" ? `por ${data.durationInMonths} mês(es)` : "na primeira cobrança";
    setCouponInfo({ ok: true, text: `Cupom ${data.code}: ${off} ${period}.` });
  }

  // Plano pago -> checkout do Stripe; gratuito -> cadastro direto com link de
  // ativação por e-mail.
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedPlan) return;
    setIsProcessing(true);
    setSubmitError(null);
    const payload = {
      email: formData.email,
      tenantName: formData.tenantName,
      plan: selectedPlan.slug,
      ...(coupon.trim() && !isFreePlan ? { coupon: coupon.trim() } : {}),
    };

    try {
      const res = await fetch(`${API_URL}/v1/onboarding/${isFreePlan ? "signup" : "checkout"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setSubmitError(await apiErrorMessage(res, "Não foi possível concluir o cadastro."));
        setIsProcessing(false);
        return;
      }
      if (isFreePlan) {
        setSignupDone(true);
        setIsProcessing(false);
        return;
      }
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      setSubmitError("Não foi possível iniciar o checkout.");
    } catch {
      setSubmitError("Erro de rede. Tente novamente.");
    }
    setIsProcessing(false);
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

          <form onSubmit={handleSubmit}>
            <div className="space-y-4">
              {plansError && (
                <p className="text-sm text-red-300">Não foi possível carregar os planos. Tente novamente em instantes.</p>
              )}
              {!plans && !plansError && <p className="text-sm text-neutral-400">Carregando planos...</p>}
              {plans?.length === 0 && (
                <p className="text-sm text-neutral-400">Nenhum plano disponível no momento.</p>
              )}
              {plans?.map((plan) => (
                <label key={plan.slug} className="block cursor-pointer">
                  <input
                    type="radio"
                    name="plan"
                    value={plan.slug}
                    className="peer sr-only"
                    checked={selectedSlug === plan.slug}
                    onChange={() => setSelectedSlug(plan.slug)}
                  />
                  <Card className="p-6 bg-neutral-900 border-neutral-800 peer-checked:border-blue-500 peer-checked:ring-1 peer-checked:ring-blue-500 transition-all hover:bg-neutral-800">
                    <div className="flex justify-between items-center gap-4">
                      <div>
                        <h3 className="text-lg font-bold text-white">{plan.name}</h3>
                        <p className="text-sm text-neutral-400">
                          {plan.description || planHighlights(plan.quotas).join(" · ")}
                        </p>
                      </div>
                      <span className="text-xl font-bold text-white whitespace-nowrap">
                        {plan.price === 0 ? "Grátis" : formatPlanPrice(plan)}
                      </span>
                    </div>
                  </Card>
                </label>
              ))}

              {!isFreePlan && selectedPlan && (
                <div className="space-y-1">
                  <Input
                    aria-label="Cupom de desconto"
                    placeholder="Cupom de desconto (opcional)"
                    value={coupon}
                    onChange={(e) => {
                      setCoupon(e.target.value);
                      setCouponInfo(null);
                    }}
                    onBlur={() => void checkCoupon()}
                  />
                  {couponInfo && (
                    <p className={`text-xs ${couponInfo.ok ? "text-emerald-300" : "text-red-300"}`}>
                      {couponInfo.text}
                    </p>
                  )}
                </div>
              )}
              {submitError && (
                <p role="status" className="text-sm text-red-300">{submitError}</p>
              )}
              {signupDone ? (
                <p role="status" className="p-4 rounded-lg border border-emerald-700 bg-emerald-950/40 text-emerald-200 text-sm">
                  Conta criada! Enviamos para <strong>{formData.email}</strong> um link para ativar a conta e definir a senha.
                </p>
              ) : (
                <Button type="submit" size="lg" className="w-full py-6 text-lg mt-6" disabled={isProcessing || !selectedPlan}>
                  {isProcessing
                    ? isFreePlan ? "Criando conta..." : "Gerando Checkout..."
                    : isFreePlan ? "Criar conta grátis" : "Pagar via Stripe"}
                </Button>
              )}
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
