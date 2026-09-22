// ============================================================
// Rotas de veículos (motos no estoque, identificadas pelo NIV)
// ============================================================
import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, requireAdmin, requireArea, requireAreaAny } from '../auth.js';
import {
  registrarEvento, historicoDoVeiculo, TIPOS_MANUAIS
} from '../historico-veiculo.js';
import { FABRICA, sqlEhFabrica, sqlNaFabrica } from '../fabrica.js';

const router = Router();

// Ano da UNIDADE (não do modelo — o mesmo modelo é montado em anos
// diferentes). Teto dinâmico porque a indústria já vende o ano-modelo
// seguinte ANTES de virar o ano civil — em setembro de 2026, por exemplo, o
// ano-modelo 2028 já circula. +2 cobre esse adiantamento; +1 (usado até
// 22/09/2026) ficou curto demais e recusava um ano que já existia no mercado.
// O banco só barra a digitação absurda (CK, faixa larga de 1980 a 2100); o
// limite de verdade é este, que sabe a data de hoje.
function validarAno(ano) {
  const anoMax = new Date().getFullYear() + 2;
  if (!Number.isInteger(ano) || ano < 1980 || ano > anoMax) {
    return { erro: 'Ano inválido — informe um ano entre 1980 e ' + anoMax + '.' };
  }
  return null;
}

// Mapeia uma linha do banco para o formato que o front (store.js) já espera:
// { niv, modeloId (código do modelo), ano, status, entrada, fabrica, venda?, garantia? }.
//
// `entrada` (EntradaEstoque) é o dia em que o chassi entrou NO ESTOQUE ATUAL —
// a concessionária de hoje, ou a Fábrica. Toda atribuição/transferência a
// reinicia (21/09/2026): antes ela era gravada uma única vez, no cadastro, e
// uma moto transferida ontem aparecia no estoque novo "desde" o dia em que a
// fábrica a cadastrou, meses antes. A entrada no SISTEMA não se perdeu: está
// em Veiculo.CriadoEm e no evento 'cadastro' do histórico, que é justamente
// onde se lê a vida inteira do chassi.
// Cor e nº do motor saíram da tela (16/09/2026); as colunas seguem no banco.
function toVeiculo(r) {
  const naFabrica = !!r.NaFabrica;
  const v = {
    niv: r.Niv,
    modeloId: r.ModeloCodigo,
    ano: r.Ano,
    status: r.Status,
    entrada: r.EntradaEstoque,
    // Na Fábrica não há concessionária: empresa/empresaId vêm null mesmo que o
    // chassi aponte para a empresa de um administrador (ver fabrica.js).
    fabrica: naFabrica,
    empresaId: naFabrica ? null : r.EmpresaId,
    empresa: naFabrica ? null : r.EmpresaNome
  };
  if (r.VendaData) v.venda = {
    data: r.VendaData,
    cliente: r.VendaCliente || '',
    cpf: r.ClienteCpf || '',
    email: r.ClienteEmail || '',
    telefone: r.ClienteTelefone || '',
    endereco: r.ClienteEndereco || ''
  };
  if (r.GarantiaAtivaEm) v.garantia = r.GarantiaAtivaEm;
  return v;
}

const SELECT_VEIC =
  `SELECT v.VeiculoId, v.Niv, v.Ano, v.Status, v.EntradaEstoque, v.VendaData,
          v.VendaCliente, v.ClienteCpf, v.ClienteEmail, v.ClienteTelefone,
          v.ClienteEndereco, v.GarantiaAtivaEm, v.EmpresaId,
          m.Codigo AS ModeloCodigo, e.RazaoSocial AS EmpresaNome,
          ${sqlNaFabrica('v.EmpresaId')} AS NaFabrica
     FROM dbo.Veiculo v
     JOIN dbo.ModeloMoto m ON m.ModeloId = v.ModeloId
     LEFT JOIN dbo.Empresa e ON e.EmpresaId = v.EmpresaId`;

// Resposta para quem tenta pôr um chassi "na concessionária" do administrador.
const ERRO_DESTINO_FABRICA =
  'Esta empresa é a Fábrica (conta de administrador) e não recebe chassi como concessionária. ' +
  'Para deixar o chassi na Fábrica, não escolha concessionária.';

// Cliente vê SOMENTE veículos atribuídos à própria empresa; admin vê todos.
// Todo chassi é inserido/atribuído por um administrador — enquanto um chassi
// não tiver EmpresaId, ele não aparece para nenhum cliente. Devolve o trecho
// WHERE e os parâmetros conforme o papel.
function escopoEmpresa(user) {
  if (user.papel === 'admin') return { where: '', params: {} };
  return { where: ' v.EmpresaId = @empresaId', params: { empresaId: user.empresaId } };
}

// GET /api/veiculos/modelos — lista de modelos (alimenta FG.model no front).
// Declarado ANTES de /:niv para não ser capturado como se "modelos" fosse um NIV.
router.get('/veiculos/modelos', requireAuth, async (_req, res, next) => {
  try {
    const rows = await query(
      `SELECT Codigo AS id, Nome AS nome, Ano AS ano, Etiqueta AS label
         FROM dbo.ModeloMoto WHERE Ativo = 1 ORDER BY Nome, Ano`
    );
    res.json(rows.map(r => ({ id: r.id, nome: r.nome, ano: r.ano, label: r.label || (r.nome + ' ' + r.ano) })));
  } catch (e) { next(e); }
});

// GET /api/empresas — lista de concessionárias ativas (SÓ ADMIN). Alimenta o
// autocomplete de atribuição/transferência de chassi e o destino das
// notificações. A Fábrica não é concessionária e fica de fora.
router.get('/empresas', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const rows = await query(
      `SELECT e.EmpresaId, e.RazaoSocial, e.NomeFantasia FROM dbo.Empresa e
        WHERE e.Ativo = 1 AND NOT ${sqlEhFabrica('e.EmpresaId')}
        ORDER BY e.RazaoSocial`
    );
    res.json(rows.map(r => ({
      id: r.EmpresaId, nome: r.RazaoSocial, fantasia: r.NomeFantasia || ''
    })));
  } catch (e) { next(e); }
});

// POST /api/veiculos (SÓ ADMIN) — cadastra um chassi novo.
//   { niv, modeloId (código do modelo), ano, empresaId? }
// empresaId opcional: já nasce atribuído àquela concessionária; sem ele o
// chassi nasce na Fábrica (nenhum cliente vê até o admin atribuir).
router.post('/veiculos', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const niv = String(req.body?.niv || '').trim().toUpperCase();
    const modeloCod = String(req.body?.modeloId || '').trim();
    const empresaId = req.body?.empresaId ? Number(req.body.empresaId) : null;
    const ano = Number(req.body?.ano);

    if (!/^[A-Z0-9]{11,17}$/.test(niv))
      return res.status(400).json({ erro: 'NIV inválido — use 11 a 17 letras/números (sem espaços).' });
    if (!modeloCod) return res.status(400).json({ erro: 'Informe o modelo da moto.' });
    const erroAno = validarAno(ano);
    if (erroAno) return res.status(400).json(erroAno);

    const mod = (await query(
      'SELECT ModeloId, Nome, Ano, Etiqueta FROM dbo.ModeloMoto WHERE Codigo = @cod', { cod: modeloCod }))[0];
    if (!mod) return res.status(400).json({ erro: 'Modelo não encontrado.' });

    if (empresaId) {
      const emp = (await query(
        `SELECT ${sqlNaFabrica('e.EmpresaId')} AS EhFabrica
           FROM dbo.Empresa e WHERE e.EmpresaId = @eid AND e.Ativo = 1`,
        { eid: empresaId }))[0];
      if (!emp) return res.status(400).json({ erro: 'Concessionária não encontrada.' });
      if (emp.EhFabrica) return res.status(400).json({ erro: ERRO_DESTINO_FABRICA });
    }

    const jaExiste = (await query('SELECT 1 FROM dbo.Veiculo WHERE Niv = @niv', { niv })).length;
    if (jaExiste) return res.status(409).json({ erro: 'Já existe um chassi cadastrado com este NIV.' });

    await query(
      `INSERT INTO dbo.Veiculo (Niv, ModeloId, Ano, Status, EntradaEstoque, EmpresaId)
       VALUES (@niv, @mid, @ano, 'Disponível', SYSUTCDATETIME(), @eid)`,
      { niv, mid: mod.ModeloId, ano, eid: empresaId }
    );

    const rows = await query(SELECT_VEIC + ' WHERE v.Niv = @niv', { niv });
    const veic = rows[0];

    // O cadastro é sempre feito na Fábrica (empresaId null = Fábrica no
    // histórico); a concessionária, quando já vem escolhida, entra no evento
    // de atribuição logo abaixo. O detalhe guarda o nome do modelo, não o
    // código: o código muda quando o modelo é renomeado.
    await registrarEvento({
      veiculoId: veic.VeiculoId, tipo: 'cadastro', titulo: 'Chassi cadastrado na Fábrica',
      detalhe: (mod.Etiqueta || (mod.Nome + ' ' + mod.Ano)) + ' · Ano ' + ano,
      user: req.user, empresaId: null
    });
    // Nascer atribuído é um segundo fato: separá-lo do cadastro deixa claro,
    // meses depois, desde quando aquela concessionária responde pelo chassi.
    if (veic.EmpresaId) {
      await registrarEvento({
        veiculoId: veic.VeiculoId, tipo: 'atribuicao',
        titulo: 'Atribuído a ' + (veic.EmpresaNome || 'concessionária'),
        user: req.user, empresaId: veic.EmpresaId, empresaNome: veic.EmpresaNome
      });
    }

    res.status(201).json(toVeiculo(veic));
  } catch (e) { next(e); }
});

// GET /api/veiculos — lista da empresa do usuário; admin vê todos.
// 'estoque' OU 'acoes': a mesma lista alimenta a tela de estoque do
// revendedor e a busca de chassi da tela de ações.
router.get('/veiculos', requireAuth, requireAreaAny(['estoque', 'acoes']), async (req, res, next) => {
  try {
    const esc = escopoEmpresa(req.user);
    const rows = await query(
      // Mais recentes primeiro: quem chegou por último ao estoque de quem está
      // olhando — não quem foi cadastrado por último lá na Fábrica.
      SELECT_VEIC + (esc.where ? ' WHERE' + esc.where : '') + ' ORDER BY v.EntradaEstoque DESC',
      esc.params
    );
    res.json(rows.map(toVeiculo));
  } catch (e) { next(e); }
});

// GET /api/veiculos/:niv — detalhe pelo NIV (respeita o escopo de empresa).
router.get('/veiculos/:niv', requireAuth, requireAreaAny(['estoque', 'acoes']), async (req, res, next) => {
  try {
    const esc = escopoEmpresa(req.user);
    const rows = await query(
      SELECT_VEIC + ' WHERE v.Niv = @niv' + (esc.where ? ' AND' + esc.where : ''),
      { niv: req.params.niv, ...esc.params }
    );
    if (!rows.length) return res.status(404).json({ erro: 'Veículo não encontrado.' });
    res.json(toVeiculo(rows[0]));
  } catch (e) { next(e); }
});

// Carrega o veículo pelo NIV aplicando o escopo de empresa. Devolve a linha
// crua (com VeiculoId/Status) ou null se não existe / fora do escopo.
async function acharVeiculo(niv, user) {
  const esc = escopoEmpresa(user);
  const rows = await query(
    SELECT_VEIC + ' WHERE v.Niv = @niv' + (esc.where ? ' AND' + esc.where : ''),
    { niv, ...esc.params }
  );
  return rows[0] || null;
}

// POST /api/veiculos/:niv/venda  { cliente } — registra a venda.
// Muda Status para 'Vendido', grava data/cliente e ativa a garantia se ainda
// não estiver ativa. Só vale para veículo 'Disponível'.
// Registrar a venda grava PII do consumidor final (nome, CPF, e-mail,
// telefone, endereço) — é ação, não consulta, e exige a área 'acoes'.
router.post('/veiculos/:niv/venda', requireAuth, requireArea('acoes'), async (req, res, next) => {
  try {
    const { cliente, cpf, email, telefone, endereco } = req.body;
    const nome = (cliente || '').trim();
    if (!nome) return res.status(400).json({ erro: 'Informe o nome do cliente.' });
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return res.status(400).json({ erro: 'E-mail do cliente inválido.' });
    // CPF: aceita com ou sem máscara, mas precisa ter 11 dígitos se informado.
    if (cpf && (String(cpf).replace(/\D/g, '').length !== 11))
      return res.status(400).json({ erro: 'CPF do cliente inválido.' });

    const veic = await acharVeiculo(req.params.niv, req.user);
    if (!veic) return res.status(404).json({ erro: 'Veículo não encontrado.' });
    if (veic.Status !== 'Disponível')
      return res.status(409).json({ erro: 'Veículo não está disponível para venda.' });

    await query(
      `UPDATE dbo.Veiculo
          SET Status = 'Vendido',
              VendaData = SYSUTCDATETIME(),
              VendaCliente = @cliente,
              ClienteCpf = @cpf,
              ClienteEmail = @email,
              ClienteTelefone = @telefone,
              ClienteEndereco = @endereco,
              GarantiaAtivaEm = COALESCE(GarantiaAtivaEm, SYSUTCDATETIME()),
              AtualizadoEm = SYSUTCDATETIME()
        WHERE VeiculoId = @id`,
      {
        cliente: nome,
        cpf: (cpf || '').trim() || null,
        email: (email || '').trim() || null,
        telefone: (telefone || '').trim() || null,
        endereco: (endereco || '').trim() || null,
        id: veic.VeiculoId
      }
    );

    const rows = await query(SELECT_VEIC + ' WHERE v.VeiculoId = @id', { id: veic.VeiculoId });
    const atualizado = rows[0];

    await registrarEvento({
      veiculoId: veic.VeiculoId, tipo: 'venda', titulo: 'Venda registrada',
      detalhe: 'Cliente: ' + nome + (cpf ? ' · CPF ' + String(cpf).trim() : ''),
      user: req.user, empresaId: atualizado.EmpresaId, empresaNome: atualizado.EmpresaNome
    });
    // A venda ativa a garantia quando ela ainda não estava ativa (COALESCE no
    // UPDATE acima). Só registramos o evento nesse caso — senão o histórico
    // mostraria a garantia "ativando" de novo a cada venda.
    if (!veic.GarantiaAtivaEm && atualizado.GarantiaAtivaEm) {
      await registrarEvento({
        veiculoId: veic.VeiculoId, tipo: 'garantia',
        titulo: 'Garantia ativada', detalhe: 'Ativada automaticamente pelo registro da venda.',
        user: req.user, empresaId: atualizado.EmpresaId, empresaNome: atualizado.EmpresaNome
      });
    }

    res.json(toVeiculo(atualizado));
  } catch (e) { next(e); }
});

// PUT /api/veiculos/:niv/transferir (SÓ ADMIN) — transfere o chassi para
// outra concessionária. Quem recebe passa a ter o chassi "desde hoje":
// EntradaEstoque é reiniciada (ver o comentário de toVeiculo). Aceita { empresaId } (vindo do autocomplete do front)
// ou { empresa } com o NOME (razão social ou fantasia; case-insensitive pela
// collation). Nome ambíguo ou inexistente devolve erro com sugestões.
// { fabrica: true } devolve o chassi à Fábrica (tira a concessionária).
router.put('/veiculos/:niv/transferir', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const paraFabrica = req.body?.fabrica === true;
    const empresaId = req.body?.empresaId ? Number(req.body.empresaId) : null;
    const nome = String(req.body?.empresa || '').trim();
    if (!paraFabrica && !empresaId && !nome)
      return res.status(400).json({ erro: 'Informe a concessionária de destino.' });

    const veic = await acharVeiculo(req.params.niv, req.user);
    if (!veic) return res.status(404).json({ erro: 'Veículo não encontrado.' });

    if (paraFabrica) {
      if (veic.NaFabrica) return res.status(409).json({ erro: 'O chassi já está na Fábrica.' });
      await query(
        `UPDATE dbo.Veiculo
            SET EmpresaId = NULL,
                EntradaEstoque = SYSUTCDATETIME(),
                AtualizadoEm = SYSUTCDATETIME()
          WHERE VeiculoId = @id`,
        { id: veic.VeiculoId }
      );
      await registrarEvento({
        veiculoId: veic.VeiculoId, tipo: 'transferencia', titulo: 'Devolvido à ' + FABRICA,
        detalhe: 'Concessionária anterior: ' + (veic.EmpresaNome || '—'),
        user: req.user, empresaId: null
      });
      const rows = await query(SELECT_VEIC + ' WHERE v.VeiculoId = @id', { id: veic.VeiculoId });
      return res.json(toVeiculo(rows[0]));
    }

    // A empresa da Fábrica entra na busca só para o erro sair claro ("isso é a
    // Fábrica"), em vez de um "não encontrada" que confundiria.
    const colunas = `e.EmpresaId, e.RazaoSocial, ${sqlNaFabrica('e.EmpresaId')} AS EhFabrica`;
    const emp = await (empresaId
      ? query(`SELECT ${colunas} FROM dbo.Empresa e WHERE e.Ativo = 1 AND e.EmpresaId = @eid`, { eid: empresaId })
      : query(
        `SELECT ${colunas} FROM dbo.Empresa e
          WHERE e.Ativo = 1 AND (e.RazaoSocial = @n OR e.NomeFantasia = @n)`, { n: nome }));
    if (!emp.length && empresaId)
      return res.status(404).json({ erro: 'Concessionária não encontrada.' });
    if (!emp.length) {
      const parecidas = await query(
        `SELECT TOP 5 e.RazaoSocial FROM dbo.Empresa e
          WHERE e.Ativo = 1 AND (e.RazaoSocial LIKE @p OR e.NomeFantasia LIKE @p)
            AND NOT ${sqlEhFabrica('e.EmpresaId')}
          ORDER BY e.RazaoSocial`, { p: '%' + nome + '%' });
      return res.status(404).json({
        erro: 'Concessionária não encontrada: "' + nome + '".' +
          (parecidas.length ? ' Parecidas: ' + parecidas.map(r => r.RazaoSocial).join(', ') + '.' : '')
      });
    }
    if (emp.length > 1)
      return res.status(409).json({ erro: 'Mais de uma concessionária com esse nome — informe a razão social exata.' });
    if (emp[0].EhFabrica)
      return res.status(400).json({ erro: ERRO_DESTINO_FABRICA });
    if (emp[0].EmpresaId === veic.EmpresaId)
      return res.status(409).json({ erro: 'O veículo já pertence a ' + emp[0].RazaoSocial + '.' });

    await query(
      `UPDATE dbo.Veiculo
          SET EmpresaId = @eid,
              EntradaEstoque = SYSUTCDATETIME(),
              AtualizadoEm = SYSUTCDATETIME()
        WHERE VeiculoId = @id`,
      { eid: emp[0].EmpresaId, id: veic.VeiculoId }
    );

    // Um chassi que sai da Fábrica está sendo ATRIBUÍDO; um que já estava numa
    // concessionária está sendo TRANSFERIDO. A distinção importa na leitura do
    // histórico.
    const primeiraVez = !!veic.NaFabrica;
    await registrarEvento({
      veiculoId: veic.VeiculoId,
      tipo: primeiraVez ? 'atribuicao' : 'transferencia',
      titulo: primeiraVez
        ? 'Atribuído a ' + emp[0].RazaoSocial
        : 'Transferido para ' + emp[0].RazaoSocial,
      detalhe: primeiraVez ? null : 'Concessionária anterior: ' + (veic.EmpresaNome || '—'),
      user: req.user, empresaId: emp[0].EmpresaId, empresaNome: emp[0].RazaoSocial
    });

    const rows = await query(SELECT_VEIC + ' WHERE v.VeiculoId = @id', { id: veic.VeiculoId });
    res.json({ ...toVeiculo(rows[0]), empresa: emp[0].RazaoSocial });
  } catch (e) { next(e); }
});

// PUT /api/veiculos/:niv/ano (SÓ ADMIN) — corrige o ano de um chassi já
// cadastrado. { ano }
//
// O NIV é imutável (é a identidade da moto), mas o ano é só um dado digitado
// no cadastro — e digitação errada acontece. Diferente do NIV, corrigi-lo não
// tem por que exigir cadastrar um chassi novo. A correção fica registrada no
// histórico do veículo (tipo 'nota', a mesma categoria de uma anotação
// administrativa) para quem olhar o chassi depois entender de onde veio a
// mudança — sem isso, o valor trocaria "sozinho" aos olhos de quem consulta.
router.put('/veiculos/:niv/ano', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const ano = Number(req.body?.ano);
    const erroAno = validarAno(ano);
    if (erroAno) return res.status(400).json(erroAno);

    const veic = await acharVeiculo(req.params.niv, req.user);
    if (!veic) return res.status(404).json({ erro: 'Veículo não encontrado.' });
    if (veic.Ano === ano) return res.status(409).json({ erro: 'O chassi já está com o ano ' + ano + '.' });

    const anoAntigo = veic.Ano;
    await query(
      'UPDATE dbo.Veiculo SET Ano = @ano, AtualizadoEm = SYSUTCDATETIME() WHERE VeiculoId = @id',
      { ano, id: veic.VeiculoId }
    );
    await registrarEvento({
      veiculoId: veic.VeiculoId, tipo: 'nota', titulo: 'Ano corrigido',
      detalhe: 'De ' + anoAntigo + ' para ' + ano,
      user: req.user, empresaId: veic.EmpresaId, empresaNome: veic.EmpresaNome, manual: true
    });

    const rows = await query(SELECT_VEIC + ' WHERE v.VeiculoId = @id', { id: veic.VeiculoId });
    res.json(toVeiculo(rows[0]));
  } catch (e) { next(e); }
});

// POST /api/veiculos/:niv/garantia — ativa a garantia (se ainda não ativa).
router.post('/veiculos/:niv/garantia', requireAuth, requireArea('acoes'), async (req, res, next) => {
  try {
    const veic = await acharVeiculo(req.params.niv, req.user);
    if (!veic) return res.status(404).json({ erro: 'Veículo não encontrado.' });
    if (veic.GarantiaAtivaEm)
      return res.status(409).json({ erro: 'Garantia já está ativa.' });

    await query(
      `UPDATE dbo.Veiculo
          SET GarantiaAtivaEm = SYSUTCDATETIME(), AtualizadoEm = SYSUTCDATETIME()
        WHERE VeiculoId = @id`,
      { id: veic.VeiculoId }
    );

    await registrarEvento({
      veiculoId: veic.VeiculoId, tipo: 'garantia', titulo: 'Garantia ativada',
      user: req.user, empresaId: veic.EmpresaId, empresaNome: veic.EmpresaNome
    });

    const rows = await query(SELECT_VEIC + ' WHERE v.VeiculoId = @id', { id: veic.VeiculoId });
    res.json(toVeiculo(rows[0]));
  } catch (e) { next(e); }
});

/* ============================================================
   HISTÓRICO DO VEÍCULO
   ------------------------------------------------------------
   A linha do tempo do chassi. A maior parte das entradas nasce sozinha, dos
   pontos acima e das reivindicações; o POST existe para o que o sistema não
   tem como saber por conta própria — recall, revisão feita na oficina, uma
   observação sobre aquele chassi.
   ============================================================ */

// GET /api/veiculos/:niv/historico — respeita o mesmo escopo do veículo:
// o cliente só lê o histórico de um chassi que é dele.
router.get('/veiculos/:niv/historico', requireAuth, requireAreaAny(['estoque', 'acoes']), async (req, res, next) => {
  try {
    const veic = await acharVeiculo(req.params.niv, req.user);
    if (!veic) return res.status(404).json({ erro: 'Veículo não encontrado.' });
    res.json(await historicoDoVeiculo(veic.VeiculoId));
  } catch (e) { next(e); }
});

// POST /api/veiculos/:niv/historico (SÓ ADMIN) — lança um evento à mão.
//   { tipo: 'recall' | 'revisao' | 'nota', titulo, detalhe?, referencia?, data? }
//
// Só administrador: o histórico é a memória oficial do chassi e vale como
// prova em garantia. Deixar cada concessionária escrever nele abriria espaço
// para versões conflitantes do que aconteceu com a moto.
router.post('/veiculos/:niv/historico', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const tipo = String(req.body?.tipo || '').trim();
    const titulo = String(req.body?.titulo || '').trim();
    const detalhe = String(req.body?.detalhe || '').trim();
    const referencia = String(req.body?.referencia || '').trim();

    if (!TIPOS_MANUAIS.includes(tipo))
      return res.status(400).json({ erro: 'Tipo inválido — use ' + TIPOS_MANUAIS.join(', ') + '.' });
    if (!titulo) return res.status(400).json({ erro: 'Informe o título do registro.' });

    // Data opcional (um recall pode ser lançado hoje para uma campanha de
    // semana passada). Recusamos data futura: histórico é do que já aconteceu.
    let dataEvento = null;
    if (req.body?.data) {
      dataEvento = new Date(req.body.data);
      if (Number.isNaN(dataEvento.getTime()))
        return res.status(400).json({ erro: 'Data inválida.' });
      if (dataEvento.getTime() > Date.now() + 60 * 1000)
        return res.status(400).json({ erro: 'A data do evento não pode estar no futuro.' });
    }

    const veic = await acharVeiculo(req.params.niv, req.user);
    if (!veic) return res.status(404).json({ erro: 'Veículo não encontrado.' });

    const ok = await registrarEvento({
      veiculoId: veic.VeiculoId, tipo, titulo, detalhe: detalhe || null,
      referencia: referencia || null, manual: true, dataEvento,
      user: req.user, empresaId: veic.EmpresaId, empresaNome: veic.EmpresaNome
    });
    if (!ok) return res.status(500).json({ erro: 'Não foi possível gravar o registro.' });

    res.status(201).json(await historicoDoVeiculo(veic.VeiculoId));
  } catch (e) { next(e); }
});

// DELETE /api/veiculos/:niv/historico/:id (SÓ ADMIN) — apaga um lançamento
// MANUAL (corrigir um recall digitado errado). Evento automático não sai: ele
// é o registro do que de fato aconteceu, e poder apagá-lo esvaziaria o
// histórico de sentido.
router.delete('/veiculos/:niv/historico/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const veic = await acharVeiculo(req.params.niv, req.user);
    if (!veic) return res.status(404).json({ erro: 'Veículo não encontrado.' });

    const id = Number(req.params.id);
    const alvo = (await query(
      'SELECT Manual FROM dbo.VeiculoHistorico WHERE HistoricoId = @id AND VeiculoId = @vid',
      { id, vid: veic.VeiculoId }))[0];
    if (!alvo) return res.status(404).json({ erro: 'Registro não encontrado neste chassi.' });
    if (!alvo.Manual)
      return res.status(409).json({ erro: 'Este registro foi gerado pelo sistema e não pode ser apagado.' });

    await query('DELETE FROM dbo.VeiculoHistorico WHERE HistoricoId = @id', { id });
    res.json(await historicoDoVeiculo(veic.VeiculoId));
  } catch (e) { next(e); }
});

export default router;
