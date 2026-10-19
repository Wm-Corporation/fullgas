// Regras de upload compartilhadas: nome do arquivo e filtro (extensão E mime precisam bater).
import crypto from 'node:crypto';
import path from 'node:path';

// Sem .svg (pode levar script). .heic/.heif = fotos do iPhone.
export const EXT_IMAGEM = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.heic', '.heif'];
export const EXT_VIDEO = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v', '.3gp', '.ogv', '.ogg', '.mpeg', '.mpg'];

// Nunca .html, .svg nem executáveis.
export const EXT_DOCUMENTO = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt', '.zip'];

// Nome gerado por nós (crypto), nunca o nome original.
export function nomeArquivo(file, extensoesOk) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const seguro = extensoesOk.includes(ext) ? ext : '';
  return Date.now() + '-' + crypto.randomBytes(12).toString('hex') + seguro;
}

// fileFilter do multer: extensão permitida E mime da família certa (ex.: ['image/']).
// octet-stream passa: alguns celulares mandam assim, e quem decide como servir é a extensão.
export function filtroArquivo(extensoesOk, familias, mensagemErro) {
  return (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!extensoesOk.includes(ext)) return cb(new Error(mensagemErro));

    const mime = (file.mimetype || '').toLowerCase();
    const mimeOk = mime === 'application/octet-stream' ||
                   familias.some(f => mime.startsWith(f));
    if (!mimeOk) return cb(new Error(mensagemErro));

    cb(null, true);
  };
}

// Atalhos para os dois casos que existem hoje.
export const filtroImagem = () =>
  filtroArquivo(EXT_IMAGEM, ['image/'], 'Envie apenas imagens (JPG, PNG, WEBP, GIF ou BMP).');

export const filtroMidia = () =>
  filtroArquivo(
    [...EXT_IMAGEM, ...EXT_VIDEO], ['image/', 'video/'],
    'Envie apenas fotos ou vídeos.'
  );

// Anexo de notificação: mídia ou documento.
export const filtroAnexo = () =>
  filtroArquivo(
    [...EXT_IMAGEM, ...EXT_VIDEO, ...EXT_DOCUMENTO],
    ['image/', 'video/', 'application/', 'text/'],
    'Tipo de arquivo não permitido. Envie imagem, vídeo, PDF, documento do Office, CSV, TXT ou ZIP.'
  );
