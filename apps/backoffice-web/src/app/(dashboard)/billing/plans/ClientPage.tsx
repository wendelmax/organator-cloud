"use client";

import { useState, useTransition } from "react";
import { Button, Modal, Input, Card } from "@organator/ui";
import { createPlan, updatePlan, togglePlan, listPlans } from "./actions";

interface BillingPlan {
  slug: string;
  name: string;
  description?: string | null;
  price: number;
  currency: string;
  cycle: string;
  quotas: Record<string, number>;
  features: Record<string, boolean>;
  status: string;
  sortOrder: number;
  stripeProductId?: string | null;
  stripePriceId?: string | null;
  createdAt?: string;
}

function formatPrice(price: number, currency: string) {
  if (price === 0) return "Gratuito";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: (currency || "usd").toUpperCase(),
    }).format(price / 100);
  } catch {
    return `$${(price / 100).toFixed(2)}`;
  }
}

export function PlansClient({ initialPlans }: { initialPlans: BillingPlan[] }) {
  const [plans, setPlans] = useState<BillingPlan[]>(initialPlans);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<BillingPlan | null>(null);
  const [isPending, startTransition] = useTransition();

  const refresh = async () => {
    try {
      const data = await listPlans();
      if (Array.isArray(data)) setPlans(data);
    } catch (e) {
      console.error(e);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setIsModalOpen(true);
  };

  const openEdit = (plan: BillingPlan) => {
    setEditing(plan);
    setIsModalOpen(true);
  };

  async function handleSubmit(formData: FormData) {
    startTransition(async () => {
      try {
        if (editing) {
          await updatePlan(formData);
        } else {
          await createPlan(formData);
        }
        setIsModalOpen(false);
        setEditing(null);
        await refresh();
      } catch (e: any) {
        alert(e.message || "Erro ao salvar o plano");
      }
    });
  }

  async function handleToggle(plan: BillingPlan) {
    const action = plan.status === "active" ? "desativar" : "ativar";
    if (!confirm(`Deseja ${action} o plano "${plan.name}"?`)) return;
    startTransition(async () => {
      try {
        await togglePlan(plan.slug);
        await refresh();
      } catch (e: any) {
        alert(e.message || "Erro ao atualizar o plano");
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Planos de Billing</h1>
          <p className="text-neutral-400 mt-1">
            Cadastre, edite e sincronize os planos com o Stripe (produto + preço).
          </p>
        </div>
        <Button onClick={openCreate}>Novo Plano</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {plans.length === 0 ? (
          <Card className="p-8 text-center text-neutral-500 col-span-full">
            Nenhum plano cadastrado. Clique em "Novo Plano" para começar.
          </Card>
        ) : (
          plans.map((plan) => (
            <Card key={plan.slug} className="p-6 bg-neutral-900 border-neutral-800 shadow-xl flex flex-col gap-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-xl font-semibold text-white">{plan.name}</h3>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold uppercase ${
                        plan.status === "active"
                          ? "bg-emerald-950 text-emerald-400 border border-emerald-800/50"
                          : "bg-neutral-800 text-neutral-400 border border-neutral-700"
                      }`}
                    >
                      {plan.status}
                    </span>
                  </div>
                  <p className="text-neutral-500 text-sm mt-1">{plan.slug}</p>
                </div>
                <div className="text-right">
                  <div className="font-bold text-indigo-400 text-lg">
                    {formatPrice(plan.price, plan.currency)}
                  </div>
                  <div className="text-neutral-500 text-xs capitalize">/{plan.cycle}</div>
                </div>
              </div>

              {plan.description ? (
                <p className="text-neutral-400 text-sm">{plan.description}</p>
              ) : null}

              <div className="text-xs text-neutral-400 space-y-1">
                {Object.entries(plan.quotas || {}).map(([resource, limit]) => (
                  <div key={resource} className="flex justify-between border-b border-neutral-800/60 pb-1">
                    <span className="font-mono">{resource}</span>
                    <span className="font-semibold text-neutral-200">
                      {limit === -1 ? "Ilimitado" : limit}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2 mt-auto">
                <Button
                  variant="ghost"
                  className="flex-1 h-8 text-xs"
                  disabled={isPending}
                  onClick={() => openEdit(plan)}
                >
                  Editar
                </Button>
                <Button
                  variant="ghost"
                  className={`flex-1 h-8 text-xs ${
                    plan.status === "active"
                      ? "text-red-400 hover:text-red-300 hover:bg-red-500/10"
                      : "text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                  }`}
                  disabled={isPending}
                  onClick={() => handleToggle(plan)}
                >
                  {plan.status === "active" ? "Desativar" : "Ativar"}
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditing(null);
        }}
        title={editing ? `Editar plano "${editing.name}"` : "Novo Plano"}
        description="O plano é sincronizado com o Stripe (produto + preço) ao salvar."
      >
        <form action={handleSubmit} className="space-y-4">
          {editing ? (
            <input type="hidden" name="slug" value={editing.slug} />
          ) : null}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-neutral-200">Nome</label>
              <Input name="name" required defaultValue={editing?.name} placeholder="Ex: Pro" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-neutral-200">Slug</label>
              <Input
                name="slug"
                required
                disabled={!!editing}
                defaultValue={editing?.slug}
                placeholder="Ex: pro"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-neutral-200">Descrição</label>
            <Input
              name="description"
              defaultValue={editing?.description || ""}
              placeholder="Ex: Para times em produção."
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-neutral-200">Preço (USD/mês)</label>
              <Input
                name="priceUsd"
                type="number"
                step="0.01"
                min="0"
                required
                defaultValue={editing ? (editing.price / 100).toFixed(2) : "0.00"}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-neutral-200">Moeda</label>
              <Input name="currency" defaultValue={editing?.currency || "usd"} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-neutral-200">Ciclo</label>
              <select
                name="cycle"
                defaultValue={editing?.cycle || "monthly"}
                className="flex h-10 w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300"
              >
                <option value="monthly">Mensal</option>
                <option value="yearly">Anual</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-neutral-200">
                Quotas (JSON)
              </label>
              <textarea
                name="quotas"
                defaultValue={editing ? JSON.stringify(editing.quotas || {}, null, 2) : '{\n  "MICROSERVICE": 5,\n  "DEPLOYMENT": 20\n}'}
                className="flex min-h-[110px] w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-xs text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300"
              />
              <p className="text-[10px] text-neutral-500">-1 = ilimitado</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-neutral-200">
                Features (JSON)
              </label>
              <textarea
                name="features"
                defaultValue={editing ? JSON.stringify(editing.features || {}, null, 2) : '{\n  "apiKeys": true,\n  "auditLog": false\n}'}
                className="flex min-h-[110px] w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-xs text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-neutral-200">Status</label>
            <select
              name="status"
              defaultValue={editing?.status || "active"}
              className="flex h-10 w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300"
            >
              <option value="active">Ativo</option>
              <option value="inactive">Inativo</option>
            </select>
          </div>

          <div className="pt-4 flex justify-end gap-2">
            <Button
              variant="ghost"
              type="button"
              onClick={() => {
                setIsModalOpen(false);
                setEditing(null);
              }}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Salvando..." : editing ? "Salvar Alterações" : "Criar Plano"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
