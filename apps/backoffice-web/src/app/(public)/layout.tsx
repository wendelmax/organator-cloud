import { ReactNode } from "react";

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-50 flex flex-col">
      <header className="flex items-center justify-between px-8 py-6 border-b border-neutral-900 bg-neutral-950/50 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white">
            O
          </div>
          <span className="text-xl font-bold tracking-tight text-white">Organator Cloud</span>
        </div>
        <div className="flex items-center gap-4">
          <a href="/login" className="text-sm font-medium text-neutral-400 hover:text-white transition">Login</a>
        </div>
      </header>
      
      <main className="flex-1">
        {children}
      </main>
    </div>
  );
}
