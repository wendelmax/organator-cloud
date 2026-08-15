"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { Card, CardContent, CardHeader, CardTitle } from "@organator/ui";

const sections = [
  { href: "/tenants", title: "Organização e membros", description: "Dados da organização, usuários, papéis e convites." },
  { href: "/billing", title: "Billing e plano", description: "Plano atual, consumo, limites e pagamentos." },
  { href: "/api-keys", title: "API Keys", description: "Credenciais de integração, escopos e revogação." },
  { href: "/sessions", title: "Segurança e sessões", description: "Dispositivos conectados e revogação de acessos." },
  { href: "/providers", title: "Provedores", description: "Credenciais e configurações de infraestrutura." },
  { href: "/audit", title: "Auditoria", description: "Histórico de alterações e ações administrativas." },
];

export default function SettingsPage() {
  const { data: session } = useSession();
  const user = session?.user as any;
  return <div className="space-y-6"><div><h1 className="text-3xl font-bold text-white">Configurações</h1><p className="text-neutral-400 mt-1">Gerencie sua organização e os recursos da plataforma em um só lugar.</p></div><Card className="bg-neutral-900 border-neutral-800"><CardContent className="p-5"><p className="text-sm text-neutral-400">Sessão atual</p><p className="text-white font-medium">{user?.email || "Usuário autenticado"}</p><p className="text-xs text-neutral-500 mt-1">Papel: {user?.role || "—"} · Tenant: {user?.tenantId || "—"}</p></CardContent></Card><div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{sections.map(section => <Link key={section.href} href={section.href}><Card className="h-full bg-neutral-900 border-neutral-800 hover:border-indigo-500 transition-colors"><CardHeader><CardTitle className="text-lg">{section.title}</CardTitle></CardHeader><CardContent><p className="text-sm text-neutral-400">{section.description}</p></CardContent></Card></Link>)}</div></div>;
}
