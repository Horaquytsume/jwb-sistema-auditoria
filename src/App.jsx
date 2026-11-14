import React, { useCallback, useEffect, useState } from 'react';
import ExcelJS from 'exceljs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString();
const STORE_KEY = 'jwb_session_v4';
const EXAMPLE = 'ORÇAMENTO OFICINA:\nKit Embreagem: R$ 1.650,00\nMão de Obra Troca: R$ 850,00';
const benchmarks = [
  { match: /embreagem/i, category: 'Peça / componente', avg: 1150, fair: 1320 },
  { match: /bomba d.?agua|correia|tensor/i, category: 'Peça / componente', avg: 1180, fair: 1380 },
  { match: /m[aã]o de obra|servi[cç]o/i, category: 'Mão de obra', avg: 520, fair: 650 }
];
const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
function parseMoney(value) { return Number(String(value).replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.')); }
async function sha256(data) {
  const bytes = data instanceof ArrayBuffer ? data : new TextEncoder().encode(data);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function audit(text, fileName) {
  const items = [];
  const rx = /(?:R\$\s*)?(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2}|\d{1,3}(?:,\d{3})+\.\d{2}|\d+\.\d{2})/g;
  for (const line of text.split(/\r?\n/).filter(Boolean)) for (const match of line.matchAll(rx)) {
    const raw = match[1];
    const amount = raw.includes(',') && (!raw.includes('.') || raw.lastIndexOf(',') > raw.lastIndexOf('.')) ? parseMoney(raw) : Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const bench = benchmarks.find((entry) => entry.match.test(line));
    const avg = bench?.avg ?? null;
    const fair = bench?.fair ?? null;
    const delta = avg ? Math.round((amount - avg) / avg * 100) : null;
    const verdict = !bench ? 'SEM REFERÊNCIA' : amount > fair && delta > 25 ? 'VERIFICAR DIFERENÇA' : amount > fair || delta > 10 ? 'ACIMA DA REFERÊNCIA' : 'DENTRO DA REFERÊNCIA';
    items.push({ description: line.trim().slice(0, 240), amount, avg, fair, delta, verdict, category: bench?.category || 'Item sem categoria' });
  }
  return { fileName, items, total: items.reduce((sum, item) => sum + item.amount, 0), market: items.reduce((sum, item) => sum + (item.avg || 0), 0) };
}
async function extractFile(file) {
  const bytes = await file.arrayBuffer();
  const ext = file.name.toLowerCase().split('.').pop();
  let text = '';
  if (ext === 'pdf') {
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => item.str).join(' '));
    }
    text = pages.join('\n');
    if (!text.trim()) throw new Error('Não encontrei texto selecionável no PDF. PDFs digitalizados como imagem precisam de OCR.');
  } else if (ext === 'xlsx') {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes);
    text = workbook.worksheets.map((sheet) => {
      const rows = [];
      sheet.eachRow({ includeEmpty: false }, (row) => rows.push(row.values.slice(1).map((cell) => {
        if (cell == null) return '';
        if (typeof cell === 'object' && 'text' in cell) return cell.text;
        if (typeof cell === 'object' && 'result' in cell) return typeof cell.result === 'number' ? cell.result.toFixed(2).replace('.', ',') : String(cell.result ?? '');
        if (typeof cell === 'number') return cell.toFixed(2).replace('.', ',');
        if (cell instanceof Date) return cell.toLocaleDateString('pt-BR');
        return String(cell);
      }).join(' | ')));
      return `Planilha: ${sheet.name}\n${rows.join('\n')}`;
    }).join('\n\n');
  } else if (['csv', 'tsv'].includes(ext)) {
    text = new TextDecoder().decode(bytes);
  } else if (ext === 'txt') {
    text = new TextDecoder().decode(bytes);
  } else {
    throw new Error('Formato não reconhecido. Envie PDF, XLSX, CSV, TSV ou TXT. Para XLS e ODS, converta para XLSX.');
  }
  return { bytes, text };
}
async function request(path, token, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Erro HTTP ${response.status}`);
  return result;
}

export default function App() {
  const [session, setSession] = useState(() => { try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { return null; } });
  const [aiEnabled, setAiEnabled] = useState(false);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tab, setTab] = useState('dashboard');
  const [content, setContent] = useState(EXAMPLE);
  const [report, setReport] = useState(() => audit(EXAMPLE, 'orçamento-demo.txt'));
  const [fileHash, setFileHash] = useState('');
  const [sectors, setSectors] = useState([]);
  const [records, setRecords] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [integrity, setIntegrity] = useState(null);
  const [aiReview, setAiReview] = useState(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const loadWorkspace = useCallback(async (token) => {
    const [me, sectorRows, auditRows] = await Promise.all([request('/api/me', token), request('/api/sectors', token), request('/api/audit', token)]);
    const staff = me.role === 'assistant' ? [] : await request('/api/employees', token);
    const next = { token, user: me };
    setSession(next); setAiEnabled(Boolean(me.aiEnabled)); localStorage.setItem(STORE_KEY, JSON.stringify(next));
    setSectors(sectorRows); setRecords(auditRows); setEmployees(staff);
  }, []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (session?.token) {
        try {
          const [me, sectorRows, auditRows] = await Promise.all([request('/api/me', session.token), request('/api/sectors', session.token), request('/api/audit', session.token)]);
          const staff = me.role === 'assistant' ? [] : await request('/api/employees', session.token);
          if (!cancelled) { const next = { token: session.token, user: me }; setAiEnabled(Boolean(me.aiEnabled)); setSession(next); localStorage.setItem(STORE_KEY, JSON.stringify(next)); setSectors(sectorRows); setRecords(auditRows); setEmployees(staff); }
        } catch { if (!cancelled) { setSession(null); localStorage.removeItem(STORE_KEY); } }
      }
      if (!cancelled) setChecking(false);
    })();
    return () => { cancelled = true; };
  }, []);
  async function login(event) {
    event.preventDefault(); setBusy(true); setNotice('');
    try { const data = await request('/api/login', null, { method: 'POST', body: JSON.stringify({ email, password }) }); await loadWorkspace(data.token); setNotice('Sessão iniciada.'); }
    catch (error) { setNotice(error.message); }
    finally { setBusy(false); }
  }
  function logout() { setSession(null); setRecords([]); setSectors([]); setEmployees([]); localStorage.removeItem(STORE_KEY); }
  async function reviewWithAI() {
    if (!window.confirm('O texto atual será enviado ao provedor de IA configurado. Não envie dados confidenciais sem autorização. Deseja continuar?')) return;
    setBusy(true); setNotice(''); setAiReview(null);
    try { const result = await request('/api/ai/review', session.token, { method: 'POST', body: JSON.stringify({ text: content }) }); setAiReview(result); setNotice('A IA preparou uma sugestão. Confira antes de aplicar; nada foi alterado automaticamente.'); }
    catch (error) { setNotice(error.message); }
    finally { setBusy(false); }
  }
  async function verifyIntegrity() {
    setBusy(true); setNotice('');
    try { setIntegrity(await request('/api/audit/verify', session.token)); setNotice('Verificação completa da cadeia finalizada.'); }
    catch (error) { setNotice(error.message); }
    finally { setBusy(false); }
  }
  function exportReport() {
    const rows = [['Evento','Tipo','Responsável','Documento','Data','Hash do evento','Hash do arquivo'], ...records.map((row) => [row.log,row.kind,row.actor,row.data?.fileName || '',row.ts,row.hash || '',row.data?.fileHash || ''])];
    const csv = '\ufeff' + rows.map((row) => row.map((cell) => { const value = String(cell ?? ''); const safe = /^[\s]*[=+@\-\t\r]/.test(value) ? `'${value}` : value; return `"${safe.replaceAll('"','""')}"`; }).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'jwb-trilha-auditoria.csv'; link.click(); URL.revokeObjectURL(url);
  }
  async function analyze(text = content, name = 'texto-colado.txt', exactBytes = null) {
    if (!text.trim()) { setNotice('O documento está vazio ou não contém texto extraível.'); return; }
    setBusy(true); setNotice('');
    try {
      const hash = await sha256(exactBytes || text);
      const nextReport = audit(text, name);
      setContent(text); setReport(nextReport); setFileHash(hash);
      const logged = await request('/api/audit', session.token, { method: 'POST', body: JSON.stringify({ fileName: name, fileHash: hash, total: nextReport.total, market: nextReport.market, itemCount: nextReport.items.length, sectorId: sectors[0]?.id }) });
      setRecords((old) => [{ seq: `new-${logged.log}`, log: logged.log, kind: 'document_audited', actor: session.user.name, data: { fileName: name, fileHash: hash, total: nextReport.total, itemCount: nextReport.items.length }, ts: logged.ts, hash: logged.hash }, ...old]);
      setNotice(`Análise registrada na trilha de auditoria (${logged.log}).`);
    } catch (error) { setNotice(`Não foi possível concluir a análise: ${error.message}`); }
    finally { setBusy(false); }
  }
  async function handleFile(file) {
    if (!file) return;
    setBusy(true); setNotice('Lendo documento…');
    try { const extracted = await extractFile(file); await analyze(extracted.text, file.name, extracted.bytes); }
    catch (error) { setNotice(`Falha ao ler arquivo: ${error.message}`); setBusy(false); }
  }

  if (checking) return <main style={styles.page}><section style={styles.login}><h1>JWB • Sistema Corporativo</h1><p>Verificando sua sessão…</p></section></main>;
  if (!session) return <main style={styles.page}><form onSubmit={login} style={styles.login}><div style={styles.brand}>JWB <span>• Sistema Corporativo</span></div><p style={styles.muted}>Entre para acessar o painel de auditoria.</p><label style={styles.label}>E-mail<input autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} style={styles.input}/></label><label style={styles.label}>Senha<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} style={styles.input}/></label><button style={styles.primary} disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>{notice && <p style={styles.notice}>{notice}</p>}<p style={styles.warning}>Demo local: ceo@demo.com / trocar-esta-senha</p></form></main>;

  return <main style={styles.page}>
    <header style={styles.header}><div><div style={styles.brand}>JWB <span>• Sistema Corporativo</span></div><p style={styles.muted}>{session.user.name} · {session.user.role}</p></div><button style={styles.secondary} onClick={logout}>Sair</button></header>
    <nav style={styles.nav}>{[['dashboard', 'Painel'], ['attachments', 'Documentos'], ['audit', `Trilha (${records.length})`], ['tools', 'Ferramentas']].map(([id, label]) => <button key={id} onClick={() => setTab(id)} style={{ ...styles.tab, ...(tab === id ? styles.activeTab : {}) }}>{label}</button>)}</nav>
    {tab === 'dashboard' && <><section style={styles.grid}>{sectors.map((sector) => <article key={sector.id} style={styles.panel}><h2>{sector.name}</h2><p style={styles.muted}>{sector.description}</p>{Number.isFinite(sector.budget) && <p>Orçamento: <strong>{money(sector.budget)}</strong></p>}<small>Responsável: {sector.manager}</small></article>)}</section><section style={{ ...styles.panel, ...styles.wide }}><h2>Resumo</h2><p>{records.length} eventos na trilha de auditoria. Setores disponíveis para seu perfil: {sectors.length}.</p><button style={styles.primary} onClick={() => setTab('attachments')}>Analisar documento</button></section>{employees.length > 0 && <section style={{ ...styles.panel, ...styles.wide }}><h2>Indicadores da equipe</h2><div style={{ overflowX: 'auto' }}><table style={styles.table}><thead><tr><th>Colaborador</th><th>Setor</th><th>Pontuação base</th><th>Entrega no prazo</th><th>Status</th></tr></thead><tbody>{employees.map((person) => <tr key={person.id}><td>{person.name}</td><td>{person.sector}</td><td>{person.baseScore}%</td><td>{person.onTimeRate}%</td><td>{person.status}</td></tr>)}</tbody></table></div><p style={styles.warning}>Indicadores de demonstração: confirme as informações antes de usá-las para decisões de pessoal.</p></section>}</>}
    {tab === 'attachments' && <section style={styles.grid}>
      <div style={styles.panel}><h2>Auditoria de documento</h2><label style={styles.label}>Selecionar PDF, planilha ou texto<input type="file" accept=".pdf,.xlsx,.csv,.tsv,.txt,application/pdf,text/csv" onChange={(event) => handleFile(event.target.files?.[0])} style={styles.file}/></label><p style={styles.muted}>PDF com texto selecionável, XLSX, CSV, TSV e TXT. XLS e ODS devem ser convertidos para XLSX.</p><label style={styles.label} htmlFor="doc">Ou cole o texto</label><textarea id="doc" value={content} onChange={(event) => setContent(event.target.value)} rows={12} style={styles.textarea}/><button style={styles.primary} disabled={busy} onClick={() => analyze(content)}>{busy ? 'Processando…' : 'Analisar, gerar SHA-256 e registrar'}</button>{notice && <p style={styles.notice}>{notice}</p>}</div>
      <div style={styles.panel}><h2>Comparação estimada</h2>{report.items.length ? <><div style={styles.summary}><div><small>Total cobrado</small><strong>{money(report.total)}</strong></div><div><small>Referência estimada</small><strong>{money(report.market)}</strong></div></div><div style={{ overflowX: 'auto' }}><table style={styles.table}><thead><tr><th>Item</th><th>Cobrado</th><th>Média</th><th>Avaliação</th></tr></thead><tbody>{report.items.map((item, index) => <tr key={`${index}-${item.description}`}><td>{item.description}</td><td>{money(item.amount)}</td><td>{item.avg == null ? 'Não disponível' : money(item.avg)}</td><td style={{ color: item.verdict === 'VERIFICAR DIFERENÇA' ? '#f87171' : item.verdict === 'ACIMA DA REFERÊNCIA' ? '#fbbf24' : '#94a3b8' }}>{item.verdict}</td></tr>)}</tbody></table></div></> : <p style={styles.muted}>Nenhum valor monetário identificado.</p>}<hr style={styles.hr}/><p style={styles.label}>Documento: {report.fileName}</p><p style={styles.label}>SHA-256 do arquivo</p><code style={styles.hash}>{fileHash || 'Aguardando análise'}</code><p style={styles.warning}>Referências são exemplos fixos, não cotações reais. Valores podem ser contabilizados em duplicidade; confira o documento. PDFs como imagem precisam de OCR.</p></div>
    </section>}
    {tab === 'audit' && <section style={{ ...styles.panel, ...styles.wide }}><div style={styles.row}><div><h2>Trilha de auditoria</h2><p style={styles.muted}>Eventos encadeados por SHA-256 no banco SQLite.</p></div><button style={styles.secondary} onClick={exportReport}>Exportar CSV</button></div>{records.length ? <div style={{ overflowX: 'auto' }}><table style={styles.table}><thead><tr><th>Evento</th><th>Tipo</th><th>Responsável</th><th>Documento</th><th>Data</th><th>Hash</th></tr></thead><tbody>{records.map((row) => <tr key={row.seq}><td>{row.log}</td><td>{row.kind}</td><td>{row.actor}</td><td>{row.data?.fileName || row.data?.text || '—'}</td><td>{new Date(row.ts).toLocaleString('pt-BR')}</td><td><code title={row.hash}>{String(row.hash).slice(0, 16)}…</code></td></tr>)}</tbody></table></div> : <p style={styles.muted}>Ainda não há eventos para o seu perfil.</p>}</section>}
    {tab === 'tools' && <section style={{ ...styles.panel, ...styles.wide }}><h2>Ferramentas de revisão e integridade</h2><div style={styles.grid}><article style={styles.panel}><h3>Revisão de texto com IA</h3><p style={styles.muted}>Sugere correções de ortografia e gramática no texto colado/carregado. A IA não deve modificar fatos ou valores. A aplicação da sugestão exige sua confirmação.</p><button style={styles.primary} disabled={busy || !aiEnabled} onClick={reviewWithAI}>{busy ? 'Revisando…' : 'Gerar sugestão de revisão'}</button>{!aiEnabled && <p style={styles.warning}>Recurso desligado: o administrador precisa configurar OPENAI_API_KEY no servidor.</p>}{aiReview && <><label style={styles.label}>Sugestão (não aplicada)</label><textarea readOnly value={aiReview.textoSugerido} rows={8} style={styles.textarea}/>{aiReview.observacoes?.length > 0 && <ul>{aiReview.observacoes.map((note,i)=><li key={i}>{note}</li>)}</ul>}<button style={styles.primary} onClick={() => { setContent(aiReview.textoSugerido); setAiReview(null); setNotice('Sugestão copiada para o editor. Ainda não foi registrada como auditoria; revise e gere uma nova análise quando quiser.'); }}>Usar sugestão no editor</button></>}</article><article style={styles.panel}><h3>Verificar integridade da cadeia</h3><p style={styles.muted}>Recalcula os hashes e confere os vínculos entre eventos armazenados.</p><button style={styles.primary} disabled={busy || session.user.role !== 'ceo'} onClick={verifyIntegrity}>Verificar cadeia SHA-256</button>{session.user.role !== 'ceo' && <p style={styles.warning}>Disponível apenas para a diretoria.</p>}{integrity && <p style={{ color: integrity.ok ? '#34d399' : '#f87171' }}>{integrity.ok ? `Cadeia válida: ${integrity.verifiedEvents} eventos verificados.` : `Falha no evento ${integrity.seq}: ${integrity.reason}`}</p>}</article><article style={styles.panel}><h3>Exportar auditoria</h3><p style={styles.muted}>Baixe a lista de eventos do seu perfil como CSV, incluindo hashes disponíveis.</p><button style={styles.secondary} onClick={exportReport}>Baixar CSV</button></article></div>{notice && <p style={styles.notice}>{notice}</p>}</section>}
    <footer style={styles.footer}>JWB • Valores de mercado demonstrativos; valide antes de decisões financeiras.</footer>
  </main>;
}
const styles = {
  page: { minHeight: '100vh', background: '#020617', color: '#e2e8f0', fontFamily: 'Inter, system-ui, sans-serif', padding: 28, boxSizing: 'border-box' }, login: { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 16, padding: 26, width: 'min(100%, 420px)', margin: '10vh auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, margin: '0 auto 24px', maxWidth: 1200 }, brand: { fontSize: 22, fontWeight: 800, color: '#fff' }, muted: { color: '#94a3b8', fontSize: 14 }, warning: { color: '#fbbf24', fontSize: 12, lineHeight: 1.5 }, notice: { color: '#93c5fd', fontSize: 13, lineHeight: 1.5 },
  label: { display: 'block', fontSize: 12, color: '#94a3b8', margin: '16px 0 7px' }, input: { display: 'block', boxSizing: 'border-box', width: '100%', padding: 12, background: '#020617', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', marginTop: 7 }, file: { display: 'block', width: '100%', color: '#cbd5e1', fontSize: 13, marginTop: 8 },
  nav: { display: 'flex', flexWrap: 'wrap', gap: 8, maxWidth: 1200, margin: '0 auto 18px' }, tab: { padding: '10px 15px', border: 0, borderRadius: 8, background: '#0f172a', color: '#94a3b8', cursor: 'pointer' }, activeTab: { background: '#2563eb', color: '#fff' },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))', gap: 18, maxWidth: 1200, margin: '0 auto' }, panel: { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 14, padding: 22, minWidth: 0 }, wide: { maxWidth: 1200, margin: '0 auto 18px' }, primary: { display: 'inline-block', background: '#2563eb', color: '#fff', border: 0, borderRadius: 8, padding: '11px 15px', fontWeight: 700, cursor: 'pointer', marginTop: 8 }, secondary: { background: '#1e293b', color: '#e2e8f0', border: 0, borderRadius: 8, padding: '10px 15px', cursor: 'pointer' },
  textarea: { boxSizing: 'border-box', width: '100%', resize: 'vertical', background: '#020617', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', padding: 12, lineHeight: 1.5 }, summary: { display: 'flex', flexWrap: 'wrap', gap: 25, margin: '18px 0' }, table: { width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }, hr: { border: 0, borderTop: '1px solid #334155', margin: '20px 0' }, hash: { display: 'block', wordBreak: 'break-all', color: '#a5b4fc', fontSize: 12 }, footer: { maxWidth: 1200, margin: '24px auto 0', color: '#64748b', fontSize: 12 }
};
