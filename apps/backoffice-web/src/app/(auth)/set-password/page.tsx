"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { SessionProvider } from "next-auth/react";

function SetPasswordForm() {
  const router = useRouter();
  const { data: session } = useSession();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    if (newPassword !== confirmPassword) {
      setError("As senhas não coincidem.");
      setIsSubmitting(false);
      return;
    }
    if (newPassword.length < 8) {
      setError("A nova senha deve ter no mínimo 8 caracteres.");
      setIsSubmitting(false);
      return;
    }

    try {
      const token = (session as any)?.accessToken;
      if (!token) {
        setError("Sessão inválida. Faça login novamente.");
        setIsSubmitting(false);
        return;
      }

      const res = await fetch("http://localhost:3001/v1/auth/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (res.ok) {
        setSuccess(true);
        setTimeout(() => router.push("/services"), 1200);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.message || "Não foi possível alterar a senha.");
      }
    } catch (err) {
      setError("Ocorreu um erro ao tentar alterar a senha.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-neutral-950">
      <div className="w-full max-w-md p-8 space-y-6 bg-neutral-900 rounded-xl shadow-2xl border border-neutral-800">
        <h1 className="text-3xl font-bold text-center text-white">Organator</h1>
        <p className="text-sm text-center text-neutral-400">
          Por segurança, defina uma nova senha antes de acessar o painel.
        </p>

        {error && (
          <div className="p-3 bg-red-900/50 border border-red-500 text-red-200 text-sm rounded-lg">
            {error}
          </div>
        )}
        {success && (
          <div className="p-3 bg-green-900/50 border border-green-500 text-green-200 text-sm rounded-lg">
            Senha atualizada com sucesso! Redirecionando...
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-300">Senha atual</label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full px-4 py-2 mt-1 border border-neutral-700 bg-neutral-800 text-white rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="••••••••"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-300">Nova senha</label>
            <input
              type="password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-4 py-2 mt-1 border border-neutral-700 bg-neutral-800 text-white rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="Mínimo 8 caracteres"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-300">Confirmar nova senha</label>
            <input
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-4 py-2 mt-1 border border-neutral-700 bg-neutral-800 text-white rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="••••••••"
            />
          </div>
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full px-4 py-2 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {isSubmitting ? "Salvando..." : "Definir nova senha"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function SetPasswordPage() {
  return (
    <SessionProvider>
      <SetPasswordForm />
    </SessionProvider>
  );
}
