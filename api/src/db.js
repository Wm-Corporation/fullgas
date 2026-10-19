// Conexão com o SQL Server (pool reutilizável).
import sql from 'mssql';
import 'dotenv/config';

const config = {
  server: process.env.DB_SERVER || 'localhost',
  port: Number(process.env.DB_PORT || 1433),
  database: process.env.DB_NAME || 'FullgasB2B',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt: String(process.env.DB_ENCRYPT) === 'true',
    trustServerCertificate: String(process.env.DB_TRUST_CERT) === 'true'
  },
  // Timeouts folgados: o banco pode demorar para "acordar".
  connectionTimeout: 30000,
  requestTimeout: 30000,
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
};

// Um único pool compartilhado por toda a aplicação.
let poolPromise;

export function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect(config)
      .then(pool => {
        console.log('✓ Conectado ao SQL Server:', config.server + '/' + config.database);
        return pool;
      })
      .catch(err => {
        poolPromise = undefined; // permite nova tentativa
        console.error('✗ Falha ao conectar no SQL Server:', err.message);
        throw err;
      });
  }
  return poolPromise;
}

// Consulta com parâmetros nomeados: query('... WHERE Sku = @sku', { sku: 'A123' })
export async function query(text, params = {}) {
  const pool = await getPool();
  const req = pool.request();
  for (const [nome, valor] of Object.entries(params)) {
    req.input(nome, valor);
  }
  const result = await req.query(text);
  return result.recordset;
}

export { sql };
