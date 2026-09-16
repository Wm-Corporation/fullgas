/* =========================================================
   FULLGAS B2B — Camada de dados (localStorage) + utilidades
   ========================================================= */
(function (global) {
  'use strict';

  var DB_KEY = 'fullgas_db_v1';
  var SESSION_KEY = 'fullgas_session_v1';
  var CART_KEY = 'fullgas_cart_v1';

  /* ---------- helpers básicos ---------- */
  function read(key, fallback) {
    try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (e) { return fallback; }
  }
  function write(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

  function pad(n, len) { n = String(n); while (n.length < len) n = '0' + n; return n; }
  function uid(prefix) { return (prefix || 'ID') + Date.now().toString().slice(-8) + pad(Math.floor(Math.random() * 999), 3); }

  function fmtMoney(v) {
    return (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
  function fmtDate(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    return pad(d.getDate(), 2) + '/' + pad(d.getMonth() + 1, 2) + '/' + d.getFullYear();
  }
  function fmtDateTime(iso) {
    var d = new Date(iso);
    return fmtDate(iso) + ', ' + pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2);
  }
  function daysAgo(n, h) {
    var d = new Date(); d.setDate(d.getDate() - n); d.setHours(h || 10, 0, 0, 0); return d.toISOString();
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* =========================================================
     SEED — dados iniciais
     ========================================================= */

  var CATEGORIES = [
    { id: 'tecnicos',   nome: 'Acessórios Técnicos',          icone: 'escape' },
    { id: 'vestuario',  nome: 'Vestuário e Acessórios',       icone: 'oculos' },
    { id: 'balance',    nome: 'Bicicletas Elétricas Infantis', icone: 'bike' },
    { id: 'kits',       nome: 'Kits de Peças Originais',      icone: 'kit' },
    { id: 'retail',     nome: 'Sistemas de Varejo',           icone: 'loja' },
    { id: 'marketing',  nome: 'Material de Marketing',        icone: 'sacola' },
    { id: 'ferramentas',nome: 'Ferramentas Especiais',        icone: 'ferramenta' },
    { id: 'pecas',      nome: 'Peças de Reposição',           icone: 'engrenagem' }
  ];

  /* [artigo, nome, categoria, preço, estoque, descrição, previsão?] */
  var PRODUCTS_SEED = [
    // ----- Peças de reposição (usadas no Parts Finder) -----
    ['A590C161Y401000', 'Garfo dianteiro completo FG 125 MY25', 'pecas', 8450.00, 4,  'Conjunto de suspensão dianteira completo, calibrado de fábrica para o modelo FG 125 2025.'],
    ['A46001094000FB',  'Kit protetor de garfo',                'pecas', 289.90, 18, 'Par de protetores plásticos para bengalas com fixações incluídas.'],
    ['77701085100FB',   'Abraçadeira da mangueira de freio',    'pecas', 24.50, 60,  'Abraçadeira de fixação da linha dianteira no garfo.'],
    ['59001092050',     'Parafuso especial M6x12,5 RP=1.0',     'pecas', 8.90, 200,  'Parafuso especial de fixação das mesas.'],
    ['0017060206',      'Parafuso sext. flang. M6x20 T=6',      'pecas', 3.50, 350,  'Parafuso sextavado flangeado, uso geral no chassi.'],
    ['A49001032022',    'Mesa inferior X=22mm',                 'pecas', 1120.00, 3, 'Mesa inferior usinada em alumínio, offset 22 mm.'],
    ['0025080506',      'Parafuso colar M8x50 TX40',            'pecas', 12.40, 140, 'Parafuso de colar para fixação das mesas e amortecedor.'],
    ['77701084000',     'Guarda-pó da coluna de direção',       'pecas', 45.00, 25,  'Vedação superior da caixa de direção.'],
    ['54201081100',     'Rolamento cônico cpl. 06',             'pecas', 96.00, 30,  'Rolamento cônico da coluna de direção, completo.'],
    ['A46001086000',    'Retentor da caixa de direção',         'pecas', 38.50, 40,  'Retentor de vedação inferior da direção.'],
    ['A54603001000',    'Quadro principal FG',                  'pecas', 6980.00, 2, 'Quadro central em aço cromo-molibdênio com pintura vermelha de fábrica.'],
    ['A46004001044',    'Amortecedor traseiro completo',        'pecas', 5640.00, 3, 'Amortecedor traseiro com reservatório separado, ajuste de compressão e retorno.'],
    ['A51004030000',    'Balança traseira',                     'pecas', 2870.00, 4, 'Balança em alumínio fundido com tensor de corrente.'],
    ['A50305079000',    'Sistema de escape completo 2T',        'pecas', 3420.00, 5, 'Corpo de escape expandido para motores 2 tempos.'],
    ['A50305980000',    'Mola do escape (jogo c/ 4)',           'pecas', 64.00, 80,  'Jogo de molas de fixação do escapamento.'],
    ['A46007008044',    'Tanque de combustível 9 L',            'pecas', 1150.00, 6, 'Tanque translúcido com torneira e tampa.'],
    ['A46007040050',    'Assento completo',                     'pecas', 689.00, 9,  'Assento com capa antiderrapante de alta aderência.'],
    ['A46008001000FB',  'Kit plásticos completo',               'pecas', 1290.00, 7, 'Conjunto completo de carenagens nas cores originais.'],
    ['A46009001044',    'Roda dianteira cpl. 21"',              'pecas', 2350.00, 4, 'Roda dianteira completa com aro, raios, cubo e disco.'],
    ['A46010001044',    'Roda traseira cpl. 18"',               'pecas', 2480.00, 4, 'Roda traseira completa com aro, raios e cubo.'],
    ['A46013030000',    'Disco de freio dianteiro 260 mm',      'pecas', 540.00, 12, 'Disco flutuante 260 mm.'],
    ['A46013930000',    'Pastilhas de freio dianteiras',        'pecas', 119.90, 35, 'Jogo de pastilhas sinterizadas — eixo dianteiro.'],
    ['A46013015100',    'Pastilhas de freio traseiras',         'pecas', 129.90, 28, 'Jogo de pastilhas sinterizadas — eixo traseiro.'],
    ['58033029044',     'Coroa traseira 48T',                   'pecas', 310.00, 16, 'Coroa em alumínio 7075, 48 dentes.'],
    ['79233029014',     'Pinhão 13T',                           'pecas', 103.68, 22, 'Pinhão de ataque 13 dentes, aço temperado.'],
    ['50180007S',       'Corrente 5/8 x 1/4',                   'pecas', 389.00, 14, 'Corrente reforçada com elo de emenda.'],
    ['A54637001044',    'Cilindro 125',                         'pecas', 3890.00, 3, 'Cilindro com revestimento Nikasil para FG 125.'],
    ['A54630038000',    'Pistão II cpl. 125',                   'pecas', 1260.00, 6, 'Pistão completo com anéis, pino e travas — medida II.'],
    ['A54630007010',    'Junta do cabeçote 125',                'pecas', 86.00, 40,  'Junta metálica do cabeçote.'],
    ['A54639090000',    'Kit reparo do motor 125 2T',           'pecas', 2150.00, 5, 'Kit completo de juntas, retentores e rolamentos do motor.'],
    ['A54632011010',    'Kit embreagem completo',               'pecas', 1480.00, 8, 'Discos, separadores e molas de embreagem.'],
    ['BORR-EMB-21',     'Borracha de amortecimento do platô de embreagem', 'pecas', 20.48, 120, 'Borracha amortecedora do platô — unidade.'],
    ['A54611031000',    'Bobina de ignição',                    'pecas', 420.00, 10, 'Bobina de alta com cabo e supressor.'],
    ['A54606015000',    'Filtro de ar',                         'pecas', 89.90, 90,  'Elemento de espuma dupla densidade, lavável.'],
    ['PREF-78',         'Pré-filtro de ar 78 mm',               'pecas', 38.00, 70,  'Pré-filtro para uso em condições de muita poeira.'],
    ['OLEOF-250450',    'Filtro de óleo FG 250F-450F',          'pecas', 61.20, 150, 'Filtro de óleo para motores 4 tempos 250F a 450F.'],

    // ----- Acessórios técnicos -----
    ['A46002910044', 'Tubo do punho do acelerador',     'tecnicos', 244.90, 26, 'Tubo de acelerador em alumínio de alta resistência; manopla não incluída.'],
    ['A45030905544', 'Kit Factory 300',                 'tecnicos', 7890.00, 0, 'Todas as peças necessárias para converter sua 250 em uma 300 Enduro. Requer arquivo de mapeamento do motor 300.', '26/07/26'],
    ['A40012948544', 'Kit de redução de potência',      'tecnicos', 645.00, 11, 'Mais segurança para os pilotos do futuro: kit intermediário liberando 8 hp.'],
    ['A46005910000', 'Ponteira slip-on Factory',        'tecnicos', 2990.00, 6, 'Ponteira em alumínio com tampa em carbono, plug-and-play.'],
    ['A46001996044', 'Protetores de mão fechados',      'tecnicos', 154.72, 44, 'Protetores de mão sem os casquilhos, com kit de montagem.'],
    ['A46004937000', 'Kit de molas de suspensão (duro)','tecnicos', 980.00, 7, 'Molas progressivas para pilotos acima de 85 kg.'],
    ['A46011946000', 'Comando de partida em CNC',       'tecnicos', 460.00, 9, 'Pedal de partida usinado, anodizado vermelho.'],

    // ----- Vestuário -----
    ['CAP-FG-RACE',  'Capacete FG Racing',              'vestuario', 1890.00, 8, 'Casco em composto de fibras, ECE 22.06, viseira ajustável.'],
    ['LUV-FG-PRO',   'Luvas FG Pro',                    'vestuario', 189.90, 32, 'Luvas leves com palma em camada única.'],
    ['CAM-FG-TEAM',  'Camiseta FG Team 2026',           'vestuario', 129.90, 60, 'Camiseta oficial da equipe, algodão premium.'],
    ['BOT-FG-TECH',  'Bota FG Tech Offroad',            'vestuario', 1450.00, 10, 'Bota com proteção de tornozelo e sola substituível.'],
    ['OCU-FG-VIS',   'Óculos FG Vision',                'vestuario', 349.90, 21, 'Óculos com lente antiembaçante e tear-offs inclusos.'],

    // ----- Balance bikes -----
    ['FGB-12E', 'FG Balance 12e', 'balance', 4990.00, 3, 'Bicicleta elétrica de equilíbrio infantil, aro 12, três modos de potência.'],
    ['FGB-16E', 'FG Balance 16e', 'balance', 6490.00, 2, 'Bicicleta elétrica de equilíbrio infantil, aro 16, bateria removível.'],

    // ----- Kits originais -----
    ['KIT-REV-125', 'Kit revisão FG 125 2T',     'kits', 489.00, 15, 'Filtro de ar, vela, junta de escape e óleo de transmissão.'],
    ['KIT-ROL-CH',  'Kit rolamentos do chassi',  'kits', 720.00, 9,  'Rolamentos de direção, balança e links em um único kit.'],

    // ----- Retail -----
    ['RET-BALCAO', 'Balcão expositor FULLGAS', 'retail', 3200.00, 2, 'Balcão de loja com iluminação e identidade visual da marca.'],
    ['RET-BANNER', 'Banner de loja 2026',      'retail', 240.00, 12, 'Banner em lona 2x1 m com a campanha vigente.'],

    // ----- Marketing -----
    ['MKT-CAT26', 'Kit catálogos 2026 (25 un.)', 'marketing', 85.00, 30, 'Catálogo impresso da linha 2026 para balcão.'],
    ['MKT-ADES',  'Cartela de adesivos FULLGAS', 'marketing', 49.00, 80, 'Cartela com 12 adesivos resistentes a combustível.'],

    // ----- Ferramentas -----
    ['FER-EXTV', 'Extrator de volante magnético', 'ferramentas', 260.00, 6, 'Extrator específico para volantes da linha 2T.'],
    ['FER-MANO', 'Manômetro de suspensão',        'ferramentas', 980.00, 4, 'Manômetro de alta precisão para balão das bengalas.'],
    ['FER-CAVA', 'Cavalete central de oficina',   'ferramentas', 1350.00, 5, 'Cavalete hidráulico com trava de altura.']
  ];

  /* ---------- Parts Finder: seções por modelo ---------- */
  function sec(num, nome, destaque, parts) {
    return { num: num, nome: nome, destaque: destaque, parts: parts.map(function (p) {
      return { pos: p[0], artigo: p[1], qtd: p[2], minutos: p[3] != null ? p[3] : p[2] };
    }) };
  }

  var SEC_CHASSI_125 = [
    sec('01', 'GARFO DIANTEIRO, MESA SUPERIOR', 'fork', [
      [1, 'A590C161Y401000', 1, 1], [2, 'A46001094000FB', 1, 1], [3, '77701085100FB', 1, 1],
      [4, '59001092050', 6, 6], [5, '0017060206', 2, 2], [6, 'A49001032022', 1, 1],
      [7, '0025080506', 4, 4], [8, '77701084000', 1, 1], [9, '54201081100', 2, 2], [10, 'A46001086000', 1, 1]
    ]),
    sec('02', 'GUIDÃO, COMANDOS', 'bar', [
      [1, 'A46002910044', 1, 1], [2, 'A46001996044', 1, 1], [3, '0017060206', 4, 2]
    ]),
    sec('03', 'QUADRO', 'frame', [
      [1, 'A54603001000', 1, 4], [2, '0025080506', 6, 3], [3, '0017060206', 8, 3]
    ]),
    sec('04', 'AMORTECEDOR', 'shock', [
      [1, 'A46004001044', 1, 2], [2, '0025080506', 2, 1], [3, 'A46004937000', 1, 1]
    ]),
    sec('04', 'BALANÇA', 'swing', [
      [1, 'A51004030000', 1, 3], [2, '54201081100', 2, 2], [3, '0025080506', 2, 1]
    ]),
    sec('05', 'SISTEMA DE ESCAPE', 'exhaust', [
      [1, 'A50305079000', 1, 2], [2, 'A50305980000', 1, 1], [3, 'A46005910000', 1, 1]
    ]),
    sec('06', 'TANQUE, ASSENTO', 'tank', [
      [1, 'A46007008044', 1, 1], [2, 'A46007040050', 1, 1]
    ]),
    sec('07', 'PLÁSTICOS, ADESIVOS', 'plastics', [
      [1, 'A46008001000FB', 1, 2], [2, 'MKT-ADES', 1, 1]
    ]),
    sec('08', 'RODAS, TRANSMISSÃO FINAL', 'wheels', [
      [1, 'A46009001044', 1, 2], [2, 'A46010001044', 1, 2], [3, '58033029044', 1, 1],
      [4, '79233029014', 1, 1], [5, '50180007S', 1, 1]
    ]),
    sec('09', 'FREIO DIANTEIRO', 'brakeF', [
      [1, 'A46013030000', 1, 1], [2, 'A46013930000', 1, 1], [3, '77701085100FB', 1, 1]
    ]),
    sec('10', 'FREIO TRASEIRO', 'brakeR', [
      [1, 'A46013015100', 1, 1]
    ])
  ];

  var SEC_ENGINE_125 = [
    sec('01', 'CILINDRO, PISTÃO', 'engine', [
      [1, 'A54637001044', 1, 3], [2, 'A54630038000', 1, 2], [3, 'A54630007010', 1, 1]
    ]),
    sec('02', 'EMBREAGEM', 'engine', [
      [1, 'A54632011010', 1, 2], [2, 'BORR-EMB-21', 8, 1]
    ]),
    sec('03', 'IGNIÇÃO', 'engine', [
      [1, 'A54611031000', 1, 1], [2, 'FER-EXTV', 1, 1]
    ]),
    sec('04', 'FILTRO DE AR, ADMISSÃO', 'tank', [
      [1, 'A54606015000', 1, 1], [2, 'PREF-78', 1, 1]
    ]),
    sec('05', 'KIT REPARO DO MOTOR', 'engine', [
      [1, 'A54639090000', 1, 6]
    ])
  ];

  var SEC_ENGINE_300 = SEC_ENGINE_125.map(function (s) { return s; }).concat([
    sec('06', 'KIT FACTORY 300', 'engine', [[1, 'A45030905544', 1, 8]])
  ]);

  var SEC_ENGINE_450F = [
    sec('01', 'LUBRIFICAÇÃO', 'engine', [[1, 'OLEOF-250450', 1, 1]]),
    sec('02', 'EMBREAGEM', 'engine', [[1, 'A54632011010', 1, 2], [2, 'BORR-EMB-21', 8, 1]]),
    sec('03', 'FILTRO DE AR, ADMISSÃO', 'tank', [[1, 'A54606015000', 1, 1], [2, 'PREF-78', 1, 1]])
  ];

  var MODELS = [
    {
      id: 'fg125-2025', nome: 'FG 125', ano: 2025,
      label: 'FG 125 2025 <2025><BR><F0103Y1>',
      arvore: ['Fullgas', 'Offroad', 'Enduro', 'E1', '2 tempos', 'FG 125', 'FG 125 2025'],
      chassi: SEC_CHASSI_125, engine: SEC_ENGINE_125
    },
    {
      id: 'fg300-2026', nome: 'FG 300', ano: 2026,
      label: 'FG 300 2026 <2026><BR><F0309Y2>',
      arvore: ['Fullgas', 'Offroad', 'Enduro', 'E3', '2 tempos', 'FG 300', 'FG 300 2026'],
      chassi: SEC_CHASSI_125, engine: SEC_ENGINE_300
    },
    {
      id: 'fg450f-2025', nome: 'FG 450F', ano: 2025,
      label: 'FG 450F 2025 <2025><BR><F4501Y1>',
      arvore: ['Fullgas', 'Offroad', 'MX', '4 tempos', 'FG 450F', 'FG 450F 2025'],
      chassi: SEC_CHASSI_125, engine: SEC_ENGINE_450F
    }
  ];

  var VEHICLES = [
    { niv: 'VBFGA125XSM160872', modeloId: 'fg125-2025', cor: 'Vermelho', status: 'Disponível', entrada: daysAgo(40) },
    { niv: 'VBFGA125YSM160873', modeloId: 'fg125-2025', cor: 'Vermelho', status: 'Disponível', entrada: daysAgo(40) },
    { niv: 'VBFGA1252SM160901', modeloId: 'fg125-2025', cor: 'Vermelho', status: 'Vendido',    entrada: daysAgo(90), venda: { data: daysAgo(12), cliente: 'Daniel Vergueiro' } },
    { niv: 'VBFGA1253SM160944', modeloId: 'fg125-2025', cor: 'Vermelho', status: 'Disponível', entrada: daysAgo(22) },
    { niv: 'VBFGC3094SM310633', modeloId: 'fg300-2026', cor: 'Vermelho', status: 'Disponível', entrada: daysAgo(18) },
    { niv: 'VBFGC3095SM310690', modeloId: 'fg300-2026', cor: 'Vermelho', status: 'Disponível', entrada: daysAgo(18) },
    { niv: 'VBFGC3096SM310702', modeloId: 'fg300-2026', cor: 'Vermelho', status: 'Vendido',    entrada: daysAgo(75), venda: { data: daysAgo(30), cliente: 'BK Off Road' } },
    { niv: 'VBFGF4501SM399000', modeloId: 'fg450f-2025', cor: 'Vermelho', status: 'Disponível', entrada: daysAgo(55) },
    { niv: 'VBFGF4502SM399017', modeloId: 'fg450f-2025', cor: 'Vermelho', status: 'Disponível', entrada: daysAgo(55) },
    { niv: 'VBFGF4503SM399025', modeloId: 'fg450f-2025', cor: 'Vermelho', status: 'Disponível', entrada: daysAgo(9) }
  ];

  // VAZIO DE PROPÓSITO. Aqui existiam três usuários de demonstração com a
  // SENHA EM TEXTO PURO, herdados da época em que o portal
  // rodava só no localStorage, antes da API. Hoje o api-adapter.js sobrescreve
  // FG.login e FG.all, então esses dados nunca são usados — mas o arquivo é
  // baixado por todo visitante, ou seja, as senhas iam junto. Pior: se o
  // api-adapter falhasse ao carregar, o login antigo abaixo voltaria a valer e
  // aceitaria essas credenciais. As contas de teste vivem no
  // database/fullgas_seeds.sql, que não é aplicado em produção.
  var USERS = [];

  var CLAIMS = [
    { id: '12094338', data: daysAgo(15), criador: 'SILVA RACING',   pais: 'Brasil', tipo: 'IT',           niv: 'VBFGA125XSM160872', status: 'Em processo', preAuth: 'Não', sentBack: false, descricao: 'Falha intermitente no sensor TPS.' },
    { id: '12079465', data: daysAgo(32), criador: 'GOX POWERSPORTS',pais: 'Brasil', tipo: 'Manufacturer', niv: 'VBFGC3094SM310633', status: 'Em processo', preAuth: 'Não', sentBack: false, descricao: 'Vazamento no retentor do amortecedor.' },
    { id: '12079380', data: daysAgo(32), criador: 'BK OFF ROAD',    pais: 'Brasil', tipo: 'Implícito',    niv: 'VBFGA1252SM160901', status: 'Em processo', preAuth: 'Não', sentBack: false, descricao: 'Trinca na carenagem lateral direita.' },
    { id: '12071122', data: daysAgo(48), criador: 'M4 RACING-PR',   pais: 'Brasil', tipo: 'IT',           niv: 'VBFGF4501SM399000', status: 'Esboço',      preAuth: 'Não', sentBack: false, descricao: 'Rascunho: ruído na embreagem a frio.' },
    { id: '12065540', data: daysAgo(80), criador: 'ART MOTO RACING',pais: 'Brasil', tipo: 'Manufacturer', niv: 'VBFGC3096SM310702', status: 'Aprovada',    preAuth: 'Sim', sentBack: false, descricao: 'Substituição da bomba de combustível em garantia.' },
    { id: '12060071', data: daysAgo(95), criador: 'POWER MOTOS LTDA',pais:'Brasil', tipo: 'IT',           niv: 'VBFGA125YSM160873', status: 'Recusada',    preAuth: 'Não', sentBack: true,  descricao: 'Desgaste de pastilhas — item de manutenção.' }
  ];

  var INVOICES = [
    { tipo: 'Fatura',          numero: '1726017668', data: daysAgo(3),  valor: 44110.00, moeda: 'Real (R$)' },
    { tipo: 'Nota de crédito', numero: '1726017205', data: daysAgo(7),  valor: -9.05,    moeda: 'Real (R$)' },
    { tipo: 'Fatura',          numero: '1726016674', data: daysAgo(12), valor: 4405.05,  moeda: 'Real (R$)' },
    { tipo: 'Fatura',          numero: '1726016687', data: daysAgo(12), valor: 4046.85,  moeda: 'Real (R$)' },
    { tipo: 'Fatura',          numero: '1726016510', data: daysAgo(15), valor: 22629.00, moeda: 'Real (R$)' },
    { tipo: 'Fatura',          numero: '1726016509', data: daysAgo(15), valor: 35200.00, moeda: 'Real (R$)' },
    { tipo: 'Fatura',          numero: '1726016329', data: daysAgo(17), valor: 37715.00, moeda: 'Real (R$)' },
    { tipo: 'Fatura',          numero: '1726015980', data: daysAgo(18), valor: 813.60,   moeda: 'Real (R$)' }
  ];

  function seedOrder(num, cx, diasAtras, userEmail, empresa, items, status) {
    var total = 0;
    items.forEach(function (i) { total += i.preco * i.qtd; });
    return {
      id: num, cx: cx, data: daysAgo(diasAtras, 9 + (diasAtras % 8)),
      usuario: userEmail, empresa: empresa, itens: items, total: total, status: status
    };
  }
  var ORDERS = [
    seedOrder('0005037694', 'CX2605180000556', 25, 'cliente@exemplo.com', 'POWER MOTOS LTDA', [
      { artigo: 'OLEOF-250450', nome: 'Filtro de óleo FG 250F-450F', preco: 61.20, qtd: 12 },
      { artigo: 'A46001996044', nome: 'Protetores de mão fechados', preco: 154.72, qtd: 4 }
    ], 'Entregue'),
    seedOrder('0005039703', 'CX2605190006179', 24, 'cliente@exemplo.com', 'POWER MOTOS LTDA', [
      { artigo: '79233029014', nome: 'Pinhão 13T', preco: 103.68, qtd: 6 },
      { artigo: 'BORR-EMB-21', nome: 'Borracha de amortecimento do platô de embreagem', preco: 20.48, qtd: 16 }
    ], 'Entregue'),
    seedOrder('0005032980', 'CX2605140002054', 29, 'cliente@exemplo.com', 'POWER MOTOS LTDA', [
      { artigo: 'PREF-78', nome: 'Pré-filtro de ar 78 mm', preco: 38.00, qtd: 10 },
      { artigo: 'A54606015000', nome: 'Filtro de ar', preco: 89.90, qtd: 8 }
    ], 'Entregue'),
    seedOrder('0005041100', 'CX2606020001231', 8, 'cliente@exemplo.com', 'POWER MOTOS LTDA', [
      { artigo: 'A54632011010', nome: 'Kit embreagem completo', preco: 1480.00, qtd: 2 },
      { artigo: 'KIT-REV-125', nome: 'Kit revisão FG 125 2T', preco: 489.00, qtd: 3 }
    ], 'Enviado'),
    seedOrder('0005041877', 'CX2606090004410', 2, 'cliente@exemplo.com', 'POWER MOTOS LTDA', [
      { artigo: 'CAP-FG-RACE', nome: 'Capacete FG Racing', preco: 1890.00, qtd: 1 },
      { artigo: 'A46013930000', nome: 'Pastilhas de freio dianteiras', preco: 119.90, qtd: 5 }
    ], 'Pendente')
  ];

  var DELIVERIES = [
    { numero: '0050729434', data: daysAgo(11), rastreios: ['000520268', '000520275', '000520272'], pedidos: ['CX2605180000556 / 0005037694', 'CX2605190006179 / 0005039703'], fatura: '1726016687', dataFatura: daysAgo(11) },
    { numero: '0050729435', data: daysAgo(11), rastreios: ['000520238', '000520242'], pedidos: ['CX2605180000556 / 0005037694', 'CX2605190006179 / 0005039703'], fatura: '1726016674', dataFatura: daysAgo(11) },
    { numero: '0050720926', data: daysAgo(17), rastreios: ['000519361'], pedidos: ['CX2605140002054 / 0005032980'], fatura: '1726015980', dataFatura: daysAgo(17) },
    { numero: '0050731002', data: daysAgo(4),  rastreios: ['000521104'], pedidos: ['CX2606020001231 / 0005041100'], fatura: '1726017668', dataFatura: daysAgo(3) }
  ];

  var NOTIFICATIONS = [
    { id: 'n1', data: daysAgo(1), tipo: 'critica', titulo: 'Campanha técnica FG 300 2026', texto: 'Verificar torque dos parafusos da mesa superior nos chassis VBFGC309… antes da entrega ao cliente final.', lida: false },
    { id: 'n2', data: daysAgo(2), tipo: 'critica', titulo: 'Fatura 1726017668 emitida', texto: 'Nova fatura no valor de R$ 44.110,00 disponível em Conta financeira.', lida: false },
    { id: 'n3', data: daysAgo(3), tipo: 'critica', titulo: 'Atualização da lista de preços', texto: 'A lista de preços 07/2026 entra em vigor no dia 01/07. Revise os pedidos em aberto.', lida: false },
    { id: 'n4', data: daysAgo(5), tipo: 'info',    titulo: 'Novos itens na loja', texto: '18 novos artigos publicados na categoria Acessórios Técnicos.', lida: false },
    { id: 'n5', data: daysAgo(9), tipo: 'info',    titulo: 'Treinamento de garantia', texto: 'Inscrições abertas para o treinamento on-line de reivindicações (turma de julho).', lida: true },
    { id: 'n6', data: daysAgo(14), tipo: 'info',   titulo: 'Janela de pedidos de motos', texto: 'A janela de pedidos do 3º trimestre fecha em 30/06.', lida: true }
  ];

  /* =========================================================
     API pública
     ========================================================= */
  var FG = {
    /* ---- inicialização ---- */
    init: function () {
      if (!read(DB_KEY, null)) {
        var products = PRODUCTS_SEED.map(function (p) {
          return { artigo: p[0], nome: p[1], cat: p[2], preco: p[3], estoque: p[4], descricao: p[5] || '', previsao: p[6] || null };
        });
        write(DB_KEY, {
          users: USERS, categories: CATEGORIES, products: products, models: MODELS,
          vehicles: VEHICLES, claims: CLAIMS, invoices: INVOICES, orders: ORDERS,
          deliveries: DELIVERIES, notifications: NOTIFICATIONS, searches: []
        });
      }
    },
    reset: function () { localStorage.removeItem(DB_KEY); localStorage.removeItem(CART_KEY); FG.init(); },

    db: function () { return read(DB_KEY, {}); },
    save: function (db) { write(DB_KEY, db); },
    all: function (col) { return (FG.db()[col]) || []; },
    setCol: function (col, arr) { var db = FG.db(); db[col] = arr; FG.save(db); },

    /* ---- sessão / auth ---- */
    session: function () { return read(SESSION_KEY, null); },
    login: function (email, senha) {
      var u = FG.all('users').find(function (x) { return x.email.toLowerCase() === String(email).toLowerCase(); });
      if (!u) return { ok: false, msg: 'Usuário não encontrado.' };
      if (u.senha !== senha) return { ok: false, msg: 'Senha incorreta.' };
      if (u.status === 'pendente') return { ok: false, msg: 'Cadastro aguardando aprovação do administrador.' };
      if (u.status === 'bloqueado') return { ok: false, msg: 'Acesso bloqueado. Fale com o administrador.' };
      write(SESSION_KEY, { id: u.id, nome: u.nome, email: u.email, empresa: u.empresa, papel: u.papel });
      return { ok: true };
    },
    logout: function () { localStorage.removeItem(SESSION_KEY); location.href = '/'; },
    register: function (dados) {
      var users = FG.all('users');
      if (users.some(function (u) { return u.email.toLowerCase() === dados.email.toLowerCase(); })) {
        return { ok: false, msg: 'Já existe um cadastro com este e-mail.' };
      }
      users.push({
        id: uid('u'), nome: dados.nome, email: dados.email, senha: dados.senha,
        empresa: dados.empresa, papel: 'cliente', status: 'pendente', criado: new Date().toISOString()
      });
      FG.setCol('users', users);
      return { ok: true };
    },
    guard: function (papel) {
      var s = FG.session();
      if (!s) { location.href = '/'; return null; }
      if (papel === 'admin' && s.papel !== 'admin') {
        alert('Acesso restrito a administradores.');
        location.href = '/portal'; return null;
      }
      return s;
    },

    /* ---- catálogo ---- */
    product: function (artigo) {
      return FG.all('products').find(function (p) { return p.artigo === artigo; }) || null;
    },
    category: function (id) {
      return FG.all('categories').find(function (c) { return c.id === id; }) || null;
    },
    /* ---- categorias hierárquicas (máx. 2 níveis) ---- */
    // Categorias de topo (sem pai). `c.pai` ausente/null = topo.
    categoriasTopo: function () {
      return FG.all('categories').filter(function (c) { return !c.pai; });
    },
    // Subcategorias diretas de uma categoria de topo.
    subcategorias: function (catId) {
      return FG.all('categories').filter(function (c) { return c.pai === catId; });
    },
    // A própria categoria + os códigos das suas subcategorias — usado para
    // listar, numa categoria de topo, também os produtos das subcategorias.
    categoriaEDescendentes: function (catId) {
      var ids = [catId];
      FG.all('categories').forEach(function (c) { if (c.pai === catId) ids.push(c.id); });
      return ids;
    },
    model: function (id) {
      return FG.all('models').find(function (m) { return m.id === id; }) || null;
    },
    /* artigos usados pelo finder de um modelo (p/ filtro "buscar por moto") */
    modelArticles: function (modelId) {
      var m = FG.model(modelId); if (!m) return [];
      var set = {};
      (m.chassi || []).concat(m.engine || []).forEach(function (s) {
        s.parts.forEach(function (p) { set[p.artigo] = true; });
      });
      return Object.keys(set);
    },

    /* ---- carrinho ---- */
    cart: function () { return read(CART_KEY, []); },
    cartCount: function () { return FG.cart().reduce(function (n, i) { return n + i.qtd; }, 0); },
    // Produto "Indisponível" = sem estoque E sem previsão de chegada. Não pode
    // ser comprado (diferente de "Pré-venda", que tem previsão e vai p/ backorder).
    compravel: function (artigo) {
      var p = FG.product(artigo);
      if (!p) return false;
      return p.estoque > 0 || !!p.previsao;
    },
    // Quantidade máxima comprável de um produto. Produtos "Em estoque"
    // (estoque > 0) limitam-se ao estoque disponível; produtos em pré-venda
    // (sem estoque, com previsão) não têm limite aqui — vão para pré-venda.
    limiteCompra: function (artigo) {
      var p = FG.product(artigo);
      return (p && p.estoque > 0) ? p.estoque : Infinity;
    },
    cartAdd: function (artigo, qtd) {
      var p = FG.product(artigo); if (!p) return false;
      if (!FG.compravel(artigo)) return false;   // indisponível: bloqueia
      var cart = FG.cart();
      var item = cart.find(function (i) { return i.artigo === artigo; });
      var nova = Math.min((item ? item.qtd : 0) + qtd, FG.limiteCompra(artigo));
      if (item) item.qtd = nova; else cart.push({ artigo: artigo, qtd: nova });
      write(CART_KEY, cart); return true;
    },
    cartSet: function (artigo, qtd) {
      var lim = FG.limiteCompra(artigo);
      var cart = FG.cart().map(function (i) { if (i.artigo === artigo) i.qtd = Math.min(qtd, lim); return i; })
        .filter(function (i) { return i.qtd > 0; });
      write(CART_KEY, cart);
    },
    cartRemove: function (artigo) {
      write(CART_KEY, FG.cart().filter(function (i) { return i.artigo !== artigo; }));
    },
    cartClear: function () { write(CART_KEY, []); },
    cartTotal: function () {
      return FG.cart().reduce(function (t, i) {
        var p = FG.product(i.artigo); return t + (p ? p.preco * i.qtd : 0);
      }, 0);
    },

    /* ---- pedidos ---- */
    createOrder: function () {
      var s = FG.session(); var cart = FG.cart();
      if (!s || !cart.length) return null;
      var db = FG.db();
      var num = pad(5041877 + db.orders.length * 13 + Math.floor(Math.random() * 9), 10);
      var d = new Date();
      var cx = 'CX' + String(d.getFullYear()).slice(2) + pad(d.getMonth() + 1, 2) + pad(d.getDate(), 2) + pad(Math.floor(Math.random() * 9999999), 7);
      var itens = cart.map(function (i) {
        var p = FG.product(i.artigo);
        return { artigo: i.artigo, nome: p ? p.nome : i.artigo, preco: p ? p.preco : 0, qtd: i.qtd };
      });
      var total = itens.reduce(function (t, i) { return t + i.preco * i.qtd; }, 0);
      var order = { id: num, cx: cx, data: d.toISOString(), usuario: s.email, empresa: s.empresa, itens: itens, total: total, status: 'Pendente' };
      db.orders.unshift(order);
      // baixa de estoque
      itens.forEach(function (i) {
        var p = db.products.find(function (x) { return x.artigo === i.artigo; });
        if (p) p.estoque = Math.max(0, p.estoque - i.qtd);
      });
      FG.save(db); FG.cartClear();
      return order;
    },
    setOrderStatus: function (id, status) {
      var db = FG.db();
      var o = db.orders.find(function (x) { return x.id === id; });
      if (!o) return { ok: false, msg: 'Pedido não encontrado.' };
      if (o.status === 'Entregue' || o.status === 'Cancelado')
        return { ok: false, msg: 'Pedido ' + o.status.toLowerCase() + ' não pode mudar de status.' };
      o.status = status;
      if (status === 'Enviado' && !o.entrega) {
        var fat = '17260' + pad(17700 + db.invoices.length, 5);
        var entrega = {
          numero: '00507' + pad(31002 + db.deliveries.length * 7, 5),
          data: new Date().toISOString(),
          rastreios: ['000' + pad(521200 + db.deliveries.length * 11, 6)],
          pedidos: [o.cx + ' / ' + o.id],
          fatura: fat, dataFatura: new Date().toISOString()
        };
        db.deliveries.unshift(entrega);
        db.invoices.unshift({ tipo: 'Fatura', numero: fat, data: new Date().toISOString(), valor: o.total, moeda: 'Real (R$)' });
        o.entrega = entrega.numero;
      }
      FG.save(db);
    },

    /* ---- reivindicações ---- */
    createClaim: function (dados) {
      var db = FG.db();
      var id = String(12094338 + db.claims.length * 97 + Math.floor(Math.random() * 50));
      var claim = {
        id: id, data: new Date().toISOString(), criador: dados.criador, pais: 'Brasil',
        tipo: dados.tipo, niv: dados.niv, status: dados.status || 'Em processo',
        preAuth: 'Não', sentBack: false, descricao: dados.descricao
      };
      db.claims.unshift(claim); FG.save(db);
      return claim;
    },
    setClaimStatus: function (id, status) {
      var db = FG.db();
      var c = db.claims.find(function (x) { return x.id === id; });
      if (c) { c.status = status; FG.save(db); }
    },

    /* ---- notificações ---- */
    unreadCritical: function () {
      return FG.all('notifications').filter(function (n) { return n.tipo === 'critica' && !n.lida; }).length;
    },
    unreadCount: function () {
      return FG.all('notifications').filter(function (n) { return !n.lida; }).length;
    },
    markNotif: function (id, lida) {
      var db = FG.db();
      var n = db.notifications.find(function (x) { return x.id === id; });
      if (n) { n.lida = lida; FG.save(db); }
    },

    /* ---- busca + log (alimenta o painel admin) ---- */
    logSearch: function (termo, resultados) {
      var db = FG.db();
      db.searches.unshift({ termo: termo, resultados: resultados, data: new Date().toISOString() });
      db.searches = db.searches.slice(0, 100);
      FG.save(db);
    },

    /* ---- usuários (admin) ---- */
    setUser: function (id, patch) {
      var db = FG.db();
      var u = db.users.find(function (x) { return x.id === id; });
      if (u) { Object.keys(patch).forEach(function (k) { u[k] = patch[k]; }); FG.save(db); }
    },

    /* ---- util ---- */
    fmtMoney: fmtMoney, fmtDate: fmtDate, fmtDateTime: fmtDateTime, esc: esc, uid: uid, pad: pad,

    /* ---- máscaras de formulário (formatam enquanto digita) ---- */
    maskCnpj: function (v) {
      v = String(v).replace(/\D/g, '').slice(0, 14);
      return v
        .replace(/^(\d{2})(\d)/, '$1.$2')
        .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
        .replace(/\.(\d{3})(\d)/, '.$1/$2')
        .replace(/(\d{4})(\d)/, '$1-$2');
    },
    maskTelefone: function (v) {
      v = String(v).replace(/\D/g, '').slice(0, 11);
      if (v.length > 10) return v.replace(/^(\d{2})(\d{5})(\d*)/, '($1) $2-$3'); // celular 9 dígitos
      return v
        .replace(/^(\d{2})(\d)/, '($1) $2')
        .replace(/^(\(\d{2}\) \d{4})(\d)/, '$1-$2');                             // fixo 8 dígitos
    },
    maskCep: function (v) {
      return String(v).replace(/\D/g, '').slice(0, 8).replace(/^(\d{5})(\d)/, '$1-$2');
    },
    // Número do endereço: só dígitos.
    maskNumero: function (v) {
      return String(v).replace(/\D/g, '').slice(0, 10);
    },
    // Cidade: só letras (com acento), espaço, apóstrofo, ponto e hífen.
    maskCidade: function (v) {
      return String(v).replace(/[^A-Za-zÀ-ÖØ-öø-ÿ'. -]/g, '').replace(/^[^A-Za-zÀ-ÖØ-öø-ÿ]+/, '').slice(0, 80);
    },
    // Inscrição estadual: maiúsculas; dígitos, letras, ponto, hífen, barra.
    maskIe: function (v) {
      return String(v).toUpperCase().replace(/[^0-9A-Z./ -]/g, '').slice(0, 20);
    },
    // Selo "Fábrica" — o mesmo desenho em todas as telas (.selo-fabrica no
    // styles.css). Vai no lugar do nome da concessionária quando o chassi, o
    // evento ou a conta são da Fábrica.
    seloFabrica: function () {
      return '<span class="selo-fabrica" title="Fullgas — Fábrica">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" ' +
        'd="M2 22V11l6 3v-3l6 3V9h2V2h4v20zM5 17h2v2H5zm4 0h2v2H9zm4 0h2v2h-2z"/></svg>' +
        'Fábrica</span>';
    },
    // Empresa da sessão para os cabeçalhos, já em HTML: administrador é da
    // Fábrica e aparece com o selo, não com a empresa em que a conta está.
    empresaDaSessao: function (s) {
      return s && s.papel === 'admin' ? FG.seloFabrica() : esc((s && s.empresa) || '');
    },
    // Autocomplete PRÓPRIO (visual .ac-wrap/.ac-list — nada de datalist
    // nativo do navegador). Requer o markup:
    //   <div class="ac-wrap"><input id="X"><div class="ac-list hidden" id="X-ac"></div></div>
    // `itens(termo)` devolve (ou resolve) os itens filtrados
    // [{ id, label, sub? }]; ao escolher, o input recebe data-ac-id com o id
    // (limpo quando o texto muda) e `aoEscolher(item)` é chamado.
    bindAutocomplete: function (inputId, itens, aoEscolher) {
      var el = document.getElementById(inputId);
      var list = document.getElementById(inputId + '-ac');
      if (!el || !list) return;
      function fechar() { list.classList.add('hidden'); list.innerHTML = ''; }
      function abrir(arr) {
        arr = arr || [];
        if (!arr.length) { fechar(); return; }
        list.innerHTML = arr.slice(0, 8).map(function (i, ix) {
          return '<button type="button" class="ac-item" data-ix="' + ix + '">' +
            '<span class="ac-nome">' + esc(i.label) + '</span>' +
            (i.sub ? '<span class="ac-preco">' + esc(i.sub) + '</span>' : '') + '</button>';
        }).join('');
        list.classList.remove('hidden');
        Array.prototype.forEach.call(list.querySelectorAll('.ac-item'), function (b) {
          // mousedown (não click): dispara ANTES do blur do input.
          b.addEventListener('mousedown', function (e) {
            e.preventDefault();
            var i = arr[Number(b.getAttribute('data-ix'))];
            el.value = i.label;
            el.setAttribute('data-ac-id', i.id);
            fechar();
            if (aoEscolher) aoEscolher(i);
          });
        });
      }
      function buscar() {
        var t = el.value.trim();
        if (!t) { fechar(); return; }
        Promise.resolve(itens(t)).then(abrir);
      }
      el.addEventListener('input', function () { el.removeAttribute('data-ac-id'); buscar(); });
      el.addEventListener('focus', buscar);
      el.addEventListener('blur', function () { setTimeout(fechar, 150); });
    },

    // Liga uma máscara num input; `aoDigitar` (opcional) recebe o valor já
    // formatado a cada tecla — usado p/ disparar a busca de CEP.
    bindMask: function (id, fn, aoDigitar) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', function () {
        el.value = fn(el.value);
        if (aoDigitar) aoDigitar(el.value, el);
      });
    },

    exportCSV: function (nome, linhas) {
      var csv = linhas.map(function (l) {
        return l.map(function (c) { return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"'; }).join(';');
      }).join('\n');
      var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = nome + '.csv';
      document.body.appendChild(a); a.click(); a.remove();
    },

    toast: function (msg, type) {
      var box = document.getElementById('toast');
      if (!box) { box = document.createElement('div'); box.id = 'toast'; document.body.appendChild(box); }
      var el = document.createElement('div');
      el.className = 'toast-item' + (type ? ' toast-' + type : ''); el.textContent = msg;
      box.appendChild(el);
      setTimeout(function () { el.classList.add('out'); setTimeout(function () { el.remove(); }, 400); }, 2600);
    },

    /* ---- SVG: moto esquemática (miniaturas do finder, home, diagramas) ---- */
    bikeSVG: function (highlight, w, opts) {
      opts = opts || {};
      var hl = function (k) { return highlight === k ? ' hl' : ''; };
      var both = highlight === 'wheels';
      return '' +
        '<svg viewBox="0 0 100 88" width="' + (w || 96) + '" class="bike-svg' + (opts.cls ? ' ' + opts.cls : '') + '" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<g fill="none" stroke-linecap="round" stroke-linejoin="round">' +
        '<circle class="bk' + hl('wheelF') + (both ? ' hl' : '') + '" cx="20" cy="68" r="13"/>' +
        '<circle class="bk' + hl('wheelR') + (both ? ' hl' : '') + '" cx="80" cy="68" r="13"/>' +
        '<circle class="bk' + hl('brakeF') + '" cx="20" cy="68" r="5"/>' +
        '<circle class="bk' + hl('brakeR') + '" cx="80" cy="68" r="5"/>' +
        '<path class="bk' + hl('fork') + '" d="M20 68 L33 30"/>' +
        '<path class="bk' + hl('bar') + '" d="M30 28 L40 23 M36 25 L33 19"/>' +
        '<path class="bk' + hl('swing') + '" d="M80 68 L56 60"/>' +
        '<path class="bk' + hl('shock') + '" d="M58 59 L51 38"/>' +
        '<path class="bk' + hl('frame') + '" d="M35 33 L52 36 L56 60 L46 58 L38 44 Z"/>' +
        '<rect class="bk' + hl('engine') + '" x="42" y="48" width="14" height="11" rx="2"/>' +
        '<path class="bk' + hl('exhaust') + '" d="M44 52 C58 44 66 52 76 58"/>' +
        '<path class="bk' + hl('tank') + '" d="M38 33 L52 35 L54 41 L40 40 Z"/>' +
        '<path class="bk' + hl('plastics') + '" d="M12 32 Q20 24 30 27 M64 44 Q72 38 84 46 M40 40 L62 38 L58 30"/>' +
        '</g></svg>';
    }
  };

  FG.init();
  global.FG = FG;
})(typeof window !== 'undefined' ? window : globalThis);
