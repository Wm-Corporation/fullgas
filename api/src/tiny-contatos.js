// ============================================================
// Sincronização de CADASTRO de clientes com o Tiny ERP (2 vias)
// ------------------------------------------------------------
// Regra de negócio: o cadastro da concessionária (razão social,
// fantasia, IE, e-mail, telefone e endereço) fica ESPELHADO entre
// o Fullgas e o Tiny, nos dois sentidos:
//
//   Fullgas → Tiny
//     - No cadastro (POST /register): pesquisa o CNPJ no Tiny e
//       VINCULA ao contato existente; se não existir, CRIA um lá
//       com os dados capturados (vincularContatoTiny).
//     - Quando a empresa edita o cadastro (PUT /conta/empresa):
//       ALTERA o contato correspondente no Tiny
//       (atualizarContatoTiny → contato.alterar.php).
//
//   Tiny → Fullgas
//     - A cada rodada do cron, relê os contatos vinculados
//       (contato.obter.php) e aplica no cadastro local o que
//       tiver mudado no Tiny (sincronizarContatosDoTiny).
//
// O CNPJ é a CHAVE do vínculo e nunca é alterado por aqui.
// Conflito (mudou nos dois lados entre sincronizações): a edição do
// portal tem prioridade enquanto não chega ao Tiny. Ela marca
// Empresa.TinyContatoAlterado = 1 (migration 046); o envio que der
// certo volta a 0. Com a marca ligada o cron RE-TENTA o envio em vez
// de trazer o contato de lá por cima — antes, um envio que falhasse
// era desfeito em silêncio pelo pull seguinte (achado de 30/09/2026).
//
// Liga/desliga: TINY_SINCRONIZAR_CLIENTES=1 no .env (além do
// TINY_TOKEN). Desligado, o cadastro funciona normalmente e nada
// é enviado nem lido do Tiny.
// ============================================================
import 'dotenv/config';
import { query } from './db.js';
import {
  pesquisarContatoPorCpfCnpj, incluirContato, alterarContato, obterContato, registrarLog
} from './tiny.js';

export function clientesLigado() {
  return !!process.env.TINY_TOKEN && process.env.TINY_SINCRONIZAR_CLIENTES === '1';
}

// "12345678000190" → "12.345.678/0001-90" (o Tiny costuma armazenar com
// máscara; a pesquisa tenta os dois formatos).
function fmtCnpj(dig) {
  return dig.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

// O Tiny devolve o CEP com ponto ("12.327-673", 10 chars); a coluna local é
// VarChar(9) no formato "12327-673". Normaliza para o formato local — sem isso
// o valor seria truncado e o pull acharia que "sempre mudou".
function normalizaCep(cep) {
  const d = String(cep || '').replace(/\D/g, '').slice(0, 8);
  return d.length === 8 ? d.slice(0, 5) + '-' + d.slice(5) : d;
}

// Carrega a empresa + endereço principal no formato usado pelos dois sentidos.
async function carregarEmpresa(empresaId) {
  return (await query(
    `SELECT e.EmpresaId, e.RazaoSocial, e.NomeFantasia, e.Cnpj, e.InscricaoEstadual,
            e.Email, e.Telefone, e.TinyContatoId,
            en.EnderecoId, en.Logradouro, en.Numero, en.Complemento, en.Bairro,
            en.Cidade, en.Uf, en.Cep
       FROM dbo.Empresa e
       OUTER APPLY (
         SELECT TOP 1 d.EnderecoId, d.Logradouro, d.Numero, d.Complemento, d.Bairro,
                d.Cidade, d.Uf, d.Cep
           FROM dbo.Endereco d
          WHERE d.EmpresaId = e.EmpresaId
          ORDER BY d.Principal DESC, d.EnderecoId ASC
       ) en
      WHERE e.EmpresaId = @eid`,
    { eid: empresaId }
  ))[0] || null;
}

// Monta o payload de contato para o Tiny.
//   - incluir (comId=false): só os dados.
//   - alterar (comId=true):  mais o `id` do contato no Tiny.
//
// ATENÇÃO — o contato.alterar.php SUBSTITUI o registro: todo campo NÃO enviado
// é apagado no Tiny. Por isso o CNPJ vai SEMPRE, inclusive na alteração. Omiti-
// -lo zerava o CNPJ do contato; sem CNPJ o contato deixava de casar com a
// empresa e a exportação do próximo pedido criava um contato NOVO — era a
// origem dos cadastros duplicados a cada edição. (O "CNPJ já cadastrado",
// código 30, não vem de mandar o próprio CNPJ: vem de já existir uma duplicata
// segurando esse número — tratado em atualizarContatoTiny.)
function montarContato(emp, comId = false) {
  const dig = String(emp.Cnpj || '').replace(/\D/g, '');
  const c = {
    // `sequencia` numera o registro dentro do lote enviado. Mandamos um contato
    // por chamada, então é sempre '1' — mas ele é obrigatório TAMBÉM na
    // inclusão, não só na alteração. Enquanto só ia no alterar, todo
    // contato.incluir.php voltava "O número de sequência deve ser informado" e
    // nenhuma empresa nova conseguia ser vinculada ao Tiny.
    sequencia: '1',
    nome: emp.RazaoSocial,
    tipo_pessoa: dig.length === 11 ? 'F' : 'J',
    situacao: 'A',
    obs: 'Sincronizado pelo portal Fullgas B2B.'
  };
  if (dig) c.cpf_cnpj = dig;
  if (comId && emp.TinyContatoId) c.id = String(emp.TinyContatoId);
  if (emp.NomeFantasia) c.fantasia = emp.NomeFantasia;
  if (emp.InscricaoEstadual) c.ie = emp.InscricaoEstadual;
  if (emp.Email) c.email = emp.Email;
  if (emp.Telefone) c.fone = emp.Telefone;
  if (emp.Logradouro) {
    c.endereco = emp.Logradouro;
    if (emp.Numero) c.numero = emp.Numero;
    if (emp.Complemento) c.complemento = emp.Complemento;
    if (emp.Bairro) c.bairro = emp.Bairro;
    if (emp.Cep) c.cep = emp.Cep;
    if (emp.Cidade) c.cidade = emp.Cidade;
    if (emp.Uf) c.uf = emp.Uf;
  }
  return c;
}

/* ============================================================
   Fullgas → Tiny
   ============================================================ */

// Vincula UMA empresa: pesquisa o CNPJ no Tiny; achou → grava o id do
// contato existente; não achou → cria o contato com os dados do cadastro.
// Falha não propaga (devolve null): a empresa segue pendente e o cron
// re-tenta. Chamada após o commit do /register e pelo cron.
export async function vincularContatoTiny(empresaId) {
  if (!clientesLigado()) return null;

  const emp = await carregarEmpresa(empresaId);
  if (!emp) return null;
  if (emp.TinyContatoId) {              // já vinculado — só apaga a pendência
    await desmarcarPendente(empresaId);
    return emp.TinyContatoId;
  }

  const dig = String(emp.Cnpj || '').replace(/\D/g, '');
  if (!dig) {                           // sem CNPJ não há o que atrelar
    await desmarcarPendente(empresaId);
    await registrarLog(null, null, 'contato', 'ignorado',
      `Empresa "${emp.RazaoSocial}" sem CNPJ — vínculo com o Tiny ignorado.`);
    return null;
  }

  try {
    // Pesquisa nos dois formatos (o Tiny pode armazenar com ou sem máscara).
    let contato = await pesquisarContatoPorCpfCnpj(fmtCnpj(dig))
      || await pesquisarContatoPorCpfCnpj(dig);
    let acao = 'vinculado ao contato existente';

    if (!contato) {
      try {
        contato = await incluirContato(montarContato(emp));
        acao = 'contato criado no Tiny';
      } catch (e) {
        // Corrida/formatação: o Tiny recusou por CNPJ duplicado — então o
        // contato existe; pesquisa de novo e vincula.
        if (!/j[áa] (existe|cadastrad)/i.test(e.message)) throw e;
        contato = await pesquisarContatoPorCpfCnpj(fmtCnpj(dig))
          || await pesquisarContatoPorCpfCnpj(dig);
        if (!contato) throw e;
      }
    }

    await query(
      `UPDATE dbo.Empresa
          SET TinyContatoId = @cid, TinyContatoPendente = 0, AtualizadoEm = SYSUTCDATETIME()
        WHERE EmpresaId = @eid`,
      { cid: contato.id, eid: empresaId }
    );
    await registrarLog(contato.id, null, 'contato', 'ok',
      `Empresa "${emp.RazaoSocial}" (CNPJ ${fmtCnpj(dig)}): ${acao}.`);
    // Vinculou a um contato que JÁ existia: o que foi editado no portal ainda
    // precisa ir para lá. (Contato criado agora já nasceu com os dados atuais.)
    if (acao !== 'contato criado no Tiny') {
      const alt = (await query('SELECT TinyContatoAlterado FROM dbo.Empresa WHERE EmpresaId = @eid',
        { eid: empresaId }))[0];
      if (alt?.TinyContatoAlterado) await atualizarContatoTiny(empresaId);
    } else {
      await query('UPDATE dbo.Empresa SET TinyContatoAlterado = 0 WHERE EmpresaId = @eid', { eid: empresaId });
    }
    return contato.id;
  } catch (e) {
    // Continua pendente — o cron re-tenta na próxima rodada.
    await registrarLog(null, null, 'contato', 'erro',
      `Empresa "${emp.RazaoSocial}" (CNPJ ${fmtCnpj(dig)}): ${e.message}`);
    console.error(`✗ Vínculo Tiny da empresa ${empresaId} falhou: ${e.message}`);
    return null;
  }
}

// Empurra para o Tiny uma edição do cadastro feita no portal. Se a empresa
// ainda não tem contato vinculado, cai no fluxo de vínculo/criação. Falha não
// propaga (fire-and-forget a partir da rota): o cron reconcilia depois.
// Chamada após o commit de PUT /conta/empresa.
export async function atualizarContatoTiny(empresaId) {
  if (!clientesLigado()) return null;

  const emp = await carregarEmpresa(empresaId);
  if (!emp) return null;
  if (!emp.TinyContatoId) return vincularContatoTiny(empresaId);  // ainda sem contato

  const dig = String(emp.Cnpj || '').replace(/\D/g, '');
  try {
    // O CNPJ é a chave do vínculo: quem o detém no Tiny é o contato CANÔNICO
    // (é nele que a exportação de pedidos vai casar). Se for outro registro —
    // porque uma duplicata nasceu antes desta correção —, re-aponta o vínculo
    // para ele em vez de continuar editando o órfão.
    let alvo = String(emp.TinyContatoId);
    if (dig) {
      const dono = await pesquisarContatoPorCpfCnpj(fmtCnpj(dig))
        || await pesquisarContatoPorCpfCnpj(dig);
      if (dono && String(dono.id) !== alvo) alvo = await revincular(emp, dono.id);
    }

    try {
      await alterarContato(montarContato({ ...emp, TinyContatoId: alvo }, true));
    } catch (e) {
      // Código 30 = "CNPJ já cadastrado": entre a pesquisa acima e o alter,
      // OUTRO contato ficou com o CNPJ (o Tiny cria um por conta própria ao
      // receber um pedido quando o vinculado está sem o número). Re-pesquisa,
      // move o vínculo para o novo dono e tenta de novo — uma vez só.
      if (e.codigo !== '30' || !dig) throw e;
      const dono = await pesquisarContatoPorCpfCnpj(fmtCnpj(dig))
        || await pesquisarContatoPorCpfCnpj(dig);
      if (!dono || String(dono.id) === alvo) throw e;
      alvo = await revincular({ ...emp, TinyContatoId: alvo }, dono.id);
      await alterarContato(montarContato({ ...emp, TinyContatoId: alvo }, true));
    }

    await query('UPDATE dbo.Empresa SET TinyContatoAlterado = 0 WHERE EmpresaId = @eid',
      { eid: empresaId });
    await registrarLog(alvo, null, 'contato', 'ok',
      `Cadastro da empresa "${emp.RazaoSocial}" atualizado no Tiny.`);
    return alvo;
  } catch (e) {
    await registrarLog(emp.TinyContatoId, null, 'contato', 'erro',
      `Atualização no Tiny da empresa "${emp.RazaoSocial}": ${e.message}`);
    console.error(`✗ Atualização Tiny da empresa ${empresaId} falhou: ${e.message}`);
    return null;
  }
}

// Re-aponta o vínculo da empresa para outro contato do Tiny (o que está com o
// CNPJ). Devolve o novo id, já como string.
async function revincular(emp, novoId) {
  const id = String(novoId);
  await query(
    `UPDATE dbo.Empresa
        SET TinyContatoId = @cid, TinyContatoPendente = 0, AtualizadoEm = SYSUTCDATETIME()
      WHERE EmpresaId = @eid`,
    { cid: id, eid: emp.EmpresaId }
  );
  await registrarLog(id, null, 'contato', 'ok',
    `Empresa "${emp.RazaoSocial}": vínculo movido do contato ${emp.TinyContatoId} para ${id} ` +
    `(é o que detém o CNPJ no Tiny). O contato ${emp.TinyContatoId} ficou órfão — remova-o lá se quiser.`);
  return id;
}

async function desmarcarPendente(empresaId) {
  await query(
    'UPDATE dbo.Empresa SET TinyContatoPendente = 0 WHERE EmpresaId = @eid',
    { eid: empresaId }
  ).catch(() => { });
}

// Re-tenta os vínculos que ficaram pendentes (Tiny fora do ar na hora do
// cadastro, chave desligada, etc.). Chamada pelo cron a cada rodada.
export async function processarContatosPendentes() {
  if (!clientesLigado()) return;
  try {
    const rows = await query(
      `SELECT EmpresaId FROM dbo.Empresa
        WHERE TinyContatoPendente = 1 AND TinyContatoId IS NULL
        ORDER BY EmpresaId`
    );
    for (const r of rows) await vincularContatoTiny(r.EmpresaId);
  } catch (e) {
    console.error('✗ Fila de contatos Tiny falhou:', e.message);
  }
}

/* ============================================================
   Tiny → Fullgas
   ============================================================ */

// Aplica no cadastro local o que mudou no contato do Tiny. Só grava campos que
// o Tiny devolveu preenchidos E diferentes do atual (não apaga dado local com
// campo vazio nem gera escrita à toa). Devolve true se algo mudou.
async function aplicarContatoLocal(emp, c) {
  let mudou = false;
  if (c.cep) c = { ...c, cep: normalizaCep(c.cep) };  // CEP do Tiny → formato local

  // --- Empresa (razão social, fantasia, IE, e-mail, telefone) ---
  const eSets = [], eParams = { eid: emp.EmpresaId };
  const mapEmpresa = [
    ['nome', 'RazaoSocial', 160], ['fantasia', 'NomeFantasia', 160],
    ['ie', 'InscricaoEstadual', 20], ['email', 'Email', 160], ['fone', 'Telefone', 30]
  ];
  for (const [campoTiny, coluna, tam] of mapEmpresa) {
    const v = c[campoTiny];
    if (v == null || v === '') continue;
    const novo = String(v).slice(0, tam);
    const atual = emp[coluna] == null ? '' : String(emp[coluna]);
    if (novo !== atual) { eSets.push(`${coluna} = @${coluna}`); eParams[coluna] = novo; }
  }
  if (eSets.length) {
    eSets.push('AtualizadoEm = SYSUTCDATETIME()');
    await query(`UPDATE dbo.Empresa SET ${eSets.join(', ')} WHERE EmpresaId = @eid`, eParams);
    mudou = true;
  }

  // --- Endereço principal ---
  if (c.endereco) {
    const mapEnd = [
      ['endereco', 'Logradouro', 180], ['numero', 'Numero', 20], ['complemento', 'Complemento', 80],
      ['bairro', 'Bairro', 80], ['cidade', 'Cidade', 80], ['uf', 'Uf', 2], ['cep', 'Cep', 9]
    ];
    if (emp.EnderecoId) {           // já tem endereço → atualiza o que diferir
      const aSets = [], aParams = { id: emp.EnderecoId };
      for (const [campoTiny, coluna, tam] of mapEnd) {
        const v = c[campoTiny];
        if (v == null || v === '') continue;
        const novo = String(v).slice(0, tam);
        const atual = emp[coluna] == null ? '' : String(emp[coluna]);
        if (novo !== atual) { aSets.push(`${coluna} = @${coluna}`); aParams[coluna] = novo; }
      }
      if (aSets.length) {
        await query(`UPDATE dbo.Endereco SET ${aSets.join(', ')} WHERE EnderecoId = @id`, aParams);
        mudou = true;
      }
    } else {                        // sem endereço local → cria a partir do Tiny
      await query(
        `INSERT INTO dbo.Endereco
           (EmpresaId, Tipo, Logradouro, Numero, Complemento, Bairro, Cidade, Uf, Cep, Principal)
         VALUES (@eid, 'Entrega', @log, @num, @comp, @bairro, @cidade, @uf, @cep, 1)`,
        {
          eid: emp.EmpresaId,
          log: String(c.endereco).slice(0, 180),
          num: c.numero ? String(c.numero).slice(0, 20) : null,
          comp: c.complemento ? String(c.complemento).slice(0, 80) : null,
          bairro: c.bairro ? String(c.bairro).slice(0, 80) : null,
          cidade: c.cidade ? String(c.cidade).slice(0, 80) : null,
          uf: c.uf ? String(c.uf).slice(0, 2) : null,
          cep: c.cep ? String(c.cep).slice(0, 9) : null
        }
      );
      mudou = true;
    }
  }

  if (mudou) {
    await registrarLog(emp.TinyContatoId, null, 'contato', 'ok',
      `Cadastro da empresa "${emp.RazaoSocial}" atualizado a partir do Tiny.`);
  }
  return mudou;
}

// Relê os contatos vinculados no Tiny e reflete no cadastro local o que mudou
// lá. Chamada pelo cron a cada rodada. Cada empresa custa 1 requisição ao Tiny
// (a fila do tiny.js espaça as chamadas) — como concessionárias são poucas
// (bem menos que produtos), o custo é baixo.
export async function sincronizarContatosDoTiny() {
  if (!clientesLigado()) return;

  let empresas;
  try {
    empresas = await query(
      `SELECT e.EmpresaId, e.RazaoSocial, e.NomeFantasia, e.Cnpj, e.InscricaoEstadual,
              e.Email, e.Telefone, e.TinyContatoId, e.TinyContatoAlterado,
              en.EnderecoId, en.Logradouro, en.Numero, en.Complemento, en.Bairro,
              en.Cidade, en.Uf, en.Cep
         FROM dbo.Empresa e
         OUTER APPLY (
           SELECT TOP 1 d.EnderecoId, d.Logradouro, d.Numero, d.Complemento, d.Bairro,
                  d.Cidade, d.Uf, d.Cep
             FROM dbo.Endereco d
            WHERE d.EmpresaId = e.EmpresaId
            ORDER BY d.Principal DESC, d.EnderecoId ASC
         ) en
        WHERE e.TinyContatoId IS NOT NULL AND e.Ativo = 1
        ORDER BY e.EmpresaId`
    );
  } catch (e) {
    console.error('✗ Pull de contatos Tiny (lista) falhou:', e.message);
    return;
  }

  for (const emp of empresas) {
    // Edição do portal que ainda não chegou ao Tiny: trazer o contato de lá
    // agora APAGARIA a edição (achado de 30/09/2026 — o cliente via "salvo" e
    // o cron desfazia em até 30 min). Re-tenta o envio; o pull volta a valer
    // quando o envio der certo.
    if (emp.TinyContatoAlterado) {
      await atualizarContatoTiny(emp.EmpresaId);
      continue;
    }
    try {
      let c = await obterContato(emp.TinyContatoId);
      if (!c) continue;

      // Guarda de identidade: só espelha um contato cujo CNPJ bate com o da
      // empresa. Se o vinculado perdeu o CNPJ (duplicata antiga), o dono do
      // número é o registro bom — re-aponta e lê ele, em vez de trazer para
      // cá os dados velhos do órfão.
      const dig = String(emp.Cnpj || '').replace(/\D/g, '');
      const digTiny = String(c.cpf_cnpj || '').replace(/\D/g, '');
      if (dig && digTiny !== dig) {
        const dono = await pesquisarContatoPorCpfCnpj(fmtCnpj(dig))
          || await pesquisarContatoPorCpfCnpj(dig);
        if (!dono || String(dono.id) === String(emp.TinyContatoId)) continue;
        emp.TinyContatoId = await revincular(emp, dono.id);
        c = await obterContato(emp.TinyContatoId);
        if (!c) continue;
      }

      await aplicarContatoLocal(emp, c);
    } catch (e) {
      await registrarLog(emp.TinyContatoId, null, 'contato', 'erro',
        `Leitura do contato no Tiny (empresa "${emp.RazaoSocial}"): ${e.message}`);
    }
  }
}
