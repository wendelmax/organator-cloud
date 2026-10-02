"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { publicApiUrl } from "../../../lib/public-env";

const API_URL = publicApiUrl();
const MIN_LENGTH = 8;

function ResetPasswordForm() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token) {
    return (
      <p className="p-3 bg-red-900/50 border border-red-500 text-red-200 text-sm rounded-lg">
        Link incompleto. Abra o link exatamente como recebido no e-mail ou{" "}
        <Link href="/forgot-password" className="underline">
          peça um novo
        </Link>
        .
      </p>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_LENGTH) {
      setError(`A senha deve ter no mínimo ${MIN_LENGTH} caracteres.`);
      return;
    }
    if (password !== confirm) {
      setError("As senhas não coincidem.");
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/v1/auth/password/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || "Não foi possível redefinir a senha.");
        return;
      }
      setDone(true);
    } catch {
      setError("Erro de rede. Tente novamente.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="space-y-4">
        <p className="p-3 bg-emerald-950/50 border border-emerald-700 text-emerald-200 text-sm rounded-lg">
          Senha definida. Por segurança, as sessões abertas foram encerradas.
        </p>
        <Link
          href="/login"
          className="block w-full px-4 py-2 text-center font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700"
        >
          Ir para o login
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="p-3 bg-red-900/50 border border-red-500 text-red-200 text-sm rounded-lg">
          {error}
          {/expirado|inválido/i.test(error) && (
            <>
              {" "}
              <Link href="/forgot-password" className="underline">
                Pedir um novo link
              </Link>
            </>
          )}
        </div>
      )}
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-neutral-300">
          Nova senha
        </label>
        <input
          id="password"
          type="password"
          required
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-4 py-2 mt-1 border border-neutral-700 bg-neutral-800 text-white rounded-lg focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div>
        <label htmlFor="confirm" className="block text-sm font-medium text-neutral-300">
          Confirme a nova senha
        </label>
        <input
          id="confirm"
          type="password"
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full px-4 py-2 mt-1 border border-neutral-700 bg-neutral-800 text-white rounded-lg focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full px-4 py-2 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
      >
        {isSubmitting ? "Salvando..." : "Definir senha"}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-neutral-950">
      <div className="w-full max-w-md p-8 space-y-6 bg-neutral-900 rounded-xl shadow-2xl border border-neutral-800">
        <h1 className="text-3xl font-bold text-center text-white">Definir senha</h1>
        <Suspense fallback={null}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </div>
  );
}
