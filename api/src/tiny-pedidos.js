// Exportação de pedidos para o Tiny (o estoque lá é compartilhado com o Magento).
//   remessa   "Confirmar envio": as peças que saíram viram um pedido aprovado no Tiny (-R2, -R3…).
//   backorder cada liberação de pré-venda vira pedido próprio (-PV).
//   normal    pedido inteiro de uma vez (hoje só garantia).
// Cancelamento local cancela no Tiny o que não saiu. Cancelado no Tiny vira só aviso.
// TinyPedidoId gravado logo após incluir: nunca duplica. Liga com TINY_EXPORTAR_PEDIDOS=1.
import 'dotenv/config';
import { query, sql } from './db.js';
import {
  incluirPedido, alterarSituacaoPedido, obterSaldoAtual, reservaPendente,
  obterSituacaoPedido
} from './tiny.js';
import { atualizarContatoTiny, clientesLigado } from './tiny-contatos.js';
import { registrarEventoPedido } from './historico-pedido.js';

// Depois disso, só o botão Reexportar.
const MAX_TENTATIVAS = 5;

export function exportacaoLigada() {
  return !!process.env.TINY_TOKEN && process.env.TINY_EXPORTAR_PEDIDOS === '1';
}

function fmtData(d) {
  return new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

/* ---------------- checagem de estoque em tempo real ---------------- */

// Checkout: atualiza o estoque da cesta com o saldo real do Tiny. Falha do Tiny não bloqueia.
export async function atualizarEstoqueCesta(skus) {
  if (!exportacaoLigada() || !skus.length) return;
  const params = {};
  const marks = skus.map((s, i) => { params[`s${i}`] = String(s); return `@s${i}`; });
  const rows = await query(
    `SELECT ProdutoId, Sku, TinyId FROM dbo.Produto
      WHERE TinyAtivo = 1 AND TinyId IS NOT NULL AND Sku IN (${marks.join(',')})`,
    params
  );
  for (const p of rows) {
    try {
      const saldo = await obterSaldoAtual(p.TinyId);
      const reserva = await reservaPendente(p.ProdutoId);
      await query(
        `UPDATE dbo.Produto
            SET Estoque = @e, TinySincronizadoEm = SYSUTCDATETIME(), AtualizadoEm = SYSUTCDATETIME()
          WHERE ProdutoId = @pid`,
        { e: Math.max(0, saldo - reserva), pid: p.ProdutoId }
      );
    } catch (e) {
      console.warn(`⚠ Checagem de estoque no Tiny falhou para ${p.Sku}: ${e.message} — seguindo com o estoque local.`);
    }
  }
}

/* ---------------- criação das exportações (dentro da transação do pedido) -- */

// Agenda a exportação na mesma transação do pedido. `itens` = snapshot [{ sku, nome, preco, qtd }].
export async function inserirExportacao(tx, pedidoId, escopo, itens = null) {
  await new sql.Request(tx)
    .input('pid', sql.Int, pedidoId)
    .input('esc', sql.VarChar(10), escopo)
    .input('itens', sql.NVarChar(sql.MAX), itens ? JSON.stringify(itens) : null)
    .query('INSERT INTO dbo.TinyPedidoExport (PedidoId, Escopo, ItensJson) VALUES (@pid, @esc, @itens)');
}

/* ---------------- montagem do payload da API v2 ---------------- */

// Payload de pedido.incluir.php: cliente = a concessionária; itens do pedido ou do ItensJson.
export async function montarPayload(exp) {
  const ped = (await query(
    `SELECT p.PedidoId, p.NumeroPedido, p.DataPedido, p.EmpresaId, p.Tipo,
            u.Email AS UsuarioEmail,
            e.RazaoSocial, e.NomeFantasia, e.Cnpj, e.InscricaoEstadual,
            e.Email AS EmpresaEmail, e.Telefone,
            p.ListaPrecoId, lp.Ativa AS ListaAtiva
       FROM dbo.Pedido p
       JOIN dbo.Usuario u ON u.UsuarioId = p.UsuarioId
       JOIN dbo.Empresa e ON e.EmpresaId = p.EmpresaId
       LEFT JOIN dbo.ListaPreco lp ON lp.ListaPrecoId = p.ListaPrecoId
      WHERE p.PedidoId = @pid`,
    { pid: exp.PedidoId }
  ))[0];
  if (!ped) throw new Error(`Pedido ${exp.PedidoId} não encontrado para exportação.`);

  const end = (await query(
    `SELECT TOP 1 Logradouro, Numero, Complemento, Bairro, Cidade, Uf, Cep
       FROM dbo.Endereco
      WHERE EmpresaId = @eid AND Tipo = 'Entrega'
      ORDER BY Principal DESC, EnderecoId`,
    { eid: ped.EmpresaId }
  ))[0];

  let itens;
  if (exp.ItensJson) {
    itens = JSON.parse(exp.ItensJson);
  } else {
    itens = (await query(
      `SELECT Sku, NomeProduto, PrecoUnitario, Quantidade
         FROM dbo.PedidoItem
        WHERE PedidoId = @pid AND EmBackorder = 0`,
      { pid: exp.PedidoId }
    )).map(r => ({ sku: r.Sku, nome: r.NomeProduto, preco: Number(r.PrecoUnitario), qtd: r.Quantidade }));
  }
  if (!itens.length) return null;

  const backorder = exp.Escopo === 'backorder';
  const remessa = exp.Escopo === 'remessa';

  // 1ª remessa usa o número do pedido; as seguintes ganham -R2, -R3… (número único no Tiny).
  let ordem = 1;
  if (remessa) {
    ordem = (await query(
      `SELECT COUNT(*) AS n FROM dbo.TinyPedidoExport
        WHERE PedidoId = @pid AND Escopo IN ('normal', 'remessa')
          AND Status <> 'cancelado' AND ExportId <= @eid`,
      { pid: exp.PedidoId, eid: exp.ExportId }
    ))[0].n || 1;
  }
  // Ainda falta peça? Vai na observação.
  const faltam = remessa ? (await query(
    `SELECT SUM(Quantidade - QuantidadeEnviada) AS n FROM dbo.PedidoItem
      WHERE PedidoId = @pid AND Quantidade > QuantidadeEnviada`,
    { pid: exp.PedidoId }
  ))[0].n || 0 : 0;
  const cnpj = String(ped.Cnpj || '').replace(/\D/g, '');
  const cliente = {
    nome: ped.RazaoSocial,
    tipo_pessoa: cnpj.length === 11 ? 'F' : 'J',
    email: ped.EmpresaEmail || ped.UsuarioEmail,
    atualizar_cliente: 'N'
  };
  if (ped.NomeFantasia) cliente.nome_fantasia = ped.NomeFantasia;
  if (cnpj) cliente.cpf_cnpj = cnpj;
  if (ped.InscricaoEstadual) cliente.ie = ped.InscricaoEstadual;
  if (ped.Telefone) cliente.fone = ped.Telefone;
  if (end) {
    cliente.endereco = end.Logradouro;
    if (end.Numero) cliente.numero = end.Numero;
    if (end.Complemento) cliente.complemento = end.Complemento;
    if (end.Bairro) cliente.bairro = end.Bairro;
    if (end.Cep) cliente.cep = end.Cep;
    cliente.cidade = end.Cidade;
    if (end.Uf) cliente.uf = end.Uf;
  }

  const payload = {
    data_pedido: fmtData(exp.CriadoEm || ped.DataPedido),
    cliente,
    itens: itens.map(i => ({
      item: {
        codigo: i.sku,
        descricao: i.nome,
        unidade: 'UN',
        quantidade: String(i.qtd),
        valor_unitario: Number(i.preco).toFixed(2)
      }
    })),
    // -PV nas liberações de pré-venda.
    numero_pedido_ecommerce: backorder
      ? `${ped.NumeroPedido}-PV${exp.ExportId}`
      : (remessa && ordem > 1 ? `${ped.NumeroPedido}-R${ordem}` : ped.NumeroPedido),
    obs: (ped.Tipo === 'garantia' ? 'GARANTIA (reposição sem cobrança) — ' : '') +
      (backorder
        ? `Pré-venda liberada do pedido Fullgas ${ped.NumeroPedido}`
        : remessa
          ? `Remessa ${ordem} do pedido Fullgas ${ped.NumeroPedido} — contém somente as peças ` +
            `enviadas nesta remessa` +
            (faltam ? `; faltam ${faltam} peça(s), que virão em remessa seguinte` : ' (envio concluído)')
          : `Pedido Fullgas ${ped.NumeroPedido}`) + ` — usuário ${ped.UsuarioEmail}.`
  };
  // Só identifica a lista (o preço já vai com o %). Lista inativa não vai, senão o Tiny recusa.
  if (ped.ListaPrecoId && ped.ListaAtiva) payload.id_lista_preco = ped.ListaPrecoId;
  return payload;
}

/* ---------------- processamento da fila ---------------- */

// Exporta uma linha: inclui (se ainda não) e aprova. Se só a aprovação falhar, o retry não recria.
export async function exportarPedido(exportId) {
  const exp = (await query(
    'SELECT * FROM dbo.TinyPedidoExport WHERE ExportId = @id', { id: exportId }
  ))[0];
  if (!exp || exp.Status === 'enviado' || exp.Status === 'cancelado') return exp?.Status || null;

  try {
    let tinyId = exp.TinyPedidoId;
    if (!tinyId) {
      const payload = await montarPayload(exp);
      if (!payload) {
        await query(
          `UPDATE dbo.TinyPedidoExport SET Status = 'cancelado', UltimoErro = N'Sem itens para exportar.'
            WHERE ExportId = @id`, { id: exportId });
        return 'cancelado';
      }
      const r = await incluirPedido(payload);
      tinyId = r.id;
      await query(
        'UPDATE dbo.TinyPedidoExport SET TinyPedidoId = @t, TinyNumero = @n WHERE ExportId = @id',
        { t: r.id, n: r.numero, id: exportId }
      );
    }
    await alterarSituacaoPedido(tinyId, 'aprovado');
    await query(
      `UPDATE dbo.TinyPedidoExport
          SET Status = 'enviado', ExportadoEm = SYSUTCDATETIME(), UltimoErro = NULL
        WHERE ExportId = @id`, { id: exportId });
    console.log(`✓ Exportação Tiny #${exportId}: pedido ${tinyId} criado e aprovado no Tiny.`);
    const nTiny = (await query('SELECT TinyNumero FROM dbo.TinyPedidoExport WHERE ExportId = @id', { id: exportId }))[0]?.TinyNumero;
    await registrarEventoPedido({
      pedidoId: exp.PedidoId, tipo: 'tiny', referencia: nTiny || String(tinyId),
      titulo: ({ backorder: 'Pré-venda criada e aprovada no Tiny', remessa: 'Remessa criada e aprovada no Tiny' }[exp.Escopo] ||
        'Pedido criado e aprovado no Tiny') +
        (nTiny ? ` (nº ${nTiny})` : ''),
      detalhe: 'O estoque do Tiny foi descontado.'
    });

    // O Tiny pode criar contato duplicado sozinho: reconcilia o cadastro (nunca derruba a exportação).
    if (clientesLigado()) {
      const emp = (await query(
        'SELECT EmpresaId FROM dbo.Pedido WHERE PedidoId = @pid', { pid: exp.PedidoId }
      ))[0];
      if (emp) await atualizarContatoTiny(emp.EmpresaId).catch(() => { });
    }
    return 'enviado';
  } catch (e) {
    await query(
      `UPDATE dbo.TinyPedidoExport
          SET Status = 'erro', Tentativas = Tentativas + 1, UltimoErro = @msg
        WHERE ExportId = @id`,
      { msg: String(e.message).slice(0, 500), id: exportId }
    ).catch(err => console.error('TinyPedidoExport não atualizou:', err.message));
    console.error(`✗ Exportação Tiny #${exportId} falhou: ${e.message}`);
    // Só a primeira falha vai para o histórico.
    if (!exp.Tentativas) {
      await registrarEventoPedido({
        pedidoId: exp.PedidoId, tipo: 'aviso', titulo: 'Falha ao enviar ao Tiny — o sistema vai tentar de novo',
        detalhe: String(e.message).slice(0, 300)
      });
    }
    return 'erro';
  }
}

// Processa a fila ('pendente' e 'erro' dentro do limite). Uma execução por vez.
let processando = false;
export async function processarExportacoes() {
  if (!exportacaoLigada() || processando) return;
  processando = true;
  try {
    const rows = await query(
      `SELECT ExportId FROM dbo.TinyPedidoExport
        WHERE Status IN ('pendente', 'erro') AND Tentativas < @max
        ORDER BY ExportId`, { max: MAX_TENTATIVAS });
    for (const r of rows) await exportarPedido(r.ExportId);
  } catch (e) {
    console.error('✗ Fila de exportação Tiny falhou:', e.message);
  } finally {
    processando = false;
  }
}

/* ---------------- status Tiny → Fullgas ---------------- */

// Situações do Tiny refletidas no pedido local.
const MAPA_SITUACAO_TINY = { enviado: 'Enviado', entregue: 'Entregue' };

// Cancelado/excluído no Tiny vira aviso na exportação (não cancela o pedido daqui).
export const AVISO_CANCELADO_NO_TINY = 'Cancelado no Tiny';
export const AVISO_EXCLUIDO_NO_TINY = 'Excluído do Tiny';
async function avisarMudancaNoTiny(r, aviso) {
  const msg = `${aviso} — o pedido ${r.NumeroPedido} segue '${r.Status}' no Fullgas ` +
    '(fatura em aberto). Cancele no painel se a venda não vai acontecer.';
  const marcou = await query(
    `UPDATE dbo.TinyPedidoExport SET UltimoErro = @msg
     OUTPUT inserted.ExportId
      WHERE ExportId = @id AND UltimoErro IS NULL`,
    { msg: msg.slice(0, 500), id: r.ExportId });
  if (marcou?.length) {
    console.warn(`⚠ ${msg}`);
    await registrarEventoPedido({ pedidoId: r.PedidoId, tipo: 'aviso', titulo: aviso, detalhe: msg, referencia: String(r.TinyPedidoId) });
  }
}
const RE_NAO_LOCALIZADO = /n[ãa]o\s+(foi\s+)?(localizad|encontrad)/i;

// Reflete Enviado/Entregue do Tiny no status local. Nunca regride nem mexe em pedido final.
export async function sincronizarSituacaoPedidos() {
  if (!exportacaoLigada()) return;
  const rows = await query(
    `SELECT e.ExportId, e.TinyPedidoId, p.PedidoId, p.NumeroPedido, p.Status,
            CASE WHEN EXISTS (SELECT 1 FROM dbo.PedidoItem pi
                               WHERE pi.PedidoId = p.PedidoId
                                 AND pi.Quantidade > pi.QuantidadeEnviada) THEN 1 ELSE 0 END AS TemPendente
       FROM dbo.TinyPedidoExport e
       JOIN dbo.Pedido p ON p.PedidoId = e.PedidoId
      WHERE e.Escopo IN ('normal', 'remessa') AND e.Status = 'enviado' AND e.TinyPedidoId IS NOT NULL
        AND p.Status NOT IN (N'Entregue', N'Cancelado')`);
  for (const r of rows) {
    try {
      let sit;
      try {
        sit = await obterSituacaoPedido(r.TinyPedidoId);
      } catch (e) {
        if (RE_NAO_LOCALIZADO.test(e.message)) { await avisarMudancaNoTiny(r, AVISO_EXCLUIDO_NO_TINY); continue; }
        throw e;
      }
      if (sit === 'cancelado') { await avisarMudancaNoTiny(r, AVISO_CANCELADO_NO_TINY); continue; }
      // Ainda falta peça sair aqui: não fecha.
      if (r.TemPendente) continue;
      const alvo = sit ? MAPA_SITUACAO_TINY[sit] : null;
      // Ignora situação não mapeada e o que já bate.
      if (!alvo || alvo === r.Status) continue;
      if (r.Status === 'Entregue' && alvo === 'Enviado') continue;
      await query(
        `UPDATE dbo.Pedido SET Status = @st, AtualizadoEm = SYSUTCDATETIME()
          WHERE PedidoId = @pid AND Status NOT IN (N'Entregue', N'Cancelado')`,
        { st: alvo, pid: r.PedidoId });
      console.log(`✓ Status Tiny→Fullgas: pedido ${r.NumeroPedido} → '${alvo}' (Tiny: '${sit}').`);
    } catch (e) {
      console.warn(`⚠ Situação Tiny do pedido ${r.NumeroPedido} indisponível: ${e.message}`);
    }
  }
}

/* ---------------- cancelamento ---------------- */

// Cancelamento local → cancela no Tiny (linhas marcadas 'cancelado' antes da chamada).
// Remessa e pré-venda ficam como estão (só levam o que saiu).
// Pedido inteiro ('normal') com peça já enviada: só aviso de ajuste manual.
const SO_O_QUE_SAIU = ['remessa', 'backorder'];
export async function cancelarExportacoesDoPedido(pedidoId, { pecasEnviadas = 0 } = {}) {
  const rows = await query(
    `SELECT ExportId, Escopo, TinyPedidoId FROM dbo.TinyPedidoExport
      WHERE PedidoId = @pid AND Status <> 'cancelado'`, { pid: pedidoId });
  for (const r of rows) {
    if (pecasEnviadas > 0 && SO_O_QUE_SAIU.includes(r.Escopo)) continue;
    const manual = pecasEnviadas > 0 && r.TinyPedidoId
      ? `Pedido cancelado no Fullgas com ${pecasEnviadas} peça(s) já enviada(s): ajuste o pedido ` +
        `${r.TinyPedidoId} no Tiny à mão — só as peças que não saíram devem voltar ao estoque.`
      : null;
    await query(
      "UPDATE dbo.TinyPedidoExport SET Status = 'cancelado', UltimoErro = @msg WHERE ExportId = @id",
      { id: r.ExportId, msg: manual }
    );
    if (!r.TinyPedidoId) continue; // nunca chegou ao Tiny: nada a desfazer lá
    if (manual) {
      console.warn(`⚠ Exportação Tiny #${r.ExportId}: ${manual}`);
      await registrarEventoPedido({ pedidoId, tipo: 'aviso', titulo: 'Tiny precisa de ajuste manual', detalhe: manual });
      continue;
    }
    try {
      await alterarSituacaoPedido(r.TinyPedidoId, 'cancelado');
      console.log(`✓ Exportação Tiny #${r.ExportId}: pedido ${r.TinyPedidoId} cancelado no Tiny.`);
      await registrarEventoPedido({
        pedidoId, tipo: 'tiny', titulo: 'Pedido cancelado no Tiny', detalhe: 'O estoque do Tiny foi devolvido.',
        referencia: String(r.TinyPedidoId)
      });
    } catch (e) {
      await query(
        'UPDATE dbo.TinyPedidoExport SET UltimoErro = @msg WHERE ExportId = @id',
        { msg: `Cancele manualmente no Tiny (pedido ${r.TinyPedidoId}): ${e.message}`.slice(0, 500), id: r.ExportId }
      ).catch(() => {});
      console.error(`✗ Cancelamento no Tiny falhou (export #${r.ExportId}): ${e.message}`);
      await registrarEventoPedido({
        pedidoId, tipo: 'aviso', titulo: 'Cancele o pedido manualmente no Tiny',
        detalhe: `O cancelamento automático falhou: ${e.message}`, referencia: String(r.TinyPedidoId)
      });
    }
  }
}
