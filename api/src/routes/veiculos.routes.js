// ---- Veículos (motos identificadas pelo NIV) ----
import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, requireAdmin, requireArea, requireAreaAny } from '../auth.js';
import {
  registrarEvento, historicoDoVeiculo, TIPOS_MANUAIS
} from '../historico-veiculo.js';
import { FABRICA, sqlEhFabrica, sqlNaFabrica } from '../fabrica.js';
import { cpfValido } from '../validacao.js';
import { miniaturaDe } from '../miniaturas.js';
import { GARANTIA_DIAS, fimDaGarantia } from '../utils/garantia.js';

const router = Router();

// Ano da unidade: até o ano atual + 2 (o ano-modelo sai antes do ano civil).
function validarAno(ano) {
  const anoMax = new Date().getFullYear() + 2;
  if (!Number.isInteger(ano) || ano < 1980 || ano > anoMax) {
    return { erro: 'Ano inválido — informe um ano entre 1980 e ' + anoMax + '.' };
  }
  return null;
}

// Linha do banco → formato do front.
// `entrada` = quando entrou no estoque ATUAL (reinicia a cada transferência).
// Dados do comprador só para quem registrou a venda e para o admin.
function podeVerComprador(r, user) {
  return !user || user.papel === 'admin' || (r.VendaEmpresaId != null && r.VendaEmpresaId === user.empresaId);
}

// URL relativa → absoluta (o front pode rodar em outra origem que a API).
function urlAbs(req, rel) {
  if (!rel) return rel || null;
  if (/^https?:\/\//i.test(rel)) return rel;
  return req.protocol + '://' + req.get('host') + rel;
}

// Endereço da concessionária em partes curtas (rua, cidade/UF, CEP).
function enderecoConcessionaria(r) {
  const rua = [r.EndLogradouro, r.EndNumero].filter(Boolean).join(', ') +
    (r.EndComplemento ? ' - ' + r.EndComplemento : '');
  return {
    endereco: [rua, r.EndBairro].filter(Boolean).join(' — '),
    cidade: [r.EndCidade, r.EndUf].filter(Boolean).join('/'),
    cep: r.EndCep || ''
  };
}

function toVeiculo(r, req) {
  const user = req.user;
  const naFabrica = !!r.NaFabrica;
  const v = {
    niv: r.Niv,
    modeloId: r.ModeloCodigo,
    // Nome do modelo junto (modelo desativado não vem em /veiculos/modelos).
    modelo: r.ModeloEtiqueta || [r.ModeloNome, r.ModeloAno].filter(Boolean).join(' ') || r.ModeloCodigo,
    ano: r.Ano,
    status: r.Status,
    entrada: r.EntradaEstoque,
    // Na Fábrica não há concessionária (ver fabrica.js).
    fabrica: naFabrica,
    empresaId: naFabrica ? null : r.EmpresaId,
    empresa: naFabrica ? null : r.EmpresaNome,
    // Foto do MODELO (a mesma do Localizador); miniatura null enquanto não gerada.
    foto: urlAbs(req, r.ModeloImagem),
    miniatura: urlAbs(req, miniaturaDe(r.ModeloImagem)),
    // Concessionária responsável hoje.
    concessionaria: naFabrica || !r.EmpresaId ? null : {
      nome: r.EmpresaNome,
      fantasia: r.EmpresaFantasia || '',
      telefone: r.EmpresaTelefone || '',
      email: r.EmpresaEmail || '',
      ...enderecoConcessionaria(r)
    },
    garantiaDias: GARANTIA_DIAS
  };
  if (r.VendaData) v.venda = podeVerComprador(r, user) ? {
    data: r.VendaData,
    cliente: r.VendaCliente || '',
    cpf: r.ClienteCpf || '',
    email: r.ClienteEmail || '',
    telefone: r.ClienteTelefone || '',
    endereco: r.ClienteEndereco || ''
  } : {
    data: r.VendaData,
    cliente: 'Venda registrada por outra concessionária',
    cpf: '', email: '', telefone: '', endereco: '',
    outraConcessionaria: true
  };
  if (r.GarantiaAtivaEm) {
    v.garantia = r.GarantiaAtivaEm;
    v.garantiaFim = fimDaGarantia(r.GarantiaAtivaEm);
  }
  return v;
}

const SELECT_VEIC =
  `SELECT v.VeiculoId, v.Niv, v.Ano, v.Status, v.EntradaEstoque, v.VendaData,
          v.VendaCliente, v.ClienteCpf, v.ClienteEmail, v.ClienteTelefone,
          v.ClienteEndereco, v.GarantiaAtivaEm, v.EmpresaId, v.VendaEmpresaId,
          m.Codigo AS ModeloCodigo, m.Nome AS ModeloNome, m.Ano AS ModeloAno,
          m.Etiqueta AS ModeloEtiqueta, m.ImagemUrl AS ModeloImagem,
          e.RazaoSocial AS EmpresaNome, e.NomeFantasia AS EmpresaFantasia,
          e.Telefone AS EmpresaTelefone, e.Email AS EmpresaEmail,
          en.Logradouro AS EndLogradouro, en.Numero AS EndNumero,
          en.Complemento AS EndComplemento, en.Bairro AS EndBairro,
          en.Cidade AS EndCidade, en.Uf AS EndUf, en.Cep AS EndCep,
          ${sqlNaFabrica('v.EmpresaId')} AS NaFabrica
     FROM dbo.Veiculo v
     JOIN dbo.ModeloMoto m ON m.ModeloId = v.ModeloId
     LEFT JOIN dbo.Empresa e ON e.EmpresaId = v.EmpresaId
     OUTER APPLY (
       -- endereço principal da concessionária (o mesmo critério da tela de usuários)
       SELECT TOP 1 d.Logradouro, d.Numero, d.Complemento, d.Bairro, d.Cidade, d.Uf, d.Cep
         FROM dbo.Endereco d
        WHERE d.EmpresaId = v.EmpresaId
        ORDER BY d.Principal DESC, d.EnderecoId ASC
     ) en`;

// Resposta para quem tenta pôr um chassi "na concessionária" do administrador.
const ERRO_DESTINO_FABRICA =
  'Esta empresa é a Fábrica (conta de administrador) e não recebe chassi como concessionária. ' +
  'Para deixar o chassi na Fábrica, não escolha concessionária.';

// Cliente vê só os veículos da empresa; admin vê todos. Devolve { where, params }.
function escopoEmpresa(user) {
  if (user.papel === 'admin') return { where: '', params: {} };
  return { where: ' v.EmpresaId = @empresaId', params: { empresaId: user.empresaId } };
}

// GET /api/veiculos/modelos — antes de /:niv, para "modelos" não virar um NIV.
router.get('/veiculos/modelos', requireAuth, async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT Codigo AS id, Nome AS nome, Ano AS ano, Etiqueta AS label, ImagemUrl
         FROM dbo.ModeloMoto WHERE Ativo = 1 ORDER BY Nome, Ano`
    );
    res.json(rows.map(r => ({
      id: r.id, nome: r.nome, ano: r.ano, label: r.label || (r.nome + ' ' + r.ano),
      imagem: urlAbs(req, r.ImagemUrl),
      miniatura: urlAbs(req, miniaturaDe(r.ImagemUrl))
    })));
  } catch (e) { next(e); }
});

// GET /api/empresas (admin) — concessionárias ativas, sem a Fábrica.
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

// POST /api/veiculos (admin) — { niv, modeloId, ano, empresaId? }. Sem empresa, nasce na Fábrica.
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

    // Cadastro sempre na Fábrica; detalhe com o nome do modelo (o código muda ao renomear).
    await registrarEvento({
      veiculoId: veic.VeiculoId, tipo: 'cadastro', titulo: 'Chassi cadastrado na Fábrica',
      detalhe: (mod.Etiqueta || (mod.Nome + ' ' + mod.Ano)) + ' · Ano ' + ano,
      user: req.user, empresaId: null
    });
    // Já atribuído: evento de atribuição separado.
    if (veic.EmpresaId) {
      await registrarEvento({
        veiculoId: veic.VeiculoId, tipo: 'atribuicao',
        titulo: 'Atribuído a ' + (veic.EmpresaNome || 'concessionária'),
        user: req.user, empresaId: veic.EmpresaId, empresaNome: veic.EmpresaNome
      });
    }

    res.status(201).json(toVeiculo(veic, req));
  } catch (e) { next(e); }
});

// GET /api/veiculos — da empresa (admin: todos). Áreas 'estoque' ou 'acoes'.
router.get('/veiculos', requireAuth, requireAreaAny(['estoque', 'acoes']), async (req, res, next) => {
  try {
    const esc = escopoEmpresa(req.user);
    const rows = await query(
      // Último a chegar no estoque primeiro.
      SELECT_VEIC + (esc.where ? ' WHERE' + esc.where : '') + ' ORDER BY v.EntradaEstoque DESC',
      esc.params
    );
    res.json(rows.map(r => toVeiculo(r, req)));
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
    res.json(toVeiculo(rows[0], req));
  } catch (e) { next(e); }
});

// Veículo pelo NIV dentro do escopo, ou null.
async function acharVeiculo(niv, user) {
  const esc = escopoEmpresa(user);
  const rows = await query(
    SELECT_VEIC + ' WHERE v.Niv = @niv' + (esc.where ? ' AND' + esc.where : ''),
    { niv, ...esc.params }
  );
  return rows[0] || null;
}

// POST /api/veiculos/:niv/venda  { cliente } — registra a venda e ativa a garantia. Só 'Disponível'.
router.post('/veiculos/:niv/venda', requireAuth, requireArea('acoes'), async (req, res, next) => {
  try {
    const { cliente, cpf, email, telefone, endereco } = req.body;
    const nome = (cliente || '').trim();
    if (!nome) return res.status(400).json({ erro: 'Informe o nome do cliente.' });
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return res.status(400).json({ erro: 'E-mail do cliente inválido.' });
    // CPF precisa ser válido (a venda não é corrigida depois).
    if (cpf && !cpfValido(cpf))
      return res.status(400).json({ erro: 'CPF do cliente inválido — confira os dígitos.' });

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
              VendaEmpresaId = EmpresaId,
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
    // Evento de garantia só se ela ativou agora.
    if (!veic.GarantiaAtivaEm && atualizado.GarantiaAtivaEm) {
      await registrarEvento({
        veiculoId: veic.VeiculoId, tipo: 'garantia',
        titulo: 'Garantia ativada', detalhe: 'Ativada automaticamente pelo registro da venda.',
        user: req.user, empresaId: atualizado.EmpresaId, empresaNome: atualizado.EmpresaNome
      });
    }

    res.json(toVeiculo(atualizado, req));
  } catch (e) { next(e); }
});

// PUT /api/veiculos/:niv/transferir (admin) — { empresaId } | { empresa: nome } | { fabrica: true }.
// Reinicia a EntradaEstoque. Nome ambíguo devolve sugestões.
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
      return res.json(toVeiculo(rows[0], req));
    }

    // A Fábrica entra na busca só para dar um erro claro.
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

    // Saindo da Fábrica = atribuição; entre concessionárias = transferência.
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
    res.json({ ...toVeiculo(rows[0], req), empresa: emp[0].RazaoSocial });
  } catch (e) { next(e); }
});

// PUT /api/veiculos/:niv/ano (admin) — { ano }. Corrige o ano e registra no histórico.
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
    res.json(toVeiculo(rows[0], req));
  } catch (e) { next(e); }
});

// (A garantia começa no registro da venda; não há ativação avulsa.)

// ---- Histórico do veículo ----

// GET /api/veiculos/:niv/historico — mesmo escopo do veículo.
router.get('/veiculos/:niv/historico', requireAuth, requireAreaAny(['estoque', 'acoes']), async (req, res, next) => {
  try {
    const veic = await acharVeiculo(req.params.niv, req.user);
    if (!veic) return res.status(404).json({ erro: 'Veículo não encontrado.' });
    res.json(await historicoDoVeiculo(veic.VeiculoId, req.user));
  } catch (e) { next(e); }
});

// POST /api/veiculos/:niv/historico (admin) — { tipo: 'recall' | 'revisao' | 'nota', titulo, detalhe?, referencia?, data? }
router.post('/veiculos/:niv/historico', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const tipo = String(req.body?.tipo || '').trim();
    const titulo = String(req.body?.titulo || '').trim();
    const detalhe = String(req.body?.detalhe || '').trim();
    const referencia = String(req.body?.referencia || '').trim();

    if (!TIPOS_MANUAIS.includes(tipo))
      return res.status(400).json({ erro: 'Tipo inválido — use ' + TIPOS_MANUAIS.join(', ') + '.' });
    if (!titulo) return res.status(400).json({ erro: 'Informe o título do registro.' });

    // Data opcional, nunca no futuro.
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

// DELETE /api/veiculos/:niv/historico/:id (admin) — só lançamento manual.
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
