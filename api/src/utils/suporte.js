// ============================================================
// Regras do Suporte Técnico (helpdesk) que não dependem do banco.
// ------------------------------------------------------------
// Ficam separadas da rota por dois motivos: são as regras que mais mudam
// (categoria nova, fluxo de status) e são as únicas testáveis sem SQL Server —
// ver api/tests/suporte.test.js.
// ============================================================

/* ------------------------------------------------------------------
   CATEGORIAS DE AJUDA
   ------------------------------------------------------------------
   Espelham as ÁREAS DO PORTAL, que é como o revendedor enxerga o site: ele não
   pensa "erro 500 na rota de faturas", pensa "problema na minha conta
   financeira". Ao acrescentar uma área ao portal, acrescente a categoria aqui —
   o banco guarda só o `codigo`, então nada de migração para isso.

   `descricao` é a linha de ajuda que aparece embaixo do seletor no pop-up
   flutuante, para o revendedor escolher certo sem adivinhar.
   ------------------------------------------------------------------ */
export const CATEGORIAS = [
  {
    codigo: 'pedidos',
    nome: 'Pedidos e entregas',
    descricao: 'Pedido parado, envio parcial, prazo, cancelamento ou rastreio.'
  },
  {
    codigo: 'loja',
    nome: 'Loja e catálogo',
    descricao: 'Peça que não aparece, preço, estoque ou dúvida sobre um artigo.'
  },
  {
    codigo: 'garantia',
    nome: 'Reivindicações e garantia',
    descricao: 'Abertura, andamento ou recusa de uma reivindicação de garantia.'
  },
  {
    codigo: 'finder',
    nome: 'Localizador de Peças',
    descricao: 'Diagrama, explosão ou código de peça de um modelo.'
  },
  {
    codigo: 'financeiro',
    nome: 'Conta financeira',
    descricao: 'Fatura, boleto, limite de crédito ou divergência de valor.'
  },
  {
    codigo: 'veiculos',
    nome: 'Chassis e estoque',
    descricao: 'NIV, registro de venda, transferência ou ações do veículo.'
  },
  {
    codigo: 'conta',
    nome: 'Acesso e cadastro',
    descricao: 'Login, senha, dados da concessionária ou contas de sub-dealer.'
  },
  {
    codigo: 'tecnico',
    nome: 'Dúvida técnica de produto',
    descricao: 'Aplicação, montagem, torque ou compatibilidade de uma peça.'
  },
  {
    codigo: 'outros',
    nome: 'Outro assunto',
    descricao: 'Qualquer coisa que não se encaixe nas categorias acima.'
  }
];

const CODIGOS = new Set(CATEGORIAS.map(c => c.codigo));

export function categoriaValida(codigo) {
  return CODIGOS.has(String(codigo || ''));
}

// Nome legível de uma categoria — inclusive de uma que tenha saído da lista
// (chamado antigo continua exibindo o código, nunca uma linha em branco).
export function nomeCategoria(codigo) {
  const c = CATEGORIAS.find(x => x.codigo === codigo);
  return c ? c.nome : String(codigo || 'Outro assunto');
}

export const PRIORIDADES = ['baixa', 'normal', 'alta'];

export function prioridadeValida(p) {
  return PRIORIDADES.includes(String(p || ''));
}

/* ------------------------------------------------------------------
   CICLO DE VIDA DO CHAMADO
   ------------------------------------------------------------------
     Aberto              recém-criado, ninguém respondeu ainda.
     Em atendimento      o suporte assumiu / o revendedor devolveu a bola.
     Aguardando cliente  o suporte respondeu e espera o revendedor.
     Resolvido           o suporte considera encerrado, mas ainda aceita
                         réplica — responder REABRE o chamado.
     Fechado             fim de linha. Não aceita mais mensagem.
   ------------------------------------------------------------------ */
export const STATUS = ['Aberto', 'Em atendimento', 'Aguardando cliente', 'Resolvido', 'Fechado'];

export function statusValido(s) {
  return STATUS.includes(String(s || ''));
}

// Um chamado fechado não recebe mais mensagem — para voltar a conversar é
// preciso reabri-lo (ou abrir um novo).
export function podeReceberMensagem(status) {
  return status !== 'Fechado';
}

// Para onde o chamado vai depois de uma resposta.
//
// A regra é a de qualquer helpdesk: a bola fica com quem NÃO falou por último.
// O caso que exige atenção é o 'Resolvido' — o revendedor que responde ali está
// dizendo "não resolveu", e o chamado precisa voltar para a fila em vez de
// morrer como resolvido com uma pergunta pendente dentro.
export function statusAposResposta(statusAtual, autor) {
  if (autor === 'admin') return 'Aguardando cliente';
  // Cliente respondendo em chamado que ninguém tocou ainda: continua na fila
  // como novo, sem fingir que já tem atendente.
  if (statusAtual === 'Aberto') return 'Aberto';
  return 'Em atendimento';
}

// O revendedor não manda o chamado para qualquer estado: ele encerra o que
// já está resolvido (ou desiste) e reabre o que voltou a incomodar. Mover para
// 'Em atendimento' / 'Aguardando cliente' é decisão de quem atende.
const STATUS_DO_CLIENTE = new Set(['Fechado', 'Aberto']);

export function clientePodeMudarStatus(destino) {
  return STATUS_DO_CLIENTE.has(String(destino || ''));
}

// Número mostrado ao usuário. O ChamadoId cru ("47") não parece protocolo e não
// dá para ditar por telefone sem soar estranho; "CH-000047" sim.
export function numeroChamado(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) return '';
  return 'CH-' + String(n).padStart(6, '0');
}
