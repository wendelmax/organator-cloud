"use client";

import { useState, useTransition } from "react";
import { Button, Modal, Input, Card } from "@organator/ui";
import {
  createTenant,
  addMember,
  updateMemberRole,
  removeMember,
  getMembers,
  updateTenant,
  changePlan,
  suspendTenant,
  reactivateTenant,
  archiveTenant,
  transferOwnership,
} from "./actions";

interface TenantMetrics {
  microservices: number;
  deployments: number;
  apiDocs: number;
  users: number;
  estimatedSpend: number;
}

interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  metrics?: TenantMetrics;
  users?: Member[];
}

interface Member {
  id: string;
  name?: string | null;
  email: string;
  role: string;
  createdAt: string;
}

type Status = "active" | "suspended" | "archived";

export function TenantsClient({
  initialTenants,
  initialMembers = [],
}: {
  initialTenants: Tenant[];
  initialMembers?: Member[];
}) {
  const [activeTab, setActiveTab] = useState<"tenants" | "members">("tenants");
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [isTenantModalOpen, setIsTenantModalOpen] = useState(false);
  const [isMemberModalOpen, setIsMemberModalOpen] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [planTenant, setPlanTenant] = useState<Tenant | null>(null);
  const [ownerTenant, setOwnerTenant] = useState<Tenant | null>(null);
  const [isPending, startTransition] = useTransition();

  const refreshMembers = async () => {
    try {
      const data = await getMembers();
      if (Array.isArray(data)) {
        setMembers(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const refreshTenants = async () => {
    window.location.reload();
  };

  async function handleCreateTenant(formData: FormData) {
    startTransition(async () => {
      await createTenant(formData);
      setIsTenantModalOpen(false);
      await refreshTenants();
    });
  }

  async function handleUpdateTenant(formData: FormData) {
    if (!editingTenant) return;
    startTransition(async () => {
      await updateTenant(editingTenant.id, formData);
      setEditingTenant(null);
      await refreshTenants();
    });
  }

  async function handleChangePlan(plan: string) {
    if (!planTenant) return;
    startTransition(async () => {
      await changePlan(planTenant.id, plan);
      setPlanTenant(null);
      await refreshTenants();
    });
  }

  async function handleTransferOwnership(newOwnerId: string) {
    if (!ownerTenant) return;
    startTransition(async () => {
      await transferOwnership(ownerTenant.id, newOwnerId);
      setOwnerTenant(null);
      await refreshTenants();
    });
  }

  async function handleStatusChange(tenant: Tenant, next: Status) {
    const actionLabel =
      next === "suspended"
        ? "suspender"
        : next === "archived"
          ? "arquivar"
          : "reativar";
    if (!confirm(`Tem certeza que deseja ${actionLabel} "${tenant.name}"?`)) return;
    startTransition(async () => {
      if (next === "suspended") await suspendTenant(tenant.id);
      else if (next === "archived") await archiveTenant(tenant.id);
      else await reactivateTenant(tenant.id);
      await refreshTenants();
    });
  }

  async function handleAddMember(formData: FormData) {
    startTransition(async () => {
      await addMember(formData);
      setIsMemberModalOpen(false);
      await refreshMembers();
    });
  }

  async function handleRoleChange(userId: string, newRole: string) {
    startTransition(async () => {
      await updateMemberRole(userId, newRole);
      await refreshMembers();
    });
  }

  async function handleRemoveMember(userId: string) {
    if (!confirm("Tem certeza que deseja remover este membro?")) return;
    startTransition(async () => {
      await removeMember(userId);
      await refreshMembers();
    });
  }

  const renderRoleBadge = (role: string) => {
    switch (role?.toUpperCase()) {
      case "OWNER":
        return (
          <span className="inline-flex items-center rounded-full bg-purple-500/10 border border-purple-500/20 px-2.5 py-0.5 text-xs font-semibold text-purple-400">
            OWNER
          </span>
        );
      case "ADMIN":
        return (
          <span className="inline-flex items-center rounded-full bg-blue-500/10 border border-blue-500/20 px-2.5 py-0.5 text-xs font-semibold text-blue-400">
            ADMIN
          </span>
        );
      case "DEVELOPER":
        return (
          <span className="inline-flex items-center rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
            DEVELOPER
          </span>
        );
      case "VIEWER":
      default:
        return (
          <span className="inline-flex items-center rounded-full bg-neutral-800 border border-neutral-700 px-2.5 py-0.5 text-xs font-semibold text-neutral-300">
            {role?.toUpperCase() || "VIEWER"}
          </span>
        );
    }
  };

  const renderStatusBadge = (status: string) => {
    const s = (status || "active").toLowerCase();
    if (s === "suspended") {
      return (
        <span className="inline-flex items-center gap-1.5 text-amber-400">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500"></span> Suspenso
        </span>
      );
    }
    if (s === "archived") {
      return (
        <span className="inline-flex items-center gap-1.5 text-neutral-500">
          <span className="h-1.5 w-1.5 rounded-full bg-neutral-600"></span> Arquivado
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-green-400">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500"></span> Ativo
      </span>
    );
  };

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="border-b border-neutral-800 flex gap-4">
        <button
          onClick={() => setActiveTab("tenants")}
          className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "tenants"
              ? "border-neutral-100 text-neutral-100"
              : "border-transparent text-neutral-400 hover:text-neutral-200"
          }`}
        >
          Organizações
        </button>
        <button
          onClick={() => setActiveTab("members")}
          className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "members"
              ? "border-neutral-100 text-neutral-100"
              : "border-transparent text-neutral-400 hover:text-neutral-200"
          }`}
        >
          Membros da Organização
        </button>
      </div>

      {activeTab === "tenants" ? (
        <>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Tenants</h1>
              <p className="text-neutral-400 mt-1">
                Gerencie as organizações isoladas do seu SaaS.
              </p>
            </div>
            <Button onClick={() => setIsTenantModalOpen(true)}>Novo Tenant</Button>
          </div>

          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-neutral-800 bg-neutral-900/50">
                  <tr>
                    <th className="px-6 py-4 font-medium text-neutral-300">Organização</th>
                    <th className="px-6 py-4 font-medium text-neutral-300">Domínio</th>
                    <th className="px-6 py-4 font-medium text-neutral-300">Plano</th>
                    <th className="px-6 py-4 font-medium text-neutral-300">Status</th>
                    <th className="px-6 py-4 font-medium text-neutral-300">Microserviços</th>
                    <th className="px-6 py-4 font-medium text-neutral-300">Spend</th>
                    <th className="px-6 py-4 font-medium text-neutral-300 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800">
                  {initialTenants.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-8 text-center text-neutral-500">
                        Nenhum tenant encontrado.
                      </td>
                    </tr>
                  ) : (
                    initialTenants.map((tenant) => (
                      <tr key={tenant.id} className="hover:bg-neutral-900/20 transition-colors">
                        <td className="px-6 py-4 font-medium text-neutral-100">{tenant.name}</td>
                        <td className="px-6 py-4 text-neutral-400">{tenant.slug}.organator.io</td>
                        <td className="px-6 py-4">
                          <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-medium text-blue-400">
                            {tenant.plan || "Default"}
                          </span>
                        </td>
                        <td className="px-6 py-4">{renderStatusBadge(tenant.status)}</td>
                        <td className="px-6 py-4 text-neutral-400">
                          {tenant.metrics?.microservices ?? 0}
                        </td>
                        <td className="px-6 py-4 text-neutral-400">
                          {tenant.metrics?.estimatedSpend != null
                            ? formatCurrency(tenant.metrics.estimatedSpend / 100)
                            : "-"}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={isPending}
                              onClick={() => setEditingTenant(tenant)}
                            >
                              Editar
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={isPending}
                              onClick={() => setPlanTenant(tenant)}
                            >
                              Plano
                            </Button>
                            {tenant.status !== "suspended" && tenant.status !== "archived" && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-amber-400 hover:text-amber-300"
                                disabled={isPending}
                                onClick={() => handleStatusChange(tenant, "suspended")}
                              >
                                Suspender
                              </Button>
                            )}
                            {tenant.status === "suspended" && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-green-400 hover:text-green-300"
                                disabled={isPending}
                                onClick={() => handleStatusChange(tenant, "active")}
                              >
                                Reativar
                              </Button>
                            )}
                            {tenant.status !== "archived" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-red-400 hover:text-red-300"
                                disabled={isPending}
                                onClick={() => handleStatusChange(tenant, "archived")}
                              >
                                Arquivar
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={isPending}
                              onClick={() => setOwnerTenant(tenant)}
                            >
                              Transferir
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Membros da Organização</h1>
              <p className="text-neutral-400 mt-1">
                Gerencie o acesso e funções dos membros da sua equipe.
              </p>
            </div>
            <Button onClick={() => setIsMemberModalOpen(true)}>Convidar Membro</Button>
          </div>

          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-neutral-800 bg-neutral-900/50">
                  <tr>
                    <th className="px-6 py-4 font-medium text-neutral-300">Nome</th>
                    <th className="px-6 py-4 font-medium text-neutral-300">Email</th>
                    <th className="px-6 py-4 font-medium text-neutral-300">Função</th>
                    <th className="px-6 py-4 font-medium text-neutral-300">Data de Criação</th>
                    <th className="px-6 py-4 font-medium text-neutral-300 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800">
                  {members.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-8 text-center text-neutral-500">
                        Nenhum membro encontrado.
                      </td>
                    </tr>
                  ) : (
                    members.map((member) => (
                      <tr key={member.id} className="hover:bg-neutral-900/20 transition-colors">
                        <td className="px-6 py-4 font-medium text-neutral-100">
                          {member.name || "Sem nome"}
                        </td>
                        <td className="px-6 py-4 text-neutral-400">{member.email}</td>
                        <td className="px-6 py-4">{renderRoleBadge(member.role)}</td>
                        <td className="px-6 py-4 text-neutral-400">
                          {member.createdAt
                            ? new Date(member.createdAt).toLocaleDateString("pt-BR")
                            : "-"}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <select
                              value={member.role}
                              disabled={isPending}
                              onChange={(e) => handleRoleChange(member.id, e.target.value)}
                              className="h-8 rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1 text-xs text-neutral-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neutral-400"
                            >
                              <option value="OWNER">OWNER</option>
                              <option value="ADMIN">ADMIN</option>
                              <option value="DEVELOPER">DEVELOPER</option>
                              <option value="VIEWER">VIEWER</option>
                            </select>
                            <Button
                              variant="ghost"
                              className="h-8 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10"
                              disabled={isPending}
                              onClick={() => handleRemoveMember(member.id)}
                            >
                              Remover
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {/* Modal Novo Tenant */}
      <Modal
        isOpen={isTenantModalOpen}
        onClose={() => setIsTenantModalOpen(false)}
        title="Cadastrar Novo Tenant"
        description="Crie um novo cliente para provisionar isoladamente a infraestrutura."
      >
        <form action={handleCreateTenant} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-neutral-200">Nome da Empresa</label>
            <Input name="name" required placeholder="Ex: Acme Corporation" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-neutral-200">Subdomínio</label>
            <Input name="slug" required placeholder="Ex: acme" />
          </div>
          <div className="pt-4 flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={() => setIsTenantModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Criando..." : "Criar Tenant"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal Editar Tenant */}
      <Modal
        isOpen={!!editingTenant}
        onClose={() => setEditingTenant(null)}
        title="Editar Tenant"
        description="Atualize o nome ou subdomínio da organização."
      >
        <form action={handleUpdateTenant} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-neutral-200">Nome da Empresa</label>
            <Input name="name" defaultValue={editingTenant?.name} required placeholder="Ex: Acme Corporation" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-neutral-200">Subdomínio</label>
            <Input name="slug" defaultValue={editingTenant?.slug} required placeholder="Ex: acme" />
          </div>
          <div className="pt-4 flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={() => setEditingTenant(null)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal Trocar Plano */}
      <Modal
        isOpen={!!planTenant}
        onClose={() => setPlanTenant(null)}
        title="Trocar Plano"
        description={`Altere o plano de "${planTenant?.name ?? ""}". As quotas serão atualizadas em tempo real.`}
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-neutral-200">Plano</label>
            <select
              defaultValue={planTenant?.plan}
              disabled={isPending}
              className="flex h-10 w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300"
              id="plan-select"
            >
              <option value="free">Free</option>
              <option value="pro">Pro</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>
          <div className="pt-4 flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={() => setPlanTenant(null)}>
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={isPending}
              onClick={() => {
                const select = document.getElementById("plan-select") as HTMLSelectElement;
                handleChangePlan(select.value);
              }}
            >
              {isPending ? "Salvando..." : "Salvar Plano"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal Transferir Ownership */}
      <Modal
        isOpen={!!ownerTenant}
        onClose={() => setOwnerTenant(null)}
        title="Transferir Ownership"
        description="Transfira o papel de OWNER para outro membro do mesmo tenant."
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-neutral-200">Novo OWNER</label>
            <select
              defaultValue=""
              disabled={isPending}
              className="flex h-10 w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300"
              id="owner-select"
            >
              <option value="" disabled>
                Selecione um membro...
              </option>
              {ownerTenant?.users?.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name || member.email} ({member.role})
                </option>
              ))}
            </select>
          </div>
          <div className="pt-4 flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={() => setOwnerTenant(null)}>
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={isPending}
              onClick={() => {
                const select = document.getElementById("owner-select") as HTMLSelectElement;
                if (select.value) handleTransferOwnership(select.value);
              }}
            >
              {isPending ? "Transferindo..." : "Transferir"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal Convidar Membro */}
      <Modal
        isOpen={isMemberModalOpen}
        onClose={() => setIsMemberModalOpen(false)}
        title="Convidar Membro"
        description="Adicione um novo usuário e defina a sua função na organização."
      >
        <form action={handleAddMember} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-neutral-200">Nome</label>
            <Input name="name" placeholder="Ex: João Silva" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-neutral-200">Email</label>
            <Input name="email" type="email" required placeholder="Ex: joao@empresa.com" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-neutral-200">Função</label>
            <select
              name="role"
              defaultValue="VIEWER"
              className="flex h-10 w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300"
            >
              <option value="OWNER">OWNER</option>
              <option value="ADMIN">ADMIN</option>
              <option value="DEVELOPER">DEVELOPER</option>
              <option value="VIEWER">VIEWER</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-neutral-200">Senha (opcional)</label>
            <Input name="password" type="password" placeholder="Min. 8 caracteres (opcional)" />
          </div>
          <div className="pt-4 flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={() => setIsMemberModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Convidando..." : "Convidar Membro"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
