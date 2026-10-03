"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@organator/ui";
import { publicApiUrl } from "../../../lib/public-env";
import { apiErrorMessage } from "../../../lib/api-error";

const API_URL = publicApiUrl();

interface PasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireDigit: boolean;
  requireSymbol: boolean;
  expiresAfterDays: number | null;
  historySize: number;
  maxFailedAttempts: number | null;
  lockoutMinutes: number | null;
}

const CHARACTER_RULES: [keyof PasswordPolicy, string][] = [
  ["requireUppercase", "Letra maiúscula"],
  ["requireLowercase", "Letra minúscula"],
  ["requireDigit", "Número"],
  ["requireSymbol", "Símbolo"],
];

/** Campo numérico opcional: vazio = sem limite próprio (null). */
const toOptionalNumber = (value: string) => (value.trim() === "" ? null : Number(value));

/** Política de senha do tenant (#104): OWNER/ADMIN veem, só o OWNER altera. */
export function PasswordPolicyCard() {
  const { data: session } = useSession();
  const token = (session as any)?.accessToken as string | undefined;
  const role = (session?.user as any)?.role as string | undefined;
  const canView = role === "OWNER" || role === "ADMIN";
  const canEdit = role === "OWNER";
  const [policy, setPolicy] = useState<PasswordPolicy | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token || !canView) return;
    fetch(`${API_URL}/v1/tenants/current/password-policy`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then(setPolicy)
      .catch(() => setPolicy(null));
  }, [token, canView]);

  if (!canView || !policy) return null;

  const set = <K extends keyof PasswordPolicy>(key: K, value: PasswordPolicy[K]) =>
    setPolicy({ ...policy, [key]: value });

  async function save() {
    if (!token || !policy) return;
    setSaving(true);
    setMessage(null);
    const res = await fetch(`${API_URL}/v1/tenants/current/password-policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(policy),
    });
    setSaving(false);
    if (res.ok) {
      setPolicy(await res.json());
      setMessage({ ok: true, text: "Política de senha atualizada." });
    } else {
      setMessage({ ok: false, text: await apiErrorMessage(res, "Não foi possível salvar a política.") });
    }
  }

  const numberField = (
    key: "minLength" | "historySize" | "expiresAfterDays" | "maxFailedAttempts" | "lockoutMinutes",
    label: string,
    hint: string,
  ) => (
    <label className="space-y-1 block">
      <span className="text-sm text-neutral-200">{label}</span>
      <Input
        type="number"
        aria-label={label}
        disabled={!canEdit}
        value={policy[key] ?? ""}
        onChange={(e) => {
          const value = e.target.value;
          if (key === "minLength" || key === "historySize") set(key, Number(value));
          else set(key, toOptionalNumber(value));
        }}
      />
      <span className="text-xs text-neutral-500">{hint}</span>
    </label>
  );

  return (
    <Card className="bg-neutral-900 border-neutral-800">
      <CardHeader>
        <CardTitle>Política de senha</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {!canEdit && (
          <p className="text-xs text-neutral-500">Somente o OWNER da organização pode alterar a política.</p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {numberField("minLength", "Tamanho mínimo", "Entre 8 e 128 caracteres.")}
          {numberField("historySize", "Senhas anteriores bloqueadas", "0 a 24. 0 permite repetir senhas.")}
          {numberField("expiresAfterDays", "Expiração (dias)", "Vazio: senhas não expiram.")}
          {numberField("maxFailedAttempts", "Tentativas até bloquear", "Vazio: padrão da plataforma.")}
          {numberField("lockoutMinutes", "Bloqueio (minutos)", "Vazio: padrão da plataforma.")}
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm text-neutral-200 mb-1">Exigir na senha</legend>
          <div className="flex flex-wrap gap-4">
            {CHARACTER_RULES.map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm text-neutral-300">
                <input
                  type="checkbox"
                  disabled={!canEdit}
                  checked={Boolean(policy[key])}
                  onChange={(e) => set(key, e.target.checked as never)}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        {message && (
          <p role="status" className={`text-sm ${message.ok ? "text-emerald-300" : "text-red-300"}`}>
            {message.text}
          </p>
        )}
        {canEdit && (
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? "Salvando..." : "Salvar política"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
