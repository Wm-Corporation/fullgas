import { describe, it, expect } from 'vitest';
import {
  CATEGORIAS, categoriaValida, nomeCategoria, prioridadeValida,
  STATUS, statusValido, podeReceberMensagem, statusAposResposta,
  clientePodeMudarStatus, numeroChamado
} from '../src/utils/suporte.js';

describe('categorias de ajuda', () => {
  it('aceita os códigos da lista e recusa o resto', () => {
    expect(categoriaValida('pedidos')).toBe(true);
    expect(categoriaValida('financeiro')).toBe(true);
    expect(categoriaValida('inventado')).toBe(false);
    expect(categoriaValida('')).toBe(false);
    expect(categoriaValida(null)).toBe(false);
  });

  it('não tem código repetido', () => {
    const codigos = CATEGORIAS.map(c => c.codigo);
    expect(new Set(codigos).size).toBe(codigos.length);
  });

  it('todas têm nome e descrição para a tela mostrar', () => {
    for (const c of CATEGORIAS) {
      expect(c.nome.length).toBeGreaterThan(0);
      expect(c.descricao.length).toBeGreaterThan(0);
    }
  });

  // Categoria que saiu da lista mostra o código.
  it('devolve o próprio código quando a categoria não existe mais', () => {
    expect(nomeCategoria('pedidos')).toBe('Pedidos e entregas');
    expect(nomeCategoria('categoria-aposentada')).toBe('categoria-aposentada');
    expect(nomeCategoria(null)).toBe('Outro assunto');
  });
});

describe('prioridade e status', () => {
  it('só aceita as três prioridades', () => {
    expect(prioridadeValida('baixa')).toBe(true);
    expect(prioridadeValida('normal')).toBe(true);
    expect(prioridadeValida('alta')).toBe(true);
    expect(prioridadeValida('urgentíssima')).toBe(false);
  });

  it('só aceita os status do ciclo de vida', () => {
    for (const s of STATUS) expect(statusValido(s)).toBe(true);
    expect(statusValido('Em processo')).toBe(false);   // status de reivindicação
    expect(statusValido('')).toBe(false);
  });

  it('chamado fechado não recebe mais mensagem', () => {
    expect(podeReceberMensagem('Fechado')).toBe(false);
    expect(podeReceberMensagem('Resolvido')).toBe(true);
    expect(podeReceberMensagem('Aberto')).toBe(true);
  });
});

describe('para onde o chamado vai depois de uma resposta', () => {
  it('resposta do suporte devolve a bola ao revendedor', () => {
    expect(statusAposResposta('Aberto', 'admin')).toBe('Aguardando cliente');
    expect(statusAposResposta('Em atendimento', 'admin')).toBe('Aguardando cliente');
  });

  it('cliente respondendo em chamado intocado não inventa atendimento', () => {
    expect(statusAposResposta('Aberto', 'cliente')).toBe('Aberto');
  });

  it('cliente respondendo devolve o chamado para a fila', () => {
    expect(statusAposResposta('Aguardando cliente', 'cliente')).toBe('Em atendimento');
  });

  // Resposta em chamado resolvido reabre.
  it('responder em chamado resolvido reabre o atendimento', () => {
    expect(statusAposResposta('Resolvido', 'cliente')).toBe('Em atendimento');
    expect(statusAposResposta('Resolvido', 'admin')).toBe('Aguardando cliente');
  });
});

describe('o que o cliente pode mudar sozinho', () => {
  it('encerra e reabre o próprio chamado', () => {
    expect(clientePodeMudarStatus('Fechado')).toBe(true);
    expect(clientePodeMudarStatus('Aberto')).toBe(true);
  });

  it('não se coloca em atendimento nem se declara resolvido', () => {
    expect(clientePodeMudarStatus('Em atendimento')).toBe(false);
    expect(clientePodeMudarStatus('Aguardando cliente')).toBe(false);
    expect(clientePodeMudarStatus('Resolvido')).toBe(false);
  });
});

describe('número do chamado', () => {
  it('formata com o prefixo e seis dígitos', () => {
    expect(numeroChamado(1)).toBe('CH-000001');
    expect(numeroChamado(47)).toBe('CH-000047');
    expect(numeroChamado(1234567)).toBe('CH-1234567');   // passou de 6 dígitos: não corta
  });

  it('devolve vazio para id inválido', () => {
    expect(numeroChamado(0)).toBe('');
    expect(numeroChamado(null)).toBe('');
    expect(numeroChamado('abc')).toBe('');
  });
});
