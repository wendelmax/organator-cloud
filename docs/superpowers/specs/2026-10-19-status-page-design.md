# Design: Status page pública (#110)

- **Data**: 2026-10-19
- **Issue**: #110 — feat(v3.3.0): alertas, incidentes e status page
- **Escopo desta entrega**: status page pública derivada de incidentes (endpoint
  público + página `/status`)
- **Fora de escopo**: regras de alerta (frente restante da #110), embedding da
  status page em SaaS do cliente (não tem issue própria — decidido: registrar
  no PR), centro de notificações (#111)

## Contexto e intenção

A frente 1 da #110 (PR #233) entregou o módulo de incidentes com `PLATFORM_ADMIN`
e já preparou o terreno: `Incident.public` (default `true`, comentário "aparece
na status page pública") e `IncidentUpdate.internal` ("fora da status page"),
com invariante de teste registrada no plano da frente 1. Nenhuma leitura pública
existe hoje.

**Resultado esperado**: qualquer pessoa anônima acessa `/status` e vê o estado
dos sistemas da plataforma — status geral, status por componente e a lista de
incidentes públicos (abertos e resolvidos recentes) com a timeline de updates
públicos. A página é atualizada automaticamente a partir dos incidentes
registrados no backoffice; nenhuma manutenção manual de status.

**Decisões registradas**:
- Sem embedding/script para SaaS do cliente nesta entrega (não há issue
  dedicada; o endpoint público fica como base futura).
- Sem eventos externos, webhooks ou notificações — leitura pura.
- Sem migração de schema: os modelos necessários já existem.

## Seção 1 — API

Novo módulo `status` em `apps/control-plane-api/src/status/`, seguindo o padrão
dos módulos leves do repo: `StatusModule`, `StatusService`,
`StatusController`, specs ao lado (`status.service.spec.ts`,
`status.controller.spec.ts`).

**Endpoint público único**:

| Método | Rota | Descrição |
|---|---|---|
| GET | `/v1/status` | Estado agregado dos sistemas; **sem `@UseGuards`** |

- Sem `@UseGuards` no controller/método — mesmo padrão de `GET /health` e
  `GET /v1/docs/public` (guard no repo é por decorator, não global).
- `StatusController` separado do `IncidentsController`: superfície anônima não
  se mistura com a superfície `PLATFORM_ADMIN`.
- O cliente não controla o recorte: nenhum filtro vem da query string. O
  recorte (`public: true`, `internal: false`) é fixo no service.

**Formato da resposta**:

```jsonc
{
  "overall": "operational" | "degraded" | "outage",
  "components": [
    { "component": "api", "status": "operational", "activeIncidents": 0 }
    // uma entrada para cada um dos 5 componentes
  ],
  "incidents": [
    {
      "id": "...", "title": "...", "severity": "critical|major|minor",
      "status": "investigating|identified|monitoring|resolved",
      "component": "api",
      "startedAt": "...", "resolvedAt": null | "...",
      "updates": [
        { "status": "...", "message": "...", "createdAt": "..." }
      ]
    }
  ]
}
```

**Regras de derivação** (corpo dos testes do service):

| Regra | Definição |
|---|---|
| Status do componente | Incidente aberto (`status != resolved`) com `public: true` naquele componente: `critical` → **outage**; `major`/`minor` → **degraded**; nenhum → **operational** |
| Status geral (`overall`) | Pior status entre os 5 componentes |
| Componentes | Sempre os 5 (`api`, `dashboard`, `provisioning`, `billing`, `data-plane`), mesmo sem incidentes |
| Incidentes listados | `public: true` **E** (`status != resolved` **OU** `resolvedAt` dentro dos últimos 30 dias, calculado contra o relógio atual da API) — abertos sempre aparecem, mesmo antigos |
| Ordenação | Abertos primeiro (mais recente no topo), depois resolvidos por `resolvedAt` desc |
| Updates | Somente `internal: false`, ordem cronológica por `createdAt` |

**Campos nunca expostos**: `authorEmail`, `assigneeEmail`, `source`,
`alertKey`, `postmortemUrl` e blast radius (`IncidentTenant` / nomes de
tenants). PII e dados de tenants ficam apenas no backoffice.

**Erros**: falha/5xx da API não é tratado na API (é leitura simples); a
degradação é tratada na página (Seção 2). Sem audit event — leitura pública não
muta nada.

**OpenAPI**: decorators Swagger no padrão dos outros controllers, para o
documento exportado/validado no e2e e no job `docker` continuar consistente.

## Seção 2 — Página pública `/status`

Em `apps/backoffice-web/src/app/(public)/status/page.tsx` — route group
`(public)/` já existe com layout próprio (sem sessão; hoje só `/register`).

- **Server component** com `export const revalidate = 60` (ISR: leitura
  anônima pura, no máximo 1 request/60s na API por visitor em cache frio).
- Busca `GET ${API_URL}/v1/status` no server **sem token** (rota é pública).
- Conteúdo (pt-BR, Tailwind no padrão visual do `(public)`):
  - **Header geral**: ícone + "Todos os sistemas operacionais" /
    "Sistemas degradados" / "Interrupção nos sistemas", derivado de `overall`
  - **Linhas de componente**: os 5 componentes com badge de status e
    contador de incidentes ativos
  - **Lista de incidentes**: cards com título, badge de severidade, janela
    (`startedAt` → `resolvedAt` ou "em andamento") e timeline dos updates
    públicos; abertos no topo
- **Empty state**: sem incidentes listados → header geral já cobre
  ("Todos os sistemas operacionais")
- **Erro de fetch**: banner próprio "Não foi possível carregar o status" com
  horário da tentativa; sem stack/detalhes internos. O ISR retenta no próximo
  ciclo — a página nunca derruba

## Seção 3 — Dados, erros, testes, segurança e rollout

**Dados**: nenhuma migração; leitura direta dos modelos existentes
(`Incident`, `IncidentUpdate`), índices `[status, startedAt]` e
`[incidentId, createdAt]` já existentes cobrem as consultas.

**Testes** (padrão do repo):
- `status.service.spec.ts`: matriz de derivação por componente
  (vazio/minor/major/critical), pior-caso do `overall`, listagem de aberto
  antigo vs. resolvido >30 dias fora, corte de `internal: true` na timeline,
  ausência de `authorEmail`/tenants no payload
- `status.controller.spec.ts`: `Reflect.getMetadata(GUARDS_METADATA, ...)`
  `toBeUndefined()` — padrão de rota anônima de `admin-controllers.spec.ts`
- `test/app.e2e-spec.ts`: caso `GET /v1/status` retorna `200` **sem**
  `Authorization` (padrão `/health`)
- Web: `lint` + `build` verdes (página server component sem server action —
  não há token/envolvimento de sessão)

**Segurança**: API é a fronteira de autorização; filtro fixo no server; sem
PII (nem `authorEmail`) nem dados de tenants em resposta pública; sem segredos
em logs; rate limit/CORS globais já vêm de `configureAppSecurity`.

**Rollout/rollback**: entrega read-only, sem schema. Rollback = reverter o PR
(remover rota e página); nenhum dado é perdido.

**Critérios da issue cobertos**: status page deriva automaticamente dos
incidentes abertos/públicos; acesso é anônimo e a superfície pública é
restrita aos campos `public`/não-`internal` (decisão de escopo registrada).
Os critérios de alerta e "gerar incidente a partir de métricas" pertencem à
frente de regras de alerta (restante da #110).
