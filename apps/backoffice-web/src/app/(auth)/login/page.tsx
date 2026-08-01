"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const res = await signIn("credentials", {
        email,
        password,
        redirect: false,
        callbackUrl: "/services",
      });

      if (res?.error) {
        setError("Credenciais inválidas. Por favor, tente novamente.");
        setIsSubmitting(false);
      } else if (res?.url) {
        router.push(res.url);
      }
    } catch (err) {
      setError("Ocorreu um erro ao tentar realizar o login.");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-neutral-950">
      <div className="w-full max-w-md p-8 space-y-6 bg-neutral-900 rounded-xl shadow-2xl border border-neutral-800">
        <h1 className="text-3xl font-bold text-center text-white">Organator</h1>
        <p className="text-sm text-center text-neutral-400">Entre com as suas credenciais para gerenciar sua infraestrutura</p>
        
        {error && (
          <div className="p-3 bg-red-900/50 border border-red-500 text-red-200 text-sm rounded-lg">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-300">Email</label>
            <input 
              type="email" 
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2 mt-1 border border-neutral-700 bg-neutral-800 text-white rounded-lg focus:ring-2 focus:ring-blue-500" 
              placeholder="admin@organator.app" 
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-300">Senha</label>
            <input 
              type="password" 
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2 mt-1 border border-neutral-700 bg-neutral-800 text-white rounded-lg focus:ring-2 focus:ring-blue-500" 
              placeholder="••••••••" 
            />
          </div>
          <button 
            type="submit" 
            disabled={isSubmitting}
            className="w-full px-4 py-2 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {isSubmitting ? "Entrando..." : "Entrar"}
          </button>
        </form>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-neutral-700" />
          </div>
          <div className="relative flex justify-center text-xs text-neutral-500">
            <span className="px-2 bg-neutral-900">ou</span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => signIn("voidauth", { callbackUrl: "/services" })}
          className="w-full px-4 py-2 font-semibold text-white bg-neutral-700 rounded-lg hover:bg-neutral-600 transition-colors"
        >
          Entrar com VoidAuth (SSO)
        </button>
      </div>
    </div>
  );
}
