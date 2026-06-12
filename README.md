# 🚀 Organator Cloud (Control Plane OS)

**Organator Cloud** é uma plataforma Open Source de *Control Plane* desenhada para criadores de SaaS que desejam isolamento de infraestrutura (Single-Tenant) com a agilidade de um ambiente Multi-Tenant. 

Chega de provisionar bancos de dados e domínios manualmente para clientes *Enterprise*. O Organator orquestra deploys na Vercel, AWS e instâncias VPS com Docker de forma 100% automatizada.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Next.js](https://img.shields.io/badge/Next.js-15-black)
![Fastify](https://img.shields.io/badge/Fastify-5.0-black)
![BullMQ](https://img.shields.io/badge/BullMQ-Redis-red)

---

## 🌟 Funcionalidades

- **Dashboard Premium (Backoffice):** Interface incrível em Next.js usando o novo Tailwind V4 e Glassmorphism.
- **Onboarding Zero-Touch:** Seus clientes se cadastram por uma Landing Page pública, pagam via Stripe e a infraestrutura deles (Network, DB isolado) sobe automaticamente sem que você mexa um dedo.
- **Service Catalog Dinâmico:** Cadastre os microsserviços do seu produto e escolha a nuvem de destino (AWS ECS, Vercel Serverless ou VPS Puro via Docker).
- **Provisioner Async (Worker):** A API nunca fica bloqueada. Todo provisionamento de infra cai numa fila Redis robusta (BullMQ) tratada por um Node Worker em background.
- **Observabilidade Integrada:** Preparado para OpenTelemetry nativo.
- **Developer Portal:** Central de documentação (Swagger/Redoc) embarcada para os desenvolvedores que integram com o seu SaaS.

## 🏗 Arquitetura (Turborepo)

O projeto é um monorepo escalável:

```bash
/apps/backoffice-web       # Painel Admin & Onboarding Público (Next.js 15)
/apps/control-plane-api    # Cérebro da Operação (NestJS + Fastify + Prisma)
/apps/provisioner-worker   # Robô de Infraestrutura (Node.js + BullMQ)
/packages/core-models      # Esquemas de Banco de Dados (Prisma) globais
/packages/ui               # Design System Premium (Tailwind V4, React)
```

## 🚀 Como Rodar Localmente

Todo o ambiente está amarrado via **Docker Compose**, então a execução é simples. Você não precisa configurar o Redis ou o PostgreSQL manualmente!

### 1. Requisitos
- Node.js 20+
- Docker e Docker Compose instalados.

### 2. Rodando o Ambiente Completo

```bash
# Baixe as dependências e faça build local
npm install
npx turbo run build

# Suba a stack completa (Postgres, Redis, API, Worker e Next.js)
docker-compose up --build
```

O ambiente estará disponível em:
- **Painel Administrativo:** `http://localhost:3001`
- **Página de Registro Público:** `http://localhost:3001/register`
- **Control Plane API:** `http://localhost:3000`

---
*Built with passion for SaaS Founders.*
