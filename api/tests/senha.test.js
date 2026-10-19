// Política de senha única (cadastro, redefinição, admin e contas internas).
import { describe, it, expect } from 'vitest';
import { erroSenha, SENHA_MINIMA } from '../src/validacao.js';

const ok = s => expect(erroSenha(s, { email: 'lucas@oficina.com.br', nome: 'Lucas Ferreira' })).toBe(null);
const recusa = s => expect(erroSenha(s, { email: 'lucas@oficina.com.br', nome: 'Lucas Ferreira' })).toBeTruthy();

describe('erroSenha', () => {
  it('o mínimo é 8', () => {
    expect(SENHA_MINIMA).toBe(8);
    recusa('Abc123!');        // 7
    ok('Abc123!x');           // 8
  });

  it('aceita frase longa sem símbolo (comprimento é o que vale)', () => {
    // Sem exigência de símbolos: frases longas são melhores.
    ok('cavalo bateria grampo azul');
    ok('minha oficina fica na esquina');
  });

  it('recusa as triviais conhecidas, inclusive as deste projeto', () => {
    ['12345678', 'password', 'senha123', 'admin123', 'cliente123'].forEach(recusa);
  });

  it('recusa caractere repetido e sequência de teclado', () => {
    recusa('aaaaaaaa');
    recusa('abcdefgh');
    recusa('12345678');
  });

  it('recusa senha que contém o próprio e-mail ou nome', () => {
    // Não pode repetir nome ou e-mail.
    recusa('lucas12345');
    recusa('senhaDoLucasFerreira');
  });

  it('não se confunde com trecho curto do e-mail', () => {
    // Local part curta (2 chars) não deve bloquear meio mundo.
    expect(erroSenha('barquinho azul', { email: 'ab@x.com' })).toBe(null);
  });

  it('recusa acima de 72 BYTES (limite silencioso do bcrypt)', () => {
    // O bcrypt ignora o que passa de 72 bytes. Senha variada para não cair na regra de repetição.
    const longa = 'frase-longa-de-senha-para-testar-o-limite-do-bcrypt-aqui-vamos-nos-ok';
    expect(longa.length).toBeLessThanOrEqual(72);
    ok(longa);
    recusa(longa + 'mais-alguns-caracteres-para-passar-de-72');
    // Acentos ocupam 2 bytes: 40 caracteres já passam de 72 bytes.
    recusa('á'.repeat(40));
  });

  it('min configurável (o admin usa 8, mas a porta existe)', () => {
    expect(erroSenha('abc123XY', { min: 12 })).toBeTruthy();
    expect(erroSenha('abc123XYZabc', { min: 12 })).toBe(null);
  });

  it('vazio e nulo são recusados, sem explodir', () => {
    expect(erroSenha('')).toBeTruthy();
    expect(erroSenha(null)).toBeTruthy();
    expect(erroSenha(undefined)).toBeTruthy();
  });
});

describe('nome da empresa na senha', () => {
  // Regra, e não lista (ver MARCA em validacao.js).
  it('recusa qualquer senha construida sobre "fullgas"', () => {
    ['Fullgas2026', 'fullgas123', 'FullGas!2026', 'minhafullgassenha']
      .forEach(p => expect(erroSenha(p)).toBeTruthy());
  });

  it('nao recusa senha que so menciona o ramo', () => {
    expect(erroSenha('oficina da esquina 2026')).toBe(null);
  });
});
