// ---- Catálogo: categorias e produtos ----
// Rotas → controllers/ → services/ → repositories/ (docs/10-arquitetura-em-camadas.md).
import { Router } from 'express';
import { requireAuth, requireAdmin, requireAreaAny } from '../auth.js';
import { uploadImagemProduto } from '../middlewares/upload-produto.js';
import { uploadImagemCategoria } from '../middlewares/upload-categoria.js';
import * as categorias from '../controllers/categoria.controller.js';
import * as produtos from '../controllers/produto.controller.js';

const router = Router();

// Catálogo é lido pela loja, pelo finder e pela garantia.
const podeLerCatalogo = requireAreaAny(['loja', 'finder', 'reivindicacoes']);

// ---- Categorias ----
router.get('/categorias', requireAuth, podeLerCatalogo, categorias.listar);
router.post('/categorias', requireAuth, requireAdmin, categorias.criar);
router.put('/categorias/:codigo', requireAuth, requireAdmin, categorias.renomear);
router.delete('/categorias/:codigo', requireAuth, requireAdmin, categorias.excluir);
router.post('/categorias/:codigo/imagem', requireAuth, requireAdmin, uploadImagemCategoria, categorias.enviarImagem);
router.delete('/categorias/:codigo/imagem', requireAuth, requireAdmin, categorias.removerImagem);

// ---- Produtos ----
router.get('/produtos', requireAuth, podeLerCatalogo, produtos.listar);
router.get('/produtos/:sku', requireAuth, podeLerCatalogo, produtos.obter);
router.post('/produtos', requireAuth, requireAdmin, produtos.criar);
router.put('/produtos/:sku', requireAuth, requireAdmin, produtos.atualizar);
router.delete('/produtos/:sku', requireAuth, requireAdmin, produtos.excluir);
router.post('/produtos/:sku/imagem', requireAuth, requireAdmin, uploadImagemProduto, produtos.enviarImagem);
router.delete('/produtos/:sku/imagem', requireAuth, requireAdmin, produtos.removerImagem);

export default router;
