/**
 * ============================================================================
 *  COLETA DE ABASTECIMENTOS SISATEC -> GOOGLE SHEETS
 * ============================================================================
 *  Puxa TODOS os abastecimentos (sem filtro de placas) da API Sisatec e grava
 *  na aba ABASTECIMENTOS da planilha abaixo. Feito para rodar por acionador.
 *
 *  COMO USAR
 *  1. Na planilha: Extensões > Apps Script. Cole este arquivo inteiro.
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
          // Atualiza a aba POSTOS e o JSON do mapa (ApiMapa.gs), se estiver no projeto
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
    item.latitude, item.longitude, item.status,
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
