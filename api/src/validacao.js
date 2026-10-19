// Validações de cadastro (registro público e "Minha conta").

// Letras, espaço, apóstrofo, ponto e hífen ("Santa Bárbara d'Oeste").
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

// IE opcional: maiúsculas, só caracteres válidos ("ISENTO" aceito). null se vazia.
export function limparIe(v) {
  const ie = String(v || '').toUpperCase().replace(/[^0-9A-Z./ -]/g, '').trim().slice(0, 20);
  return ie || null;
}

// ---- CNPJ ----
// Chave do Tiny: confere os dígitos e grava sempre como "12.345.678/0001-90".
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

// ---- SKU ----
// Vira atributo HTML no front: só letras, dígitos, . _ / -. Máx. 40 (coluna Produto.Sku).
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

// Limites iguais aos das colunas (o driver corta sem erro).
export function erroTextoProduto({ nome, descricao, previsao }) {
  if (nome != null && String(nome).length > 200)
    return 'Nome do produto muito longo (máximo de 200 caracteres).';
  if (descricao != null && String(descricao).length > 1000)
    return 'Descrição muito longa (máximo de 1000 caracteres).';
  if (previsao != null && String(previsao).length > 20)
    return 'Previsão de chegada muito longa (máximo de 20 caracteres).';
  return null;
}

// ---- Senha ----
// Regra única: mínimo 8, máximo 72 bytes, sem senhas triviais nem repetir e-mail/nome.
// Sem exigência de símbolos (NIST SP 800-63B: comprimento é o que vale).
export const SENHA_MINIMA = 8;

// Senhas comuns (comparação em minúsculas).
const SENHAS_TRIVIAIS = new Set([
  '12345678', '123456789', '1234567890', 'senha123', 'password', 'password1',
  'qwertyui', 'abcd1234', '11111111', '00000000', 'admin123', 'cliente123',
  'mudar123', 'trocar123'
]);

// Recusa senha baseada no nome da casa (regra, para não versionar senhas reais).
const MARCA = 'fullgas';

// Valida senha nova: mensagem de erro ou null.
export function erroSenha(senha, { email = '', nome = '', min = SENHA_MINIMA } = {}) {
  const s = String(senha ?? '');

  if (s.length < min) return `A senha precisa de ao menos ${min} caracteres.`;
  // O bcrypt ignora o que passa de 72 bytes.
  if (Buffer.byteLength(s, 'utf8') > 72) return 'A senha é longa demais (máximo de 72 caracteres).';

  const baixa = s.toLowerCase().trim();
  if (SENHAS_TRIVIAIS.has(baixa)) return 'Essa senha é fácil demais de adivinhar. Escolha outra.';
  if (baixa.includes(MARCA)) return 'A senha não pode conter o nome da empresa.';

  // Um caractere repetido ('aaaaaaaa') ou sequência óbvia do teclado.
  if (/^(.)\1+$/.test(s)) return 'Essa senha é fácil demais de adivinhar. Escolha outra.';
  if ('abcdefghijklmnopqrstuvwxyz'.includes(baixa) || '01234567890'.includes(baixa))
    return 'Essa senha é fácil demais de adivinhar. Escolha outra.';

  // Não pode repetir e-mail nem nome.
  const local = String(email || '').toLowerCase().split('@')[0];
  if (local && local.length >= 3 && baixa.includes(local))
    return 'A senha não pode conter o seu e-mail.';
  const primeiroNome = String(nome || '').toLowerCase().trim().split(/\s+/)[0];
  if (primeiroNome && primeiroNome.length >= 4 && baixa.includes(primeiroNome))
    return 'A senha não pode conter o seu nome.';

  return null;
}
