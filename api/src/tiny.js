// Integração com o Tiny ERP (API v2). Toda chamada ao Tiny passa por aqui.
// Produtos importados são espelho do Tiny; no sentido inverso só vão pedidos (tiny-pedidos.js).
import 'dotenv/config';
import { query } from './db.js';
import { prepararMiniaturas } from './miniaturas.js';
import { reservaBlackOrders, alocarBlackOrders } from './black-order.js';

const BASE = 'https://api.tiny.com.br/api2';

// Fila: no máximo ~60 req/min (o Tiny bloqueia acima disso). Prioritárias entram na frente.
const INTERVALO_MS = 1100;

// Sem timeout, uma resposta pendurada travaria o cron para sempre.
const TIMEOUT_MS = Number(process.env.TINY_TIMEOUT_MS || 20000);

const filaEspera = [];   // resolvers aguardando a vez de chamar o Tiny
let despachando = false;
let ultimaChamadaEm = 0;

function aguardarVez(prioritario = false) {
  return new Promise(resolve => {
    if (prioritario) filaEspera.unshift(resolve);
    else filaEspera.push(resolve);
    despachar();
  });
}

async function despachar() {
  if (despachando) return;
  despachando = true;
  while (filaEspera.length) {
    const espera = ultimaChamadaEm + INTERVALO_MS - Date.now();
    if (espera > 0) await new Promise(r => setTimeout(r, espera));
    ultimaChamadaEm = Date.now();
    filaEspera.shift()();
  }
  despachando = false;
}

class TinyError extends Error {
  constructor(msg, codigo) {
    super(msg);
    this.name = 'TinyError';
    this.codigo = codigo != null ? String(codigo) : null;
  }
}

// Erros da resposta: em consultas vêm no topo; em gravações, em registros[].registro.erros.
// O codigo_erro segue a mesma regra (20 = sem registros, 30 = CNPJ já cadastrado).
function extrairErros(ret) {
  const lista = v => (Array.isArray(v) ? v : v ? [v] : []);
  const msgs = lista(ret.erros).map(e => e?.erro).filter(Boolean);
  let codigo = ret.codigo_erro ?? null;

  for (const item of lista(ret.registros)) {
    const reg = item?.registro ?? item;
    if (!reg) continue;
    if (codigo == null && reg.codigo_erro != null) codigo = reg.codigo_erro;
    msgs.push(...lista(reg.erros).map(e => e?.erro).filter(Boolean));
  }
  // Sem repetições: o mesmo erro nos dois níveis não ajuda quem lê o log.
  return { msg: [...new Set(msgs)].join('; '), codigo };
}

// POST form-encoded na API v2. Lança TinyError se o status vier "Erro".
async function tinyPost(endpoint, params = {}, { prioritario = false } = {}) {
  const token = process.env.TINY_TOKEN;
  if (!token) throw new TinyError('TINY_TOKEN não configurado no .env da API.');
  await aguardarVez(prioritario);

  const body = new URLSearchParams({ token, formato: 'json' });
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') body.append(k, String(v));
  }

  let resp;
  try {
    resp = await fetch(`${BASE}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (e) {
    // Timeout e falha de rede também viram TinyError.
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError')
      throw new TinyError(`Tiny não respondeu em ${TIMEOUT_MS / 1000}s.`);
    throw new TinyError(`Falha de rede ao chamar o Tiny: ${e.message}`);
  }
  if (!resp.ok) {
    // Descarta o corpo para liberar o socket.
    await resp.body?.cancel().catch(() => {});
    throw new TinyError(`Tiny respondeu HTTP ${resp.status}.`);
  }

  const data = await resp.json().catch(() => null);
  const ret = data?.retorno;
  if (!ret) throw new TinyError('Resposta do Tiny em formato inesperado.');
  if (String(ret.status).toLowerCase() === 'erro') {
    const { msg, codigo } = extrairErros(ret);
    throw new TinyError(`Tiny: ${msg || 'Erro não especificado do Tiny.'}`, codigo);
  }
  return ret;
}

/* ---------------- normalização dos dados do Tiny ---------------- */

// Descrição HTML → texto com quebras de linha e "• " nos itens de lista (máx. 1000).
function limparDescricao(html) {
  if (!html) return null;
  const texto = String(html)
    .replace(/<li[^>]*>/gi, '\n• ')                       // item de lista → linha com marcador
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|ul|ol|tr|h[1-6])\s*>/gi, '\n')     // fim de bloco → quebra
    .replace(/<[^>]+>/g, '')                              // remove as demais tags
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#3?9;|&apos;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')                             // sem espaços em volta das quebras
    .replace(/\n{3,}/g, '\n\n')                           // no máximo uma linha em branco
    .trim();
  return texto ? texto.slice(0, 1000) : null;
}

// Primeira imagem dos anexos ([{ anexo: 'https://...' }]).
function primeiraFoto(anexos) {
  if (!Array.isArray(anexos)) return null;
  for (const a of anexos) {
    const url = typeof a === 'string' ? a : a?.anexo;
    if (url && /^https?:\/\//i.test(url)) return String(url).slice(0, 400);
  }
  return null;
}

// Estoque nunca negativo (o Tiny permite saldo negativo; o Fullgas não).
function clampEstoque(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Saldo que pode ser vendido: saldo − reservado. Pedido aprovado no Tiny (remessa nossa ou Magento)
// reserva a peça sem tirá-la do saldo até ser faturado; sem descontar, a mesma peça é vendida duas vezes.
export function saldoLivre(est) {
  return clampEstoque((Number(est?.saldo) || 0) - (Number(est?.saldoReservado) || 0));
}

/* ---------------- consultas ao Tiny ---------------- */

// Produtos do Tiny, 100 por página. Página vazia vem como codigo_erro 20.
export async function listarProdutos(pagina = 1, pesquisa = '') {
  let ret;
  try {
    ret = await tinyPost('produtos.pesquisa.php', { pagina, pesquisa });
  } catch (e) {
    if (e instanceof TinyError && e.codigo === '20') {
      return { pagina: Number(pagina) || 1, totalPaginas: 0, produtos: [] };
    }
    throw e;
  }
  const produtos = (ret.produtos || []).map(w => w.produto).filter(Boolean).map(p => ({
    tinyId: String(p.id),
    sku: String(p.codigo || '').trim().toUpperCase(),
    nome: String(p.nome || '').trim(),
    preco: Math.max(0, Number(p.preco) || 0),
    situacao: p.situacao || ''       // 'A' ativo | 'I' inativo | 'E' excluído
  }));
  return {
    pagina: Number(ret.pagina) || Number(pagina) || 1,
    totalPaginas: Number(ret.numero_paginas) || 1,
    produtos
  };
}

// "dd/mm/aaaa hh:mm:ss" no horário de Brasília (formato que o Tiny espera nas datas).
export function dataTiny(d) {
  const f = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(d).reduce((o, p) => (o[p.type] = p.value, o), {});
  return `${f.day}/${f.month}/${f.year} ${f.hour === '24' ? '00' : f.hour}:${f.minute}:${f.second}`;
}

// Saldos que mudaram no Tiny desde `desde`: [{ tinyId, saldo }] (saldo já sem o reservado).
// Uma chamada traz até 100 produtos; nada mudou = codigo_erro 20.
export async function listarEstoquesAlterados(desde) {
  const out = [];
  for (let pagina = 1; pagina <= 20; pagina++) {
    let ret;
    try {
      ret = await tinyPost('lista.atualizacoes.estoque.php', { dataAlteracao: dataTiny(desde), pagina });
    } catch (e) {
      if (e instanceof TinyError && e.codigo === '20') break;
      throw e;
    }
    for (const w of ret.produtos || []) {
      const p = w.produto || w;
      if (p?.id != null) out.push({ tinyId: String(p.id), saldo: saldoLivre(p) });
    }
    if (pagina >= (Number(ret.numero_paginas) || 1)) break;
  }
  return out;
}

// Aplica os saldos alterados só nos produtos importados e ligados (o resto do Tiny é ignorado, sem log).
export async function aplicarSaldosAlterados(alterados) {
  if (!alterados.length) return [];
  const params = {};
  const marks = alterados.map((a, i) => { params['t' + i] = a.tinyId; return '@t' + i; });
  const locais = new Set((await query(
    `SELECT TinyId FROM dbo.Produto WHERE TinyAtivo = 1 AND TinyId IN (${marks.join(',')})`, params
  )).map(r => String(r.TinyId)));
  const feitos = [];
  for (const a of alterados) {
    if (!locais.has(a.tinyId)) continue;
    try { feitos.push(await aplicarAtualizacao(a.tinyId, { estoque: a.saldo }, 'cron')); }
    catch (e) { console.warn(`⚠ Estoque do Tiny ${a.tinyId} não aplicado: ${e.message}`); }
  }
  return feitos;
}

// Detalhe + saldo de estoque, nas colunas do portal.
export async function obterProdutoCompleto(tinyId) {
  const p = (await tinyPost('produto.obter.php', { id: tinyId })).produto;
  if (!p) throw new TinyError('Produto não encontrado no Tiny.');

  // produto.obter não traz saldo: vem de produto.obter.estoque, já sem o reservado.
  const est = (await tinyPost('produto.obter.estoque.php', { id: tinyId })).produto;
  const saldo = saldoLivre(est);

  return {
    tinyId: String(p.id ?? tinyId),
    sku: String(p.codigo || '').trim().toUpperCase(),
    nome: String(p.nome || '').trim().slice(0, 200),
    preco: Math.max(0, Number(p.preco) || 0),
    estoque: saldo,
    descricao: limparDescricao(p.descricao_complementar),
    foto: primeiraFoto(p.anexos)
  };
}

/* ---------------- listas de preço ---------------- */

// Todas as listas de preço: [{ id, descricao, percentual }]. Negativo = desconto.
export async function listarListasPreco() {
  const listas = [];
  for (let pagina = 1, total = 1; pagina <= total; pagina++) {
    let ret;
    try {
      ret = await tinyPost('listas.precos.pesquisa.php', { pagina });
    } catch (e) {
      if (e instanceof TinyError && e.codigo === '20') break;
      throw e;
    }
    total = Number(ret.numero_paginas) || 1;
    for (const item of ret.registros || []) {
      const r = item?.registro ?? item;
      const id = Number(r?.id);
      const percentual = Number(r?.acrescimo_desconto);
      if (!Number.isInteger(id) || id <= 0 || !Number.isFinite(percentual)) continue;
      listas.push({ id, descricao: String(r.descricao || '').trim().slice(0, 60) || 'Lista ' + id, percentual });
    }
  }
  return listas;
}

/* ---------------- contatos (clientes) no Tiny ---------------- */

// Contato pelo CPF/CNPJ exato: { id, nome } ou null.
export async function pesquisarContatoPorCpfCnpj(cpfCnpj) {
  let ret;
  try {
    ret = await tinyPost('contatos.pesquisa.php', { cpf_cnpj: cpfCnpj }, { prioritario: true });
  } catch (e) {
    if (e instanceof TinyError && e.codigo === '20') return null;
    throw e;
  }
  const c = (ret.contatos || []).map(w => w.contato).filter(Boolean)[0];
  return c ? { id: String(c.id), nome: c.nome || '' } : null;
}

// contato.incluir.php → { id }.
export async function incluirContato(contato) {
  const ret = await tinyPost('contato.incluir.php',
    { contato: JSON.stringify({ contatos: [{ contato }] }) }, { prioritario: true });
  const regs = ret.registros;
  const reg = Array.isArray(regs) ? regs[0]?.registro : (regs?.registro ?? regs);
  if (String(reg?.status).toLowerCase() === 'erro') {
    const msg = (reg.erros || []).map(e => e?.erro).filter(Boolean).join('; ')
      || 'Erro não especificado ao incluir o contato.';
    throw new TinyError(`Tiny: ${msg}`, reg.codigo_erro);
  }
  if (!reg?.id) throw new TinyError('Tiny não devolveu o id do contato incluído.');
  return { id: String(reg.id) };
}

// contato.alterar.php (objeto com `id`).
export async function alterarContato(contato) {
  const ret = await tinyPost('contato.alterar.php',
    { contato: JSON.stringify({ contatos: [{ contato }] }) }, { prioritario: true });
  const regs = ret.registros;
  const reg = Array.isArray(regs) ? regs[0]?.registro : (regs?.registro ?? regs);
  if (String(reg?.status).toLowerCase() === 'erro') {
    const msg = (reg.erros || []).map(e => e?.erro).filter(Boolean).join('; ')
      || 'Erro não especificado ao alterar o contato.';
    throw new TinyError(`Tiny: ${msg}`, reg.codigo_erro);
  }
  return { id: String(reg?.id || contato.id) };
}

// contato.obter.php → contato ou null.
export async function obterContato(tinyId) {
  const ret = await tinyPost('contato.obter.php', { id: tinyId });
  const c = ret.contato
    || (Array.isArray(ret.registros) ? ret.registros[0]?.registro?.contato || ret.registros[0]?.registro : null);
  return c || null;
}

/* ---------------- pedidos no Tiny (escrita) ---------------- */

// Saldo atual (prioritário: checkout esperando).
export async function obterSaldoAtual(tinyId) {
  const est = (await tinyPost('produto.obter.estoque.php', { id: tinyId }, { prioritario: true })).produto;
  return saldoLivre(est);
}

// pedido.incluir.php → { id, numero }.
export async function incluirPedido(pedido) {
  const ret = await tinyPost('pedido.incluir.php',
    { pedido: JSON.stringify({ pedido }) }, { prioritario: true });
  const regs = ret.registros;
  const reg = Array.isArray(regs) ? regs[0]?.registro : (regs?.registro ?? regs);
  if (String(reg?.status).toLowerCase() === 'erro') {
    const msg = (reg.erros || []).map(e => e?.erro).filter(Boolean).join('; ')
      || 'Erro não especificado ao incluir o pedido.';
    throw new TinyError(`Tiny: ${msg}`, reg.codigo_erro);
  }
  if (!reg?.id) throw new TinyError('Tiny não devolveu o id do pedido incluído.');
  return { id: String(reg.id), numero: reg.numero != null ? String(reg.numero) : null };
}

// Situação do pedido no Tiny: 'aprovado' baixa o estoque, 'cancelado' devolve.
export async function alterarSituacaoPedido(tinyPedidoId, situacao) {
  await tinyPost('pedido.alterar.situacao.php',
    { id: tinyPedidoId, situacao }, { prioritario: true });
}

// pedido.obter.php → situação em minúsculas, ou null.
export async function obterSituacaoPedido(tinyPedidoId) {
  const ret = await tinyPost('pedido.obter.php', { id: tinyPedidoId });
  const ped = ret.pedido
    || (Array.isArray(ret.registros) ? ret.registros[0]?.registro?.pedido || ret.registros[0]?.registro : null);
  const sit = ped?.situacao;
  return sit != null && sit !== '' ? String(sit).trim().toLowerCase() : null;
}

// ---- Reserva: vendido aqui, ainda não descontado no Tiny ----
// O espelho de estoque subtrai: (1) itens ainda não exportados de pedidos não cancelados;
// (2) exportações 'pendente'/'erro'. Senão a mesma peça seria vendida duas vezes.

// Quantidade do SKU nas exportações não confirmadas (sem ItensJson, usa `itensDoPedido`).
export function somarReservaExportacoes(sku, linhas) {
  let total = 0;
  for (const l of linhas) {
    let itens;
    if (l.ItensJson) {
      try { itens = JSON.parse(l.ItensJson); } catch { itens = []; }
    } else {
      itens = (l.itensDoPedido || []).map(i => ({ sku: i.Sku, qtd: i.Quantidade }));
    }
    for (const i of itens || []) {
      if (String(i.sku) === String(sku)) total += Number(i.qtd) || 0;
    }
  }
  return total;
}

export async function reservaPendente(produtoId) {
  const prod = (await query(
    'SELECT Sku FROM dbo.Produto WHERE ProdutoId = @pid', { pid: produtoId }))[0];
  if (!prod) return 0;

  // Fase 1 — vendido e ainda não exportado.
  const f1 = (await query(
    `SELECT ISNULL(SUM(pi.Quantidade - pi.QuantidadeExportada), 0) AS Reserva
       FROM dbo.PedidoItem pi
       JOIN dbo.Pedido p ON p.PedidoId = pi.PedidoId
      WHERE pi.ProdutoId = @pid AND pi.EmBackorder = 0
        AND pi.Quantidade > pi.QuantidadeExportada
        AND p.Status <> N'Cancelado'`,
    { pid: produtoId }
  ))[0];

  // Fase 2 — exportado, mas o Tiny ainda não confirmou.
  const linhas = await query(
    `SELECT ExportId, PedidoId, ItensJson FROM dbo.TinyPedidoExport
      WHERE Status IN ('pendente', 'erro')`
  );
  for (const l of linhas) {
    if (!l.ItensJson) {
      l.itensDoPedido = await query(
        `SELECT Sku, Quantidade FROM dbo.PedidoItem
          WHERE PedidoId = @pid AND EmBackorder = 0`, { pid: l.PedidoId });
    }
  }
  return (Number(f1?.Reserva) || 0) + somarReservaExportacoes(prod.Sku, linhas);
}

/* ---------------- gravação no banco ---------------- */

export async function registrarLog(tinyId, sku, evento, status, mensagem) {
  await query(
    `INSERT INTO dbo.TinySyncLog (TinyId, Sku, Evento, Status, Mensagem)
     VALUES (@tid, @sku, @ev, @st, @msg)`,
    {
      tid: tinyId != null ? String(tinyId).slice(0, 40) : null,
      sku: sku || null,
      ev: evento,
      st: status,
      msg: mensagem ? String(mensagem).slice(0, 500) : null
    }
  ).catch(e => console.error('TinySyncLog falhou:', e.message));
}

// Mantém só os N últimos logs de 'cron' por produto (eventos manuais ficam).
export async function podarLogCron(manterPorProduto = 3) {
  await query(
    `WITH ranqueado AS (
       SELECT LogId,
              ROW_NUMBER() OVER (PARTITION BY COALESCE(Sku, TinyId)
                                 ORDER BY LogId DESC) AS rn
         FROM dbo.TinySyncLog
        WHERE Evento = 'cron'
     )
     DELETE FROM ranqueado WHERE rn > @n`,
    { n: Math.max(1, manterPorProduto) }
  ).catch(e => console.error('Poda do TinySyncLog falhou:', e.message));
}

// Aplica no produto os campos do Tiny (campo ausente não apaga).
export async function aplicarAtualizacao(tinyId, dados, evento) {
  const rows = await query(
    'SELECT ProdutoId, Sku, TinyAtivo FROM dbo.Produto WHERE TinyId = @tid',
    { tid: String(tinyId) }
  );
  if (!rows.length) {
    await registrarLog(tinyId, null, evento, 'ignorado', 'Produto não importado no Fullgas.');
    return { status: 'ignorado', msg: 'Produto não importado no Fullgas.' };
  }
  const p = rows[0];
  if (!p.TinyAtivo) {
    await registrarLog(tinyId, p.Sku, evento, 'ignorado', 'Sincronização desativada (TinyAtivo = 0).');
    return { status: 'ignorado', sku: p.Sku, msg: 'Sincronização desativada.' };
  }

  const sets = ['TinySincronizadoEm = SYSUTCDATETIME()', 'AtualizadoEm = SYSUTCDATETIME()'];
  const params = { pid: p.ProdutoId };
  let livreParaFila = null;
  if (dados.estoque !== undefined) {
    // Saldo do Tiny menos a reserva dos pedidos e a fila de black order (a fila vem antes da loja).
    const saldo = clampEstoque(dados.estoque);
    const reserva = await reservaPendente(p.ProdutoId);
    const fila = await reservaBlackOrders(p.ProdutoId);
    sets.push('Estoque = @est');
    params.est = Math.max(0, saldo - reserva - fila);
    if (fila > 0) livreParaFila = saldo - reserva;
  }
  if (dados.preco !== undefined) { sets.push('Preco = @preco'); params.preco = Math.max(0, Number(dados.preco) || 0); }
  if (dados.nome !== undefined && dados.nome) { sets.push('Nome = @nome'); params.nome = String(dados.nome).slice(0, 200); }
  if (dados.descricao !== undefined) { sets.push('Descricao = @desc'); params.desc = dados.descricao || null; }
  if (dados.foto !== undefined && dados.foto) { sets.push('ImagemUrl = @foto'); params.foto = dados.foto; }

  await query(`UPDATE dbo.Produto SET ${sets.join(', ')} WHERE ProdutoId = @pid`, params);
  if (livreParaFila !== null) await alocarBlackOrders(p.ProdutoId, livreParaFila);
  await registrarLog(tinyId, p.Sku, evento, 'ok', null);
  return { status: 'ok', sku: p.Sku };
}

// Sincroniza produtos com o Tiny (null = todos os TinyAtivo). evento: 'lote' (botão) ou 'cron'.
export async function sincronizarLote(produtoIds = null, evento = 'lote') {
  let sqlSel = `SELECT ProdutoId, TinyId, Sku FROM dbo.Produto
                 WHERE TinyAtivo = 1 AND TinyId IS NOT NULL`;
  const params = {};
  if (Array.isArray(produtoIds)) {
    if (!produtoIds.length) return [];
    const marcadores = produtoIds.map((_, i) => `@p${i}`);
    produtoIds.forEach((id, i) => { params[`p${i}`] = Number(id); });
    sqlSel += ` AND ProdutoId IN (${marcadores.join(',')})`;
  }
  const produtos = await query(sqlSel + ' ORDER BY Sku', params);

  const resultados = [];
  for (const p of produtos) {
    try {
      const dados = await obterProdutoCompleto(p.TinyId);
      const r = await aplicarAtualizacao(p.TinyId, dados, evento);
      resultados.push({ sku: p.Sku, tinyId: p.TinyId, ...r });
    } catch (e) {
      await registrarLog(p.TinyId, p.Sku, evento, 'erro', e.message);
      resultados.push({ sku: p.Sku, tinyId: p.TinyId, status: 'erro', msg: e.message });
    }
  }
  prepararMiniaturas();   // foto nova do Tiny ganha miniatura (segundo plano)
  return resultados;
}
