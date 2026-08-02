"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Button, Card, CardHeader, CardTitle, CardContent, Input } from "@organator/ui";

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001").replace(/\/v1$/, "");

const TYPE_LABELS: Record<string, string> = {
  AWS: "AWS",
  VERCEL: "Vercel",
  VPS: "VPS (SSH)",
};

interface ProviderCredential {
  id: string;
  type: string;
  name: string;
  secrets: Record<string, string>;
  config: Record<string, unknown>;
  createdAt?: string;
}

export default function ProvidersPage() {
  const { data: session } = useSession();
  const token = (session as any)?.accessToken;

  const [credentials, setCredentials] = useState<ProviderCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; mock?: boolean; message: string } | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [formType, setFormType] = useState("VERCEL");
  const [formName, setFormName] = useState("");
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [config, setConfig] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const authHeaders = useCallback(() => {
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }, [token]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/v1/providers`, { headers: authHeaders() });
      if (!res.ok) throw new Error("Não autorizado");
      setCredentials(await res.json());
    } catch (err: any) {
      setCredentials([]);
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    if (token) {
      load();
    }
  }, [token, load]);

  const handleTestConnection = async (cred: ProviderCredential) => {
    setTestingId(cred.id);
    setTestResult(null);
    try {
      const res = await fetch(`${API_URL}/v1/providers/${cred.id}/test-connection`, {
        method: "POST",
        headers: authHeaders(),
      });
      setTestResult({ ...(await res.json()), id: cred.id });
    } catch {
      setTestResult({ id: cred.id, ok: false, message: "Falha ao testar conexão" });
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async (cred: ProviderCredential) => {
    if (!confirm(`Excluir a credencial "${cred.name}"?`)) return;
    try {
      await fetch(`${API_URL}/v1/providers/${cred.id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      await load();
    } catch {
      alert("Falha ao excluir credencial");
    }
  };

  const secretFields = (type: string): { key: string; label: string; placeholder: string }[] => {
    if (type === "AWS") {
      return [
        { key: "accessKeyId", label: "Access Key ID", placeholder: "AKIA..." },
        { key: "secretAccessKey", label: "Secret Access Key", placeholder: "••••••••" },
      ];
    }
    if (type === "VPS") {
      return [{ key: "privateKey", label: "Chave privada (SSH)", placeholder: "-----BEGIN RSA PRIVATE KEY-----" }];
    }
    return [{ key: "apiToken", label: "API Token", placeholder: "sk_..." }];
  };

  const configFields = (type: string): { key: string; label: string; placeholder: string }[] => {
    if (type === "AWS") {
      return [{ key: "region", label: "Região", placeholder: "us-east-1" }];
    }
    if (type === "VERCEL") {
      return [{ key: "teamId", label: "Team ID (opcional)", placeholder: "team_xxx" }];
    }
    return [
      { key: "host", label: "Host", placeholder: "192.168.0.10" },
      { key: "port", label: "Porta", placeholder: "22" },
      { key: "username", label: "Usuário", placeholder: "root" },
      { key: "domain", label: "Domínio wildcard", placeholder: "*.organator.local" },
    ];
  };

  const resetForm = () => {
    setShowForm(false);
    setFormType("VERCEL");
    setFormName("");
    setSecrets({});
    setConfig({});
    setFormError(null);
  };

  const handleCreate = async () => {
    setFormError(null);
    if (!formName.trim()) {
      setFormError("Informe um nome para a credencial");
      return;
    }
    const required = secretFields(formType);
    for (const f of required) {
      if (!secrets[f.key]?.trim()) {
        setFormError(`Informe o campo "${f.label}"`);
        return;
      }
    }
    setSaving(true);
    try {
      const body: any = { type: formType, name: formName.trim(), secrets, config };
      const res = await fetch(`${API_URL}/v1/providers`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setFormError(data?.message || "Falha ao criar credencial");
        return;
      }
      resetForm();
      await load();
    } catch {
      setFormError("Falha ao criar credencial");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Provedores</h1>
          <p className="text-neutral-400 mt-1">Credenciais de nuvem cifradas (AWS, Vercel, VPS) para provisionamento</p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancelar" : "Nova Credencial"}
        </Button>
      </div>

      {showForm && (
        <Card className="p-6 bg-neutral-900 border-neutral-800 shadow-xl">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl font-semibold text-white">Nova Credencial</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <label className="flex flex-col gap-1 text-sm text-neutral-400">
                Tipo de provedor
                <select
                  value={formType}
                  onChange={(e) => {
                    setFormType(e.target.value);
                    setSecrets({});
                    setConfig({});
                  }}
                  className="h-10 rounded-md border border-neutral-800 bg-neutral-950 px-3 text-sm text-white"
                >
                  <option value="AWS">AWS</option>
                  <option value="VERCEL">Vercel</option>
                  <option value="VPS">VPS (SSH)</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-neutral-400">
                Nome
                <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="ex.: AWS principal" />
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {secretFields(formType).map((f) => (
                <label key={f.key} className="flex flex-col gap-1 text-sm text-neutral-400">
                  {f.label}
                  <Input
                    type="password"
                    value={secrets[f.key] || ""}
                    onChange={(e) => setSecrets((s) => ({ ...s, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                  />
                </label>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {configFields(formType).map((f) => (
                <label key={f.key} className="flex flex-col gap-1 text-sm text-neutral-400">
                  {f.label}
                  <Input
                    value={config[f.key] || ""}
                    onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                  />
                </label>
              ))}
            </div>

            {formError && <p className="text-sm text-red-400">{formError}</p>}

            <div className="flex justify-end">
              <Button onClick={handleCreate} disabled={saving}>
                {saving ? "Salvando..." : "Salvar Credencial"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {testResult && (
        <div className={`p-4 rounded-lg border text-sm ${testResult.ok ? "border-emerald-800/50 bg-emerald-950 text-emerald-400" : "border-red-800/50 bg-red-950 text-red-400"}`}>
          {testResult.mock ? "🧪 " : ""}
          {testResult.message}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4">
        {loading ? (
          <p className="text-neutral-500">Carregando credenciais...</p>
        ) : credentials.length === 0 ? (
          <p className="text-neutral-500">Nenhuma credencial cadastrada.</p>
        ) : (
          credentials.map((cred) => (
            <Card key={cred.id} className="p-6 bg-neutral-900 border-neutral-800 shadow-xl">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3">
                    <span className="px-2.5 py-1 bg-indigo-950 text-indigo-300 border border-indigo-800/50 rounded-full text-xs font-mono font-semibold uppercase">
                      {TYPE_LABELS[cred.type] || cred.type}
                    </span>
                    <h3 className="text-lg font-semibold text-white">{cred.name}</h3>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-neutral-400">
                    {Object.entries(cred.secrets || {}).map(([k, mask]) => (
                      <span key={k} className="font-mono">
                        {k}: <span className="text-neutral-300">{mask}</span>
                      </span>
                    ))}
                    {Object.entries(cred.config || {}).map(([k, v]) => (
                      <span key={k} className="font-mono">
                        {k}: <span className="text-neutral-300">{String(v)}</span>
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleTestConnection(cred)}
                    disabled={testingId === cred.id}
                  >
                    {testingId === cred.id ? "Testando..." : "Testar conexão"}
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => handleDelete(cred)}>
                    Excluir
                  </Button>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
