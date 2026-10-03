"use client";

import { Suspense, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { publicApiUrl, publicLegalUrls } from "../../../lib/public-env";
import { apiErrorMessage } from "../../../lib/api-error";

const API_URL = publicApiUrl();

interface ConsentStatus {
  versions: { terms: string; privacy: string };
  required: ("terms" | "privacy")[];
  preferences: { marketing: boolean; analytics: boolean };
}

/** Destino interno seguro depois do aceite (evita redirecionar para fora). */
const safeNext = (value: string | null) =>
  value && value.startsWith("/") && !value.startsWith("//") ? value : "/";

function ConsentForm() {
  const { data: session, status: sessionStatus } = useSession();
  const token = (session as any)?.accessToken as string | undefined;
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const { termsUrl, privacyUrl } = publicLegalUrls();
  const [status, setStatus] = useState<ConsentStatus | null>(null);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [preferences, setPreferences] = useState({ marketing: false, analytics: false });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (sessionStatus === "unauthenticated") router.replace("/login");
    if (!token) return;
    fetch(`${API_URL}/v1/compliance/consents`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ConsentStatus | null) => {
        if (!data) return;
        if (data.required.length === 0) router.replace(next);
        setStatus(data);
        setPreferences(data.preferences);
      });
  }, [token, sessionStatus, router, next]);

  if (!status) return <p className="text-center text-neutral-400">Carregando...</p>;

  const documents = {
    terms: { label: "Termos de uso", url: termsUrl, version: status.versions.terms },
    privacy: { label: "Política de privacidade", url: privacyUrl, version: status.versions.privacy },
  };
  const allAccepted = status.required.every((purpose) => accepted[purpose]);

  async function submit() {
    setSaving(true);
    setError(null);
    const changes = [
      ...status!.required.map((purpose) => ({ purpose, granted: true })),
      ...(Object.entries(preferences) as [string, boolean][])
        .filter(([purpose, granted]) => granted !== status!.preferences[purpose as "marketing"])
        .map(([purpose, granted]) => ({ purpose, granted })),
    ];
    for (const change of changes) {
      const res = await fetch(`${API_URL}/v1/compliance/consents`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(change),
      });
      if (!res.ok) {
        setError(await apiErrorMessage(res, "Não foi possível registrar o consentimento."));
        setSaving(false);
        return;
      }
    }
    router.replace(next);
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-neutral-400">
        Para continuar, leia e aceite os documentos abaixo. Você pode mudar as preferências opcionais
        depois em Configurações.
      </p>
      {status.required.map((purpose) => {
        const doc = documents[purpose];
        return (
          <label key={purpose} className="flex items-start gap-3 text-sm text-neutral-200">
            <input
              type="checkbox"
              className="mt-1"
              checked={Boolean(accepted[purpose])}
              onChange={(e) => setAccepted({ ...accepted, [purpose]: e.target.checked })}
            />
            <span>
              Li e aceito os{" "}
              {doc.url ? (
                <a href={doc.url} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">
                  {doc.label}
                </a>
              ) : (
                doc.label
              )}{" "}
              (versão {doc.version})
            </span>
          </label>
        );
      })}
      <fieldset className="space-y-2 border-t border-neutral-800 pt-4">
        <legend className="text-sm text-neutral-300 mb-1">Opcional</legend>
        <label className="flex items-center gap-3 text-sm text-neutral-300">
          <input
            type="checkbox"
            checked={preferences.marketing}
            onChange={(e) => setPreferences({ ...preferences, marketing: e.target.checked })}
          />
          Receber novidades e comunicações de marketing por e-mail
        </label>
        <label className="flex items-center gap-3 text-sm text-neutral-300">
          <input
            type="checkbox"
            checked={preferences.analytics}
            onChange={(e) => setPreferences({ ...preferences, analytics: e.target.checked })}
          />
          Permitir métricas de uso para melhorar o produto
        </label>
      </fieldset>
      {error && (
        <p role="status" className="text-sm text-red-300">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={() => void submit()}
        disabled={!allAccepted || saving}
        className="w-full px-4 py-2 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
      >
        {saving ? "Salvando..." : "Aceitar e continuar"}
      </button>
    </div>
  );
}

export default function ConsentPage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-neutral-950">
      <div className="w-full max-w-lg p-8 space-y-6 bg-neutral-900 rounded-xl shadow-2xl border border-neutral-800">
        <h1 className="text-2xl font-bold text-white">Termos e privacidade</h1>
        <Suspense fallback={null}>
          <ConsentForm />
        </Suspense>
      </div>
    </div>
  );
}
