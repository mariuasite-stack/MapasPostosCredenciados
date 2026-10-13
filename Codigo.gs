/**
 * ============================================================================
 *  MAPA DE ABASTECIMENTOS — Apps Script (arquivo único)
 * ============================================================================
 *  Parte 1 — COLETA: puxa TODOS os abastecimentos (sem filtro de placas) da
 *            API Sisatec e grava na aba ABASTECIMENTOS. Roda por acionador.
 *  Parte 2 — API DO MAPA: agrega a aba por posto e publica o JSON do site.
 *
 *  COMO USAR
 *  1. Na planilha: Extensões > Apps Script. Cole este arquivo inteiro no
 *     Código.gs (apague os outros .gs do projeto, se houver).
 *  2. Selecione a função `configurarCredenciais` e clique em Executar
 *     (autorize o acesso quando pedir). Depois disso, pode apagar a chave
 *     de dentro da função — ela fica salva nas Propriedades do script.
 *  3. Selecione `extrairAbastecimentosSisatec` e clique em Executar.
 *     A primeira carga (desde 01/10/2025) pode levar várias execuções:
 *     cada uma para em ~5 min, salva o progresso e a próxima continua.
 *  4. Acionadores (ícone de relógio) > Adicionar acionador:
 *       Função: extrairAbastecimentosSisatec
 *       Origem do evento: Baseado no tempo
 *       Frequência: a sua escolha
 *
 *  Para recomeçar do zero: limpe a aba e execute `resetarColeta`.
 * ============================================================================
 */

const SPREADSHEET_ID = '1-mpMfq3hBAB6fyYA6QNF_1lnTjCqdY-FNwooan3mnLo';
const NOME_ABA = 'ABASTECIMENTOS';
const DATA_INICIO = '2025-10-01';       // yyyy-MM-dd — início da carga completa
const DIAS_POR_BLOCO = 20;              // tamanho da janela de datas por consulta
const TEMPO_MAX_MS = 5 * 60 * 1000;     // para antes do limite de 6 min do Apps Script
const FUSO = 'America/Sao_Paulo';
const PROP_ESTADO = 'ESTADO_COLETA';

const CABECALHO = [
  'codAbastecimento', 'data', 'hora', 'placa', 'posto', 'posto_razao',
  'endereco', 'estado', 'cidade', 'cnpj', 'cod_terminal',
  'latitude', 'longitude', 'status',
  'valor', 'valorLitro', 'quantidadeLitros',
  'tipo_servico', 'nomeServico', 'prefixo', 'modelo', 'marca',
  'ano_veiculo', 'cor', 'chassi', 'renavam', 'capacidade_tanque',
  'centroDeCustoVeiculo', 'kmAtual', 'kmAnterior',
  'KmHoraRodado', 'KmHoraPorLitro', 'EmissaoCO2',
  'condutor', 'cpfcondutor', 'cnhcondutor', 'registroCondutor',
  'matricula_condutor', 'centroDeCustoCondutor', 'numeroCartao',
  'UltimaObservacaoAbastecimento'
];

/** Rode UMA vez para salvar as credenciais. Depois pode apagar os valores daqui. */
function configurarCredenciais() {
  PropertiesService.getScriptProperties().setProperties({
    SISATEC_CODIGO: '12845',
    SISATEC_KEY: 'F628A9CF612C993E6F6A9DD87CD411786D7E2AF9'
  });
  Logger.log('Credenciais salvas nas Propriedades do script.');
}

/** Apaga o progresso salvo. Use depois de limpar a aba para recarregar tudo. */
function resetarColeta() {
  PropertiesService.getScriptProperties().deleteProperty(PROP_ESTADO);
  Logger.log('Progresso apagado. A próxima execução começa em ' + DATA_INICIO + '.');
}

/** Função principal — é ela que o acionador deve chamar. */
function extrairAbastecimentosSisatec() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10 * 1000)) {
    Logger.log('Outra execução ainda está rodando. Saindo.');
    return;
  }

  try {
    const inicioExecucao = Date.now();
    const props = PropertiesService.getScriptProperties();
    const codigo = props.getProperty('SISATEC_CODIGO');
    const key = props.getProperty('SISATEC_KEY');
    if (!codigo || !key) {
      throw new Error('Credenciais ausentes. Execute configurarCredenciais() primeiro.');
    }

    const aba = obterAba();
    const idsExistentes = lerIdsExistentes(aba);
    const estado = lerEstado(props);
    const hoje = Utilities.formatDate(new Date(), FUSO, 'yyyy-MM-dd');
    let novasLinhas = [];

    const salvar = () => {
      if (novasLinhas.length > 0) {
        aba.getRange(aba.getLastRow() + 1, 1, novasLinhas.length, CABECALHO.length).setValues(novasLinhas);
        Logger.log(`${novasLinhas.length} registros gravados.`);
        novasLinhas = [];
      }
      props.setProperty(PROP_ESTADO, JSON.stringify(estado));
    };

    while (true) {
      if (Date.now() - inicioExecucao > TEMPO_MAX_MS) {
        salvar();
        Logger.log('Tempo limite atingido. A próxima execução continua de onde parou.');
        return;
      }

      // Abre um novo bloco de datas se não houver um pendente
      if (!estado.bloco) {
        const ini = estado.proximaData;
        let fim = somarDias(ini, DIAS_POR_BLOCO - 1);
        if (fim > hoje) fim = hoje;
        estado.bloco = { ini: ini, fim: fim, pagina: 1 };
        Logger.log(`Buscando: ${ini} até ${fim}`);
      }

      const bloco = estado.bloco;
      const lista = buscarPagina(codigo, key, bloco.ini, bloco.fim, bloco.pagina);
      if (lista === null) {
        // Erro na API: salva o que já tem e tenta este mesmo bloco/página na próxima execução
        salvar();
        return;
      }

      lista.forEach(item => {
        const id = String(item.codAbastecimento);
        if (!idsExistentes.has(id)) {
          novasLinhas.push(montarLinha(item));
          idsExistentes.add(id);
        }
      });

      if (lista.length === 0 || lista.length < 10) {
        // Bloco concluído
        const chegouEmHoje = bloco.fim >= hoje;
        // Ao alcançar hoje, recua 1 dia para pegar lançamentos atrasados na próxima execução
        estado.proximaData = chegouEmHoje ? somarDias(bloco.fim, -1) : somarDias(bloco.fim, 1);
        estado.bloco = null;
        salvar();
        if (chegouEmHoje) {
          Logger.log('Processo concluído. Tudo atualizado.');
          // Atualiza a aba POSTOS e o JSON do mapa (Parte 2)
          if (typeof atualizarPostos === 'function') {
            try {
              atualizarPostos();
            } catch (e) {
              Logger.log('Falha ao atualizar POSTOS: ' + e);
            }
          }
          return;
        }
      } else {
        bloco.pagina++;
        Utilities.sleep(200); // pausa para não sobrecarregar a API
      }
    }
  } finally {
    lock.releaseLock();
  }
}

/** Retorna a lista de abastecimentos da página, ou null em caso de erro. */
function buscarPagina(codigo, key, ini, fim, pagina) {
  const url = 'https://ws.sisatec.com.br/api/abastecimento/novo/bydata'
    + `?codigo=${encodeURIComponent(codigo)}&key=${encodeURIComponent(key)}`
    + `&data1=${formatarDataApi(ini)}&data2=${formatarDataApi(fim)}`
    + `&status=1&tipo_posto=1&tipo_servico=1&pagina=${pagina}`;

  try {
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const httpCode = response.getResponseCode();
    if (httpCode !== 200) {
      Logger.log(`Erro HTTP ${httpCode} em ${ini}..${fim} página ${pagina}: ${response.getContentText().slice(0, 300)}`);
      return null;
    }
    const json = JSON.parse(response.getContentText());
    return json.abastecimentos || [];
  } catch (e) {
    Logger.log(`Falha ao consultar ${ini}..${fim} página ${pagina}: ${e}`);
    return null;
  }
}

function montarLinha(item) {
  return [
    String(item.codAbastecimento), item.data, item.hora, String(item.placa || '').toUpperCase().trim(),
    item.posto, item.posto_razao,
    item.endereco, item.estado, item.cidade, item.cnpj, item.cod_terminal,
    converterCoord(item.latitude), converterCoord(item.longitude), item.status,
    converterValor(item.valor), converterValor(item.valorLitro), converterValor(item.quantidadeLitros),
    item.tipo_servico, item.nomeServico, item.prefixo, item.modelo, item.marca,
    item.ano_veiculo, item.cor, item.chassi, item.renavam, item.capacidade_tanque,
    item.centroDeCustoVeiculo, converterValor(item.kmAtual), converterValor(item.kmAnterior),
    item.KmHoraRodado, item.KmHoraPorLitro, converterValor(item.EmissaoCO2),
    item.condutor, item.cpfcondutor, item.cnhcondutor, item.registroCondutor,
    item.matricula_condutor, item.centroDeCustoCondutor, item.numeroCartao,
    item.UltimaObservacaoAbastecimento
  ].map(v => (v === null || v === undefined ? '' : v));
}

/** Converte "1.234,56", "12.5", 12.5 etc. em número. Se não der, devolve o texto original. */
function converterValor(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return v;
  let s = String(v).trim();
  if (s === '') return '';
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? String(v) : n;
}

/**
 * Coordenada como número. A API manda texto ("-12.316062"); gravado como texto,
 * a planilha em pt-BR lê o ponto como milhar e vira -12316062.
 */
function converterCoord(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).trim().replace(',', '.'));
  return isNaN(n) ? '' : n;
}

function obterAba() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let aba = ss.getSheetByName(NOME_ABA);
  if (!aba) aba = ss.insertSheet(NOME_ABA);
  if (aba.getLastRow() === 0) {
    aba.getRange(1, 1, 1, CABECALHO.length).setValues([CABECALHO]).setFontWeight('bold');
    aba.setFrozenRows(1);
    aba.getRange('A:A').setNumberFormat('@'); // ID como texto
  }
  return aba;
}

function lerIdsExistentes(aba) {
  const ids = new Set();
  const ultimaLinha = aba.getLastRow();
  if (ultimaLinha > 1) {
    aba.getRange(2, 1, ultimaLinha - 1, 1).getValues().forEach(r => {
      if (r[0] !== '') ids.add(String(r[0]));
    });
  }
  return ids;
}

function lerEstado(props) {
  const bruto = props.getProperty(PROP_ESTADO);
  if (bruto) {
    try {
      return JSON.parse(bruto);
    } catch (e) {
      Logger.log('Estado salvo inválido, recomeçando do início.');
    }
  }
  return { proximaData: DATA_INICIO, bloco: null };
}

/** Soma dias a uma data 'yyyy-MM-dd' e devolve no mesmo formato. */
function somarDias(dataStr, dias) {
  const p = dataStr.split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + dias));
  return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
}

/** 'yyyy-MM-dd' -> 'MM-dd-yyyy' (formato da API Sisatec) */
function formatarDataApi(dataStr) {
  const p = dataStr.split('-');
  return `${p[1]}-${p[2]}-${p[0]}`;
}


/**
 * ============================================================================
 *  PARTE 2 — API DO MAPA DE ABASTECIMENTOS (Web App)
 * ============================================================================
 *  Agrega a aba ABASTECIMENTOS por posto e publica um JSON para o site do mapa.
 *  Usa SPREADSHEET_ID e NOME_ABA da Parte 1.
 *
 *  COMO PUBLICAR
 *  1. Execute `atualizarPostos` uma vez (cria as abas POSTOS, POSTOS_AJUSTES e IBGE_CIDADES).
 *  2. Implantar > Nova implantação > tipo "App da Web":
 *       Executar como: Eu  |  Quem pode acessar: Qualquer pessoa
 *     Copie a URL terminada em /exec e cole em docs/config.js (API_URL).
 *  3. Abra  <URL>?diag=1  para conferir os nomes de serviço, postos sem
 *     coordenada e postos cuja cidade não foi reconhecida.
 *
 *  Depois disso, `extrairAbastecimentosSisatec` chama `atualizarPostos`
 *  sozinho ao terminar cada coleta. Ao alterar o código, publique uma
 *  nova versão em Implantar > Gerenciar implantações (a URL continua a mesma).
 *
 *  AJUSTES MANUAIS: a aba POSTOS_AJUSTES lista cada posto. Nela você pode
 *  corrigir a cidade e colar o link do Google Maps (o de "Compartilhar",
 *  maps.app.goo.gl/...). Quando a Sisatec não manda a cidade, ela é
 *  preenchida pela coordenada. A aba é preservada a cada atualização.
 *
 *  PRIVACIDADE: o JSON nunca leva placa, condutor, CPF, CNH, número de cartão,
 *  litros, valores gastos nem quantidade de abastecimentos.
 * ============================================================================
 */

const ABA_POSTOS = 'POSTOS';
const ABA_IBGE = 'IBGE_CIDADES';
const ABA_AJUSTES = 'POSTOS_AJUSTES';
const GEOCODIFICAR_POR_EXECUCAO = 60;   // consultas de cidade pela coordenada por execução
const URL_IBGE_MUNICIPIOS = 'https://servicodados.ibge.gov.br/api/v1/localidades/municipios?view=nivelado';
const CACHE_PREFIXO = 'mapa_postos_v2_';
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
  const ajustes = lerAjustes(ss);
  const hoje = Utilities.formatDate(new Date(), FUSO, 'yyyy-MM-dd');
  const resultado = agregarPostos(registros, mapaIbge, hoje, ajustes);

  completarCidades(ss, resultado.postos, ajustes, mapaIbge);
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
 * @param {Object} mapaIbge     { 'UF|NOME NORMALIZADO': {id, nome} }
 * @param {string} hoje         'yyyy-MM-dd'
 * @param {Object} ajustes      { id: {cidade, link} } da aba POSTOS_AJUSTES
 */
function agregarPostos(registros, mapaIbge, hoje, ajustes) {
  ajustes = ajustes || {};
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
  const semCidade = [];
  const postos = Object.keys(grupos).map(chave => {
    const g = grupos[chave];
    g.regs.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    const ultimo = g.regs[g.regs.length - 1];
    // Último abastecimento de combustível (ARLA não conta)
    const semArla = g.regs.filter(x => x.combustivel !== 'arla');
    const ultimoComb = semArla.length ? semArla[semArla.length - 1] : ultimo;
    const comCoord = g.regs.filter(x => x.lat !== null && x.lng !== null);
    const coord = comCoord.length ? comCoord[comCoord.length - 1] : null;

    const ajuste = ajustes[chave] || {};
    const cidadeBruta = ajuste.cidade || ultimo.cidade;
    const ibge = cidadeIbge(mapaIbge, ultimo.uf, cidadeBruta);
    const cidade = ibge ? ibge.nome : cidadeBruta;

    const precos = {};
    ['gasolina', 'dieselS10'].forEach(tipo => {
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

    const lat = coord ? coord.lat : null;
    const lng = coord ? coord.lng : null;
    const nome = ultimo.nome || ultimo.razao || 'Posto sem nome';
    if (lat === null) semCoordenada.push(`${nome} (${cidade || '?'}/${ultimo.uf})`);

    return {
      id: chave,
      nome: nome,
      razao: ultimo.razao,
      cnpj: g.cnpj,
      endereco: ultimo.endereco,
      cidade: cidade,
      cidadeId: ibge ? ibge.id : null,
      uf: ultimo.uf,
      lat: lat,
      lng: lng,
      ultimo: { data: ultimoComb.data, hora: ultimoComb.hora, combustivel: ultimoComb.servico },
      precos: precos,
      mapsUrl: linkMaps(ajuste.link, nome, lat, lng, ultimo.endereco, cidade, ultimo.uf),
      rotaUrl: lat === null ? null : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
    };
  });

  postos.forEach(p => { if (!p.cidadeId) semCidade.push(`${p.nome}: "${p.cidade}"/${p.uf}`); });

  postos.sort((a, b) => (a.uf + a.cidade + a.nome).localeCompare(b.uf + b.cidade + b.nome));

  return {
    postos: postos,
    diag: {
      servicos: Object.keys(servicos).sort().map(s => ({
        nomeServico: s, quantidade: servicos[s], classificadoComo: classificarCombustivel(s)
      })),
      semCoordenada: semCoordenada,
      semCidade: semCidade
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

/**
 * Link do Google Maps do posto: o colado na aba POSTOS_AJUSTES; senão, a busca
 * pelo nome ao redor da coordenada (abre a ficha do posto quando o Google o conhece).
 */
function linkMaps(linkManual, nome, lat, lng, endereco, cidade, uf) {
  if (linkManual) return linkManual;
  if (lat !== null) return `https://www.google.com/maps/search/${encodeURIComponent(nome)}/@${lat},${lng},17z`;
  return linkBuscaMaps(nome, endereco, cidade, uf);
}

function cidadeIbge(mapaIbge, uf, cidade) {
  return cidade ? mapaIbge[`${uf}|${normalizarTexto(cidade)}`] || null : null;
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
    semCidade: diag.semCidade.slice(0, 40),
    totalSemCidade: diag.semCidade.length
  };
  while (JSON.stringify(d).length > 8500 && d.semCoordenada.length) d.semCoordenada.pop();
  while (JSON.stringify(d).length > 8500 && d.semCidade.length) d.semCidade.pop();
  return d;
}

// ---------------------------------------------------------------------------
//  IBGE (municípios) e ajustes por posto
// ---------------------------------------------------------------------------

/** Lê a tabela de municípios da aba oculta; baixa do IBGE na primeira vez. */
function carregarMapaIbge(ss) {
  let aba = ss.getSheetByName(ABA_IBGE);
  if (!aba || aba.getLastRow() < 2) {
    aba = baixarMunicipiosIbge(ss);
  }
  const mapa = {};
  if (!aba) return mapa;
  aba.getRange(2, 1, aba.getLastRow() - 1, 3).getValues().forEach(r => {
    mapa[r[0]] = { id: Number(r[1]), nome: String(r[2]) };
  });
  return mapa;
}

function baixarMunicipiosIbge(ss) {
  const resp = UrlFetchApp.fetch(URL_IBGE_MUNICIPIOS, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) {
    Logger.log('IBGE indisponível (HTTP ' + resp.getResponseCode() + '); cidades ficam para a próxima execução.');
    return null;
  }
  const lista = JSON.parse(resp.getContentText());
  const linhas = lista.map(m => [
    `${m['UF-sigla']}|${normalizarTexto(m['municipio-nome'])}`,
    m['municipio-id'], m['municipio-nome']
  ]);
  let aba = ss.getSheetByName(ABA_IBGE) || ss.insertSheet(ABA_IBGE);
  aba.clear();
  aba.getRange(1, 1, 1, 3).setValues([['chave', 'municipio_id', 'municipio']]);
  aba.getRange(2, 1, linhas.length, 3).setValues(linhas);
  aba.hideSheet();
  return aba;
}

/** { id: {cidade, link} } da aba POSTOS_AJUSTES (editável à mão). */
function lerAjustes(ss) {
  const aba = ss.getSheetByName(ABA_AJUSTES);
  const ajustes = {};
  if (!aba || aba.getLastRow() < 2) return ajustes;
  aba.getRange(2, 1, aba.getLastRow() - 1, 5).getValues().forEach((r, i) => {
    const id = String(r[0]).trim();
    if (!id) return;
    const link = String(r[4] || '').trim();
    ajustes[id] = { linha: i + 2, cidade: String(r[3] || '').trim(), link: /^https?:\/\//.test(link) ? link : '' };
  });
  return ajustes;
}

/**
 * Acrescenta postos novos à aba POSTOS_AJUSTES e, quando a Sisatec não manda
 * a cidade, descobre pela coordenada. O que você digitou na aba é mantido.
 */
function completarCidades(ss, postos, ajustes, mapaIbge) {
  let aba = ss.getSheetByName(ABA_AJUSTES);
  if (!aba) {
    aba = ss.insertSheet(ABA_AJUSTES);
    aba.getRange(1, 1, 1, 5).setValues([['id', 'posto', 'uf', 'cidade', 'link_google_maps']]).setFontWeight('bold');
    aba.setFrozenRows(1);
    aba.getRange('A:A').setNumberFormat('@');
    aba.getRange('D1').setNote('Preenchida pela coordenada quando a Sisatec não manda. Pode corrigir à mão.');
    aba.getRange('E1').setNote('Cole aqui o link do Google Maps do posto (botão Compartilhar). Ele passa a ser o link do site.');
  }
  let consultas = 0;
  const novas = [];
  postos.forEach(p => {
    const a = ajustes[p.id];
    if (!p.cidadeId && p.lat !== null && !(a && a.cidade) && consultas < GEOCODIFICAR_POR_EXECUCAO) {
      consultas++;
      const ibge = cidadeIbge(mapaIbge, p.uf, cidadePelaCoordenada(p.lat, p.lng));
      if (ibge) {
        p.cidade = ibge.nome;
        p.cidadeId = ibge.id;
        if (a) aba.getRange(a.linha, 4).setValue(ibge.nome);
      }
    }
    if (!a) novas.push([p.id, p.nome, p.uf, p.cidadeId ? p.cidade : '', '']);
  });
  if (novas.length) aba.getRange(aba.getLastRow() + 1, 1, novas.length, 5).setValues(novas);
  if (consultas) Logger.log(`${consultas} cidades consultadas pela coordenada.`);
}

/** Nome do município para uma coordenada (geocodificador do Google), ou ''. */
function cidadePelaCoordenada(lat, lng) {
  try {
    const r = Maps.newGeocoder().setLanguage('pt-BR').setRegion('br').reverseGeocode(lat, lng);
    if (!r || r.status !== 'OK') return '';
    for (const res of r.results) {
      const c = (res.address_components || []).find(x => x.types.indexOf('administrative_area_level_2') !== -1);
      if (c) return c.long_name;
    }
  } catch (e) {
    Logger.log('Geocodificação falhou: ' + e);
  }
  return '';
}

// ---------------------------------------------------------------------------
//  Aba POSTOS + cache
// ---------------------------------------------------------------------------

function gravarAbaPostos(ss, postos) {
  const aba = ss.getSheetByName(ABA_POSTOS) || ss.insertSheet(ABA_POSTOS);
  const cab = ['id', 'nome', 'cidade', 'uf', 'latitude', 'longitude',
    'ultimo_abastecimento', 'gasolina', 'gasolina_data', 'diesel_s10', 'diesel_s10_data',
    'google_maps', 'json'];
  const p = (x, k) => (x ? x[k] : '');
  const linhas = postos.map(x => [
    x.id, x.nome, x.cidade, x.uf, x.lat === null ? '' : x.lat, x.lng === null ? '' : x.lng,
    `${x.ultimo.data} ${x.ultimo.hora}`,
    p(x.precos.gasolina, 'ultimo'), p(x.precos.gasolina, 'data'),
    p(x.precos.dieselS10, 'ultimo'), p(x.precos.dieselS10, 'data'),
    x.mapsUrl, JSON.stringify(x)
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
