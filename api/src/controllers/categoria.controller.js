// Controller de Categoria: HTTP ↔ serviço.
import * as service from '../services/categoria.service.js';

export async function listar(_req, res, next) {
  try {
    res.json(await service.listar());
  } catch (e) { next(e); }
}

export async function criar(req, res, next) {
  try {
    const id = await service.criar(req.body || {});
    res.status(201).json({ ok: true, id });
  } catch (e) { next(e); }
}

export async function renomear(req, res, next) {
  try {
    await service.renomear(req.params.codigo, req.body?.nome);
    res.json({ ok: true });
  } catch (e) { next(e); }
}

export async function excluir(req, res, next) {
  try {
    await service.excluir(req.params.codigo);
    res.json({ ok: true });
  } catch (e) { next(e); }
}

export async function enviarImagem(req, res, next) {
  try {
    const imagem = await service.definirImagem(req.params.codigo, req.file.filename);
    res.json({ ok: true, imagem });
  } catch (e) { next(e); }
}

export async function removerImagem(req, res, next) {
  try {
    await service.removerImagem(req.params.codigo);
    res.json({ ok: true });
  } catch (e) { next(e); }
}
