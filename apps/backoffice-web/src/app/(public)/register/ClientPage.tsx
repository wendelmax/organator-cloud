"use client";

import { useState } from "react";
import { Button, Card, Input } from "@navant/ui";

export function RegisterClient() {
  const [step, setStep] = useState(1);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleStripeRedirect = (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);
    // Simula redirecionamento para o Stripe Checkout
    setTimeout(() => {
      alert("Redirecionando para o Stripe Checkout Segura...");
      setIsProcessing(false);
    }, 1500);
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
                  <Input required placeholder="Ex: John" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-neutral-300">Sobrenome</label>
                  <Input required placeholder="Ex: Doe" />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-neutral-300">Email Corporativo</label>
                <Input required type="email" placeholder="john@empresa.com" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-neutral-300">Nome da Organização (Tenant)</label>
                <Input required placeholder="Ex: Acme Corp" />
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
              <label className="block cursor-pointer">
                <input type="radio" name="plan" className="peer sr-only" defaultChecked />
                <Card className="p-6 bg-neutral-900 border-neutral-800 peer-checked:border-blue-500 peer-checked:ring-1 peer-checked:ring-blue-500 transition-all hover:bg-neutral-800">
                  <div className="flex justify-between items-center">
                    <div>
                      <h3 className="text-lg font-bold text-white">Pro</h3>
                      <p className="text-sm text-neutral-400">Até 5 microsserviços provisionados</p>
                    </div>
                    <div className="text-right">
                      <span className="text-2xl font-bold text-white">$49</span>
                      <span className="text-sm text-neutral-400">/mês</span>
                    </div>
                  </div>
                </Card>
              </label>

              <label className="block cursor-pointer">
                <input type="radio" name="plan" className="peer sr-only" />
                <Card className="p-6 bg-neutral-900 border-neutral-800 peer-checked:border-blue-500 peer-checked:ring-1 peer-checked:ring-blue-500 transition-all hover:bg-neutral-800">
                  <div className="flex justify-between items-center">
                    <div>
                      <h3 className="text-lg font-bold text-white">Enterprise</h3>
                      <p className="text-sm text-neutral-400">Nuvens ilimitadas e Docker VPS</p>
                    </div>
                    <div className="text-right">
                      <span className="text-2xl font-bold text-white">$199</span>
                      <span className="text-sm text-neutral-400">/mês</span>
                    </div>
                  </div>
                </Card>
              </label>

              <Button type="submit" size="lg" className="w-full py-6 text-lg mt-6" disabled={isProcessing}>
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
