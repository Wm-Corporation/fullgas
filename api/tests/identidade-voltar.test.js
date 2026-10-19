// Regressão: a volta da identidade assumida precisa ler u.TokenVersion,
// senão a sessão nova nasce com tv = 0 e cai na primeira requisição. Teste estático da consulta.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.dirname(fileURLToPath(import.meta.url));
const fonte = (rel) => fs.readFileSync(path.join(raiz, '..', 'src', rel), 'utf-8');

// Pega o trecho entre `await query(` e o fim do template da consulta.
function consultaAntesDe(texto, marcador) {
  const i = texto.indexOf(marcador);
  expect(i).toBeGreaterThan(-1);
  const inicio = texto.lastIndexOf('await query(', i);
  return texto.slice(inicio, i);
}

describe('retorno de identidade assumida', () => {
  it('a consulta do admin traz TokenVersion (senão a sessão nasce morta)', () => {
    const src = fonte('routes/auth.routes.js');
    const consulta = consultaAntesDe(src, '{ id: req.user.imp }');
    expect(consulta).toContain('u.TokenVersion');
  });

  it('toda emissão de sessão parte de uma consulta com TokenVersion', () => {
    for (const rel of ['routes/auth.routes.js', 'routes/usuarios.routes.js']) {
      const src = fonte(rel);
      // Consulta de usuário que alimenta signToken sem TokenVersion = o bug de volta.
      for (const m of src.matchAll(/await query\(\s*`SELECT[^`]*FROM dbo\.Usuario[^`]*`/g)) {
        const consulta = m[0];
        if (/u\.Papel|u\.Permissoes/.test(consulta)) {
          expect(consulta, `consulta sem TokenVersion em ${rel}`).toContain('TokenVersion');
        }
      }
    }
  });
});
