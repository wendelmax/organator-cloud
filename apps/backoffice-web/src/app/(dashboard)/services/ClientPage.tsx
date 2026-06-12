"use client";

import { useState, useTransition } from "react";
import { Button, Modal, Input, Card, CardHeader, CardTitle, CardContent } from "@navant/ui";
import { createService } from "./actions";

interface Service {
  id: string;
  name: string;
  repository: string;
  cloudProvider: string;
}

export function ServicesClient({ initialServices }: { initialServices: Service[] }) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [cloudProvider, setCloudProvider] = useState("VERCEL");
  const [isPending, startTransition] = useTransition();

  async function handleCreate(formData: FormData) {
    startTransition(async () => {
      await createService(formData);
      setIsModalOpen(false);
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Catálogo de Serviços</h1>
          <p className="text-neutral-400 mt-1">Orquestre deploys para Vercel, AWS ou VPS via Docker.</p>
        </div>
        <Button onClick={() => setIsModalOpen(true)}>Registrar Serviço</Button>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {initialServices.length === 0 ? (
          <div className="col-span-full text-center py-10 text-neutral-500">
            Nenhum serviço registrado.
          </div>
        ) : (
          initialServices.map(service => (
            <Card key={service.id}>
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle>{service.name}</CardTitle>
                    <p className="text-sm text-neutral-400 mt-1">{service.repository}</p>
                  </div>
                  <span className="px-2 py-1 bg-neutral-900 border border-neutral-800 text-neutral-300 rounded text-xs font-mono">{service.cloudProvider}</span>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Button className="w-full" variant="outline">Deploy Lote</Button>
                  <a href={`/services/${service.id}`} className="w-full">
                    <Button className="w-full" variant="default">Ver Logs</Button>
                  </a>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Modal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)}
        title="Registrar Microsserviço"
        description="Configure um repositório e selecione a nuvem de destino."
      >
        <form action={handleCreate} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-neutral-200">Nome do Serviço</label>
            <Input name="name" required placeholder="Ex: Auth API" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-neutral-200">Repositório Git</label>
            <Input name="repository" required placeholder="Ex: github.com/sua-org/auth-api" />
          </div>
          
          <div className="space-y-2">
            <label className="text-sm font-medium text-neutral-200">Cloud Provider</label>
            <select 
              name="cloudProvider"
              value={cloudProvider}
              onChange={(e) => setCloudProvider(e.target.value)}
              className="flex h-10 w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300"
            >
              <option value="VERCEL">Vercel (Serverless)</option>
              <option value="AWS">AWS (ECS/EC2)</option>
              <option value="VPS">VPS (Docker Automático)</option>
            </select>
          </div>

          {cloudProvider === "VPS" && (
            <div className="space-y-2 p-3 bg-neutral-900 border border-neutral-800 rounded-lg">
              <label className="text-sm font-medium text-neutral-200">Configuração VPS</label>
              <Input name="vpsHost" placeholder="Ex: root@192.168.1.10" />
              <p className="text-xs text-neutral-500 mt-1">A chave SSH será gerada automaticamente.</p>
            </div>
          )}

          <div className="pt-4 flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={() => setIsModalOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
