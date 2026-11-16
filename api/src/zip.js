// ZIP mínimo (sem pacote externo): imagens já comprimidas vão guardadas; texto vai com deflate.
import zlib from 'node:zlib';

function dataDos(d) {
  return {
    hora: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    dia: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  };
}

// arquivos: [{ nome: 'pasta/arquivo.ext', dados: Buffer | string }] → Buffer do .zip
export function montarZip(arquivos, agora = new Date()) {
  const { hora, dia } = dataDos(agora);
  const partes = [], centrais = [];
  let pos = 0;
  for (const a of arquivos) {
    const nome = Buffer.from(a.nome, 'utf8');
    const bruto = Buffer.isBuffer(a.dados) ? a.dados : Buffer.from(String(a.dados), 'utf8');
    const guardar = /\.(png|gif|jpe?g|zip)$/i.test(a.nome);
    const dados = guardar ? bruto : zlib.deflateRawSync(bruto, { level: 9 });
    const crc = zlib.crc32(bruto);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);              // nomes em UTF-8
    local.writeUInt16LE(guardar ? 0 : 8, 8);
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(dia, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(dados.length, 18);
    local.writeUInt32LE(bruto.length, 22);
    local.writeUInt16LE(nome.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(guardar ? 0 : 8, 10);
    central.writeUInt16LE(hora, 12);
    central.writeUInt16LE(dia, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(dados.length, 20);
    central.writeUInt32LE(bruto.length, 24);
    central.writeUInt16LE(nome.length, 28);
    central.writeUInt32LE(pos, 42);              // demais campos (extra, comentário, atributos) = 0

    partes.push(local, nome, dados);
    centrais.push(central, nome);
    pos += local.length + nome.length + dados.length;
  }
  const dir = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(dir.length, 12);
  fim.writeUInt32LE(pos, 16);
  return Buffer.concat([...partes, dir, fim]);
}
