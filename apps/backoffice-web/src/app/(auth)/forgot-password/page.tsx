"use client";

import { useState } from "react";
import Link from "next/link";
import { publicApiUrl } from "../../../lib/public-env";

const API_URL = publicApiUrl();

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/v1/auth/password/forgot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setSent(true);
    } catch {
      setError("Não foi possível enviar o pedido. Tente novamente em instantes.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-neutral-950">
      <div className="w-full max-w-md p-8 space-y-6 bg-neutral-900 rounded-xl shadow-2xl border border-neutral-800">
        <h1 className="text-3xl font-bold text-center text-white">Esqueceu a senha?</h1>

        {sent ? (
          <p className="p-3 bg-emerald-950/50 border border-emerald-700 text-emerald-200 text-sm rounded-lg">
            Se existir uma conta para <strong>{email}</strong>, enviamos um link
            para redefinir a senha. O link vale por 1 hora.
          </p>
        ) : (
          <>
            <p className="text-sm text-center text-neutral-400">
              Informe o e-mail da sua conta e enviaremos um link para criar uma nova senha.
            </p>
            {error && (
              <div className="p-3 bg-red-900/50 border border-red-500 text-red-200 text-sm rounded-lg">
                {error}
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-neutral-300">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2 mt-1 border border-neutral-700 bg-neutral-800 text-white rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="voce@empresa.com"
                />
              </div>
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full px-4 py-2 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {isSubmitting ? "Enviando..." : "Enviar link"}
              </button>
            </form>
          </>
        )}

        <p className="text-sm text-center">
          <Link href="/login" className="text-blue-400 hover:underline">
            Voltar para o login
          </Link>
        </p>
      </div>
    </div>
  );
}
