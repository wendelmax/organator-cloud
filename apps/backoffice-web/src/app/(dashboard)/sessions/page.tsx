"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@organator/ui";

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001").replace(/\/v1$/, "");

export default function SessionsPage() {
  const { data: session } = useSession();
  const token = (session as any)?.accessToken;
  const [sessions, setSessions] = useState<any[]>([]);
  const load = useCallback(async () => { const res = await fetch(`${API_URL}/v1/auth/sessions`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }); if (res.ok) setSessions(await res.json()); }, [token]);
  useEffect(() => { if (token) load(); }, [token, load]);
  async function revoke(id: string) { if (!confirm("Revogar esta sessão?")) return; await fetch(`${API_URL}/v1/auth/sessions/${id}`, { method: "DELETE", headers: token ? { Authorization: `Bearer ${token}` } : {} }); await load(); }
  async function revokeOthers() { if (!confirm("Revogar todas as outras sessões?")) return; await fetch(`${API_URL}/v1/auth/sessions`, { method: "DELETE", headers: token ? { Authorization: `Bearer ${token}` } : {} }); await load(); }
  return <div className="space-y-6"><div className="flex items-center justify-between"><div><h1 className="text-3xl font-bold text-white">Sessões ativas</h1><p className="text-neutral-400 mt-1">Revogue acessos de dispositivos que você não reconhece.</p></div><Button variant="outline" onClick={revokeOthers}>Revogar outras sessões</Button></div><Card className="bg-neutral-900 border-neutral-800"><CardHeader><CardTitle>Dispositivos conectados</CardTitle></CardHeader><CardContent className="space-y-3">{sessions.length === 0 ? <p className="text-neutral-500">Nenhuma sessão ativa encontrada.</p> : sessions.map(item => <div key={item.id} className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 rounded border border-neutral-800 p-4"><div><p className="text-white">{item.userAgent || "Dispositivo desconhecido"}</p><p className="text-xs text-neutral-500">IP: {item.ip || "não informado"} · Último acesso: {new Date(item.lastSeenAt).toLocaleString()}</p></div><Button variant="outline" onClick={() => revoke(item.id)}>Revogar</Button></div>)}</CardContent></Card></div>;
}
