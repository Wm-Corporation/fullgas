// Upload da foto do produto.
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EXT_IMAGEM, nomeArquivo, filtroImagem } from './upload-comum.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROD_DIR = path.join(__dirname, '..', '..', 'uploads', 'produtos');
fs.mkdirSync(PROD_DIR, { recursive: true });

// URL pública (relativa) das fotos.
export const PROD_URL_BASE = '/uploads/produtos/';

const uploadProd = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, PROD_DIR),
    filename: (_req, file, cb) => cb(null, nomeArquivo(file, EXT_IMAGEM))
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: filtroImagem()
});

// Recebe o campo multipart "imagem" e traduz erros do multer em 400 legível.
export function uploadImagemProduto(req, res, next) {
  uploadProd.single('imagem')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'Imagem muito grande (máximo 15 MB).'
        : (err.message || 'Falha no upload.');
      return res.status(400).json({ erro: msg });
    }
    if (!req.file) return res.status(400).json({ erro: 'Envie o arquivo no campo "imagem".' });
    next();
  });
}
