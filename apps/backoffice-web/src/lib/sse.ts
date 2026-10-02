/**
 * Lê um endpoint SSE autenticado. O `EventSource` do navegador não envia o
 * header Authorization, então o stream é consumido via fetch e as linhas
 * `data:` são entregues a `onData`. Retorna uma função que cancela a leitura.
 */
export function streamSse(
  url: string,
  token: string,
  onData: (data: string) => void,
): () => void {
  const controller = new AbortController();

  (async () => {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
      signal: controller.signal,
    });
    if (!res.ok || !res.body) return;
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      // Eventos SSE terminam numa linha em branco.
      let end: number;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const event = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = parseSseData(event);
        if (data !== null) onData(data);
      }
    }
  })().catch((err) => {
    if ((err as Error).name !== "AbortError") console.warn("SSE stream closed:", err);
  });

  return () => controller.abort();
}

/** Junta as linhas `data:` de um evento SSE (null se não houver). */
export function parseSseData(event: string): string | null {
  const lines = event
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""));
  return lines.length ? lines.join("\n") : null;
}
