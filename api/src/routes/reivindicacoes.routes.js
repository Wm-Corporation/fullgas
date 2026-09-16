// ============================================================
// Rotas de reivindicações (garantia) — versão expandida (Frente 2).
// Cliente vê/abre apenas as da própria empresa; admin vê todas, muda status e
// pode DEVOLVER ao revendedor (com o que falta). Rascunhos ("Esboço") NÃO ficam
// no banco — vivem no navegador do cliente; o POST só cria reivindicações
// enviadas ("Em processo"), com todos os campos obrigatórios.
// Campos: data do ocorrido, duração (horas/km), peças (com quantidade) e fotos.
// ============================================================
import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { query, getPool, sql } from '../db.js';
import { requireAuth, requireAdmin, requireArea } from '../auth.js';
import { EXT_IMAGEM, EXT_VIDEO, nomeArquivo, filtroMidia } from '../middlewares/upload-comum.js';
import {
  exportacaoLigada, atualizarEstoqueCesta, inserirExportacao, processarExportacoes
} from '../tiny-pedidos.js';
import { registrarEvento } from '../historico-veiculo.js';

const router = Router();

// Status válidos (espelham o CHECK constraint da tabela — sem "Esboço").
const STATUS_VALIDOS = ['Em processo', 'Aprovada', 'Recusada'];
// Estados terminais: não voltam a ser editados pelo cliente.
const STATUS_TERMINAIS = ['Aprovada', 'Recusada'];
const TIPOS_VALIDOS = ['Manufacturer', 'Implícito'];
// Prazo da garantia do VEÍCULO: 90 dias a partir de Veiculo.GarantiaAtivaEm
// (ativada na venda). Vencido — ou nunca ativada — o chassi não aceita novas
// reivindicações. O varejo (garantia por pedido) NÃO tem prazo.
const GARANTIA_DIAS = 90;

// ---- Upload de fotos (multer → disco) -----------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'reivindicacoes');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const URL_BASE = '/uploads/reivindicacoes/';

// Antes eram 200 MB por arquivo — número que nunca valeu na prática: o Nginx
// da produção corta o corpo em 64 MB, então o revendedor levava um 413 seco do
// servidor em vez de uma mensagem explicando. 60 MB alinha os dois e ainda
// limita o estrago de um envio abusivo (5 arquivos = 300 MB no pior caso).
const LIMITE_BYTES = 60 * 1024 * 1024;
// Fotos/vídeos por envio (veículo e varejo). Eram 10; 5 bastam para mostrar a
// peça, e é o mesmo teto do formulário (MAX_MIDIA em frontend/js/portal.js).
// Vale por envio: se a reivindicação for devolvida pedindo mais imagens, o
// reenvio pode trazer outras 5.
const MAX_ANEXOS_POR_ENVIO = 5;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => cb(null, nomeArquivo(file, [...EXT_IMAGEM, ...EXT_VIDEO]))
});
const upload = multer({
  storage,
  limits: { fileSize: LIMITE_BYTES, files: MAX_ANEXOS_POR_ENVIO },
  fileFilter: filtroMidia()
});
// Wrapper que transforma erros do multer em 400 com mensagem clara.
function uploadFotos(req, res, next) {
  upload.array('fotos', MAX_ANEXOS_POR_ENVIO)(req, res, (err) => {
    if (err) {
      // UNEXPECTED_FILE no campo "fotos" = passou do maxCount do array().
      const excesso = err.code === 'LIMIT_FILE_COUNT' ||
        (err.code === 'LIMIT_UNEXPECTED_FILE' && err.field === 'fotos');
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Arquivo muito grande (máximo 60 MB por arquivo).'
        : excesso ? `Máximo de ${MAX_ANEXOS_POR_ENVIO} fotos ou vídeos por envio.`
          : (err.message || 'Falha no upload.');
      return res.status(400).json({ erro: msg });
    }
    next();
  });
}
function limparArquivos(files) {
  for (const f of files || []) { try { fs.unlinkSync(f.path); } catch { /* ignora */ } }
}

function toIso(d) { return d instanceof Date ? d.toISOString() : (d || null); }
function toIsoDate(d) { return d instanceof Date ? d.toISOString().slice(0, 10) : (d || null); }
function intOuNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : NaN;
}
function urlAbs(req, rel) {
  if (!rel) return rel;
  if (/^https?:\/\//i.test(rel)) return rel;
  return req.protocol + '://' + req.get('host') + rel;
}

// Normaliza/valida o array de peças. Cada item: { sku, quantidade }. Mescla
// SKUs repetidos somando a quantidade.
function lerPecas(body) {
  const bruto = Array.isArray(body?.pecas) ? body.pecas
    : (body?.numeroPeca ? [{ sku: body.numeroPeca, quantidade: 1 }] : []);
  const mapa = new Map();
  for (const it of bruto) {
    const sku = String(it?.sku || '').trim();
    const q = Number(it?.quantidade);
    if (!sku) return { erro: 'Peça inválida (sem código).' };
    if (!Number.isInteger(q) || q < 1) return { erro: 'Quantidade inválida para a peça ' + sku + '.' };
    mapa.set(sku, (mapa.get(sku) || 0) + q);
  }
  return { pecas: Array.from(mapa, ([sku, quantidade]) => ({ sku, quantidade })) };
}

// Valida o corpo de criação/edição. Todos os campos são obrigatórios (rascunho
// incompleto não chega aqui — fica no navegador). Devolve { dados } ou { erro }.
// opts.comTipo=false (edição) NÃO valida/retorna o tipo — o tipo é imutável
// após o 1º envio e permanece o original no banco.
function parseReiv(body, opts) {
  const comTipo = !opts || opts.comTipo !== false;
  const tipo = String(body?.tipo || '').trim();
  const niv = String(body?.niv || '').trim();
  const descricao = String(body?.descricao || '').trim();
  const dataDefeitoTxt = String(body?.dataDefeito || '').trim();

  if (comTipo && !TIPOS_VALIDOS.includes(tipo)) return { erro: 'Tipo de reivindicação inválido.' };
  const { pecas, erro } = lerPecas(body);
  if (erro) return { erro };
  if (!niv) return { erro: 'Informe o NIV do veículo.' };
  if (!pecas.length) return { erro: 'Informe ao menos uma peça defeituosa.' };
  if (!dataDefeitoTxt) return { erro: 'Informe a data do ocorrido.' };
  if (!descricao) return { erro: 'Descreva o problema.' };

  const horimetro = intOuNull(body?.horimetro);
  const quilometragem = intOuNull(body?.quilometragem);
  if (Number.isNaN(horimetro)) return { erro: 'Horas de operação inválidas.' };
  if (Number.isNaN(quilometragem)) return { erro: 'Quilometragem inválida.' };

  const d = new Date(dataDefeitoTxt + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return { erro: 'Data do ocorrido inválida.' };
  if (d.getTime() > Date.now()) return { erro: 'A data do ocorrido não pode ser futura.' };

  const dados = { niv, descricao, pecas, dataDefeito: dataDefeitoTxt, horimetro, quilometragem };
  if (comTipo) dados.tipo = tipo;
  return { dados };
}

// Valida cada peça no catálogo (dentro de uma tx) e devolve com o nome.
async function resolverPecas(tx, pecas) {
  const pecasResolvidas = [];
  for (const p of pecas) {
    const prod = await new sql.Request(tx).input('sku', sql.VarChar(40), p.sku)
      .query('SELECT Nome FROM dbo.Produto WHERE Sku = @sku');
    if (!prod.recordset.length) return { erro: 'Peça não encontrada no catálogo: ' + p.sku };
    pecasResolvidas.push({ sku: p.sku, nome: prod.recordset[0].Nome, quantidade: p.quantidade });
  }
  return { pecasResolvidas };
}

/* ------------------------------------------------------------------
   GARANTIA DE PRÉ-ENTREGA
   ------------------------------------------------------------------
   O defeito achado na inspeção que antecede a entrega, com a moto ainda no
   estoque. As regras são o espelho da garantia comum:

     comum      → exige venda registrada (é ela que ativa a garantia)
     pré-entrega→ exige que a venda NÃO tenha sido registrada

   Duas condições a mais, que a garantia comum não tem:

   • O chassi precisa ser DA EMPRESA que abre. "Pré-entrega" quer dizer "está
     no meu estoque, eu inspecionei" — reclamar da moto que está no pátio de
     outro revendedor não faria sentido. (O administrador é exceção: ele abre
     em nome de qualquer concessionária, como faz no resto do painel.)

   • Não há prazo a verificar. O relógio dos 90 dias começa na entrega ao
     consumidor; enquanto a moto está no estoque ele nem partiu. E abrir esta
     reivindicação NÃO ativa a garantia: se ativasse, o prazo do comprador
     começaria a correr antes de ele receber a moto.
   ------------------------------------------------------------------ */
async function resolverVeicPreEntrega(tx, niv, pecas, user) {
  const veic = await new sql.Request(tx).input('niv', sql.VarChar(30), niv)
    .query(`SELECT VeiculoId, VendaData, Status, EmpresaId
              FROM dbo.Veiculo WHERE Niv = @niv`);
  if (!veic.recordset.length) return { erro: 'Veículo não encontrado: ' + niv };
  const v = veic.recordset[0];

  if (user.papel !== 'admin' && v.EmpresaId !== user.empresaId)
    return { erro: 'Este chassi não está no estoque da sua concessionária.' };

  if (v.VendaData || v.Status === 'Vendido')
    return {
      erro: 'Este chassi já tem venda registrada — use a garantia normal, não a de pré-entrega.'
    };

  const { pecasResolvidas, erro } = await resolverPecas(tx, pecas);
  if (erro) return { erro };
  return { veiculoId: v.VeiculoId, pecasResolvidas };
}

// Resolve o veículo (NIV) e valida cada peça no catálogo (dentro de uma tx).
// Aplica o prazo de garantia: 90 dias a partir de GarantiaAtivaEm. Sem garantia
// ativada, ou com o prazo vencido, a abertura é barrada.
async function resolverVeicPecas(tx, niv, pecas) {
  const veic = await new sql.Request(tx).input('niv', sql.VarChar(30), niv)
    .query('SELECT VeiculoId, GarantiaAtivaEm FROM dbo.Veiculo WHERE Niv = @niv');
  if (!veic.recordset.length) return { erro: 'Veículo não encontrado: ' + niv };
  const { VeiculoId, GarantiaAtivaEm } = veic.recordset[0];
  if (!GarantiaAtivaEm)
    return { erro: 'Garantia não ativada para este veículo — registre a venda primeiro.' };
  const limite = new Date(GarantiaAtivaEm).getTime() + GARANTIA_DIAS * 24 * 60 * 60 * 1000;
  if (Date.now() > limite)
    return { erro: `Garantia expirada (${GARANTIA_DIAS} dias). Este chassi não aceita novas reivindicações de garantia.` };
  const { pecasResolvidas, erro } = await resolverPecas(tx, pecas);
  if (erro) return { erro };
  return { veiculoId: VeiculoId, pecasResolvidas };
}

// Varejo: valida o corpo (número do pedido, descrição e peças). Sem NIV/data/
// horas/km — esses campos não se aplicam à garantia de peça. Devolve { dados }
// ou { erro }.
function parseReivVarejo(body) {
  const numeroPedido = String(body?.numeroPedido || '').trim();
  const descricao = String(body?.descricao || '').trim();
  const { pecas, erro } = lerPecas(body);
  if (erro) return { erro };
  if (!numeroPedido) return { erro: 'Informe o número do pedido.' };
  if (!pecas.length) return { erro: 'Informe ao menos uma peça defeituosa do pedido.' };
  if (!descricao) return { erro: 'Descreva o problema.' };
  return { dados: { numeroPedido, descricao, pecas } };
}

// Resolve o pedido (dentro do escopo da empresa) e valida que CADA peça está
// entre os itens daquele pedido — só o que foi comprado ali pode ter garantia.
// Pedidos de garantia (reposição) não abrem nova garantia. Devolve o PedidoId e
// as peças com o nome do snapshot do item.
async function resolverPedidoPecas(tx, numeroPedido, user, pecas) {
  const eid = user.papel === 'admin' ? null : user.empresaId;
  const ped = await new sql.Request(tx)
    .input('num', sql.VarChar(20), numeroPedido)
    .input('eid', sql.Int, eid)
    .query(`SELECT PedidoId, Tipo FROM dbo.Pedido
             WHERE NumeroPedido = @num AND (@eid IS NULL OR EmpresaId = @eid)`);
  if (!ped.recordset.length) return { erro: 'Pedido não encontrado: ' + numeroPedido };
  if (ped.recordset[0].Tipo === 'garantia')
    return { erro: 'Este pedido é uma reposição de garantia e não abre nova garantia.' };
  const pedidoId = ped.recordset[0].PedidoId;

  const itens = (await new sql.Request(tx).input('pid', sql.Int, pedidoId)
    .query('SELECT Sku, NomeProduto, Quantidade FROM dbo.PedidoItem WHERE PedidoId = @pid')).recordset;
  // Agrega por SKU (o mesmo item pode aparecer em mais de uma linha): guarda o
  // nome e a quantidade TOTAL comprada — o teto do que pode ser reivindicado.
  const porSku = new Map();
  for (const i of itens) {
    const cur = porSku.get(i.Sku);
    if (cur) cur.quantidade += i.Quantidade;
    else porSku.set(i.Sku, { nome: i.NomeProduto, quantidade: i.Quantidade });
  }

  const pecasResolvidas = [];
  for (const p of pecas) {
    const item = porSku.get(p.sku);
    if (!item)
      return { erro: `A peça ${p.sku} não está no pedido ${numeroPedido}.` };
    // Não se pode reivindicar mais peças do que se comprou naquele pedido.
    if (p.quantidade > item.quantidade)
      return { erro: `A peça ${p.sku} teve ${item.quantidade} un. no pedido ${numeroPedido}; não é possível reivindicar ${p.quantidade}.` };
    pecasResolvidas.push({ sku: p.sku, nome: item.nome, quantidade: p.quantidade });
  }
  return { pedidoId, pecasResolvidas };
}
async function inserirPecas(tx, reivId, pecasResolvidas) {
  for (const p of pecasResolvidas) {
    await new sql.Request(tx)
      .input('rid', sql.Int, reivId).input('sku', sql.VarChar(40), p.sku)
      .input('nome', sql.NVarChar(200), p.nome).input('qtd', sql.Int, p.quantidade)
      .query(`INSERT INTO dbo.ReivindicacaoPeca (ReivindicacaoId, Sku, NomeProduto, Quantidade)
              VALUES (@rid, @sku, @nome, @qtd)`);
  }
}

// SELECT base com os JOINs que alimentam o formato esperado pelo front.
const SELECT_REIV =
  `SELECT r.ReivindicacaoId, r.Numero, r.Tipo, r.Status, r.Pais, r.PreAutorizacao,
          r.Devolvido, r.Reenviada, r.FaltaInformacao, r.Descricao, r.DataAbertura,
          r.AtualizadoEm, r.DataAprovacao, r.ValorGarantia, r.EmpresaId,
          r.NumeroPeca, r.DataDefeito, r.Horimetro, r.Quilometragem,
          r.Origem, r.PedidoId, ped.NumeroPedido AS NumeroPedido,
          e.RazaoSocial AS Empresa, v.Niv AS Niv
     FROM dbo.Reivindicacao r
     LEFT JOIN dbo.Empresa e ON e.EmpresaId = r.EmpresaId
     LEFT JOIN dbo.Veiculo v ON v.VeiculoId = r.VeiculoId
     LEFT JOIN dbo.Pedido ped ON ped.PedidoId = r.PedidoId`;

// Carrega registros-filho (anexos/peças) agrupados por ReivindicacaoId.
async function filhosPorReiv(ids, cols, tabela) {
  const map = new Map();
  if (!ids.length) return map;
  const params = {};
  const marks = ids.map((id, i) => { params['a' + i] = id; return '@a' + i; });
  const rows = await query(
    `SELECT ${cols} FROM dbo.${tabela}
      WHERE ReivindicacaoId IN (${marks.join(',')})
      ORDER BY ${tabela === 'ReivindicacaoAnexo' ? 'AnexoId' : 'ReivindicacaoPecaId'}`,
    params
  );
  for (const a of rows) {
    if (!map.has(a.ReivindicacaoId)) map.set(a.ReivindicacaoId, []);
    map.get(a.ReivindicacaoId).push(a);
  }
  return map;
}
const anexosPorReiv = (ids) =>
  filhosPorReiv(ids, 'AnexoId, ReivindicacaoId, NomeArquivo, TipoConteudo, TamanhoBytes, Url, CriadoEm', 'ReivindicacaoAnexo');
const pecasPorReiv = (ids) =>
  filhosPorReiv(ids, 'ReivindicacaoPecaId, ReivindicacaoId, Sku, NomeProduto, Quantidade', 'ReivindicacaoPeca');

function montar(r, extras, req) {
  const anexoRows = (extras && extras.anexos) || [];
  const pecaRows = (extras && extras.pecas) || [];
  return {
    id: r.Numero,
    data: toIso(r.DataAbertura),
    criador: r.Empresa || '',
    pais: r.Pais,
    tipo: r.Tipo,
    origem: r.Origem || 'veiculo',
    numeroPedido: r.NumeroPedido || '',
    niv: r.Niv || '',
    status: r.Status,
    preAuth: r.PreAutorizacao ? 'Sim' : 'Não',
    sentBack: !!r.Devolvido,
    reenviada: !!r.Reenviada,
    atualizadoEm: toIso(r.AtualizadoEm),
    dataAprovacao: toIso(r.DataAprovacao),
    valorGarantia: r.ValorGarantia == null ? null : Number(r.ValorGarantia),
    faltaInformacao: r.FaltaInformacao || '',
    descricao: r.Descricao || '',
    empresaId: r.EmpresaId,
    numeroPeca: r.NumeroPeca || '',
    dataDefeito: toIsoDate(r.DataDefeito),
    horimetro: r.Horimetro == null ? null : r.Horimetro,
    quilometragem: r.Quilometragem == null ? null : r.Quilometragem,
    pecas: pecaRows.map((p) => ({ sku: p.Sku, nome: p.NomeProduto || '', quantidade: p.Quantidade })),
    anexos: anexoRows.map((a) => ({
      id: a.AnexoId, nome: a.NomeArquivo, tipo: a.TipoConteudo, tamanho: a.TamanhoBytes,
      url: urlAbs(req, a.Url), criadoEm: toIso(a.CriadoEm)
    }))
  };
}

async function montarLista(rows, req) {
  const ids = rows.map((r) => r.ReivindicacaoId);
  const [anexos, pecas] = await Promise.all([anexosPorReiv(ids), pecasPorReiv(ids)]);
  return rows.map((r) => montar(r, { anexos: anexos.get(r.ReivindicacaoId), pecas: pecas.get(r.ReivindicacaoId) }, req));
}

// GET /api/reivindicacoes — cliente vê as da própria empresa; admin vê todas.
router.get('/reivindicacoes', requireAuth, requireArea('reivindicacoes'), async (req, res, next) => {
  try {
    const eid = req.user.papel === 'admin' ? null : req.user.empresaId;
    const status = STATUS_VALIDOS.includes(req.query.status) ? req.query.status : null;
    const rows = await query(
      SELECT_REIV +
        ` WHERE (@eid IS NULL OR r.EmpresaId = @eid)
            AND (@status IS NULL OR r.Status = @status)
          ORDER BY r.DataAbertura DESC, r.ReivindicacaoId DESC`,
      { eid, status }
    );
    res.json(await montarLista(rows, req));
  } catch (e) { next(e); }
});

// GET /api/reivindicacoes/:numero — detalhe (respeita o escopo de empresa).
router.get('/reivindicacoes/:numero', requireAuth, requireArea('reivindicacoes'), async (req, res, next) => {
  try {
    const eid = req.user.papel === 'admin' ? null : req.user.empresaId;
    const rows = await query(
      SELECT_REIV + ' WHERE r.Numero = @num AND (@eid IS NULL OR r.EmpresaId = @eid)',
      { num: req.params.numero, eid }
    );
    if (!rows.length) return res.status(404).json({ erro: 'Reivindicação não encontrada.' });
    res.json((await montarLista(rows, req))[0]);
  } catch (e) { next(e); }
});

// POST /api/reivindicacoes — cria (sempre "Em processo", tudo obrigatório).
// origem='varejo' abre garantia de peça de um PEDIDO (sem NIV/prazo); o padrão
// 'veiculo' mantém o fluxo por NIV, agora com o prazo de 90 dias.
router.post('/reivindicacoes', requireAuth, requireArea('reivindicacoes'), async (req, res, next) => {
  const origem = String(req.body?.origem || '').trim();
  const varejo = origem === 'varejo';
  const preEntrega = origem === 'preentrega';
  // Pré-entrega não tem Tipo a escolher: o defeito visto na inspeção de uma
  // moto zero é, por definição, de fábrica ou de transporte. Forçamos
  // 'Manufacturer' para satisfazer a coluna NOT NULL sem pedir ao cliente uma
  // classificação que ele não teria como fazer.
  const { dados, erro } = varejo
    ? parseReivVarejo(req.body)
    : parseReiv(preEntrega ? { ...req.body, tipo: 'Manufacturer' } : req.body);
  if (erro) return res.status(400).json({ erro });

  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();

    // Resolve alvo (veículo por NIV, ou pedido por número) e valida as peças.
    const rv = varejo
      ? await resolverPedidoPecas(tx, dados.numeroPedido, req.user, dados.pecas)
      : preEntrega
        ? await resolverVeicPreEntrega(tx, dados.niv, dados.pecas, req.user)
        : await resolverVeicPecas(tx, dados.niv, dados.pecas);
    if (rv.erro) { await tx.rollback(); return res.status(400).json({ erro: rv.erro }); }

    // Numero único de 8 dígitos.
    let numero = null;
    for (let i = 0; i < 8 && !numero; i++) {
      const cand = String(Math.floor(10000000 + Math.random() * 90000000));
      const ja = await new sql.Request(tx).input('n', sql.VarChar(20), cand)
        .query('SELECT 1 FROM dbo.Reivindicacao WHERE Numero = @n');
      if (!ja.recordset.length) numero = cand;
    }
    if (!numero) { await tx.rollback(); return res.status(503).json({ erro: 'Não foi possível gerar o número. Tente novamente.' }); }

    const ins = await new sql.Request(tx)
      .input('num', sql.VarChar(20), numero)
      .input('eid', sql.Int, req.user.empresaId)
      .input('uid', sql.Int, req.user.id)
      .input('vid', sql.Int, varejo ? null : rv.veiculoId)
      .input('pid', sql.Int, varejo ? rv.pedidoId : null)
      .input('origem', sql.VarChar(10), varejo ? 'varejo' : preEntrega ? 'preentrega' : 'veiculo')
      // Varejo e pré-entrega não têm "Tipo" de garantia a escolher: gravam o
      // padrão aceito pelo CHECK só para satisfazer a coluna NOT NULL.
      .input('tipo', sql.VarChar(16), varejo ? 'Manufacturer' : dados.tipo)
      .input('desc', sql.NVarChar(1000), dados.descricao)
      .input('peca', sql.VarChar(40), rv.pecasResolvidas[0]?.sku || null)
      .input('ddef', sql.Date, varejo ? null : dados.dataDefeito)
      .input('hor', sql.Int, varejo ? null : dados.horimetro)
      .input('km', sql.Int, varejo ? null : dados.quilometragem)
      .query(`INSERT INTO dbo.Reivindicacao
                (Numero, EmpresaId, UsuarioId, VeiculoId, PedidoId, Origem, Tipo,
                 Status, Descricao, NumeroPeca, DataDefeito, Horimetro, Quilometragem)
              OUTPUT inserted.ReivindicacaoId
              VALUES (@num, @eid, @uid, @vid, @pid, @origem, @tipo, 'Em processo',
                      @desc, @peca, @ddef, @hor, @km)`);
    const reivId = ins.recordset[0].ReivindicacaoId;
    await inserirPecas(tx, reivId, rv.pecasResolvidas);

    await tx.commit();

    // Reivindicação de VEÍCULO entra no histórico do chassi. A de varejo é
    // sobre uma peça de pedido, sem chassi a que se ligar. Fica FORA da
    // transação de propósito: o histórico não pode desfazer uma abertura.
    if (!varejo && rv.veiculoId) {
      await registrarEvento({
        veiculoId: rv.veiculoId, tipo: 'reivindicacao',
        titulo: preEntrega ? 'Reivindicação de pré-entrega aberta' : 'Reivindicação aberta',
        detalhe: dados.descricao,
        referencia: numero, user: req.user, empresaId: req.user.empresaId
      });
    }

    const rows = await query(SELECT_REIV + ' WHERE r.ReivindicacaoId = @id', { id: reivId });
    res.status(201).json((await montarLista(rows, req))[0]);
  } catch (e) {
    try { await tx.rollback(); } catch { /* já desfeita */ }
    next(e);
  }
});

// PUT /api/reivindicacoes/:numero — edita/reenvia (cliente da própria empresa ou
// admin). Usado quando a reivindicação foi DEVOLVIDA: o revendedor completa e
// reenvia, o que limpa o estado "devolvido". Bloqueado se já estiver terminal.
router.put('/reivindicacoes/:numero', requireAuth, requireArea('reivindicacoes'), async (req, res, next) => {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();

    const eid = req.user.papel === 'admin' ? null : req.user.empresaId;
    const cur = await new sql.Request(tx)
      .input('num', sql.VarChar(20), req.params.numero)
      .input('eid', sql.Int, eid)
      .query('SELECT ReivindicacaoId, Status, Devolvido, Origem FROM dbo.Reivindicacao WHERE Numero = @num AND (@eid IS NULL OR EmpresaId = @eid)');
    if (!cur.recordset.length) { await tx.rollback(); return res.status(404).json({ erro: 'Reivindicação não encontrada.' }); }
    if (STATUS_TERMINAIS.includes(cur.recordset[0].Status)) {
      await tx.rollback();
      return res.status(409).json({ erro: 'Reivindicação já ' + cur.recordset[0].Status.toLowerCase() + ' — não pode ser editada.' });
    }
    const reivId = cur.recordset[0].ReivindicacaoId;
    // Reenvio em resposta a uma devolução → sinaliza ao admin que foi atualizada.
    const reenviada = cur.recordset[0].Devolvido ? 1 : 0;
    // A ORIGEM não vem do corpo: é a que está gravada. Aceitá-la do cliente
    // deixaria uma garantia comum virar pré-entrega no reenvio, contornando a
    // regra de "sem venda registrada" que vale na abertura.
    const varejo = cur.recordset[0].Origem === 'varejo';
    const preEntrega = cur.recordset[0].Origem === 'preentrega';

    // Tipo é imutável após o 1º envio — não é validado nem alterado aqui.
    const parsed = varejo ? parseReivVarejo(req.body) : parseReiv(req.body, { comTipo: false });
    if (parsed.erro) { await tx.rollback(); return res.status(400).json({ erro: parsed.erro }); }
    const dados = parsed.dados;

    const rv = varejo
      ? await resolverPedidoPecas(tx, dados.numeroPedido, req.user, dados.pecas)
      : preEntrega
        ? await resolverVeicPreEntrega(tx, dados.niv, dados.pecas, req.user)
        : await resolverVeicPecas(tx, dados.niv, dados.pecas);
    if (rv.erro) { await tx.rollback(); return res.status(400).json({ erro: rv.erro }); }

    await new sql.Request(tx)
      .input('id', sql.Int, reivId)
      .input('vid', sql.Int, varejo ? null : rv.veiculoId)
      .input('pid', sql.Int, varejo ? rv.pedidoId : null)
      .input('desc', sql.NVarChar(1000), dados.descricao)
      .input('peca', sql.VarChar(40), rv.pecasResolvidas[0]?.sku || null)
      .input('ddef', sql.Date, varejo ? null : dados.dataDefeito)
      .input('hor', sql.Int, varejo ? null : dados.horimetro)
      .input('km', sql.Int, varejo ? null : dados.quilometragem)
      .input('reenv', sql.Bit, reenviada)
      .query(`UPDATE dbo.Reivindicacao
                 SET VeiculoId=@vid, PedidoId=@pid, Descricao=@desc, NumeroPeca=@peca,
                     DataDefeito=@ddef, Horimetro=@hor, Quilometragem=@km,
                     Status='Em processo', Devolvido=0, FaltaInformacao=NULL,
                     Reenviada=@reenv, AtualizadoEm=SYSUTCDATETIME()
               WHERE ReivindicacaoId=@id`);

    // Substitui as peças.
    await new sql.Request(tx).input('id', sql.Int, reivId)
      .query('DELETE FROM dbo.ReivindicacaoPeca WHERE ReivindicacaoId = @id');
    await inserirPecas(tx, reivId, rv.pecasResolvidas);

    await tx.commit();
    const rows = await query(SELECT_REIV + ' WHERE r.ReivindicacaoId = @id', { id: reivId });
    res.json((await montarLista(rows, req))[0]);
  } catch (e) {
    try { await tx.rollback(); } catch { /* já desfeita */ }
    next(e);
  }
});

// POST /api/reivindicacoes/:numero/anexos — sobe fotos (campo multipart "fotos").
router.post('/reivindicacoes/:numero/anexos', requireAuth, requireArea('reivindicacoes'), uploadFotos, async (req, res, next) => {
  const files = req.files || [];
  try {
    if (!files.length) return res.status(400).json({ erro: 'Nenhuma foto enviada.' });
    const eid = req.user.papel === 'admin' ? null : req.user.empresaId;
    const r = await query(
      'SELECT ReivindicacaoId FROM dbo.Reivindicacao WHERE Numero = @num AND (@eid IS NULL OR EmpresaId = @eid)',
      { num: req.params.numero, eid }
    );
    if (!r.length) { limparArquivos(files); return res.status(404).json({ erro: 'Reivindicação não encontrada.' }); }
    const reivId = r[0].ReivindicacaoId;

    for (const f of files) {
      await query(
        `INSERT INTO dbo.ReivindicacaoAnexo
           (ReivindicacaoId, NomeArquivo, TipoConteudo, TamanhoBytes, Url, EnviadoPor)
         VALUES (@rid, @nome, @tipo, @tam, @url, @uid)`,
        { rid: reivId, nome: f.originalname || f.filename, tipo: f.mimetype || null,
          tam: f.size || null, url: URL_BASE + f.filename, uid: req.user.id }
      );
    }
    const anexos = await anexosPorReiv([reivId]);
    res.status(201).json({
      ok: true,
      anexos: (anexos.get(reivId) || []).map((a) => ({
        id: a.AnexoId, nome: a.NomeArquivo, tipo: a.TipoConteudo,
        tamanho: a.TamanhoBytes, url: urlAbs(req, a.Url), criadoEm: toIso(a.CriadoEm)
      }))
    });
  } catch (e) { limparArquivos(files); next(e); }
});

// ---- Pedido de garantia (reposição) ----------------------------------------
// Reivindicação APROVADA não desconta mais da fatura do cliente (o modelo de
// nota de crédito foi aposentado): a aprovação cria um PEDIDO DE GARANTIA —
// as peças reclamadas, com preço R$ 0 e SEM fatura — que segue o fluxo normal
// de pedidos: aparece na área de pedidos (pill "Garantia"), exporta ao Tiny
// (baixa o estoque lá) e, se faltar estoque, o item entra em pré-venda e sai
// pelo rastreador quando repor. Roda dentro da transação da aprovação.
async function criarPedidoGarantia(tx, reiv) {
  const pecas = (await new sql.Request(tx).input('rid', sql.Int, reiv.ReivindicacaoId)
    .query('SELECT Sku, NomeProduto, Quantidade FROM dbo.ReivindicacaoPeca WHERE ReivindicacaoId = @rid')).recordset;
  if (!pecas.length) return null;

  const num = await new sql.Request(tx).query(`
    SELECT '0005' + RIGHT('000000' + CAST(NEXT VALUE FOR dbo.Seq_NumeroPedido AS VARCHAR(20)), 6) AS NumeroPedido,
           SYSUTCDATETIME() AS Agora;`);
  const { NumeroPedido, Agora } = num.recordset[0];

  const insPed = await new sql.Request(tx)
    .input('num', sql.VarChar(20), NumeroPedido)
    .input('uid', sql.Int, reiv.UsuarioId)
    .input('eid', sql.Int, reiv.EmpresaId)
    .input('data', sql.DateTime2, Agora)
    .query(`INSERT INTO dbo.Pedido (NumeroPedido, UsuarioId, EmpresaId, DataPedido, Status, Total, Tipo)
            OUTPUT inserted.PedidoId
            VALUES (@num, @uid, @eid, @data, N'Em separação', 0, 'garantia')`);
  const pedidoId = insPed.recordset[0].PedidoId;

  let temEstoque = false;
  for (const p of pecas) {
    // Baixa atômica. Sem estoque, o item entra em PRÉ-VENDA mesmo sem previsão
    // de chegada — garantia aprovada não é recusada por falta de estoque.
    const dec = await new sql.Request(tx)
      .input('sku', sql.VarChar(40), p.Sku).input('qtd', sql.Int, p.Quantidade)
      .query(`UPDATE dbo.Produto SET Estoque = Estoque - @qtd, AtualizadoEm = SYSUTCDATETIME()
              OUTPUT inserted.ProdutoId
               WHERE Sku = @sku AND Estoque >= @qtd`);
    let produtoId, backorder;
    if (dec.recordset.length) {
      produtoId = dec.recordset[0].ProdutoId; backorder = false; temEstoque = true;
    } else {
      const prod = await new sql.Request(tx).input('sku', sql.VarChar(40), p.Sku)
        .query('SELECT ProdutoId FROM dbo.Produto WHERE Sku = @sku');
      produtoId = prod.recordset[0]?.ProdutoId ?? null;
      backorder = true;
    }
    await new sql.Request(tx)
      .input('pid', sql.Int, pedidoId).input('prod', sql.Int, produtoId)
      .input('sku', sql.VarChar(40), p.Sku).input('nome', sql.NVarChar(200), p.NomeProduto)
      .input('qtd', sql.Int, p.Quantidade).input('back', sql.Bit, backorder ? 1 : 0)
      .query(`INSERT INTO dbo.PedidoItem (PedidoId, ProdutoId, Sku, NomeProduto, PrecoUnitario, Quantidade, EmBackorder)
              VALUES (@pid, @prod, @sku, @nome, 0, @qtd, @back)`);
  }

  // Sem fatura (garantia não cobra). Exporta ao Tiny o que tem estoque; a
  // pré-venda vira exportação própria quando o admin liberar.
  if (exportacaoLigada() && temEstoque) await inserirExportacao(tx, pedidoId, 'normal');
  return NumeroPedido;
}

// PUT /api/reivindicacoes/:numero/status (admin) — muda o status.
// Terminais (Aprovada/Recusada) não voltam a mudar. Ao APROVAR, cria o pedido
// de garantia (ver criarPedidoGarantia) — não há mais nota de crédito.
router.put('/reivindicacoes/:numero/status', requireAuth, requireAdmin, async (req, res, next) => {
  const status = String(req.body?.status || '').trim();
  if (!STATUS_VALIDOS.includes(status))
    return res.status(400).json({ erro: 'Status inválido.' });

  // Aprovação mexe em estoque: atualiza o espelho local com o saldo real do
  // Tiny antes (mesma checagem do checkout). Falha não bloqueia a aprovação.
  if (status === 'Aprovada') {
    try {
      const skus = await query(
        `SELECT DISTINCT rp.Sku FROM dbo.ReivindicacaoPeca rp
           JOIN dbo.Reivindicacao r ON r.ReivindicacaoId = rp.ReivindicacaoId
          WHERE r.Numero = @num`, { num: req.params.numero });
      await atualizarEstoqueCesta(skus.map(s => s.Sku));
    } catch (e) { console.warn('⚠ Checagem de estoque no Tiny indisponível:', e.message); }
  }

  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
    const cur = await new sql.Request(tx).input('num', sql.VarChar(20), req.params.numero)
      .query('SELECT ReivindicacaoId, Numero, EmpresaId, UsuarioId, Status, Origem, PedidoId, VeiculoId FROM dbo.Reivindicacao WHERE Numero = @num');
    if (!cur.recordset.length) { await tx.rollback(); return res.status(404).json({ erro: 'Reivindicação não encontrada.' }); }
    const reiv = cur.recordset[0];
    if (STATUS_TERMINAIS.includes(reiv.Status)) {
      await tx.rollback();
      return res.status(409).json({ erro: 'Reivindicação ' + reiv.Status.toLowerCase() + ' — o status não pode mais ser alterado.' });
    }

    let valorGarantia = null;
    let pedidoGarantia = null;
    if (status === 'Aprovada') {
      // Valor informativo (Σ preço × qtd das peças) — fica no registro da
      // reivindicação; o cliente NÃO é mais creditado por ele.
      const val = await new sql.Request(tx).input('rid', sql.Int, reiv.ReivindicacaoId)
        .query(`SELECT ISNULL(SUM(rp.Quantidade * pr.Preco), 0) AS Total
                  FROM dbo.ReivindicacaoPeca rp
                  JOIN dbo.Produto pr ON pr.Sku = rp.Sku
                 WHERE rp.ReivindicacaoId = @rid`);
      valorGarantia = Number(val.recordset[0].Total) || 0;
      pedidoGarantia = await criarPedidoGarantia(tx, reiv);

      // Varejo: registra no PEDIDO ORIGINAL quais peças tiveram garantia
      // aprovada (grava o nº da reivindicação em cada item reclamado).
      if (reiv.Origem === 'varejo' && reiv.PedidoId) {
        await new sql.Request(tx)
          .input('num', sql.VarChar(20), reiv.Numero)
          .input('pid', sql.Int, reiv.PedidoId)
          .input('rid', sql.Int, reiv.ReivindicacaoId)
          .query(`UPDATE pi SET pi.GarantiaNumero = @num
                    FROM dbo.PedidoItem pi
                   WHERE pi.PedidoId = @pid
                     AND pi.Sku IN (SELECT Sku FROM dbo.ReivindicacaoPeca WHERE ReivindicacaoId = @rid)`);
      }
    }

    await new sql.Request(tx)
      .input('num', sql.VarChar(20), req.params.numero)
      .input('status', sql.VarChar(14), status)
      .input('val', sql.Decimal(12, 2), valorGarantia)
      .query(`UPDATE dbo.Reivindicacao
                 SET Status = @status, Reenviada = 0, ValorGarantia = @val,
                     AtualizadoEm = SYSUTCDATETIME(),
                     DataAprovacao = CASE WHEN @status = 'Aprovada'
                                          THEN SYSUTCDATETIME() ELSE DataAprovacao END
               WHERE Numero = @num`);

    await tx.commit();
    if (pedidoGarantia) processarExportacoes(); // fire-and-forget: cria/aprova no Tiny

    // O desfecho da garantia é o que mais importa no histórico do chassi:
    // é ele que conta se aquele defeito foi coberto ou não.
    if (reiv.VeiculoId) {
      await registrarEvento({
        veiculoId: reiv.VeiculoId, tipo: 'reivindicacao',
        titulo: 'Reivindicação ' + status.toLowerCase(),
        detalhe: status === 'Aprovada' && pedidoGarantia
          ? 'Pedido de garantia gerado: ' + pedidoGarantia
          : null,
        referencia: reiv.Numero, user: req.user, empresaId: reiv.EmpresaId
      });
    }

    const rows = await query(SELECT_REIV + ' WHERE r.Numero = @num', { num: req.params.numero });
    const corpo = (await montarLista(rows, req))[0];
    corpo.pedidoGarantia = pedidoGarantia;
    res.json(corpo);
  } catch (e) {
    try { await tx.rollback(); } catch { /* já desfeita */ }
    next(e);
  }
});

// PUT /api/reivindicacoes/:numero/devolver (admin) — devolve ao revendedor,
// marcando Devolvido=1 e gravando o que falta (obrigatório).
router.put('/reivindicacoes/:numero/devolver', requireAuth, requireAdmin, async (req, res, next) => {
  const falta = String(req.body?.faltaInformacao || '').trim();
  if (!falta) return res.status(400).json({ erro: 'Descreva o que falta antes de devolver.' });
  try {
    const cur = await query(
      'SELECT Status, VeiculoId, EmpresaId FROM dbo.Reivindicacao WHERE Numero = @num',
      { num: req.params.numero });
    if (!cur.length) return res.status(404).json({ erro: 'Reivindicação não encontrada.' });
    if (STATUS_TERMINAIS.includes(cur[0].Status))
      return res.status(409).json({ erro: 'Reivindicação ' + cur[0].Status.toLowerCase() + ' — não pode ser devolvida.' });
    await query(
      `UPDATE dbo.Reivindicacao
          SET Devolvido = 1, FaltaInformacao = @falta, Status = 'Em processo',
              Reenviada = 0, AtualizadoEm = SYSUTCDATETIME()
        WHERE Numero = @num`,
      { falta, num: req.params.numero }
    );

    if (cur[0].VeiculoId) {
      await registrarEvento({
        veiculoId: cur[0].VeiculoId, tipo: 'reivindicacao',
        titulo: 'Reivindicação devolvida ao revendedor',
        detalhe: 'Falta: ' + falta,
        referencia: req.params.numero, user: req.user, empresaId: cur[0].EmpresaId
      });
    }

    const rows = await query(SELECT_REIV + ' WHERE r.Numero = @num', { num: req.params.numero });
    res.json((await montarLista(rows, req))[0]);
  } catch (e) { next(e); }
});

export default router;
