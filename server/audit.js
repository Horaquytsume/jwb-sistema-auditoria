// Análise heurística: não substitui conferência humana ou cotação de mercado.
export function audit(text, fileName) {
  const items = [];
  // Números muito longos não são valores monetários confiáveis e não devem causar backtracking quadrático.
  const rx = /(?<![\d.,])(?:R\$\s*)?(\d{1,3}(?:\.\d{3}){1,3},\d{2}|\d{1,12},\d{2}|\d{1,3}(?:,\d{3}){1,3}\.\d{2}|\d{1,12}\.\d{2})(?![\d.,])/g;
  for (const line of text.split(/\r?\n/).filter(Boolean)) for (const match of line.matchAll(rx)) {
    const raw = match[1];
    const amount = raw.includes(',') && (!raw.includes('.') || raw.lastIndexOf(',') > raw.lastIndexOf('.'))
      ? Number(raw.replace(/\./g, '').replace(',', '.')) : Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    items.push({ description: line.trim().slice(0, 240), amount, avg: null, fair: null, delta: null, verdict: 'SEM REFERÊNCIA', category: 'Item sem categoria' });
  }
  return { fileName, items, total: items.reduce((sum, item) => sum + item.amount, 0), market: 0 };
}
