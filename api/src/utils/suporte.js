// Regras do Suporte Técnico que não dependem do banco (testadas em api/tests/suporte.test.js).

// Categorias de ajuda = áreas do portal. O banco guarda só o `codigo`.
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

// Nome da categoria (código, se saiu da lista).
export function nomeCategoria(codigo) {
  const c = CATEGORIAS.find(x => x.codigo === codigo);
  return c ? c.nome : String(codigo || 'Outro assunto');
}

export const PRIORIDADES = ['baixa', 'normal', 'alta'];

export function prioridadeValida(p) {
  return PRIORIDADES.includes(String(p || ''));
}

// Ciclo do chamado: Aberto → Em atendimento ⇄ Aguardando cliente → Resolvido (resposta reabre) → Fechado.
export const STATUS = ['Aberto', 'Em atendimento', 'Aguardando cliente', 'Resolvido', 'Fechado'];

export function statusValido(s) {
  return STATUS.includes(String(s || ''));
}

// Fechado não recebe mensagem.
export function podeReceberMensagem(status) {
  return status !== 'Fechado';
}

// Status após uma resposta: a vez fica com quem não falou por último. Resposta em Resolvido reabre.
export function statusAposResposta(statusAtual, autor) {
  if (autor === 'admin') return 'Aguardando cliente';
  // Ninguém atendeu ainda: continua Aberto.
  if (statusAtual === 'Aberto') return 'Aberto';
  return 'Em atendimento';
}

// O revendedor só fecha ou reabre.
const STATUS_DO_CLIENTE = new Set(['Fechado', 'Aberto']);

export function clientePodeMudarStatus(destino) {
  return STATUS_DO_CLIENTE.has(String(destino || ''));
}

// 47 → "CH-000047"
export function numeroChamado(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) return '';
  return 'CH-' + String(n).padStart(6, '0');
}
