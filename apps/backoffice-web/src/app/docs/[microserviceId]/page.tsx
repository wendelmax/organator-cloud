import React from 'react';
import Script from "next/script";
import { Metadata } from 'next';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      redoc: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        "spec-url"?: string;
      };
    }
  }
}

export default function RedocViewerPage({ params }: { params: { microserviceId: string } }) {
  // Num cenário real, buscaríamos a Spec JSON do banco via `params.microserviceId`
  // Simulando a URL do arquivo OpenAPI
  const specUrl = "https://petstore.swagger.io/v2/swagger.json";

  return (
    <div className="min-h-screen bg-white">
      <div className="bg-neutral-950 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">Organator - API Reference</h1>
        <a href="/login" className="text-sm text-neutral-400 hover:text-white">Área do Desenvolvedor</a>
      </div>
      
      {/* Container onde o Redoc será injetado */}
      {/* @ts-ignore */}
      <redoc spec-url={specUrl}></redoc>

      {/* Script Standalone do Redoc */}
      <Script 
        src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js" 
        strategy="lazyOnload"
      />
    </div>
  );
}
