// ============================================================
// Exportação de PEDIDOS para o Tiny ERP (sentido Fullgas → Tiny)
// ------------------------------------------------------------
// O estoque do Tiny é compartilhado com outro e-commerce (Magento).
// Para a peça vendida aqui sumir de lá o quanto antes, cada pedido
// do Fullgas vira um pedido no Tiny NA HORA da compra, já 'aprovado'
// (a aprovação baixa o estoque no Tiny — a conta precisa estar com
// "lançar estoque na aprovação do pedido" ligado).
//
// Fluxo:
//   REMESSA (escopo 'remessa'): o admin decide o que vai nesta saída
//   (quantidade enviada de cada peça) e clica em "Confirmar envio" —
//   só então as peças daquela remessa viram um pedido no Tiny. Um
//   pedido enviado em partes gera uma remessa por saída; o Tiny recebe
//   exatamente o que saiu. Se o Tiny estiver fora, a linha fica 'erro'
//   e o cron (tiny-cron.js) tenta de novo.
//
//   O escopo 'normal' (pedido inteiro exportado na APROVAÇÃO) é
//   HISTÓRICO: até 17/09/2026 o pedido ia ao Tiny quando o admin o
//   tirava de 'Pendente', antes de qualquer envio. As linhas antigas
//   continuam sendo lidas; nenhuma nova é criada.
//
//   Pré-venda: quando o admin libera o envio do backorder, cada
//   liberação gera um SEGUNDO pedido no Tiny (escopo 'backorder')
//   com o snapshot dos itens liberados naquele momento (ItensJson).
//
//   Cancelamento local → pedidos já criados no Tiny são cancelados
//   lá (a situação 'cancelado' devolve o estoque no Tiny).
//
// Idempotência: TinyPedidoId é gravado logo após a inclusão — um
// pedido NUNCA é incluído duas vezes; se só a aprovação falhar, o
// retry reaprova sem recriar.
//
// Liga/desliga: TINY_EXPORTAR_PEDIDOS=1 no .env (além do TINY_TOKEN).
// Desligado, o site vende normalmente só com o estoque local.
// ============================================================
import 'dotenv/config';
import { query, sql } from './db.js';
import {
  incluirPedido, alterarSituacaoPedido, obterSaldoAtual, reservaPendente,
  obterSituacaoPedido
} from './tiny.js';
import { atualizarContatoTiny, clientesLigado } from './tiny-contatos.js';

// Depois disso o cron para de insistir; o admin pode reexportar pelo painel
// (o botão zera as tentativas).
const MAX_TENTATIVAS = 5;

export function exportacaoLigada() {
  return !!process.env.TINY_TOKEN && process.env.TINY_EXPORTAR_PEDIDOS === '1';
}

function fmtData(d) {
  return new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

/* ---------------- checagem de estoque em tempo real ---------------- */

// Chamada pelo checkout ANTES de baixar o estoque local: consulta o saldo
// atual no Tiny para cada item da cesta e atualiza o espelho local. Se o
// Magento acabou de vender a peça, o cliente descobre agora — e não depois
// de "comprar" algo que já não existe. Falha do Tiny NÃO bloqueia a venda:
// segue com o estoque local (o cron corrige depois).
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

// Insere a linha de exportação NA MESMA transação que grava o pedido: ou o
// pedido nasce com a exportação agendada, ou nada. `itens` (só no escopo
// 'backorder') é o snapshot [{ sku, nome, preco, qtd }] liberado agora.
export async function inserirExportacao(tx, pedidoId, escopo, itens = null) {
  await new sql.Request(tx)
    .input('pid', sql.Int, pedidoId)
    .input('esc', sql.VarChar(10), escopo)
    .input('itens', sql.NVarChar(sql.MAX), itens ? JSON.stringify(itens) : null)
    .query('INSERT INTO dbo.TinyPedidoExport (PedidoId, Escopo, ItensJson) VALUES (@pid, @esc, @itens)');
}

/* ---------------- montagem do payload da API v2 ---------------- */

// Formato de pedido.incluir.php. Cliente = a concessionária (Empresa) + o
// endereço de entrega cadastrado; itens = snapshot do PedidoItem (escopo
// 'normal') ou o ItensJson gravado na liberação (escopo 'backorder').
// Exportada só para depuração/teste (monta sem enviar).
export async function montarPayload(exp) {
  const ped = (await query(
    `SELECT p.PedidoId, p.NumeroPedido, p.DataPedido, p.EmpresaId, p.Tipo,
            u.Email AS UsuarioEmail,
            e.RazaoSocial, e.NomeFantasia, e.Cnpj, e.InscricaoEstadual,
            e.Email AS EmpresaEmail, e.Telefone
       FROM dbo.Pedido p
       JOIN dbo.Usuario u ON u.UsuarioId = p.UsuarioId
       JOIN dbo.Empresa e ON e.EmpresaId = p.EmpresaId
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

  // Ordem desta remessa no pedido: a 1ª leva o número do pedido Fullgas (o
  // caso comum, pedido que sai inteiro de uma vez); as seguintes ganham -R2,
  // -R3... porque o número do pedido de e-commerce precisa ser único no Tiny.
  // Exportações 'normal' (regra antiga) contam na ordem: se um pedido já foi
  // ao Tiny inteiro, uma remessa posterior nunca reusa aquele número.
  let ordem = 1;
  if (remessa) {
    ordem = (await query(
      `SELECT COUNT(*) AS n FROM dbo.TinyPedidoExport
        WHERE PedidoId = @pid AND Escopo IN ('normal', 'remessa')
          AND Status <> 'cancelado' AND ExportId <= @eid`,
      { pid: exp.PedidoId, eid: exp.ExportId }
    ))[0].n || 1;
  }
  // Ainda falta peça neste pedido? Entra na observação, para quem abrir o
  // pedido no Tiny saber que o restante vem em outra remessa.
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

  return {
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
    // Sufixo -PV nas liberações de pré-venda: cada uma é um pedido próprio no
    // Tiny e o número do e-commerce precisa distingui-las.
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
}

/* ---------------- processamento da fila ---------------- */

// Exporta UMA linha: inclui o pedido no Tiny (se ainda não foi) e o aprova.
// Os dois passos são separados de propósito — se a aprovação falhar, o retry
// NÃO recria o pedido (TinyPedidoId já gravado), só reaprova.
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

    // O pedido.incluir casa o cliente pelo CNPJ POR CONTA PRÓPRIA e, se não
    // achar, CRIA um contato — sem avisar e sem respeitar o nosso vínculo.
    // Foi assim que nasceram contatos duplicados presos ao cadastro antigo.
    // Reconcilia logo depois: confere quem detém o CNPJ, re-aponta o vínculo
    // se mudou e empurra o cadastro atual. Nunca derruba a exportação — o
    // pedido já está no Tiny; isto é só o cadastro acompanhando.
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
    return 'erro';
  }
}

// Processa tudo que está aguardando ('pendente' e 'erro' dentro do limite de
// tentativas). Chamada logo após criar um pedido (fire-and-forget) e pelo
// cron, como retry. Trava de sobreposição igual à do tiny-cron.
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

// Situações do Tiny que REFLETIMOS no status local do pedido. Só interessa ao
// negócio saber quando o Tiny marcou como enviado ou entregue; as demais
// (aprovado, preparando envio, FATURADO, pronto p/ envio...) são ignoradas.
const MAPA_SITUACAO_TINY = { enviado: 'Enviado', entregue: 'Entregue' };

// Puxa do Tiny a situação dos pedidos já exportados (escopo 'normal') que ainda
// não foram finalizados aqui e reflete 'Enviado'/'Entregue' no status local.
// Nunca regride (Entregue não volta a Enviado) nem toca pedidos já terminais.
// Chamada pelo cron, depois de reprocessar a fila de exportação.
export async function sincronizarSituacaoPedidos() {
  if (!exportacaoLigada()) return;
  const rows = await query(
    `SELECT e.TinyPedidoId, p.PedidoId, p.NumeroPedido, p.Status,
            CASE WHEN EXISTS (SELECT 1 FROM dbo.PedidoItem pi
                               WHERE pi.PedidoId = p.PedidoId
                                 AND pi.Quantidade > pi.QuantidadeEnviada) THEN 1 ELSE 0 END AS TemPendente
       FROM dbo.TinyPedidoExport e
       JOIN dbo.Pedido p ON p.PedidoId = e.PedidoId
      WHERE e.Escopo IN ('normal', 'remessa') AND e.Status = 'enviado' AND e.TinyPedidoId IS NOT NULL
        AND p.Status NOT IN (N'Entregue', N'Cancelado')`);
  for (const r of rows) {
    // Remessa entregue no Tiny NÃO fecha um pedido que ainda tem peça para
    // sair: lá cada remessa é um pedido próprio, aqui o pedido é um só.
    if (r.TemPendente) continue;
    try {
      const sit = await obterSituacaoPedido(r.TinyPedidoId);
      const alvo = sit ? MAPA_SITUACAO_TINY[sit] : null;
      // Ignora situações não mapeadas (faturado, aprovado...) e o que já bate;
      // nunca volta de Entregue para Enviado.
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

// Pedido cancelado no Fullgas → cancela também no Tiny (devolve o estoque lá).
// As linhas são marcadas 'cancelado' ANTES da chamada ao Tiny para a fila não
// aprovar um pedido cancelado no meio do caminho; se a chamada falhar, o
// UltimoErro avisa que precisa cancelar manualmente no Tiny.
export async function cancelarExportacoesDoPedido(pedidoId) {
  const rows = await query(
    `SELECT ExportId, TinyPedidoId FROM dbo.TinyPedidoExport
      WHERE PedidoId = @pid AND Status <> 'cancelado'`, { pid: pedidoId });
  for (const r of rows) {
    await query(
      "UPDATE dbo.TinyPedidoExport SET Status = 'cancelado', UltimoErro = NULL WHERE ExportId = @id",
      { id: r.ExportId }
    );
    if (!r.TinyPedidoId) continue; // nunca chegou ao Tiny: nada a desfazer lá
    try {
      await alterarSituacaoPedido(r.TinyPedidoId, 'cancelado');
      console.log(`✓ Exportação Tiny #${r.ExportId}: pedido ${r.TinyPedidoId} cancelado no Tiny.`);
    } catch (e) {
      await query(
        'UPDATE dbo.TinyPedidoExport SET UltimoErro = @msg WHERE ExportId = @id',
        { msg: `Cancele manualmente no Tiny (pedido ${r.TinyPedidoId}): ${e.message}`.slice(0, 500), id: r.ExportId }
      ).catch(() => {});
      console.error(`✗ Cancelamento no Tiny falhou (export #${r.ExportId}): ${e.message}`);
    }
  }
}
