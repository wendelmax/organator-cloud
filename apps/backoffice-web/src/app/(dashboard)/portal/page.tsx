"use client";

import { useState, useEffect } from "react";
import { Button, Card, CardHeader, CardTitle, CardContent, Modal, Input } from "@organator/ui";
import { useSession } from "next-auth/react";

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001").replace(/\/v1$/, "");

interface ApiDoc {
  id: string;
  microserviceId: string;
  title: string;
  version: string;
  openApiSpec: string;
  isPublic: boolean;
  createdAt: string;
}

export default function DeveloperPortalPage() {
  const { data: session } = useSession();
  const [docs, setDocs] = useState<ApiDoc[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<ApiDoc | null>(null);
  const [formData, setFormData] = useState({ title: "", version: "1.0.0", microserviceId: "", openApiSpec: "" });
  const [loading, setLoading] = useState(true);

  const fetchPublicDocs = () => {
    setLoading(true);
    fetch(`${API_URL}/v1/docs/public`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setDocs(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => {
        setDocs([]);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchPublicDocs();
  }, []);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_URL}/v1/docs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${(session as any)?.accessToken ?? ""}`,
        },
        body: JSON.stringify({ ...formData, isPublic: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.error("Falha ao publicar spec:", data.message || `HTTP ${res.status}`);
        return;
      }
      setIsModalOpen(false);
      setFormData({ title: "", version: "1.0.0", microserviceId: "", openApiSpec: "" });
      fetchPublicDocs();
    } catch (err) {
      console.error("Erro ao cadastrar spec:", err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Developer Portal</h1>
          <p className="text-neutral-400 mt-1">Especificações OpenAPI ativas e documentação da API</p>
        </div>
        <Button onClick={() => setIsModalOpen(true)}>Publicar OpenAPI Spec</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {loading ? (
          <p className="col-span-full text-center py-10 text-neutral-400">Carregando documentações...</p>
        ) : docs.length === 0 ? (
          <Card className="col-span-full p-8 text-center bg-neutral-900/50 border-neutral-800">
            <p className="text-neutral-400">Nenhuma documentação OpenAPI cadastrada ainda.</p>
            <p className="text-sm text-neutral-500 mt-1">Clique em "Publicar OpenAPI Spec" para adicionar uma nova especificação.</p>
          </Card>
        ) : (
          docs.map((doc) => (
            <Card key={doc.id} className="p-4 bg-neutral-900 border-neutral-800 flex flex-col justify-between hover:border-neutral-700 transition-all">
              <CardHeader className="p-0 mb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg font-semibold text-white">{doc.title}</CardTitle>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-950 text-blue-400 border border-blue-800/50">
                    v{doc.version}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="p-0 space-y-3">
                <div className="flex items-center justify-between text-xs text-neutral-400">
                  <span>Serviço: <code className="text-neutral-300 font-mono">{doc.microserviceId}</code></span>
                  <span className="px-2 py-0.5 bg-green-950 text-green-400 rounded border border-green-800/50 text-[10px]">
                    {doc.isPublic ? "PÚBLICO" : "PRIVADO"}
                  </span>
                </div>
                <div className="p-3 bg-black/80 rounded-lg border border-neutral-800 font-mono text-xs text-neutral-300 max-h-36 overflow-y-auto whitespace-pre-wrap">
                  {doc.openApiSpec}
                </div>
              </CardContent>
              <div className="mt-4 pt-3 border-t border-neutral-800 flex justify-end">
                <Button variant="outline" size="sm" onClick={() => setSelectedDoc(doc)}>
                  Visualizar Spec Completa
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Publicar Especificação OpenAPI">
        <form onSubmit={handleUpload} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-neutral-300 mb-1">Título da API</label>
            <Input required placeholder="ex: Payment Service API" value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-300 mb-1">Versão</label>
            <Input required placeholder="ex: 1.0.0" value={formData.version} onChange={(e) => setFormData({ ...formData, version: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-300 mb-1">ID do Microsserviço</label>
            <Input required placeholder="ex: service-payment-api" value={formData.microserviceId} onChange={(e) => setFormData({ ...formData, microserviceId: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-300 mb-1">Especificação OpenAPI (JSON ou YAML)</label>
            <textarea
              required
              placeholder="Cole aqui o conteúdo da spec..."
              value={formData.openApiSpec}
              onChange={(e) => setFormData({ ...formData, openApiSpec: e.target.value })}
              className="w-full h-36 p-3 bg-neutral-950 border border-neutral-800 text-white font-mono text-xs rounded-lg focus:ring-1 focus:ring-blue-500 focus:outline-none"
            />
          </div>
          <Button type="submit" className="w-full">Salvar e Publicar</Button>
        </form>
      </Modal>

      {selectedDoc && (
        <Modal isOpen={!!selectedDoc} onClose={() => setSelectedDoc(null)} title={`${selectedDoc.title} (v${selectedDoc.version})`}>
          <div className="space-y-4">
            <div className="text-xs text-neutral-400">
              <p>ID do Microsserviço: <code className="text-blue-400 font-mono">{selectedDoc.microserviceId}</code></p>
              <p>Publicado em: {new Date(selectedDoc.createdAt).toLocaleString()}</p>
            </div>
            <div className="p-4 bg-black border border-neutral-800 rounded-lg max-h-96 overflow-y-auto">
              <pre className="text-green-400 font-mono text-xs whitespace-pre-wrap">{selectedDoc.openApiSpec}</pre>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
