"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@organator/ui";

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001").replace(/\/v1$/, "");
const SCOPES = ["services:read", "services:write", "services:deploy", "docs:read", "docs:write", "tenants:read"];

export default function ApiKeysPage() {
  const { data: session } = useSession();
  const token = (session as any)?.accessToken;
  const [keys, setKeys] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["services:read"]);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const headers = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const load = useCallback(async () => { const res = await fetch(`${API_URL}/v1/api-keys`, { headers }); if (res.ok) setKeys(await res.json()); }, [token]);
  useEffect(() => { if (token) load(); }, [token, load]);
  async function create() { if (!name.trim()) return; const res = await fetch(`${API_URL}/v1/api-keys`, { method: "POST", headers, body: JSON.stringify({ name, scopes }) }); if (!res.ok) { alert("Não foi possível criar a chave"); return; } const data = await res.json(); setCreatedToken(data.token); setName(""); await load(); }
  async function revoke(id: string) { if (!confirm("Revogar esta chave? Esta ação é imediata.")) return; await fetch(`${API_URL}/v1/api-keys/${id}`, { method: "DELETE", headers }); await load(); }
  return <div className="space-y-6"><div><h1 className="text-3xl font-bold text-white">API Keys</h1><p className="text-neutral-400 mt-1">Crie credenciais para integrações e revogue-as quando necessário.</p></div>
    {createdToken && <Card className="border-amber-700 bg-amber-950/30"><CardContent className="p-5 space-y-2"><p className="text-amber-300 font-semibold">Copie esta chave agora. Ela não será exibida novamente.</p><code className="block break-all rounded bg-neutral-950 p-3 text-emerald-300">{createdToken}</code><Button variant="outline" onClick={() => navigator.clipboard.writeText(createdToken)}>Copiar</Button></CardContent></Card>}
    <Card className="bg-neutral-900 border-neutral-800"><CardHeader><CardTitle>Nova chave</CardTitle></CardHeader><CardContent className="space-y-4"><Input value={name} onChange={(e: any) => setName(e.target.value)} placeholder="Nome da integração" /><div className="grid grid-cols-1 md:grid-cols-2 gap-2">{SCOPES.map(scope => <label key={scope} className="text-sm text-neutral-300"><input type="checkbox" className="mr-2" checked={scopes.includes(scope)} onChange={() => setScopes(scopes.includes(scope) ? scopes.filter(s => s !== scope) : [...scopes, scope])} />{scope}</label>)}</div><Button onClick={create}>Criar API Key</Button></CardContent></Card>
    <Card className="bg-neutral-900 border-neutral-800"><CardHeader><CardTitle>Chaves existentes</CardTitle></CardHeader><CardContent className="space-y-2">{keys.length === 0 ? <p className="text-neutral-500">Nenhuma chave cadastrada.</p> : keys.map(key => <div key={key.id} className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 rounded border border-neutral-800 p-3"><div><p className="text-white font-medium">{key.name}</p><p className="text-xs text-neutral-500">{key.prefix} · {(key.scopes || []).join(", ")}</p></div><Button variant="outline" onClick={() => revoke(key.id)}>Revogar</Button></div>)}</CardContent></Card>
  </div>;
}
