"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@organator/ui";
import { useEffect, useState } from "react";

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001").replace(/\/v1$/, "");

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
  const token = (session as any)?.accessToken;
  const [tenant, setTenant] = useState<any>(null); const [name, setName] = useState(""); const [slug, setSlug] = useState(""); const [saved, setSaved] = useState(false);
  useEffect(() => { if (token) fetch(`${API_URL}/v1/tenants/current/settings`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.ok ? r.json() : null).then(data => { if (data) { setTenant(data); setName(data.name || ""); setSlug(data.slug || ""); } }); }, [token]);
  async function save() { if (!token) return; const r = await fetch(`${API_URL}/v1/tenants/current/settings`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ name, slug }) }); if (r.ok) { setTenant(await r.json()); setSaved(true); setTimeout(() => setSaved(false), 2500); } }
  return <div className="space-y-6"><div><h1 className="text-3xl font-bold text-white">Configurações</h1><p className="text-neutral-400 mt-1">Gerencie sua organização e os recursos da plataforma em um só lugar.</p></div><Card className="bg-neutral-900 border-neutral-800"><CardHeader><CardTitle>Organização</CardTitle></CardHeader><CardContent className="space-y-3"><Input value={name} onChange={(e: any) => setName(e.target.value)} placeholder="Nome da organização" /><Input value={slug} onChange={(e: any) => setSlug(e.target.value)} placeholder="Slug" /><Button onClick={save}>Salvar alterações</Button>{saved && <span className="ml-3 text-emerald-400 text-sm">Salvo</span>}</CardContent></Card><div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{sections.map(section => <Link key={section.href} href={section.href}><Card className="h-full bg-neutral-900 border-neutral-800 hover:border-indigo-500 transition-colors"><CardHeader><CardTitle className="text-lg">{section.title}</CardTitle></CardHeader><CardContent><p className="text-sm text-neutral-400">{section.description}</p></CardContent></Card></Link>)}</div></div>;
}
