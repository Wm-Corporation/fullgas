// Trilha de auditoria: o autor em identidade assumida é o admin, e falha na trilha não derruba a operação.
// db.js é um dublê.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const inserts = [];
let falharProximo = false;

vi.mock('../src/db.js', () => ({
  query: async (sqlTexto, params) => {
    if (falharProximo) throw new Error('banco fora do ar');
    inserts.push({ sqlTexto, params });
    return [];
  }
}));

const { auditar, ACOES } = await import('../src/auditoria.js');

beforeEach(() => { inserts.length = 0; falharProximo = false; });

const reqAdmin = { user: { id: 10, email: 'admin@fullgas.com.br' }, ip: '203.0.113.9' };

describe('auditar', () => {
  it('grava a acao com autor, alvo e ip', async () => {
    await auditar({ req: reqAdmin, acao: ACOES.ADMIN_CRIADO, alvoId: 55, alvoEmail: 'novo@x.com' });
    expect(inserts).toHaveLength(1);
    const p = inserts[0].params;
    expect(p.acao).toBe('admin_criado');
    expect(p.adminId).toBe(10);
    expect(p.adminEmail).toBe('admin@fullgas.com.br');
    expect(p.alvoId).toBe(55);
    expect(p.ip).toBe('203.0.113.9');
  });

  it('DURANTE impersonacao o autor e o ADMIN, nao o cliente', async () => {
    // req.user é o cliente; req.user.imp é o admin.
    const reqImp = { user: { id: 99, email: 'cliente@x.com', imp: 10 }, ip: '203.0.113.9' };
    await auditar({ req: reqImp, acao: ACOES.IMPERSONAR_FIM, alvoId: 99 });
    expect(inserts[0].params.adminId).toBe(10);      // o admin
    expect(inserts[0].params.adminId).not.toBe(99);  // nao o cliente
  });

  it('NAO deixa o cliente escolher o autor pelo corpo da requisicao', async () => {
    // O autor vem sempre da sessão. Um `adminId` no payload é ignorado.
    await auditar({ req: reqAdmin, acao: ACOES.STATUS_ALTERADO, alvoId: 1, adminId: 4242 });
    expect(inserts[0].params.adminId).toBe(10);
  });

  it('falha ao gravar NAO propaga (a operacao auditada segue)', async () => {
    falharProximo = true;
    await expect(
      auditar({ req: reqAdmin, acao: ACOES.USUARIO_EXCLUIDO, alvoId: 7 })
    ).resolves.toBeUndefined();
  });

  it('serializa o detalhe e corta detalhe gigante', async () => {
    await auditar({ req: reqAdmin, acao: ACOES.PAPEL_ALTERADO, alvoId: 1, detalhe: { papel: 'admin' } });
    expect(JSON.parse(inserts[0].params.detalhe)).toEqual({ papel: 'admin' });

    inserts.length = 0;
    await auditar({ req: reqAdmin, acao: ACOES.PAPEL_ALTERADO, alvoId: 1, detalhe: { x: 'a'.repeat(9000) } });
    expect(inserts[0].params.detalhe.length).toBeLessThanOrEqual(4000);
  });

  it('sem sessao grava autor nulo em vez de explodir', async () => {
    await auditar({ req: {}, acao: ACOES.STATUS_ALTERADO, alvoId: 3 });
    expect(inserts[0].params.adminId).toBe(null);
    expect(inserts[0].params.ip).toBe(null);
  });
});
