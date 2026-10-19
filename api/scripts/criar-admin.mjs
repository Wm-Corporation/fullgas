// Cria o PRIMEIRO administrador (banco novo não tem nenhum). Rode dentro de api/, com o .env:
//   node scripts/criar-admin.mjs "Nome do Admin" email@empresa.com.br "SenhaForte123"
// Mesmo e-mail de novo: atualiza a senha e reativa.
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { query, getPool, sql } from '../src/db.js';

const [, , nome, email, senha] = process.argv;

if (!nome || !email || !senha) {
  console.error('Uso: node scripts/criar-admin.mjs "Nome" email@dominio "Senha"');
  process.exit(1);
}
if (senha.length < 8) {
  console.error('ERRO: use uma senha de pelo menos 8 caracteres.');
  process.exit(1);
}
if (!/^\S+@\S+\.\S+$/.test(email)) {
  console.error('ERRO: e-mail inválido.');
  process.exit(1);
}

const EMPRESA = 'FULLGAS MOTOS';   // a matriz; o admin é pendurado nela

try {
  // A empresa é obrigatória; cria a matriz se não existir.
  let emp = (await query('SELECT EmpresaId FROM dbo.Empresa WHERE RazaoSocial = @r', { r: EMPRESA }))[0];
  if (!emp) {
    emp = (await query(
      'INSERT INTO dbo.Empresa (RazaoSocial) OUTPUT INSERTED.EmpresaId VALUES (@r)', { r: EMPRESA }))[0];
    console.log(`empresa "${EMPRESA}" criada (id ${emp.EmpresaId})`);
  }

  const hash = await bcrypt.hash(senha, 10);
  const pool = await getPool();
  const existe = (await query('SELECT UsuarioId FROM dbo.Usuario WHERE Email = @e', { e: email }))[0];

  if (existe) {
    // SenhaHash é VARBINARY: guardamos os BYTES da string do bcrypt, igual ao login.
    await pool.request()
      .input('id', sql.Int, existe.UsuarioId)
      .input('hash', sql.VarBinary(256), Buffer.from(hash, 'utf8'))
      .query(`UPDATE dbo.Usuario
                 SET SenhaHash = @hash, Papel = 'admin', Status = 'aprovado', Gestor = 1,
                     AtualizadoEm = SYSUTCDATETIME()
               WHERE UsuarioId = @id`);
    console.log(`✓ senha atualizada e acesso de admin garantido para ${email}`);
  } else {
    await pool.request()
      .input('eid', sql.Int, emp.EmpresaId)
      .input('nome', sql.NVarChar(120), nome)
      .input('email', sql.NVarChar(160), email)
      .input('hash', sql.VarBinary(256), Buffer.from(hash, 'utf8'))
      .query(`INSERT INTO dbo.Usuario (EmpresaId, Nome, Email, SenhaHash, Papel, Status, Gestor)
              VALUES (@eid, @nome, @email, @hash, 'admin', 'aprovado', 1)`);
    console.log(`✓ administrador criado: ${email}`);
  }
  console.log('  Entre no portal e troque a senha no primeiro acesso.');
  process.exit(0);
} catch (e) {
  console.error('ERRO:', e.message);
  process.exit(1);
}
