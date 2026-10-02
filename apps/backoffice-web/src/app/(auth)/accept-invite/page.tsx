"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { publicApiUrl } from "../../../lib/public-env";

const API_URL = publicApiUrl();
const MIN_LENGTH = 8;

type Preview = {
  email: string;
  role: string;
  tenantName: string;
  accountExists: boolean;
};

const inputClass =
  "w-full px-4 py-2 mt-1 border border-neutral-700 bg-neutral-800 text-white rounded-lg focus:ring-2 focus:ring-blue-500";

function AcceptInvite() {
  const token = useSearchParams().get("token") ?? "";
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoadError("Link incompleto. Abra o link exatamente como recebido.");
      return;
    }
    fetch(
      `${API_URL}/v1/tenant-invitations/preview?token=${encodeURIComponent(token)}`,
    )
      .then(async (res) => {
        if (!res.ok) throw new Error();
        setPreview(await res.json());
      })
      .catch(() =>
        setLoadError(
          "Este convite é inválido, expirou ou já foi usado. Peça um novo convite ao administrador da organização.",
        ),
      );
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (preview && !preview.accountExists) {
      if (password.length < MIN_LENGTH) {
        setError(`A senha deve ter no mínimo ${MIN_LENGTH} caracteres.`);
        return;
      }
      if (password !== confirm) {
        setError("As senhas não coincidem.");
        return;
      }
    }
    setIsSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/v1/tenant-invitations/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name, password: password || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || "Não foi possível aceitar o convite.");
        return;
      }
      setDone(true);
    } catch {
      setError("Erro de rede. Tente novamente.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loadError) {
    return (
      <p className="p-3 bg-red-900/50 border border-red-500 text-red-200 text-sm rounded-lg">
        {loadError}
      </p>
    );
  }
  if (!preview) {
    return <p className="text-center text-neutral-400">Carregando convite...</p>;
  }
  if (done) {
    return (
      <div className="space-y-4">
        <p className="p-3 bg-emerald-950/50 border border-emerald-700 text-emerald-200 text-sm rounded-lg">
          Pronto! Você agora faz parte de <strong>{preview.tenantName}</strong>.
        </p>
        <Link
          href="/login"
          className="block w-full px-4 py-2 text-center font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700"
        >
          Entrar
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-center text-neutral-400">
        <strong className="text-white">{preview.email}</strong> foi convidado
        para <strong className="text-white">{preview.tenantName}</strong> como{" "}
        {preview.role}.
      </p>
      {error && (
        <div className="p-3 bg-red-900/50 border border-red-500 text-red-200 text-sm rounded-lg">
          {error}
        </div>
      )}
      {preview.accountExists ? (
        <p className="text-sm text-neutral-400">
          Você já tem uma conta: depois de aceitar, entre com a sua senha atual e
          troque de organização pelo menu.
        </p>
      ) : (
        <>
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-neutral-300">
              Seu nome
            </label>
            <input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-neutral-300">
              Crie uma senha
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="confirm" className="block text-sm font-medium text-neutral-300">
              Confirme a senha
            </label>
            <input
              id="confirm"
              type="password"
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={inputClass}
            />
          </div>
        </>
      )}
      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full px-4 py-2 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
      >
        {isSubmitting ? "Aceitando..." : "Aceitar convite"}
      </button>
    </form>
  );
}

export default function AcceptInvitePage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-neutral-950">
      <div className="w-full max-w-md p-8 space-y-6 bg-neutral-900 rounded-xl shadow-2xl border border-neutral-800">
        <h1 className="text-3xl font-bold text-center text-white">Convite</h1>
        <Suspense fallback={null}>
          <AcceptInvite />
        </Suspense>
      </div>
    </div>
  );
}
