/**
 * ============================================================================
 *  API DO MAPA DE ABASTECIMENTOS (Web App)
 * ============================================================================
 *  Agrega a aba ABASTECIMENTOS por posto e publica um JSON para o site do mapa.
 *  Fica no MESMO projeto do ColetaAbastecimentos.gs (usa SPREADSHEET_ID e NOME_ABA de lá).
 *
 *  COMO PUBLICAR
 *  1. Cole este arquivo como um novo script (+ > Script) no mesmo projeto.
 *  2. Execute `atualizarPostos` uma vez (cria as abas POSTOS e IBGE_MUNICIPIOS).
 *  3. Implantar > Nova implantação > tipo "App da Web":
 *       Executar como: Eu  |  Quem pode acessar: Qualquer pessoa
 *     Copie a URL terminada em /exec e cole em site/config.js (API_URL).
 *  4. Abra  <URL>?diag=1  para conferir os nomes de serviço, postos sem
 *     coordenada e cidades sem mesorregião.
 *
 *  Depois disso, `extrairAbastecimentosSisatec` chama `atualizarPostos`
 *  sozinho ao terminar cada coleta. Ao alterar o código, publique uma
 *  nova versão em Implantar > Gerenciar implantações (a URL continua a mesma).
 *
 *  PRIVACIDADE: o JSON nunca leva placa, condutor, CPF, CNH ou número de cartão.
 * ============================================================================
 */

const ABA_POSTOS = 'POSTOS';
const ABA_IBGE = 'IBGE_MUNICIPIOS';
const URL_IBGE_MUNICIPIOS = 'https://servicodados.ibge.gov.br/api/v1/localidades/municipios?view=nivelado';
const CACHE_PREFIXO = 'mapa_postos_v1_';
const CACHE_SEGUNDOS = 6 * 60 * 60;
const CACHE_PEDACO = 90 * 1000; // CacheService aceita até 100 KB por chave
const DIAS_MEDIA = 30;

const UF_POR_NOME = {
  'ACRE': 'AC', 'ALAGOAS': 'AL', 'AMAPA': 'AP', 'AMAZONAS': 'AM', 'BAHIA': 'BA', 'CEARA': 'CE',
  'DISTRITO FEDERAL': 'DF', 'ESPIRITO SANTO': 'ES', 'GOIAS': 'GO', 'MARANHAO': 'MA',
  'MATO GROSSO': 'MT', 'MATO GROSSO DO SUL': 'MS', 'MINAS GERAIS': 'MG', 'PARA': 'PA',
  'PARAIBA': 'PB', 'PARANA': 'PR', 'PERNAMBUCO': 'PE', 'PIAUI': 'PI', 'RIO DE JANEIRO': 'RJ',
  'RIO GRANDE DO NORTE': 'RN', 'RIO GRANDE DO SUL': 'RS', 'RONDONIA': 'RO', 'RORAIMA': 'RR',
  'SANTA CATARINA': 'SC', 'SAO PAULO': 'SP', 'SERGIPE': 'SE', 'TOCANTINS': 'TO'
};

// ---------------------------------------------------------------------------
//  Web App
// ---------------------------------------------------------------------------

function doGet(e) {
  const params = (e && e.parameter) || {};
  if (params.diag === '1') {
    const diag = PropertiesService.getScriptProperties().getProperty('POSTOS_DIAG');
    return respostaJson(diag ? JSON.parse(diag) : { aviso: 'Execute atualizarPostos() primeiro.' });
  }
  const texto = lerCache() || montarRespostaDaAba();
  return ContentService.createTextOutput(texto).setMimeType(ContentService.MimeType.JSON);
}

function respostaJson(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
//  Atualização (chamada pela coleta ou manualmente)
// ---------------------------------------------------------------------------

function atualizarPostos() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const aba = ss.getSheetByName(NOME_ABA);
  if (!aba || aba.getLastRow() < 2) {
    Logger.log('Aba ABASTECIMENTOS vazia; nada para agregar.');
    return;
  }

  const valores = aba.getDataRange().getValues();
  const registros = linhasParaRegistros(valores);
  const mapaIbge = carregarMapaIbge(ss);
  const hoje = Utilities.formatDate(new Date(), FUSO, 'yyyy-MM-dd');
  const resultado = agregarPostos(registros, mapaIbge, hoje);

  gravarAbaPostos(ss, resultado.postos);

  const resposta = {
    geradoEm: Utilities.formatDate(new Date(), FUSO, "yyyy-MM-dd'T'HH:mm:ssXXX"),
    periodoInicio: DATA_INICIO,
    totalPostos: resultado.postos.length,
    postos: resultado.postos
  };
  const texto = JSON.stringify(resposta);
  const props = PropertiesService.getScriptProperties();
  props.setProperty('POSTOS_GERADO_EM', resposta.geradoEm);
  props.setProperty('POSTOS_DIAG', JSON.stringify(limitarDiag(resultado.diag)));
  gravarCache(texto);

  Logger.log(`${resultado.postos.length} postos agregados de ${registros.length} abastecimentos.`);
}

/** Converte a matriz da planilha em objetos, usando o cabeçalho como nome do campo. */
function linhasParaRegistros(valores) {
  const cab = valores[0].map(h => String(h).trim());
  const registros = [];
  for (let i = 1; i < valores.length; i++) {
    const linha = valores[i];
    if (linha[0] === '' || linha[0] === null) continue;
    const r = {};
    cab.forEach((nome, j) => { r[nome] = linha[j]; });
    registros.push(r);
  }
  return registros;
}

// ---------------------------------------------------------------------------
//  Agregação (funções puras — sem APIs do Google)
// ---------------------------------------------------------------------------

/**
 * @param {Object[]} registros  linhas da aba ABASTECIMENTOS como objetos
 * @param {Object} mapaIbge     { 'UF|NOME NORMALIZADO': {mesoId, mesoNome, regiao} }
 * @param {string} hoje         'yyyy-MM-dd'
 */
function agregarPostos(registros, mapaIbge, hoje) {
  const grupos = {};
  const servicos = {};
  const limiteMedia = somarDiasIso(hoje, -DIAS_MEDIA);

  registros.forEach(r => {
    const data = parseDataBR(r.data);
    if (!data) return;
    const hora = normalizarHora(r.hora);
    const uf = normalizarUf(r.estado);
    const cidade = String(r.cidade || '').trim();
    const nomeServico = String(r.nomeServico || '').trim();
    const combustivel = classificarCombustivel(nomeServico);
    servicos[nomeServico || '(vazio)'] = (servicos[nomeServico || '(vazio)'] || 0) + 1;

    const cnpj = String(r.cnpj || '').replace(/\D/g, '');
    const chave = cnpj || normalizarTexto(`${r.posto}|${cidade}|${uf}`);
    let g = grupos[chave];
    if (!g) {
      g = grupos[chave] = { chave: chave, cnpj: cnpj, regs: [] };
    }
    g.regs.push({
      ts: `${data} ${hora}`, data: data, hora: hora, uf: uf, cidade: cidade,
      nome: String(r.posto || '').trim(), razao: String(r.posto_razao || '').trim(),
      endereco: String(r.endereco || '').trim(),
      lat: parseCoord(r.latitude), lng: parseCoord(r.longitude),
      combustivel: combustivel, servico: nomeServico,
      litros: numero(r.quantidadeLitros), valor: numero(r.valor), valorLitro: numero(r.valorLitro)
    });
  });

  const semCoordenada = [];
  const semMesorregiao = {};
  const postos = Object.keys(grupos).map(chave => {
    const g = grupos[chave];
    g.regs.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    const ultimo = g.regs[g.regs.length - 1];
    const comCoord = g.regs.filter(x => x.lat !== null && x.lng !== null);
    const coord = comCoord.length ? comCoord[comCoord.length - 1] : null;

    const ibge = mapaIbge[`${ultimo.uf}|${normalizarTexto(ultimo.cidade)}`];
    if (!ibge) semMesorregiao[`${ultimo.cidade}/${ultimo.uf}`] = true;

    const precos = {};
    ['gasolina', 'dieselS10', 'arla'].forEach(tipo => {
      const regs = g.regs.filter(x => x.combustivel === tipo && precoLitro(x) > 0);
      if (!regs.length) { precos[tipo] = null; return; }
      const u = regs[regs.length - 1];
      const recentes = regs.filter(x => x.data >= limiteMedia && x.litros > 0);
      const litros30 = recentes.reduce((s, x) => s + x.litros, 0);
      const media30 = litros30 > 0
        ? recentes.reduce((s, x) => s + precoLitro(x) * x.litros, 0) / litros30
        : null;
      precos[tipo] = {
        ultimo: arred(precoLitro(u), 3),
        data: u.data,
        servico: u.servico,
        media30d: media30 === null ? null : arred(media30, 3)
      };
    });

    const outros = {};
    g.regs.forEach(x => { if (x.combustivel === 'outros' && x.servico) outros[x.servico] = true; });

    const lat = coord ? coord.lat : null;
    const lng = coord ? coord.lng : null;
    const nome = ultimo.nome || ultimo.razao || 'Posto sem nome';
    if (lat === null) semCoordenada.push(`${nome} (${ultimo.cidade}/${ultimo.uf})`);

    return {
      id: chave,
      nome: nome,
      razao: ultimo.razao,
      cnpj: g.cnpj,
      endereco: ultimo.endereco,
      cidade: ultimo.cidade,
      uf: ultimo.uf,
      mesorregiao: ibge ? ibge.mesoNome : 'Não identificada',
      mesorregiaoId: ibge ? ibge.mesoId : null,
      regiao: ibge ? ibge.regiao : null,
      lat: lat,
      lng: lng,
      ultimo: {
        data: ultimo.data, hora: ultimo.hora, combustivel: ultimo.servico,
        litros: arred(ultimo.litros, 2), valor: arred(ultimo.valor, 2)
      },
      precos: precos,
      outrosServicos: Object.keys(outros),
      totais: {
        abastecimentos: g.regs.length,
        litros: arred(g.regs.reduce((s, x) => s + x.litros, 0), 2),
        valor: arred(g.regs.reduce((s, x) => s + x.valor, 0), 2),
        primeiro: g.regs[0].data
      },
      mapsUrl: lat === null ? linkBuscaMaps(nome, ultimo.endereco, ultimo.cidade, ultimo.uf)
        : `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
      rotaUrl: lat === null ? null : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
    };
  });

  postos.sort((a, b) => (a.uf + a.cidade + a.nome).localeCompare(b.uf + b.cidade + b.nome));

  return {
    postos: postos,
    diag: {
      servicos: Object.keys(servicos).sort().map(s => ({
        nomeServico: s, quantidade: servicos[s], classificadoComo: classificarCombustivel(s)
      })),
      semCoordenada: semCoordenada,
      semMesorregiao: Object.keys(semMesorregiao)
    }
  };
}

/** gasolina | dieselS10 | arla | outros, a partir do texto do serviço. */
function classificarCombustivel(nomeServico) {
  const t = normalizarTexto(nomeServico);
  if (!t) return 'outros';
  if (t.indexOf('ARLA') !== -1) return 'arla';
  if (/\bS ?-? ?10\b/.test(t.replace(/-/g, ' ').replace(/\s+/g, ' ')) || t.indexOf('S10') !== -1) {
    return t.indexOf('DIESEL') !== -1 || t.indexOf('OLEO') !== -1 || /^S ?10$/.test(t) ? 'dieselS10' : 'outros';
  }
  if (t.indexOf('GASOL') !== -1) return 'gasolina';
  return 'outros';
}

function precoLitro(x) {
  if (x.valorLitro > 0) return x.valorLitro;
  if (x.valor > 0 && x.litros > 0) return x.valor / x.litros;
  return 0;
}

/** Date | 'dd/MM/yyyy' | 'yyyy-MM-dd' | 'dd-MM-yyyy' -> 'yyyy-MM-dd' (ou null) */
function parseDataBR(v) {
  if (v === null || v === undefined || v === '') return null;
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return null;
    return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (m) return `${m[3]}-${pad2(m[2])}-${pad2(m[1])}`;
  return null;
}

function normalizarHora(v) {
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    return `${pad2(v.getHours())}:${pad2(v.getMinutes())}`;
  }
  const m = String(v || '').match(/(\d{1,2}):(\d{2})/);
  return m ? `${pad2(m[1])}:${m[2]}` : '00:00';
}

/** '-12,2345' | -12.2345 -> número; vazio, 0 ou fora do Brasil -> null */
function parseCoord(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).trim().replace(',', '.'));
  if (isNaN(n) || n === 0 || Math.abs(n) > 180) return null;
  return Math.round(n * 1e6) / 1e6;
}

function normalizarUf(v) {
  const t = normalizarTexto(v);
  if (t.length === 2) return t;
  return UF_POR_NOME[t] || t;
}

function normalizarTexto(v) {
  return String(v === null || v === undefined ? '' : v)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’'`´]/g, '')
    .toUpperCase().replace(/[^A-Z0-9|]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function numero(v) {
  if (typeof v === 'number') return v;
  if (v === null || v === undefined || v === '') return 0;
  let s = String(v).trim();
  if (s.indexOf(',') !== -1) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function arred(n, casas) {
  const f = Math.pow(10, casas);
  return Math.round(n * f) / f;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function somarDiasIso(iso, dias) {
  const p = iso.split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + dias));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function linkBuscaMaps(nome, endereco, cidade, uf) {
  const q = [nome, endereco, cidade, uf].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

function limitarDiag(diag) {
  // Propriedades do script aceitam ~9 KB por valor
  const d = {
    servicos: diag.servicos.slice(0, 60),
    semCoordenada: diag.semCoordenada.slice(0, 40),
    totalSemCoordenada: diag.semCoordenada.length,
    semMesorregiao: diag.semMesorregiao.slice(0, 40),
    totalSemMesorregiao: diag.semMesorregiao.length
  };
  while (JSON.stringify(d).length > 8500 && d.semCoordenada.length) d.semCoordenada.pop();
  while (JSON.stringify(d).length > 8500 && d.semMesorregiao.length) d.semMesorregiao.pop();
  return d;
}

// ---------------------------------------------------------------------------
//  IBGE (mesorregiões)
// ---------------------------------------------------------------------------

/** Lê a tabela de municípios da aba oculta; baixa do IBGE na primeira vez. */
function carregarMapaIbge(ss) {
  let aba = ss.getSheetByName(ABA_IBGE);
  if (!aba || aba.getLastRow() < 2) {
    aba = baixarMunicipiosIbge(ss);
  }
  const mapa = {};
  if (!aba) return mapa;
  aba.getRange(2, 1, aba.getLastRow() - 1, 4).getValues().forEach(r => {
    mapa[r[0]] = { mesoId: r[1], mesoNome: r[2], regiao: r[3] };
  });
  return mapa;
}

function baixarMunicipiosIbge(ss) {
  const resp = UrlFetchApp.fetch(URL_IBGE_MUNICIPIOS, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) {
    Logger.log('IBGE indisponível (HTTP ' + resp.getResponseCode() + '); mesorregiões ficam para a próxima execução.');
    return null;
  }
  const lista = JSON.parse(resp.getContentText());
  const linhas = lista.map(m => [
    `${m['UF-sigla']}|${normalizarTexto(m['municipio-nome'])}`,
    m['mesorregiao-id'], m['mesorregiao-nome'], m['regiao-nome']
  ]);
  let aba = ss.getSheetByName(ABA_IBGE) || ss.insertSheet(ABA_IBGE);
  aba.clear();
  aba.getRange(1, 1, 1, 4).setValues([['chave', 'mesorregiao_id', 'mesorregiao', 'regiao']]);
  aba.getRange(2, 1, linhas.length, 4).setValues(linhas);
  aba.hideSheet();
  return aba;
}

// ---------------------------------------------------------------------------
//  Aba POSTOS + cache
// ---------------------------------------------------------------------------

function gravarAbaPostos(ss, postos) {
  const aba = ss.getSheetByName(ABA_POSTOS) || ss.insertSheet(ABA_POSTOS);
  const cab = ['id', 'nome', 'cidade', 'uf', 'mesorregiao', 'latitude', 'longitude',
    'ultimo_abastecimento', 'gasolina', 'gasolina_data', 'diesel_s10', 'diesel_s10_data',
    'arla', 'arla_data', 'abastecimentos', 'google_maps', 'json'];
  const p = (x, k) => (x ? x[k] : '');
  const linhas = postos.map(x => [
    x.id, x.nome, x.cidade, x.uf, x.mesorregiao, x.lat === null ? '' : x.lat, x.lng === null ? '' : x.lng,
    `${x.ultimo.data} ${x.ultimo.hora}`,
    p(x.precos.gasolina, 'ultimo'), p(x.precos.gasolina, 'data'),
    p(x.precos.dieselS10, 'ultimo'), p(x.precos.dieselS10, 'data'),
    p(x.precos.arla, 'ultimo'), p(x.precos.arla, 'data'),
    x.totais.abastecimentos, x.mapsUrl, JSON.stringify(x)
  ]);
  aba.clearContents();
  aba.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold');
  aba.setFrozenRows(1);
  if (linhas.length) {
    aba.getRange(2, 1, linhas.length, 1).setNumberFormat('@');
    aba.getRange(2, 1, linhas.length, cab.length).setValues(linhas);
  }
}

function montarRespostaDaAba() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const aba = ss.getSheetByName(ABA_POSTOS);
  const postos = [];
  if (aba && aba.getLastRow() > 1) {
    const colJson = aba.getLastColumn();
    aba.getRange(2, colJson, aba.getLastRow() - 1, 1).getValues().forEach(r => {
      if (r[0]) postos.push(JSON.parse(r[0]));
    });
  }
  const texto = JSON.stringify({
    geradoEm: PropertiesService.getScriptProperties().getProperty('POSTOS_GERADO_EM'),
    periodoInicio: DATA_INICIO,
    totalPostos: postos.length,
    postos: postos
  });
  gravarCache(texto);
  return texto;
}

function gravarCache(texto) {
  try {
    const cache = CacheService.getScriptCache();
    const pedacos = {};
    let n = 0;
    for (let i = 0; i < texto.length; i += CACHE_PEDACO) {
      pedacos[CACHE_PREFIXO + n] = texto.slice(i, i + CACHE_PEDACO);
      n++;
    }
    pedacos[CACHE_PREFIXO + 'n'] = String(n);
    cache.putAll(pedacos, CACHE_SEGUNDOS);
  } catch (e) {
    Logger.log('Cache não gravado (resposta grande demais?): ' + e);
  }
}

function lerCache() {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get(CACHE_PREFIXO + 'n'));
  if (!n) return null;
  const chaves = [];
  for (let i = 0; i < n; i++) chaves.push(CACHE_PREFIXO + i);
  const vals = cache.getAll(chaves);
  let texto = '';
  for (let i = 0; i < n; i++) {
    if (vals[chaves[i]] === undefined) return null;
    texto += vals[chaves[i]];
  }
  return texto;
}
