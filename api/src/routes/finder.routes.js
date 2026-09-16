// ============================================================
// Rotas do Parts Finder (Frente 1.4 expandida — 100% administrável)
// ------------------------------------------------------------
// Leitura (autenticado): modelos com árvore, modelo + seções por lado,
// seção com peças + hotspots, busca por VIN / número de motor (com log).
// Escrita (admin): CRUD completo de modelos, seções, peças da seção e
// hotspots, além de upload das imagens (foto do modelo e diagrama da seção).
//
// Convenções:
// - Imagens são gravadas em /uploads/finder e o banco guarda a URL RELATIVA;
//   as respostas convertem para URL absoluta (front pode estar em outra origem).
// - Hotspots usam PIXELS da imagem em tamanho natural; o front converte em %.
// - PecaSecao.Posicao (coluna legada NOT NULL) é mantida em sincronia com o
//   NumeroImagem quando ele é numérico; senão recebe um sequencial.
// ============================================================
import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EXT_IMAGEM, nomeArquivo, filtroImagem } from '../middlewares/upload-comum.js';
import { query, getPool, sql } from '../db.js';
import { requireAuth, requireAdmin, requireArea } from '../auth.js';
import { slugModelo, arvoreModelo, MARCA_PADRAO, MODALIDADE_PADRAO } from '../utils/modelo-moto.js';

const router = Router();

const LADOS = ['chassi', 'engine'];

// ---- Upload de imagens (multer → disco) -----------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_ROOT = path.join(__dirname, '..', '..', 'uploads');
const FINDER_DIR = path.join(UPLOADS_ROOT, 'finder');
fs.mkdirSync(FINDER_DIR, { recursive: true });
const URL_BASE = '/uploads/finder/';

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, FINDER_DIR),
  filename: (_req, file, cb) => cb(null, nomeArquivo(file, EXT_IMAGEM))
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024, files: 1 }, // 15 MB por imagem
  fileFilter: filtroImagem()
});
// Wrapper que transforma erros do multer em 400 com mensagem clara.
function uploadImagem(req, res, next) {
  upload.single('imagem')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'Imagem muito grande (máximo 15 MB).'
        : (err.message || 'Falha no upload.');
      return res.status(400).json({ erro: msg });
    }
    if (!req.file) return res.status(400).json({ erro: 'Envie o arquivo no campo "imagem".' });
    next();
  });
}

// Apaga do disco um arquivo referenciado por URL relativa (/uploads/...).
// Só remove se o caminho resolvido continuar dentro de /uploads (segurança).
export function apagarUpload(rel) {
  if (!rel || !String(rel).startsWith('/uploads/')) return;
  const abs = path.resolve(UPLOADS_ROOT, String(rel).replace(/^\/uploads\//, ''));
  if (!abs.startsWith(path.resolve(UPLOADS_ROOT))) return;
  try { fs.unlinkSync(abs); } catch { /* já não existe */ }
}

// URL relativa → absoluta (o front pode rodar em outra origem que a API).
function urlAbs(req, rel) {
  if (!rel) return rel || null;
  if (/^https?:\/\//i.test(rel)) return rel;
  return req.protocol + '://' + req.get('host') + rel;
}

/* =========================================================================
   Mapeadores linha do banco → JSON do front
   ========================================================================= */
function toModelo(req, r) {
  const m = {
    id: r.Codigo,
    modeloId: r.ModeloId,
    marca: r.Marca || null,
    modalidade: r.Modalidade || null,
    categoria: r.Categoria || null,
    nome: r.Nome,
    ano: r.Ano,
    label: r.Etiqueta || (r.Nome + ' ' + r.Ano),
    imagem: urlAbs(req, r.ImagemUrl),
    docTecnica: r.DocTecnicaUrl || null,
    cilindrada: r.Cilindrada || null,
    tipoMotor: r.TipoMotor || null,
    ativo: r.Ativo === undefined ? true : !!r.Ativo
  };
  // Montada na hora a partir dos campos: editar a categoria (ou o nome, ou o
  // ano) já muda a árvore. A coluna ModeloMoto.Arvore, digitada à mão até
  // 16/09/2026, não é mais lida nem gravada.
  m.arvore = arvoreModelo(m);
  return m;
}

function toSecao(req, r) {
  return {
    id: r.SecaoId,
    lado: r.Lado,
    numero: r.Numero,
    nome: r.Nome,
    destaque: r.Destaque || null,
    ordem: r.Ordem,
    imagem: urlAbs(req, r.ImagemUrl),
    qtdPecas: r.QtdPecas !== undefined ? Number(r.QtdPecas) : undefined
  };
}

function toPeca(req, r) {
  return {
    id: r.PecaSecaoId,
    produtoId: r.ProdutoId,
    sku: r.Sku,
    nome: r.NomeProduto,
    preco: Number(r.Preco),
    estoque: r.Estoque,
    previsao: r.PrevisaoChegada || null,
    imagem: urlAbs(req, r.ProdutoImagem),
    numeroImagem: r.NumeroImagem || '',
    quantidade: r.Quantidade,
    quantidadePadrao: r.QuantidadePadrao,
    minutos: r.MinutosMaoObra,
    ordem: r.Ordem,
    ativo: !!r.Ativo
  };
}

function toHotspot(r) {
  return {
    id: r.HotspotId,
    x: r.PosX, y: r.PosY, w: r.Largura, h: r.Altura,
    texto: r.Texto || '',
    linkNumero: r.LinkNumero || '',
    ordem: r.Ordem
  };
}

const SELECT_MODELO =
  `SELECT ModeloId, Codigo, Marca, Modalidade, Nome, Ano, Etiqueta, ImagemUrl, DocTecnicaUrl,
          Cilindrada, TipoMotor, Categoria, Ativo
     FROM dbo.ModeloMoto`;

const SELECT_PECAS =
  `SELECT ps.PecaSecaoId, ps.SecaoId, ps.Posicao, ps.NumeroImagem, ps.Quantidade, ps.QuantidadePadrao,
          ps.MinutosMaoObra, ps.Ordem, ps.Ativo,
          p.ProdutoId, p.Sku, p.Nome AS NomeProduto, p.Preco, p.Estoque,
          p.PrevisaoChegada, p.ImagemUrl AS ProdutoImagem
     FROM dbo.PecaSecao ps
     JOIN dbo.Produto p ON p.ProdutoId = ps.ProdutoId`;

// Carrega um modelo pelo código (slug). Devolve a linha crua ou null.
async function acharModelo(codigo) {
  const rows = await query(SELECT_MODELO + ' WHERE Codigo = @cod', { cod: codigo });
  return rows[0] || null;
}

// Carrega uma seção pelo id. Devolve a linha crua ou null.
async function acharSecao(id) {
  const rows = await query(
    `SELECT s.SecaoId, s.ModeloId, s.Lado, s.Numero, s.Nome, s.Destaque, s.Ordem, s.ImagemUrl,
            m.Codigo AS ModeloCodigo, m.Nome AS ModeloNome, m.Ano, m.Etiqueta
       FROM dbo.SecaoModelo s
       JOIN dbo.ModeloMoto m ON m.ModeloId = s.ModeloId
      WHERE s.SecaoId = @id`, { id });
  return rows[0] || null;
}

function intOuNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
}

/* =========================================================================
   LEITURA (cliente autenticado)
   ========================================================================= */

// GET /api/finder/modelos — lista com árvore (só ativos; admin: ?todos=1).
router.get('/finder/modelos', requireAuth, requireArea('finder'), async (req, res, next) => {
  try {
    const todos = req.user.papel === 'admin' && String(req.query.todos) === '1';
    const rows = await query(
      SELECT_MODELO + (todos ? '' : ' WHERE Ativo = 1') + ' ORDER BY Nome, Ano'
    );
    res.json(rows.map(r => toModelo(req, r)));
  } catch (e) { next(e); }
});

// GET /api/finder/busca?vin=...&motor=... — resolve VIN ou nº de motor para o
// modelo. Registra a busca no LogBusca (alimenta o dashboard do admin).
router.get('/finder/busca', requireAuth, requireArea('finder'), async (req, res, next) => {
  try {
    const vin = String(req.query.vin || '').trim();
    const motor = String(req.query.motor || '').trim();
    if (!vin && !motor) return res.status(400).json({ erro: 'Informe vin ou motor.' });

    // ESCOPO POR EMPRESA — o mesmo padrão de veiculos.routes.js (escopoEmpresa).
    // Sem ele, esta rota respondia sobre QUALQUER chassi da base: bastava estar
    // logado para descobrir, a partir de um número de chassi, o modelo, a cor e
    // se a moto já foi vendida — inclusive de outra concessionária. Era o único
    // ponto do sistema onde dado de veículo escapava do isolamento por empresa.
    const eid = req.user.papel === 'admin' ? null : req.user.empresaId;

    const rows = await query(
      `SELECT TOP 1 v.Niv, v.NumeroMotor, v.Cor, v.Status, m.ModeloId, m.Codigo, m.Marca,
              m.Modalidade, m.Nome, m.Ano, m.Etiqueta, m.ImagemUrl, m.DocTecnicaUrl,
              m.Cilindrada, m.TipoMotor, m.Categoria, m.Ativo
         FROM dbo.Veiculo v
         JOIN dbo.ModeloMoto m ON m.ModeloId = v.ModeloId
        WHERE ${vin ? 'v.Niv = @termo' : 'v.NumeroMotor = @termo'}
          AND (@eid IS NULL OR v.EmpresaId = @eid)`,
      { termo: vin || motor, eid }
    );

    // Log da busca (não derruba a resposta se falhar).
    try {
      await query(
        `INSERT INTO dbo.LogBusca (UsuarioId, EmpresaId, Termo, QtdResultados)
         VALUES (@uid, @eid, @termo, @qtd)`,
        { uid: req.user.id, eid: req.user.empresaId, termo: (vin || motor).slice(0, 200), qtd: rows.length }
      );
    } catch { /* log é melhor-esforço */ }

    if (!rows.length) {
      return res.status(404).json({ erro: vin ? 'Nenhum veículo encontrado com este NIV.' : 'Nenhum veículo encontrado com este número de motor.' });
    }
    const r = rows[0];
    res.json({
      modelo: toModelo(req, r),
      veiculo: { niv: r.Niv, numeroMotor: r.NumeroMotor, cor: r.Cor, status: r.Status }
    });
  } catch (e) { next(e); }
});

// GET /api/finder/uso?sku=&descricao= — todas as seções do finder que contêm
// uma peça, buscada pelo número do artigo (SKU) e/ou pela descrição. Alimenta a
// tela "Usage list": o cliente digita um SKU e vê em quais modelos/seções ele
// aparece, com link para abrir a seção. Busca parcial (LIKE) em ambos os campos.
router.get('/finder/uso', requireAuth, requireArea('finder'), async (req, res, next) => {
  try {
    const sku = String(req.query.sku || '').trim();
    const descricao = String(req.query.descricao || '').trim();
    if (!sku && !descricao) return res.json([]);

    const cond = [];
    const params = {};
    if (sku) { cond.push('p.Sku LIKE @sku'); params.sku = '%' + sku + '%'; }
    if (descricao) { cond.push('p.Nome LIKE @desc'); params.desc = '%' + descricao + '%'; }

    const rows = await query(
      `SELECT TOP 500 ps.SecaoId, m.Codigo AS ModeloCodigo, m.Ano, m.Nome AS ModeloNome,
              m.Etiqueta, m.Categoria, s.Lado, s.Numero, s.Nome AS SecaoNome,
              p.Sku, p.Nome AS Artigo
         FROM dbo.PecaSecao ps
         JOIN dbo.Produto p ON p.ProdutoId = ps.ProdutoId
         JOIN dbo.SecaoModelo s ON s.SecaoId = ps.SecaoId
         JOIN dbo.ModeloMoto m ON m.ModeloId = s.ModeloId
        WHERE ps.Ativo = 1 AND m.Ativo = 1 AND (${cond.join(' AND ')})
        ORDER BY m.Ano DESC, m.Nome, s.Numero`,
      params
    );
    res.json(rows.map(r => ({
      secaoId: r.SecaoId,
      modeloCodigo: r.ModeloCodigo,
      ano: r.Ano,
      modeloLabel: r.Etiqueta || (r.ModeloNome + ' ' + r.Ano),
      categoria: r.Categoria || '',
      lado: r.Lado,
      secaoNumero: r.Numero,
      secaoNome: r.SecaoNome,
      sku: r.Sku,
      artigo: r.Artigo
    })));
  } catch (e) { next(e); }
});

// GET /api/finder/modelos/:codigo — modelo + seções agrupadas por lado.
router.get('/finder/modelos/:codigo', requireAuth, requireArea('finder'), async (req, res, next) => {
  try {
    const m = await acharModelo(req.params.codigo);
    if (!m) return res.status(404).json({ erro: 'Modelo não encontrado.' });

    const secoes = await query(
      `SELECT s.SecaoId, s.Lado, s.Numero, s.Nome, s.Destaque, s.Ordem, s.ImagemUrl,
              (SELECT COUNT(*) FROM dbo.PecaSecao ps WHERE ps.SecaoId = s.SecaoId AND ps.Ativo = 1) AS QtdPecas
         FROM dbo.SecaoModelo s
        WHERE s.ModeloId = @mid
        ORDER BY s.Ordem, s.Numero, s.SecaoId`,
      { mid: m.ModeloId }
    );

    const out = toModelo(req, m);
    out.chassi = secoes.filter(s => s.Lado === 'chassi').map(s => toSecao(req, s));
    out.engine = secoes.filter(s => s.Lado === 'engine').map(s => toSecao(req, s));
    res.json(out);
  } catch (e) { next(e); }
});

// GET /api/finder/secoes/:id — seção com peças + hotspots + vizinhas (anterior/
// próxima do mesmo lado, para as setas e o "NEXT CATEGORY" do cliente).
// Cliente vê só peças ativas; admin vê todas (para o painel).
router.get('/finder/secoes/:id', requireAuth, requireArea('finder'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const s = await acharSecao(id);
    if (!s) return res.status(404).json({ erro: 'Seção não encontrada.' });

    const admin = req.user.papel === 'admin';
    const [pecas, hotspots, irmas] = await Promise.all([
      query(
        SELECT_PECAS + ' WHERE ps.SecaoId = @id' + (admin ? '' : ' AND ps.Ativo = 1') +
        ' ORDER BY ps.Ordem, ps.PecaSecaoId', { id }
      ),
      query(
        `SELECT HotspotId, PosX, PosY, Largura, Altura, Texto, LinkNumero, Ordem
           FROM dbo.SecaoHotspot WHERE SecaoId = @id ORDER BY Ordem, HotspotId`, { id }
      ),
      query(
        `SELECT SecaoId FROM dbo.SecaoModelo
          WHERE ModeloId = @mid AND Lado = @lado
          ORDER BY Ordem, Numero, SecaoId`,
        { mid: s.ModeloId, lado: s.Lado }
      )
    ]);

    const idx = irmas.findIndex(x => x.SecaoId === id);
    const anterior = idx > 0 ? irmas[idx - 1].SecaoId : null;
    const proxima = idx >= 0 && idx < irmas.length - 1 ? irmas[idx + 1].SecaoId : null;

    res.json({
      id: s.SecaoId,
      lado: s.Lado,
      numero: s.Numero,
      nome: s.Nome,
      destaque: s.Destaque || null,
      ordem: s.Ordem,
      imagem: urlAbs(req, s.ImagemUrl),
      modelo: { id: s.ModeloCodigo, nome: s.ModeloNome, ano: s.Ano, label: s.Etiqueta || (s.ModeloNome + ' ' + s.Ano) },
      pecas: pecas.map(p => toPeca(req, p)),
      hotspots: hotspots.map(toHotspot),
      vizinhos: { anterior, proxima }
    });
  } catch (e) { next(e); }
});

/* =========================================================================
   ADMIN — MODELOS
   ========================================================================= */

// Valida/normaliza o corpo de modelo. Devolve { dados } ou { erro }.
// O código NÃO vem do corpo: é sempre gerado do nome e do ano (ver
// utils/modelo-moto.js), no cadastro e em toda edição.
function parseModelo(body) {
  const dados = {};
  // Marca e modalidade têm padrão porque hoje só existe uma de cada; a
  // categoria não tem — é ela que separa os modelos no finder.
  dados.marca = String(body?.marca || '').trim() || MARCA_PADRAO;
  dados.modalidade = String(body?.modalidade || '').trim() || MODALIDADE_PADRAO;
  dados.categoria = String(body?.categoria || '').trim();
  if (!dados.categoria) return { erro: 'Informe a categoria (ex.: Enduro, Cross-country).' };
  if (dados.marca.length > 60) return { erro: 'Marca muito longa (máximo 60 caracteres).' };
  if (dados.modalidade.length > 60) return { erro: 'Modalidade muito longa (máximo 60 caracteres).' };
  if (dados.categoria.length > 40) return { erro: 'Categoria muito longa (máximo 40 caracteres).' };
  dados.nome = String(body?.nome || '').trim();
  if (!dados.nome) return { erro: 'Informe o nome do modelo.' };
  if (dados.nome.length > 80) return { erro: 'Nome muito longo (máximo 80 caracteres).' };
  const ano = Number(body?.ano);
  if (!Number.isInteger(ano) || ano < 1990 || ano > 2100) return { erro: 'Ano inválido.' };
  dados.ano = ano;
  dados.codigo = slugModelo(dados.nome, dados.ano);
  if (!dados.codigo) return { erro: 'O nome do modelo precisa ter letras ou números.' };
  dados.etiqueta = String(body?.label || body?.etiqueta || '').trim() || null;
  dados.cilindrada = String(body?.cilindrada || '').trim() || null;
  dados.tipoMotor = String(body?.tipoMotor || '').trim() || null;
  dados.docTecnica = String(body?.docTecnica || '').trim() || null;
  if (dados.docTecnica && !/^https?:\/\//i.test(dados.docTecnica)) {
    return { erro: 'Link da documentação técnica deve começar com http(s)://.' };
  }
  dados.ativo = body?.ativo === undefined ? 1 : (body.ativo ? 1 : 0);
  return { dados };
}

// Mesmo código = mesmo nome e ano. Devolve a mensagem de conflito, ou null.
// `exceto` é o próprio modelo numa edição (manter o nome não é conflito).
async function conflitoDeCodigo(dados, exceto) {
  const outro = (await query(
    'SELECT Nome, Ano FROM dbo.ModeloMoto WHERE Codigo = @cod AND ModeloId <> @id',
    { cod: dados.codigo, id: exceto ?? 0 }))[0];
  if (!outro) return null;
  return 'Já existe o modelo ' + outro.Nome + ' ' + outro.Ano + ' (código ' + dados.codigo + '). ' +
    'Nome e ano precisam ser diferentes de um modelo para outro.';
}

// POST /api/finder/modelos  (admin) — cria modelo.
router.post('/finder/modelos', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { dados, erro } = parseModelo(req.body);
    if (erro) return res.status(400).json({ erro });

    const conflito = await conflitoDeCodigo(dados, null);
    if (conflito) return res.status(409).json({ erro: conflito });

    const rows = await query(
      `INSERT INTO dbo.ModeloMoto (Codigo, Marca, Modalidade, Nome, Ano, Etiqueta, Cilindrada, TipoMotor, Categoria, DocTecnicaUrl, Ativo)
       OUTPUT inserted.ModeloId
       VALUES (@cod, @marca, @modal, @nome, @ano, @eti, @cil, @tm, @cat, @doc, @ativo)`,
      {
        cod: dados.codigo, marca: dados.marca, modal: dados.modalidade,
        nome: dados.nome, ano: dados.ano, eti: dados.etiqueta,
        cil: dados.cilindrada, tm: dados.tipoMotor,
        cat: dados.categoria, doc: dados.docTecnica, ativo: dados.ativo
      }
    );
    const m = await query(SELECT_MODELO + ' WHERE ModeloId = @id', { id: rows[0].ModeloId });
    res.status(201).json(toModelo(req, m[0]));
  } catch (e) { next(e); }
});

// PUT /api/finder/modelos/:codigo  (admin) — edita. O código acompanha o
// nome e o ano: renomear o modelo troca o código, e a resposta traz o novo
// (`id`) — é por ele que o front segue (foto, links). Tudo o que pendura no
// modelo (seções, chassis) usa o ModeloId numérico e não é afetado.
router.put('/finder/modelos/:codigo', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const m = await acharModelo(req.params.codigo);
    if (!m) return res.status(404).json({ erro: 'Modelo não encontrado.' });
    const { dados, erro } = parseModelo(req.body);
    if (erro) return res.status(400).json({ erro });

    const conflito = await conflitoDeCodigo(dados, m.ModeloId);
    if (conflito) return res.status(409).json({ erro: conflito });

    await query(
      `UPDATE dbo.ModeloMoto
          SET Codigo=@cod, Marca=@marca, Modalidade=@modal, Nome=@nome, Ano=@ano,
              Etiqueta=@eti, Cilindrada=@cil, TipoMotor=@tm, Categoria=@cat,
              DocTecnicaUrl=@doc, Ativo=@ativo
        WHERE ModeloId=@id`,
      {
        cod: dados.codigo, marca: dados.marca, modal: dados.modalidade,
        nome: dados.nome, ano: dados.ano, eti: dados.etiqueta,
        cil: dados.cilindrada, tm: dados.tipoMotor, cat: dados.categoria,
        doc: dados.docTecnica, ativo: dados.ativo, id: m.ModeloId
      }
    );
    const rows = await query(SELECT_MODELO + ' WHERE ModeloId = @id', { id: m.ModeloId });
    res.json(toModelo(req, rows[0]));
  } catch (e) { next(e); }
});

// DELETE /api/finder/modelos/:codigo  (admin) — apaga modelo + seções/peças/
// hotspots (cascata). Bloqueado se houver veículos vinculados (FK).
router.delete('/finder/modelos/:codigo', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const m = await acharModelo(req.params.codigo);
    if (!m) return res.status(404).json({ erro: 'Modelo não encontrado.' });

    // Junta as imagens (modelo + seções) para limpar do disco após apagar.
    const imgs = await query(
      'SELECT ImagemUrl FROM dbo.SecaoModelo WHERE ModeloId = @id AND ImagemUrl IS NOT NULL',
      { id: m.ModeloId }
    );
    try {
      await query('DELETE FROM dbo.ModeloMoto WHERE ModeloId = @id', { id: m.ModeloId });
    } catch (e) {
      if (e.number === 547) {
        return res.status(409).json({ erro: 'Modelo tem veículos cadastrados — desative-o em vez de excluir.' });
      }
      throw e;
    }
    apagarUpload(m.ImagemUrl);
    imgs.forEach(r => apagarUpload(r.ImagemUrl));
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// POST /api/finder/modelos/:codigo/imagem  (admin) — sobe/troca a foto do modelo.
router.post('/finder/modelos/:codigo/imagem', requireAuth, requireAdmin, uploadImagem, async (req, res, next) => {
  try {
    const m = await acharModelo(req.params.codigo);
    if (!m) { apagarUpload(URL_BASE + req.file.filename); return res.status(404).json({ erro: 'Modelo não encontrado.' }); }
    const rel = URL_BASE + req.file.filename;
    await query('UPDATE dbo.ModeloMoto SET ImagemUrl = @img WHERE ModeloId = @id', { img: rel, id: m.ModeloId });
    apagarUpload(m.ImagemUrl); // remove a anterior do disco
    res.status(201).json({ ok: true, imagem: urlAbs(req, rel) });
  } catch (e) { next(e); }
});

// DELETE /api/finder/modelos/:codigo/imagem  (admin) — remove a foto do modelo.
router.delete('/finder/modelos/:codigo/imagem', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const m = await acharModelo(req.params.codigo);
    if (!m) return res.status(404).json({ erro: 'Modelo não encontrado.' });
    await query('UPDATE dbo.ModeloMoto SET ImagemUrl = NULL WHERE ModeloId = @id', { id: m.ModeloId });
    apagarUpload(m.ImagemUrl);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* =========================================================================
   ADMIN — SEÇÕES (diagramas de um modelo)
   ========================================================================= */

// POST /api/finder/modelos/:codigo/secoes  (admin) — cria seção num lado.
router.post('/finder/modelos/:codigo/secoes', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const m = await acharModelo(req.params.codigo);
    if (!m) return res.status(404).json({ erro: 'Modelo não encontrado.' });

    const lado = String(req.body?.lado || '').trim();
    const numero = String(req.body?.numero || '').trim();
    const nome = String(req.body?.nome || '').trim();
    if (!LADOS.includes(lado)) return res.status(400).json({ erro: "Lado inválido — use 'chassi' ou 'engine'." });
    if (!numero || numero.length > 8) return res.status(400).json({ erro: 'Informe o número da seção (ex.: 01).' });
    if (!nome) return res.status(400).json({ erro: 'Informe o nome da seção.' });

    const rows = await query(
      `INSERT INTO dbo.SecaoModelo (ModeloId, Lado, Numero, Nome, Destaque, Ordem)
       OUTPUT inserted.SecaoId
       SELECT @mid, @lado, @num, @nome, @dest,
              COALESCE(MAX(Ordem) + 1, 0)
         FROM dbo.SecaoModelo WHERE ModeloId = @mid AND Lado = @lado`,
      {
        mid: m.ModeloId, lado, num: numero, nome,
        dest: String(req.body?.destaque || '').trim() || null
      }
    );
    const s = await acharSecao(rows[0].SecaoId);
    res.status(201).json(toSecao(req, s));
  } catch (e) { next(e); }
});

// PUT /api/finder/secoes/:id  (admin) — edita número/nome/destaque/ordem.
router.put('/finder/secoes/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const s = await acharSecao(Number(req.params.id));
    if (!s) return res.status(404).json({ erro: 'Seção não encontrada.' });

    const numero = req.body?.numero !== undefined ? String(req.body.numero).trim() : s.Numero;
    const nome = req.body?.nome !== undefined ? String(req.body.nome).trim() : s.Nome;
    const destaque = req.body?.destaque !== undefined
      ? (String(req.body.destaque).trim() || null) : s.Destaque;
    const ordem = req.body?.ordem !== undefined ? intOuNull(req.body.ordem) : s.Ordem;
    if (!numero || numero.length > 8) return res.status(400).json({ erro: 'Número inválido.' });
    if (!nome) return res.status(400).json({ erro: 'Informe o nome da seção.' });
    if (ordem === null || Number.isNaN(ordem)) return res.status(400).json({ erro: 'Ordem inválida.' });

    await query(
      'UPDATE dbo.SecaoModelo SET Numero=@num, Nome=@nome, Destaque=@dest, Ordem=@ord WHERE SecaoId=@id',
      { num: numero, nome, dest: destaque, ord: ordem, id: s.SecaoId }
    );
    res.json(toSecao(req, await acharSecao(s.SecaoId)));
  } catch (e) { next(e); }
});

// DELETE /api/finder/secoes/:id  (admin) — apaga seção (+ peças e hotspots).
router.delete('/finder/secoes/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const s = await acharSecao(Number(req.params.id));
    if (!s) return res.status(404).json({ erro: 'Seção não encontrada.' });
    await query('DELETE FROM dbo.SecaoModelo WHERE SecaoId = @id', { id: s.SecaoId });
    apagarUpload(s.ImagemUrl);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// PUT /api/finder/modelos/:codigo/secoes/ordem  (admin) — reordena um lado.
// Body: { lado, ids: [SecaoId na nova ordem] }.
router.put('/finder/modelos/:codigo/secoes/ordem', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const m = await acharModelo(req.params.codigo);
    if (!m) return res.status(404).json({ erro: 'Modelo não encontrado.' });
    const lado = String(req.body?.lado || '').trim();
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
    if (!LADOS.includes(lado)) return res.status(400).json({ erro: 'Lado inválido.' });
    if (!ids.length || ids.some(n => !Number.isInteger(n))) return res.status(400).json({ erro: 'Lista de ids inválida.' });

    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();
      for (let i = 0; i < ids.length; i++) {
        await new sql.Request(tx)
          .input('ord', sql.Int, i)
          .input('id', sql.Int, ids[i])
          .input('mid', sql.Int, m.ModeloId)
          .input('lado', sql.VarChar(8), lado)
          .query('UPDATE dbo.SecaoModelo SET Ordem=@ord WHERE SecaoId=@id AND ModeloId=@mid AND Lado=@lado');
      }
      await tx.commit();
    } catch (e) {
      try { await tx.rollback(); } catch { /* já desfeita */ }
      throw e;
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// POST /api/finder/secoes/:id/imagem  (admin) — sobe/troca o diagrama da seção.
router.post('/finder/secoes/:id/imagem', requireAuth, requireAdmin, uploadImagem, async (req, res, next) => {
  try {
    const s = await acharSecao(Number(req.params.id));
    if (!s) { apagarUpload(URL_BASE + req.file.filename); return res.status(404).json({ erro: 'Seção não encontrada.' }); }
    const rel = URL_BASE + req.file.filename;
    await query('UPDATE dbo.SecaoModelo SET ImagemUrl = @img WHERE SecaoId = @id', { img: rel, id: s.SecaoId });
    apagarUpload(s.ImagemUrl);
    res.status(201).json({ ok: true, imagem: urlAbs(req, rel) });
  } catch (e) { next(e); }
});

// DELETE /api/finder/secoes/:id/imagem  (admin) — remove o diagrama.
router.delete('/finder/secoes/:id/imagem', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const s = await acharSecao(Number(req.params.id));
    if (!s) return res.status(404).json({ erro: 'Seção não encontrada.' });
    await query('UPDATE dbo.SecaoModelo SET ImagemUrl = NULL WHERE SecaoId = @id', { id: s.SecaoId });
    apagarUpload(s.ImagemUrl);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* =========================================================================
   ADMIN — PEÇAS DA SEÇÃO (linhas da lista do finder)
   ========================================================================= */

// Valida campos numéricos comuns da peça. Devolve { dados } ou { erro }.
function parsePeca(body) {
  const dados = {};
  dados.numeroImagem = String(body?.numeroImagem ?? '').trim().slice(0, 12);
  const qtd = body?.quantidade === undefined ? 1 : intOuNull(body.quantidade);
  if (qtd === null || Number.isNaN(qtd) || qtd < 1) return { erro: 'Quantidade (no conjunto) deve ser 1 ou mais.' };
  dados.quantidade = qtd;
  const qp = body?.quantidadePadrao === undefined ? 0 : intOuNull(body.quantidadePadrao);
  if (qp === null || Number.isNaN(qp) || qp < 0) return { erro: 'Quantidade padrão inválida.' };
  dados.quantidadePadrao = qp;
  const min = intOuNull(body?.minutos);
  if (Number.isNaN(min) || (min !== null && min < 0)) return { erro: 'Minutos de mão de obra inválidos.' };
  dados.minutos = min;
  dados.ativo = body?.ativo === undefined ? 1 : (body.ativo ? 1 : 0);
  return { dados };
}

// POST /api/finder/secoes/:id/pecas  (admin) — adiciona um produto à seção.
router.post('/finder/secoes/:id/pecas', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const s = await acharSecao(Number(req.params.id));
    if (!s) return res.status(404).json({ erro: 'Seção não encontrada.' });

    const sku = String(req.body?.sku || '').trim();
    if (!sku) return res.status(400).json({ erro: 'Informe o SKU do produto.' });
    const prod = await query('SELECT ProdutoId FROM dbo.Produto WHERE Sku = @sku', { sku });
    if (!prod.length) return res.status(400).json({ erro: 'Produto não encontrado: ' + sku });

    const { dados, erro } = parsePeca(req.body);
    if (erro) return res.status(400).json({ erro });

    // Posicao (legada, NOT NULL): usa o NumeroImagem quando numérico; senão o
    // próximo sequencial da seção.
    const posNum = /^\d+$/.test(dados.numeroImagem) ? Number(dados.numeroImagem) : null;

    const rows = await query(
      `INSERT INTO dbo.PecaSecao
         (SecaoId, ProdutoId, Posicao, Quantidade, MinutosMaoObra, NumeroImagem, QuantidadePadrao, Ordem, Ativo)
       OUTPUT inserted.PecaSecaoId
       SELECT @sid, @pid,
              COALESCE(@pos, MAX(Posicao) + 1, 1),
              @qtd, @min, @numImg, @qp,
              COALESCE(MAX(Ordem) + 1, 0), @ativo
         FROM dbo.PecaSecao WHERE SecaoId = @sid`,
      {
        sid: s.SecaoId, pid: prod[0].ProdutoId, pos: posNum, qtd: dados.quantidade,
        min: dados.minutos, numImg: dados.numeroImagem || null, qp: dados.quantidadePadrao,
        ativo: dados.ativo
      }
    );
    const nova = await query(SELECT_PECAS + ' WHERE ps.PecaSecaoId = @id', { id: rows[0].PecaSecaoId });
    res.status(201).json(toPeca(req, nova[0]));
  } catch (e) { next(e); }
});

// PUT /api/finder/pecas/:id  (admin) — edita a linha (nº na imagem, qtds,
// situação, ordem). O produto (SKU) não muda — remova e adicione outro.
router.put('/finder/pecas/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const atual = await query(SELECT_PECAS + ' WHERE ps.PecaSecaoId = @id', { id });
    if (!atual.length) return res.status(404).json({ erro: 'Peça não encontrada nesta seção.' });
    const a = atual[0];

    const { dados, erro } = parsePeca({
      numeroImagem: req.body?.numeroImagem !== undefined ? req.body.numeroImagem : a.NumeroImagem,
      quantidade: req.body?.quantidade !== undefined ? req.body.quantidade : a.Quantidade,
      quantidadePadrao: req.body?.quantidadePadrao !== undefined ? req.body.quantidadePadrao : a.QuantidadePadrao,
      minutos: req.body?.minutos !== undefined ? req.body.minutos : a.MinutosMaoObra,
      ativo: req.body?.ativo !== undefined ? req.body.ativo : a.Ativo
    });
    if (erro) return res.status(400).json({ erro });
    const ordem = req.body?.ordem !== undefined ? intOuNull(req.body.ordem) : a.Ordem;
    if (ordem === null || Number.isNaN(ordem)) return res.status(400).json({ erro: 'Ordem inválida.' });

    const posNum = /^\d+$/.test(dados.numeroImagem) ? Number(dados.numeroImagem) : a.Posicao;

    await query(
      `UPDATE dbo.PecaSecao
          SET NumeroImagem=@numImg, Quantidade=@qtd, QuantidadePadrao=@qp,
              MinutosMaoObra=@min, Ativo=@ativo, Ordem=@ord,
              Posicao=COALESCE(@pos, Posicao)
        WHERE PecaSecaoId=@id`,
      {
        numImg: dados.numeroImagem || null, qtd: dados.quantidade, qp: dados.quantidadePadrao,
        min: dados.minutos, ativo: dados.ativo, ord: ordem, pos: posNum, id
      }
    );
    const rows = await query(SELECT_PECAS + ' WHERE ps.PecaSecaoId = @id', { id });
    res.json(toPeca(req, rows[0]));
  } catch (e) { next(e); }
});

// DELETE /api/finder/pecas/:id  (admin) — remove a peça da seção.
router.delete('/finder/pecas/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const rows = await query('DELETE FROM dbo.PecaSecao OUTPUT deleted.PecaSecaoId WHERE PecaSecaoId = @id', { id: Number(req.params.id) });
    if (!rows.length) return res.status(404).json({ erro: 'Peça não encontrada.' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// PUT /api/finder/secoes/:id/pecas/ordem  (admin) — reordena as linhas.
// Body: { ids: [PecaSecaoId na nova ordem] }.
router.put('/finder/secoes/:id/pecas/ordem', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const s = await acharSecao(Number(req.params.id));
    if (!s) return res.status(404).json({ erro: 'Seção não encontrada.' });
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
    if (!ids.length || ids.some(n => !Number.isInteger(n))) return res.status(400).json({ erro: 'Lista de ids inválida.' });

    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();
      for (let i = 0; i < ids.length; i++) {
        await new sql.Request(tx)
          .input('ord', sql.Int, i)
          .input('id', sql.Int, ids[i])
          .input('sid', sql.Int, s.SecaoId)
          .query('UPDATE dbo.PecaSecao SET Ordem=@ord WHERE PecaSecaoId=@id AND SecaoId=@sid');
      }
      await tx.commit();
    } catch (e) {
      try { await tx.rollback(); } catch { /* já desfeita */ }
      throw e;
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* =========================================================================
   ADMIN — HOTSPOTS (áreas clicáveis do diagrama)
   ========================================================================= */

// Valida um hotspot. Devolve { dados } ou { erro }.
function parseHotspot(body) {
  const x = intOuNull(body?.x), y = intOuNull(body?.y);
  const w = body?.w === undefined ? 32 : intOuNull(body.w);
  const h = body?.h === undefined ? 32 : intOuNull(body.h);
  if ([x, y].some(v => v === null || Number.isNaN(v) || v < 0)) return { erro: 'Posição (x, y) inválida.' };
  if ([w, h].some(v => v === null || Number.isNaN(v) || v < 1)) return { erro: 'Tamanho (w, h) inválido.' };
  return {
    dados: {
      x, y, w, h,
      texto: String(body?.texto || '').trim().slice(0, 200) || null,
      linkNumero: String(body?.linkNumero ?? '').trim().slice(0, 12) || null
    }
  };
}

// POST /api/finder/secoes/:id/hotspots  (admin) — adiciona uma área.
router.post('/finder/secoes/:id/hotspots', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const s = await acharSecao(Number(req.params.id));
    if (!s) return res.status(404).json({ erro: 'Seção não encontrada.' });
    const { dados, erro } = parseHotspot(req.body);
    if (erro) return res.status(400).json({ erro });

    const rows = await query(
      `INSERT INTO dbo.SecaoHotspot (SecaoId, PosX, PosY, Largura, Altura, Texto, LinkNumero, Ordem)
       OUTPUT inserted.HotspotId
       SELECT @sid, @x, @y, @w, @h, @txt, @lnk, COALESCE(MAX(Ordem) + 1, 0)
         FROM dbo.SecaoHotspot WHERE SecaoId = @sid`,
      { sid: s.SecaoId, x: dados.x, y: dados.y, w: dados.w, h: dados.h, txt: dados.texto, lnk: dados.linkNumero }
    );
    const novo = await query('SELECT * FROM dbo.SecaoHotspot WHERE HotspotId = @id', { id: rows[0].HotspotId });
    res.status(201).json(toHotspot(novo[0]));
  } catch (e) { next(e); }
});

// PUT /api/finder/secoes/:id/hotspots  (admin) — substitui TODAS as áreas de
// uma vez (salvar do editor visual). Body: { hotspots: [{x,y,w,h,texto,linkNumero}] }.
router.put('/finder/secoes/:id/hotspots', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const s = await acharSecao(Number(req.params.id));
    if (!s) return res.status(404).json({ erro: 'Seção não encontrada.' });
    const lista = Array.isArray(req.body?.hotspots) ? req.body.hotspots : null;
    if (!lista) return res.status(400).json({ erro: 'Envie o array hotspots.' });
    if (lista.length > 200) return res.status(400).json({ erro: 'Máximo de 200 áreas por diagrama.' });

    const parsed = [];
    for (const h of lista) {
      const { dados, erro } = parseHotspot(h);
      if (erro) return res.status(400).json({ erro });
      parsed.push(dados);
    }

    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();
      await new sql.Request(tx).input('sid', sql.Int, s.SecaoId)
        .query('DELETE FROM dbo.SecaoHotspot WHERE SecaoId = @sid');
      for (let i = 0; i < parsed.length; i++) {
        const d = parsed[i];
        await new sql.Request(tx)
          .input('sid', sql.Int, s.SecaoId)
          .input('x', sql.Int, d.x).input('y', sql.Int, d.y)
          .input('w', sql.Int, d.w).input('h', sql.Int, d.h)
          .input('txt', sql.NVarChar(200), d.texto)
          .input('lnk', sql.VarChar(12), d.linkNumero)
          .input('ord', sql.Int, i)
          .query(`INSERT INTO dbo.SecaoHotspot (SecaoId, PosX, PosY, Largura, Altura, Texto, LinkNumero, Ordem)
                  VALUES (@sid, @x, @y, @w, @h, @txt, @lnk, @ord)`);
      }
      await tx.commit();
    } catch (e) {
      try { await tx.rollback(); } catch { /* já desfeita */ }
      throw e;
    }

    const rows = await query(
      'SELECT * FROM dbo.SecaoHotspot WHERE SecaoId = @sid ORDER BY Ordem, HotspotId',
      { sid: s.SecaoId }
    );
    res.json(rows.map(toHotspot));
  } catch (e) { next(e); }
});

// PUT /api/finder/hotspots/:id  (admin) — edita uma área individual.
router.put('/finder/hotspots/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const atual = await query('SELECT * FROM dbo.SecaoHotspot WHERE HotspotId = @id', { id });
    if (!atual.length) return res.status(404).json({ erro: 'Área não encontrada.' });
    const a = atual[0];

    const { dados, erro } = parseHotspot({
      x: req.body?.x !== undefined ? req.body.x : a.PosX,
      y: req.body?.y !== undefined ? req.body.y : a.PosY,
      w: req.body?.w !== undefined ? req.body.w : a.Largura,
      h: req.body?.h !== undefined ? req.body.h : a.Altura,
      texto: req.body?.texto !== undefined ? req.body.texto : a.Texto,
      linkNumero: req.body?.linkNumero !== undefined ? req.body.linkNumero : a.LinkNumero
    });
    if (erro) return res.status(400).json({ erro });

    await query(
      `UPDATE dbo.SecaoHotspot
          SET PosX=@x, PosY=@y, Largura=@w, Altura=@h, Texto=@txt, LinkNumero=@lnk
        WHERE HotspotId=@id`,
      { x: dados.x, y: dados.y, w: dados.w, h: dados.h, txt: dados.texto, lnk: dados.linkNumero, id }
    );
    const rows = await query('SELECT * FROM dbo.SecaoHotspot WHERE HotspotId = @id', { id });
    res.json(toHotspot(rows[0]));
  } catch (e) { next(e); }
});

// DELETE /api/finder/hotspots/:id  (admin) — remove uma área.
router.delete('/finder/hotspots/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const rows = await query('DELETE FROM dbo.SecaoHotspot OUTPUT deleted.HotspotId WHERE HotspotId = @id', { id: Number(req.params.id) });
    if (!rows.length) return res.status(404).json({ erro: 'Área não encontrada.' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
