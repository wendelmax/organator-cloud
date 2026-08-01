# ADR-001 — Frontend: Shell único vs Micro-frontend

- **Data:** 2026-08-01
- **Status:** Aceito
- **Decisores:** Plataforma (equipe Organator Cloud)
- **Issues:** #68 (Avaliar e adotar framework de Developer Portal)

## Contexto

O Organator Cloud precisa servir públicos distintos: platform engineers (console/control view), product engineers/devs (self-service hub, resource overview), usuários finais dos tenants e clientes white-label. A pergunta em questão: compensa adotar uma **arquitetura de micro-frontend** (Module Federation / single-spa) para cobrir todas as telas com visões diferentes por público?

## Decisão

**Não adotar micro-frontend.** Manter **um único app shell** (Next.js no monorepo Turborepo) com:

- **Route groups** do Next.js para separar públicos no mesmo shell (`(auth)`, `(public)`, `(dashboard)`, futuro `(portal)`).
- **`@organator/ui`** como base visual única compartilhada.
- **Packages embarcáveis** (`@organator/sdk`, widgets) como a forma de "micro" que importa: ilhas publicáveis consumíveis por qualquer shell do cliente (white-label).
- **Split lazy por workspace** quando (e se) um público específico exigir deploy independente — o Turborepo já suporta extrair um novo app sem Module Federation.

## Consequências

### Positivas

- Zero overhead de coordenação de micro-frontends (roteamento distribuído, estado global, isolamento de estilos, matriz de versões, E2E entre apps).
- Um único backend (`control-plane-api`) atendendo todos os públicos; context switcher (#48) e RBAC funcionam no mesmo domínio sem fronteiras artificiais.
- Performance: um bundle, sem latência de composição runtime.
- White-label continua resolvido por embedding (widgets/SDK), não por decomposição arquitetural.

### Negativas / Riscos

- Se o time crescer para 3+ squads independentes, o monólito de UI exigirá split — mitigado pela capacidade nativa do Turborepo de extrair apps por workspace.
- Se um cliente white-label exigir deploy/CDN totalmente independentes em escala, pode ser necessária a extração de um app dedicado.

### Condições de revisão

Revisitar esta decisão se surgirem: 3+ times com cadência de deploy própria; necessidade de versionamento independente por cliente; ecossistema de plugins de UI de terceiros.

## Alternativas consideradas

1. **Micro-frontend (Module Federation / single-spa)** — rejeitado: custo alto para time pequeno, overhead de runtime, redundante com frameworks de portal que já são shells únicos (Backstage/Refine).
2. **Backstage como shell** — rejeitado por ora (ver #68): pesado e opinado; a decisão da #68 é binária e pode ser revisitada sem impacto nesta ADR.
3. **Refine.dev como shell** — candidato na #68; compatível com esta ADR (é um shell único).

## Decisão da #68 (registro de acompanhamento)

A #68 avalia Backstage vs Refine vs manter Next.js + `@organator/ui`. Esta ADR determina o **formato** (shell único), não o **framework**. A escolha do framework fica aberta até o POC da #68, dentro do mesmo shell único.
