// Tradução dos nomes do catálogo KTM (a KTM só publica em inglês).
import { describe, it, expect } from 'vitest';
import { traduzirPeca, traduzirGrupo, nomeDoTiny } from '../src/traducao-ktm.js';

describe('nomes de peça', () => {
  it.each([
    ['HH COLLAR SCREW M6X16', 'PARAFUSO SEXTAVADO FLANGEADO M6X16'],
    ['REAR BRAKE DISC 220MM', 'DISCO DE FREIO TRASEIRO 220MM'],
    ['Piston cpl. I', 'PISTÃO COMPLETO I'],
    ['SHAFT SEAL RING 14X24X5 VITON', 'RETENTOR 14X24X5 VITON'],
    ['CHAIN TENSIONER LEFT', 'TENSOR DA CORRENTE ESQUERDO'],
    ['POSITION LIGHT LEFT', 'LUZ DE POSIÇÃO ESQUERDA']
  ])('%s → %s', (en, pt) => expect(traduzirPeca(en)).toBe(pt));

  it('as duas ordens da KTM dão o mesmo nome', () => {
    expect(traduzirPeca('CLUTCH COVER')).toBe('TAMPA DA EMBREAGEM');
    expect(traduzirPeca('COVER CLUTCH')).toBe('TAMPA DA EMBREAGEM');
    expect(traduzirPeca('BRACKET FILTER AIR')).toBe('SUPORTE DO FILTRO DE AR');
  });

  it('fixação é sempre o principal', () => {
    expect(traduzirPeca('GASKET COVER MAGNETO')).toBe('JUNTA DA TAMPA DO MAGNETO');
    expect(traduzirPeca('LEVER SCREW')).toBe('PARAFUSO DA ALAVANCA');
  });

  it('vírgula decimal não quebra o nome; vírgula de verdade sim', () => {
    expect(traduzirPeca('CIRCLIP 30X1,2')).toBe('ANEL ELÁSTICO 30X1,2');
    expect(traduzirPeca('CABLE TIE 140/2,5MM BLACK')).toBe('ABRAÇADEIRA PLÁSTICA PRETA 140/2,5MM');
    expect(traduzirPeca('SCREW, M8X20')).toBe('PARAFUSO, M8X20');
  });

  it('palavra desconhecida fica como está', () => {
    expect(traduzirPeca('ZZTOP 12')).toBe('ZZTOP 12');
    expect(traduzirPeca('')).toBe('');
  });
});

describe('grupos', () => {
  it('tabela fixa e partes', () => {
    expect(traduzirGrupo('FRONT FORK, TRIPLE CLAMP')).toBe('SUSPENSÃO DIANTEIRA, MESAS');
    expect(traduzirGrupo('INSTRUMENTS / LOCK SYSTEM')).toBe('INSTRUMENTOS / SISTEMA DE TRAVAS');
    expect(traduzirGrupo('Crankshaft, Piston')).toBe('VIRABREQUIM, PISTÃO');
  });
});

describe('nome do Tiny', () => {
  it('um nome só (ou repetido) vale; nomes diferentes não', () => {
    expect(nomeDoTiny(['KIT PISTAO B', 'KIT PISTAO B'])).toBe('KIT PISTAO B');
    expect(nomeDoTiny(['KIT PISTAO A', 'KIT PISTAO B'])).toBeNull();
    expect(nomeDoTiny([])).toBeNull();
  });
});
