// Regressão: o RETORNO de identidade assinava uma sessão que já nascia morta.
//
// O admin assumia a identidade de um cliente, voltava para a própria conta e
// perdia o acesso a tudo — painel, Tiny, banco. A causa não estava na sessão
// nova em si: a consulta do POST /api/auth/identidade/voltar não trazia
// u.TokenVersion, então o signToken assinava tv = 0 (o `?? 0` de auth.js) e o
// revalidarSessao comparava esse 0 com o TokenVersion real do banco. Diferente
// = sessão morta + cookies apagados, na PRIMEIRA requisição depois da volta.
//
// Só acontecia com admin que já tivesse trocado a senha ou saído de todos os
// dispositivos alguma vez — é o que empurra o TokenVersion para 1.
//
// O teste é estático de propósito: o erro não estava na lógica (que já tem
// cobertura em revalidacao-sessao.test.js), e sim numa COLUNA que faltou na
// consulta. É isso que precisa ficar travado.
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
      // Uma consulta de usuário que alimenta signToken sem TokenVersion é o
      // bug de novo, em outra rota.
      for (const m of src.matchAll(/await query\(\s*`SELECT[^`]*FROM dbo\.Usuario[^`]*`/g)) {
        const consulta = m[0];
        if (/u\.Papel|u\.Permissoes/.test(consulta)) {
          expect(consulta, `consulta sem TokenVersion em ${rel}`).toContain('TokenVersion');
        }
      }
    }
  });
});
