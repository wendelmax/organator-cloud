# Design: Módulo de incidentes (#110)

- **Data**: 2026-10-18
- **Issue**: #110 — feat(v3.3.0): alertas, incidentes e status page
- **Escopo desta entrega**: módulo de incidentes completo (API + UI do backoffice)
- **Fora de escopo**: regras de alerta, status page pública, notificações a tenants

## Contexto e intenção

A issue #110 cobre três frentes (alertas, incidentes, status page). O trabalho
anterior já criou o schema Prisma (`Incident`, `IncidentUpdate`,
`IncidentTenant`) e a migração `20261007000000_incidents`, mas nenhum código de
aplicação existe. Esta entrega constrói o módulo de incidentes completo sobre
esse schema, restrito a `PLATFORM_ADMIN` no backoffice.

**Resultado esperado**: o operador da plataforma cria incidentes, atribui
responsável, publica atualizações em timeline (com notas internas), rastreia o
blast radius (tenants afetados) e resolve com registro de `resolvedAt` — tudo
auditado. A visão pública/tenant fica para a frente da status page.

**Decisão registrada**: nesta entrega nenhuma comunicação (e-mail, notificação)
é enviada a tenants; updates ficam apenas na timeline. Não há integrações
externas (webhooks/eventos) neste módulo.

## Seção 1 — API

Novo módulo `incidents` em `apps/control-plane-api/src/incidents/`, seguindo o
padrão do `billing`: `IncidentsModule`, `IncidentsService`,
`IncidentsController`, specs ao lado.

**Guards**: `@UseGuards(JwtAuthGuard, RolesGuard)` no controller, todos os
endpoints com `@Roles('PLATFORM_ADMIN')`. Todas as mutações (criação, PATCH,
timeline e blast radius) são exclusivas de `PLATFORM_ADMIN`, com `403` para
qualquer outra role — inclusive `SUPPORT`; as leituras seguem a convenção
repo-wide de acesso somente-leitura para `SUPPORT` (#103), concedida pelo
próprio `roles.guard.ts`.

**Endpoints**:

| Método | Rota | Descrição |
|---|---|---|
| GET | `/incidents` | Lista com filtros `status`, `severity`, `component` e paginação |
| POST | `/incidents` | Cria incidente; com `alertKey` já existente em incidente aberto, retorna o existente (idempotente) |
| GET | `/incidents/:id` | Detalhe com `updates` (timeline) e `affected` (tenants) |
| PATCH | `/incidents/:id` | Atualiza título, severidade, status, componente, `public`, responsável, `postmortemUrl` |
| POST | `/incidents/:id/updates` | Adiciona item na timeline |
| POST | `/incidents/:id/affected` | Adiciona tenant ao blast radius |
| DELETE | `/incidents/:id/affected/:tenantId` | Remove tenant do blast radius |

**Regras de negócio**:

- **Dedup por `alertKey`** (preparação para os alertas futuros da #110): ao
  criar com `alertKey` que já pertence a um incidente **aberto** (não
  `resolved`), retorna o incidente existente em vez de criar outro — resposta
  idempotente, nunca `409`. Ao resolver o incidente, limpa `alertKey` para que
  um novo alerta possa abrir um próximo.
- **Resolver**: marcar `status = resolved` preenche `resolvedAt` com o horário
  atual; reabrir (voltar de `resolved` para outro status) limpa `resolvedAt`.
- **Timeline**: cada update guarda `status` (investigating/identified/
  monitoring/resolved), `message`, `internal` (default `false`) e
  `authorEmail` extraído do usuário do JWT. Ordenação cronológica por
  `createdAt`.
- **Blast radius**: `POST` valida que o tenant existe (`404` caso contrário);
  adicionar tenant já presente é idempotente. `DELETE` de tenant não
  relacionado retorna `404`.

**Auditoria**: `AuditService.record()` em toda mutação, com ator do JWT
(`incident.create`, `incident.update`, `incident.update.add`,
`incident.affected.add`, `incident.affected.remove`), best-effort no padrão do
`AuditService` (nunca derruba a operação).

**Erros**:
- `401` sem token; `403` para roles ≠ `PLATFORM_ADMIN`
- `404` para `incidentId` ou `tenantId` inexistente
- Validação de entrada via DTOs class-validator no padrão do repo

## Seção 2 — UI do backoffice

Em `apps/backoffice-web/src/app/(dashboard)/incidentes/`, no padrão das
outras páginas (server actions em `actions.ts`, revalidação de rota).

**Lista** — `incidentes/page.tsx`:
- Filtros `status`, `severity`, `component` via query string
- Tabela: título + badge de severidade (critical vermelho / major laranja /
  minor cinza), status, componente, responsável, `startedAt`, contagem de
  updates
- Destaque visual para incidentes abertos (não-resolved)
- Botão "Novo incidente" com formulário: título, severidade, componente,
  público, responsável

**Detalhe** — `incidentes/[id]/page.tsx`:
- **Cabeçalho**: título, badges (severidade/status/componente), toggle
  "público", responsável editável, `postmortemUrl`, botão "Resolver"
  (`resolvedAt` exibido quando aplicável)
- **Timeline**: itens cronológicos; updates públicos com destaque, `internal`
  em estilo retraído com etiqueta "nota interna"; form para novo update
  (status da mensagem, texto, checkbox "nota interna"); autor e data em cada
  item
- **Blast radius**: chips dos tenants afetados com remoção + seletor para
  adicionar tenant (busca existente no backoffice)
- **Metadados**: `source`, `alertKey` (somente leitura — mostra origem do
  alerta quando houver), `startedAt`/`resolvedAt`

**Navegação**: item "Incidentes" no menu lateral do dashboard. Nenhuma rota
pública nova.

## Seção 3 — Dados, erros, testes e rollout

**Dados**: schema e migração `20261007000000_incidents` já existem; validar a
aplicação e regenerar o Prisma client antes da implementação. Tabelas novas,
nenhuma existente alterada além da relação `incidents IncidentTenant[]` em
`Tenant` — expandir→migrar→contrair respeitado, reversível.

**Testes**:
- `incidents.service.spec.ts`: dedup por `alertKey` (chave repetida em
  incidente aberto retorna o existente; resolver limpa a chave), `resolvedAt`
  automático ao resolver e limpeza ao reabrir, ordenação da timeline
- Padrão dos `*-controllers.spec.ts`: 401 sem token, 403 para role não
  permitida, 200 para `PLATFORM_ADMIN`
- Server actions no estilo de `server-actions.test.ts`
- Autorização negativa e entre-tenants conforme critérios da issue

**Rollout/rollback**: PR único (migração + módulo + UI). Rollback = reverter o
PR; como a migração só cria tabelas novas, reverter é seguro (perda dos dados
de incidentes aceitável para feature nova).

**Segurança**: API é a fronteira de autorização (a UI não); sem dados
pessoais/segredos em logs; notas internas nunca aparecem em leituras públicas
(futura status page filtra `internal = false`).
