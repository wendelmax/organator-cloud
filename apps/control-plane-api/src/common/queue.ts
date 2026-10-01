/**
 * jobId aceito pelo BullMQ a partir de uma chave de idempotência.
 *
 * O BullMQ rejeita ids customizados com ":" (exceto o formato legado de 3
 * partes de jobs repetíveis) — `tenant-infra:<id>` ou
 * `data-isolation:<id>:generation:<n>` lançam "Custom Id cannot contain :".
 * As chaves de idempotência gravadas no banco continuam com ":"; só o id do
 * job é derivado. Determinístico: a mesma chave gera o mesmo jobId, então a
 * deduplicação do BullMQ continua funcionando.
 */
export function bullJobId(idempotencyKey: string): string {
  return idempotencyKey.replace(/:/g, '__');
}
