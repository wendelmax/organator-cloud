"use client";

import { useState } from "react";
import { Button, Modal, Input, Card, CardHeader, CardTitle, CardContent } from "@navant/ui";

export function TenantsClient() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tenants</h1>
          <p className="text-neutral-400 mt-1">Gerencie as organizações isoladas do seu SaaS.</p>
        </div>
        <Button onClick={() => setIsModalOpen(true)}>Novo Tenant</Button>
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
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              <tr className="hover:bg-neutral-900/20 transition-colors">
                <td className="px-6 py-4 font-medium text-neutral-100">Acme Corp</td>
                <td className="px-6 py-4 text-neutral-400">acme.organator.io</td>
                <td className="px-6 py-4">
                  <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-medium text-blue-400">Enterprise</span>
                </td>
                <td className="px-6 py-4">
                  <span className="inline-flex items-center gap-1.5 text-green-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-500"></span> Ativo
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Modal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)}
        title="Cadastrar Novo Tenant"
        description="Crie um novo cliente para provisionar isoladamente a infraestrutura."
      >
        <form className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-neutral-200">Nome da Empresa</label>
            <Input placeholder="Ex: Acme Corporation" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-neutral-200">Subdomínio</label>
            <Input placeholder="Ex: acme" />
          </div>
          <div className="pt-4 flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={() => setIsModalOpen(false)}>Cancelar</Button>
            <Button type="button">Criar Tenant</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
