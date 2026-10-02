# 🚀 Organator Cloud (Control Plane OS)

**Organator Cloud** é uma plataforma Open Source de *Control Plane* desenhada para criadores de SaaS que desejam isolamento de infraestrutura (Single-Tenant) com a agilidade de um ambiente Multi-Tenant. 

Chega de provisionar bancos de dados e domínios manualmente para clientes *Enterprise*. O Organator orquestra deploys na Vercel, AWS e instâncias VPS com Docker de forma 100% automatizada.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node.js](https://img.shields.io/badge/Node.js-24-green)
![Next.js](https://img.shields.io/badge/Next.js-16-black)
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

## 📋 Estado das integrações

| Área | Estado |
| --- | --- |
| Autenticação (senha, MFA/TOTP, SSO/OIDC, API keys), convites e recuperação de senha por e-mail | Implementado e testado (unitários + E2E) |
| Cobrança com Stripe (checkout por assinatura, webhooks idempotentes, portal, faturas, cancelamento no offboarding) | Implementado e testado (unitários + E2E) |
| Ciclo de vida do tenant (onboarding, past_due, suspensão, offboarding) e audit log | Implementado e testado (unitários + E2E) |
| Isolamento de dados no PostgreSQL (SHARED / SCHEMA / DATABASE, com migração entre modos) | Implementado e testado contra PostgreSQL real (`DATA_ISOLATION_*`) |
| Deploy de serviços na Vercel e em VPS via SSH/Docker | Integrado com as APIs reais (a VPS ainda publica uma imagem fixa, `nginx:alpine`); falhas marcam o deploy como `FAILED` |
| Deploy na AWS | Ainda não automatizado: o deploy falha com mensagem explícita |
| Drivers de infraestrutura do tenant (rede, DNS, banco dedicado em nuvem) | **Simulados**: registram as fases, mas não criam recursos |

Com `PROVIDER_SIMULATION=true` (padrão no `docker compose`), falta de credenciais
ou falhas dos provedores viram resultados simulados para demonstração. Em
produção (`NODE_ENV=production` sem a variável) toda falha é reportada.

## 🏗 Arquitetura (Turborepo)

O projeto é um monorepo escalável:

```bash
/apps/backoffice-web       # Painel Admin & Onboarding Público (Next.js 16)
/apps/control-plane-api    # Cérebro da Operação (NestJS + Fastify + Prisma)
/apps/provisioner-worker   # Robô de Infraestrutura (Node.js + BullMQ)
/packages/core-models      # Esquemas de Banco de Dados (Prisma) globais
/packages/ui               # Design System Premium (Tailwind V4, React)
```

## 🚀 Como Rodar Localmente

Todo o ambiente está amarrado via **Docker Compose**, então a execução é simples. Você não precisa configurar o Redis ou o PostgreSQL manualmente!

### 1. Requisitos
- Node.js 24 e npm 11
- Docker e Docker Compose instalados.

### 2. Rodando o Ambiente Completo

```bash
npm install

# Postgres, Redis, migrações, API, Worker e painel
docker compose up --build
```

O serviço `migrate` aplica as migrações do Prisma antes de API e worker subirem.

O ambiente estará disponível em:
- **Painel Administrativo:** `http://localhost:3001`
- **Página de Registro Público:** `http://localhost:3001/register`
- **Control Plane API:** `http://localhost:3000` (`/health` e `/health/ready`)
- **Caixa de e-mails (Mailpit):** `http://localhost:8025` — recuperação de senha, ativação de conta e convites enviados pela API
- **Documentação da API (OpenAPI):** `http://localhost:3000/docs` — especificação em `/docs/openapi.json`, útil para gerar clientes (`openapi-generator`, `openapi-typescript`). O CI publica o `openapi.json` como artefato de cada build.

No primeiro boot a API cria o admin `admin@organator.app` e imprime a senha
temporária **uma única vez** nos logs (`docker compose logs control-plane-api | grep BOOTSTRAP`).

## 🧪 Testes

```bash
npm test                                 # todos os pacotes (turbo)
npx turbo lint
npm run test:e2e -w control-plane-api    # e2e da API (Fastify inject, sem banco)
```

Os testes de integração de isolamento de dados rodam contra um PostgreSQL real
quando `TEST_DATABASE_URL` está definido (o CI faz isso automaticamente).

## ☸️ Produção

- **Kubernetes/Helm:** [docs/deployment/kubernetes.md](docs/deployment/kubernetes.md) —
  secrets, banco/Redis gerenciados, migrações automáticas, probes e TLS.
- **Imagens:** cada tag `vX.Y.Z` publica `ghcr.io/wendelmax/organator-cloud/<app>:X.Y.Z`.
- **Configuração:** as variáveis estão documentadas em [.env.example](.env.example).
  Em produção a API recusa subir sem `JWT_SECRET`, `ENCRYPTION_KEY` e `CORS_ORIGINS` válidos.

## 🔒 Segurança

Containers rodam como não-root, credenciais de provedores são cifradas com
AES-256-GCM e o acesso é isolado por tenant (JWT, OIDC/SSO e API keys com
escopos). Para reportar uma vulnerabilidade, abra um
[security advisory privado](https://github.com/wendelmax/organator-cloud/security/advisories/new)
em vez de uma issue pública.

---
*Built with passion for SaaS Founders.*
