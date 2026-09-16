# Parts Finder — referência completa (Frente 1.4 expandida)

O Parts Finder é 100% alimentado pelo banco e administrado pelo painel
(`admin.html` → aba **Parts Finder**). Este documento lista **todos os
endpoints** para acesso total às modificações, o modelo de dados e como as
telas usam cada rota.

## Conceitos

| Conceito | Tabela | O que é |
|---|---|---|
| Modelo | `ModeloMoto` | A moto (ex.: FG 125 2025). Tem marca, modalidade, categoria, foto ("Show Image") e link de documentação técnica. A árvore de seleção e o código saem desses campos (ver abaixo). |
| Seção | `SecaoModelo` | Um diagrama explodido de um lado (`chassi` = Frame ou `engine`), ex.: "01 GARFO DIANTEIRO". Tem a imagem enviada pelo admin. |
| Peça da seção | `PecaSecao` | Linha da lista: produto do catálogo + *Number on Image* + quantidade no conjunto + quantidade padrão + situação (habilitar) + posição. |
| Hotspot | `SecaoHotspot` | Área clicável sobre a imagem (x, y, largura, altura em **pixels da imagem em tamanho natural**), com texto opcional e *Link Number*. |

Árvore de seleção e código do modelo (desde 16/09/2026) — nenhum dos dois é
digitado; os dois acompanham qualquer edição do modelo:

- **Árvore** = `Marca › Modalidade › Categoria › Nome › Ano`
  (ex.: `Fullgas › Off-road › Enduro › FG 125 › 2025`). Montada pela API em
  `api/src/utils/modelo-moto.js`. Cilindrada e tipo de motor **não** entram.
  A antiga coluna `ModeloMoto.Arvore` (texto livre) não é mais lida nem gravada.
- **Código** = nome + ano (`FG 125` + 2025 → `fg125-2025`). Renomear o modelo
  troca o código; seções e chassis ligam pelo `ModeloId` e não são afetados.
  Nome + ano repetido de outro modelo é recusado (**409**).

Como as coisas se ligam:

- `SecaoHotspot.LinkNumero` ⇔ `PecaSecao.NumeroImagem` (o número impresso no
  diagrama). Clicar na área no finder do cliente seleciona todas as peças com
  aquele número; selecionar uma peça acende as áreas correspondentes.
- A miniatura da peça vem de `Produto.ImagemUrl` (upload no Catálogo).
- `QuantidadePadrao > 0` faz a linha vir pré-marcada com essa quantidade na
  tela do cliente (como as 3 primeiras linhas do SparePartsFinder original).
- Imagens ficam em `api/uploads/finder/` e `api/uploads/produtos/`; o banco
  guarda a URL relativa e a API responde com URL absoluta.

## Endpoints — leitura (qualquer usuário autenticado)

| Método | Caminho | O que devolve |
|---|---|---|
| GET | `/api/finder/modelos` | Modelos ativos com `marca`, `modalidade`, `categoria`, `arvore` (níveis do seletor, montados dos campos), `label`, `imagem`, `docTecnica`. Admin: `?todos=1` inclui inativos. |
| GET | `/api/finder/modelos/:codigo` | Modelo + seções agrupadas: `chassi: [...]`, `engine: [...]` (cada uma com `imagem` e `qtdPecas`). |
| GET | `/api/finder/secoes/:id` | Seção com `pecas` (só ativas p/ cliente; todas p/ admin), `hotspots` e `vizinhos { anterior, proxima }` (setas / NEXT CATEGORY). |
| GET | `/api/finder/busca?vin=...` ou `?motor=...` | Resolve VIN ou nº de motor → `{ modelo, veiculo }`. Registra em `LogBusca` (dashboard). 404 se não achar. |

## Endpoints — administração (papel `admin`)

### Modelos

| Método | Caminho | Corpo / efeito |
|---|---|---|
| POST | `/api/finder/modelos` | `{ nome, ano, categoria, marca?, modalidade?, label?, cilindrada?, tipoMotor?, docTecnica?, ativo? }`. `marca` padrão `Fullgas`, `modalidade` padrão `Off-road`. O código é gerado (nome + ano); `codigo` e `arvore` no corpo são ignorados. **409** se já existir modelo com o mesmo nome e ano. |
| PUT | `/api/finder/modelos/:codigo` | Mesmos campos. O código é recalculado: renomear troca o código, e a resposta traz o novo em `id`. |
| DELETE | `/api/finder/modelos/:codigo` | Apaga modelo + seções/peças/hotspots (cascata). **409** se houver veículos vinculados — desative (`ativo: false`) em vez de excluir. |
| POST | `/api/finder/modelos/:codigo/imagem` | multipart, campo `imagem` (foto do modelo — botão "Show Image"). Troca apaga a anterior do disco. |
| DELETE | `/api/finder/modelos/:codigo/imagem` | Remove a foto. |

### Seções (diagramas)

| Método | Caminho | Corpo / efeito |
|---|---|---|
| POST | `/api/finder/modelos/:codigo/secoes` | `{ lado: 'chassi'\|'engine', numero, nome }`. Entra no fim da ordem do lado. |
| PUT | `/api/finder/secoes/:id` | `{ numero?, nome?, destaque?, ordem? }`. |
| DELETE | `/api/finder/secoes/:id` | Apaga a seção + peças + hotspots. |
| PUT | `/api/finder/modelos/:codigo/secoes/ordem` | `{ lado, ids: [SecaoId na nova ordem] }`. |
| POST | `/api/finder/secoes/:id/imagem` | multipart `imagem` — o diagrama explodido. |
| DELETE | `/api/finder/secoes/:id/imagem` | Remove o diagrama (áreas continuam salvas). |

### Peças da seção

| Método | Caminho | Corpo / efeito |
|---|---|---|
| POST | `/api/finder/secoes/:id/pecas` | `{ sku, numeroImagem?, quantidade?, quantidadePadrao?, minutos?, ativo? }`. O SKU precisa existir no catálogo. |
| PUT | `/api/finder/pecas/:pecaSecaoId` | Edita `numeroImagem`, `quantidade` (no conjunto), `quantidadePadrao`, `minutos`, `ativo` (Situação/Habilitar), `ordem`. O produto não muda — remova e adicione outro. |
| DELETE | `/api/finder/pecas/:pecaSecaoId` | Remove a linha. |
| PUT | `/api/finder/secoes/:id/pecas/ordem` | `{ ids: [PecaSecaoId na nova ordem] }`. |

### Hotspots (áreas clicáveis)

| Método | Caminho | Corpo / efeito |
|---|---|---|
| PUT | `/api/finder/secoes/:id/hotspots` | **Substitui todas**: `{ hotspots: [{ x, y, w, h, texto?, linkNumero? }] }` (salvar do editor visual). Máx. 200. |
| POST | `/api/finder/secoes/:id/hotspots` | Adiciona uma área. |
| PUT | `/api/finder/hotspots/:id` | Edita uma área individual. |
| DELETE | `/api/finder/hotspots/:id` | Remove uma área. |

### Foto do produto (miniatura da peça)

| Método | Caminho | Efeito |
|---|---|---|
| POST | `/api/produtos/:sku/imagem` | multipart `imagem`. Aparece como miniatura no finder e no admin. |
| DELETE | `/api/produtos/:sku/imagem` | Remove a foto. |

`GET /api/produtos` agora devolve também `imagem` em cada produto.

Uploads de imagem: só imagens (jpg/png/webp/gif/bmp/svg…), até **15 MB**.

## Telas

- **Cliente** (`finder.html` + `js/finder.js`): busca por VIN/nº de motor,
  seletores em cascata Marca › Modalidade › Categoria › Modelo › Ano, lista de seções com miniatura do
  diagrama, tela da seção com tabela de peças (comentário, quantidade padrão
  pré-marcada, link p/ loja), diagrama com zoom 0.1–1.6, setas
  anterior/próxima, áreas clicáveis bidirecionais e "ADD ITEM(S) TO BASKET"
  (cesta da loja). "Show Image" abre a foto do modelo; "Technical
  documentation" abre o link cadastrado.
- **Admin** (`admin.html#finder` + `js/admin.js`): três níveis —
  modelos → seções por lado → peças + editor visual. No editor, clique na
  imagem cria uma área 32×32, arraste posiciona; a lista embaixo edita
  tamanho (`Clickable Area`), texto e `Link Number`, e o botão
  **Salvar áreas clicáveis** grava tudo de uma vez (PUT em lote).

## Banco

Migração `014_partsfinder_admin.sql` (idempotente):

- `ModeloMoto`: + `Arvore`, `ImagemUrl`, `DocTecnicaUrl` (backfill da árvore
  dos 3 modelos semeados).
- `Produto`: + `ImagemUrl`.
- `SecaoModelo`: + `ImagemUrl`.
- `PecaSecao`: + `NumeroImagem` (backfill = `Posicao`), `QuantidadePadrao`,
  `Ordem` (backfill = `Posicao`), `Ativo`. `Posicao` (legada) é mantida em
  sincronia quando o `NumeroImagem` é numérico.
- Nova `SecaoHotspot` (FK cascata p/ `SecaoModelo`).

Migração `039_modelo_marca_modalidade.sql` (idempotente): `ModeloMoto` ganha
`Marca` (padrão `Fullgas`) e `Modalidade` (padrão `Off-road`), os dois
primeiros níveis da árvore.

Rodar como administrador (o `fullgas_app` não tem DDL; o driver 18 do sqlcmd
exige `-C` para confiar no certificado local):

```
sqlcmd -E -C -S localhost -d FullgasB2B -i database/migrations/014_partsfinder_admin.sql
```

As permissões do `fullgas_app` já cobrem a tabela nova (roles
`db_datareader`/`db_datawriter`).
