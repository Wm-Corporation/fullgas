// ============================================================
// Validações de cadastro compartilhadas entre as rotas
// (auth.routes.js — registro público; conta.routes.js — painel
// "Minha conta" do gestor). O front aplica as mesmas regras nas
// máscaras, mas a API é quem garante.
// ============================================================

// Cidade: só letras (com acento), espaço, apóstrofo, ponto e hífen —
// cobre "Mogi-Mirim", "Santa Bárbara d'Oeste"... Sem dígitos/símbolos.
const RE_CIDADE = /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ'. -]*$/;

// Valida o endereço do cadastro. Devolve a mensagem de erro ou null se ok.
export function erroEndereco(end) {
  if (!end || !end.logradouro || !end.numero || !end.bairro || !end.cidade || !end.uf || !end.cep)
    return 'Preencha o endereço (CEP, logradouro, número, bairro, cidade e UF).';
  if (String(end.cep).replace(/\D/g, '').length !== 8)
    return 'CEP inválido — use os 8 dígitos.';
  if (!/^\d{1,10}$/.test(String(end.numero).trim()))
    return 'Número do endereço deve conter apenas dígitos.';
  if (!RE_CIDADE.test(String(end.cidade).trim()))
    return 'Cidade não pode conter números ou caracteres especiais.';
  if (!/^[A-Za-z]{2}$/.test(String(end.uf).trim()))
    return 'UF inválida — use a sigla de 2 letras.';
  return null;
}

// Inscrição estadual (opcional): normaliza para maiúsculas e mantém só
// dígitos, letras, ponto, hífen, barra e espaço (formatos variam por UF;
// "ISENTO" também é aceito). Devolve null quando vazia/só lixo.
export function limparIe(v) {
  const ie = String(v || '').toUpperCase().replace(/[^0-9A-Z./ -]/g, '').trim().slice(0, 20);
  return ie || null;
}

/* ============================================================
   CNPJ
   ------------------------------------------------------------
   O CNPJ é a chave do vínculo com o Tiny: é por ele que o cadastro acha (e,
   na edição, SOBRESCREVE) o contato de lá. Por isso a API confere os dígitos
   verificadores e grava sempre no mesmo formato ("12.345.678/0001-90") —
   antes aceitava qualquer texto, e "12345678000190" e "12.345.678/0001-90"
   viravam duas empresas diferentes.
   ============================================================ */
export function soDigitosCnpj(v) {
  return String(v || '').replace(/\D/g, '');
}

export function cnpjValido(v) {
  const d = soDigitosCnpj(v);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (base) => {
    let peso = base.length - 7, soma = 0;
    for (const c of base) { soma += Number(c) * peso--; if (peso < 2) peso = 9; }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(d.slice(0, 12));
  const d2 = dv(d.slice(0, 12) + d1);
  return d.endsWith(String(d1) + String(d2));
}

// "12345678000190" (ou já mascarado) → "12.345.678/0001-90".
export function formatarCnpj(v) {
  return soDigitosCnpj(v).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

// CPF (comprador da moto): dígitos verificadores, como o CNPJ.
export function cpfValido(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

// Mensagem de erro para o CNPJ, ou null se estiver bom.
export function erroCnpj(v) {
  if (!soDigitosCnpj(v)) return 'Informe o CNPJ da empresa.';
  if (soDigitosCnpj(v).length !== 14) return 'CNPJ incompleto — use os 14 dígitos.';
  if (!cnpjValido(v)) return 'CNPJ inválido — confira os dígitos.';
  return null;
}

/* ============================================================
   CATÁLOGO — número do artigo (SKU)
   ------------------------------------------------------------
   O SKU não é só um dado: ele vira ATRIBUTO DE HTML no front
   (data-art="...", href="#/produto/..."). O escape do lado do
   navegador já foi corrigido, mas uma allowlist aqui fecha a
   porta antes: um SKU que não pode CONTER aspas nem sinal de
   menor não tem como virar marcação, em qualquer tela, hoje ou
   numa escrita nova que esqueça o esc().

   A lista permitida cobre o que a Fullgas realmente usa
   (A590C161Y401000, BORR-EMB-21, OLEOF-250450, 50180007S) com
   folga: letras, dígitos, ponto, hífen, barra e sublinhado.
   O teto de 40 é o da coluna Produto.Sku no banco — passar disso
   seria truncado em silêncio pelo SQL Server.
   ============================================================ */
const RE_SKU = /^[A-Za-z0-9._/-]{1,40}$/;

export function skuValido(sku) {
  return RE_SKU.test(String(sku || '').trim());
}

// Mensagem de erro para o SKU, ou null se estiver bom.
export function erroSku(sku) {
  const s = String(sku || '').trim();
  if (!s) return 'Informe o número do artigo (SKU).';
  if (s.length > 40) return 'Número do artigo muito longo (máximo de 40 caracteres).';
  if (!RE_SKU.test(s))
    return 'Número do artigo inválido — use apenas letras, números, ponto, hífen, barra e sublinhado.';
  return null;
}

// Limites de texto do catálogo, iguais aos das colunas do banco
// (Produto.Nome NVARCHAR(200), Descricao NVARCHAR(1000),
// PrevisaoChegada VARCHAR(20)). Sem isto, um texto maior que a
// coluna é cortado pelo driver sem erro nenhum.
export function erroTextoProduto({ nome, descricao, previsao }) {
  if (nome != null && String(nome).length > 200)
    return 'Nome do produto muito longo (máximo de 200 caracteres).';
  if (descricao != null && String(descricao).length > 1000)
    return 'Descrição muito longa (máximo de 1000 caracteres).';
  if (previsao != null && String(previsao).length > 20)
    return 'Previsão de chegada muito longa (máximo de 20 caracteres).';
  return null;
}

/* ============================================================
   SENHA
   ------------------------------------------------------------
   Regra única para TODO ponto que define senha: cadastro público, redefinição
   por e-mail, criação de admin e as contas internas que o gestor cria ou
   reseta. Antes cada um desses cinco lugares repetia o próprio
   `if (senha.length < 6)`, e o de admin usava 8 — divergência que ninguém
   percebia porque estava espalhada.

   O mínimo subiu de 6 para 8. Seis caracteres é curto o bastante para força
   bruta offline caso o banco vaze, e a conta de admin já exigia 8 — não havia
   razão para o revendedor valer menos. Isto NÃO invalida senha existente:
   quem já tem uma de 6 continua entrando normalmente, porque a checagem só
   roda quando se DEFINE uma senha. O efeito aparece na próxima troca.

   O que NÃO fazemos aqui, de propósito:
   • exigir maiúscula/número/símbolo. A pesquisa moderna (e o NIST SP 800-63B)
     mostra que essas regras empurram para "Senha@123" — previsível — enquanto
     penalizam frases longas, que são melhores. Comprimento é o que vale.
   • consultar lista de vazamentos (HaveIBeenPwned). Vale a pena, mas mete uma
     chamada de rede no caminho do cadastro; fica para depois.
   ============================================================ */
export const SENHA_MINIMA = 8;

// As que aparecem em toda lista de senha vazada, mais as "de casa" que este
// projeto já teve (os seeds de demonstração). Comparação em minúsculas e sem
// espaços nas pontas.
const SENHAS_TRIVIAIS = new Set([
  '12345678', '123456789', '1234567890', 'senha123', 'password', 'password1',
  'qwertyui', 'abcd1234', '11111111', '00000000', 'admin123', 'cliente123',
  'mudar123', 'trocar123'
]);

// Senha construída sobre o nome da casa ("fullgas" + qualquer coisa) é o
// primeiro palpite de quem sabe onde está entrando, e foi o padrão real de
// mais de uma senha deste projeto.
//
// É uma REGRA, não uma lista, de propósito: enumerar as variantes exigiria
// escrever aqui as senhas de verdade — num arquivo versionado, lido por
// qualquer pessoa com acesso ao repositório. Uma lista de senhas proibidas
// que contém as senhas em uso é uma lista de senhas em uso.
const MARCA = 'fullgas';

// Valida uma senha nova. Devolve a mensagem de erro, ou null se estiver boa.
// `email` e `nome` são opcionais e servem só para recusar a senha que repete
// o próprio cadastro — a primeira coisa que alguém tenta ao invadir uma conta.
export function erroSenha(senha, { email = '', nome = '', min = SENHA_MINIMA } = {}) {
  const s = String(senha ?? '');

  if (s.length < min) return `A senha precisa de ao menos ${min} caracteres.`;
  // Teto: o bcrypt ignora tudo além de 72 BYTES, silenciosamente. Sem este
  // limite, duas senhas longas com o mesmo começo seriam a mesma senha para
  // o login — e ninguém entenderia por quê.
  if (Buffer.byteLength(s, 'utf8') > 72) return 'A senha é longa demais (máximo de 72 caracteres).';

  const baixa = s.toLowerCase().trim();
  if (SENHAS_TRIVIAIS.has(baixa)) return 'Essa senha é fácil demais de adivinhar. Escolha outra.';
  if (baixa.includes(MARCA)) return 'A senha não pode conter o nome da empresa.';

  // Um caractere repetido ('aaaaaaaa') ou sequência óbvia do teclado.
  if (/^(.)\1+$/.test(s)) return 'Essa senha é fácil demais de adivinhar. Escolha outra.';
  if ('abcdefghijklmnopqrstuvwxyz'.includes(baixa) || '01234567890'.includes(baixa))
    return 'Essa senha é fácil demais de adivinhar. Escolha outra.';

  // Repetir o próprio e-mail/nome é o primeiro palpite de quem tem a lista de
  // cadastros — que é exatamente o que um vazamento entrega.
  const local = String(email || '').toLowerCase().split('@')[0];
  if (local && local.length >= 3 && baixa.includes(local))
    return 'A senha não pode conter o seu e-mail.';
  const primeiroNome = String(nome || '').toLowerCase().trim().split(/\s+/)[0];
  if (primeiroNome && primeiroNome.length >= 4 && baixa.includes(primeiroNome))
    return 'A senha não pode conter o seu nome.';

  return null;
}
