// Filtro de upload: impede HTML/SVG com script de ser gravado e servido no portal.
import { describe, it, expect } from 'vitest';
import { filtroImagem, filtroMidia, filtroAnexo, nomeArquivo, EXT_IMAGEM } from '../src/middlewares/upload-comum.js';

// Roda um fileFilter do multer e devolve true (aceito) ou false (recusado).
function aceita(filtro, originalname, mimetype) {
  let ok = null;
  filtro({}, { originalname, mimetype }, (err, res) => { ok = !err && res === true; });
  return ok;
}

describe('filtroImagem', () => {
  it('aceita as imagens comuns', () => {
    expect(aceita(filtroImagem(), 'foto.jpg', 'image/jpeg')).toBe(true);
    expect(aceita(filtroImagem(), 'foto.PNG', 'image/png')).toBe(true);
    expect(aceita(filtroImagem(), 'foto.webp', 'image/webp')).toBe(true);
  });

  it('aceita foto de iPhone (heic) e mimetype generico do celular', () => {
    expect(aceita(filtroImagem(), 'IMG_0001.heic', 'image/heic')).toBe(true);
    expect(aceita(filtroImagem(), 'IMG_0001.jpg', 'application/octet-stream')).toBe(true);
  });

  it('RECUSA svg (pode conter script e roda na mesma origem)', () => {
    expect(aceita(filtroImagem(), 'logo.svg', 'image/svg+xml')).toBe(false);
  });

  it('RECUSA html disfarcado de imagem no mimetype', () => {
    // Mimetype image/png com extensão .html não passa.
    expect(aceita(filtroImagem(), 'payload.html', 'image/png')).toBe(false);
  });

  it('RECUSA extensao permitida com mimetype de outra familia', () => {
    expect(aceita(filtroImagem(), 'x.png', 'text/html')).toBe(false);
  });

  it('RECUSA executaveis e arquivo sem extensao', () => {
    expect(aceita(filtroImagem(), 'virus.exe', 'application/octet-stream')).toBe(false);
    expect(aceita(filtroImagem(), 'semextensao', 'image/png')).toBe(false);
  });
});

describe('filtroMidia (fotos de reivindicacao)', () => {
  it('aceita foto e video', () => {
    expect(aceita(filtroMidia(), 'peca.jpg', 'image/jpeg')).toBe(true);
    expect(aceita(filtroMidia(), 'defeito.mp4', 'video/mp4')).toBe(true);
    expect(aceita(filtroMidia(), 'defeito.mov', 'application/octet-stream')).toBe(true);
  });

  it('RECUSA html e svg', () => {
    expect(aceita(filtroMidia(), 'x.html', 'video/mp4')).toBe(false);
    expect(aceita(filtroMidia(), 'x.svg', 'image/svg+xml')).toBe(false);
  });
});

describe('filtroAnexo (notificacoes)', () => {
  it('aceita documento que o admin realmente envia', () => {
    expect(aceita(filtroAnexo(), 'boletim.pdf', 'application/pdf')).toBe(true);
    expect(aceita(filtroAnexo(), 'tabela.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(true);
    expect(aceita(filtroAnexo(), 'lista.csv', 'text/csv')).toBe(true);
  });

  it('RECUSA html, svg e executavel (antes NAO havia filtro algum)', () => {
    expect(aceita(filtroAnexo(), 'pagina.html', 'text/html')).toBe(false);
    expect(aceita(filtroAnexo(), 'icone.svg', 'image/svg+xml')).toBe(false);
    expect(aceita(filtroAnexo(), 'setup.exe', 'application/octet-stream')).toBe(false);
    expect(aceita(filtroAnexo(), 'script.js', 'text/javascript')).toBe(false);
  });
});

describe('nomeArquivo', () => {
  it('descarta o nome original e mantem so a extensao permitida', () => {
    const n = nomeArquivo({ originalname: '../../etc/passwd.png' }, EXT_IMAGEM);
    expect(n).toMatch(/^\d+-[0-9a-f]{24}\.png$/);
    expect(n).not.toContain('/');
    expect(n).not.toContain('..');
  });

  it('nao gera dois nomes iguais', () => {
    const a = nomeArquivo({ originalname: 'a.jpg' }, EXT_IMAGEM);
    const b = nomeArquivo({ originalname: 'a.jpg' }, EXT_IMAGEM);
    expect(a).not.toBe(b);
  });

  it('extensao fora da lista nao vai para o disco', () => {
    expect(nomeArquivo({ originalname: 'x.html' }, EXT_IMAGEM)).toMatch(/^\d+-[0-9a-f]{24}$/);
  });
});
