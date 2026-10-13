/* Mapa de Abastecimentos — app.js (sem build, sem framework) */
(function () {
  'use strict';

  const CFG = Object.assign({
    API_URL: '', TITULO: 'Mapa de Abastecimentos', LOGO: '', COMBUSTIVEL_PADRAO: 'dieselS10', DIAS_SEM_USO: 90
  }, window.MAPA_CONFIG || {});

  const COMBUSTIVEIS = { gasolina: 'Gasolina', dieselS10: 'Diesel S10' };
  const UF_CODIGO = { RO: 11, AC: 12, AM: 13, RR: 14, PA: 15, AP: 16, TO: 17, MA: 21, PI: 22, CE: 23, RN: 24, PB: 25, PE: 26, AL: 27, SE: 28, BA: 29, MG: 31, ES: 32, RJ: 33, SP: 35, PR: 41, SC: 42, RS: 43, MS: 50, MT: 51, GO: 52, DF: 53 };
  const UF_NOME = { AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins' };
  const IBGE = 'https://servicodados.ibge.gov.br/api';
  const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/';
  const TILES = {
    claro: { base: ESRI + 'World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', ref: ESRI + 'World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}' },
    escuro: { base: ESRI + 'World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', ref: ESRI + 'World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}' }
  };
  const ESRI_SRV = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
  /** Fundos do mapa: "mapa" (cinza, segue o tema) e "satelite" (imagem + ruas + nomes). */
  const FUNDOS = {
    mapa: tema => ({
      base: TILES[tema].base, refs: [TILES[tema].ref], nativo: 16, escurecer: tema === 'escuro',
      atrib: 'Mapa &copy; <a href="https://www.esri.com">Esri</a>, HERE, Garmin, &copy; OpenStreetMap · Malhas IBGE',
      atribTexto: 'Mapa © Esri, HERE, Garmin, © OpenStreetMap'
    }),
    satelite: () => ({
      base: ESRI_SRV + 'World_Imagery/MapServer/tile/{z}/{y}/{x}',
      refs: [ESRI_SRV + 'Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', ESRI_SRV + 'Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
      nativo: 18, escurecer: false,
      atrib: 'Imagens &copy; <a href="https://www.esri.com">Esri</a>, Maxar, Earthstar Geographics · Malhas IBGE',
      atribTexto: 'Imagens © Esri, Maxar, Earthstar Geographics · Rótulos © Esri'
    })
  };
  const ZOOM_ROTULOS = 9;

  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const el = {
    status: $('#status'), statusMovel: $('#status-movel'), lista: $('#lista'), busca: $('#busca'), buscaLimpar: $('#busca-limpar'),
    sugestoes: $('#sugestoes'), chips: $('#chips'), resumo: $('#resumo'), ordem: $('#ordem'), legenda: $('#legenda'),
    detalhe: $('#detalhe'), painel: $('#painel'), alca: $('#painel-alca'), toast: $('#toast'),
    btnTema: $('#btn-tema'), btnPerto: $('#btn-perto'), btnCaptura: $('#btn-captura'),
    captura: $('#captura'), capturaRet: $('#captura-ret'), capturaDica: $('#captura-dica'),
    capturaBarra: $('#captura-barra'), capturaMedida: $('#captura-medida'), logo: $('#logo'),
    aviso: $('#aviso-exemplo'), mapa: $('#mapa')
  };

  const estado = {
    dados: null, postos: [], porId: {}, cidades: new Map(),
    aba: 'posto', busca: '', periodo: 'tudo', combustivel: CFG.COMBUSTIVEL_PADRAO in COMBUSTIVEIS ? CFG.COMBUSTIVEL_PADRAO : 'dieselS10',
    uf: null, cidade: null, selecionado: null, ordem: 'recente',
    usuario: null, filtrados: [], faixa: null
  };

  // ---------------------------------------------------------------- utilidades
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const preco = n => (n === null || n === undefined) ? '—' : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const inteiro = n => Math.round(n).toLocaleString('pt-BR');
  const dataBR = iso => { if (!iso) return '—'; const p = iso.slice(0, 10).split('-'); return `${p[2]}/${p[1]}/${p[0]}`; };
  const dataCurta = iso => { if (!iso) return '—'; const p = iso.slice(0, 10).split('-'); return `${p[2]}/${p[1]}`; };
  const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hojeIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  function diasDesde(iso) {
    if (!iso) return Infinity;
    const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
    const h = hojeIso().split('-').map(Number);
    return Math.round((Date.UTC(h[0], h[1] - 1, h[2]) - Date.UTC(a, m - 1, d)) / 864e5);
  }
  function quando(iso) {
    const n = diasDesde(iso);
    if (n <= 0) return 'hoje';
    if (n === 1) return 'ontem';
    if (n < 31) return `há ${n} dias`;
    return dataBR(iso);
  }
  function distanciaKm(a, b) {
    const R = 6371, rad = x => x * Math.PI / 180;
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const plural = (n, um, varios) => `${inteiro(n)} ${n === 1 ? um : varios}`;
  function nomeServico(t) {
    const n = norm(t).toUpperCase();
    if (!n) return '—';
    if (/S ?-?10\b/.test(n)) return 'Diesel S10';
    if (/S ?-?500\b/.test(n)) return 'Diesel S500';
    return String(t).toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());
  }
  const km = d => d < 10 ? `${d.toFixed(1).replace('.', ',')} km` : `${Math.round(d)} km`;
  const cnpjFmt = c => { const d = String(c || '').replace(/\D/g, ''); return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : (c || '—'); };
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* armazenamento indisponível */ } }
  };
  let toastTimer;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('visivel');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('visivel'), 2800);
  }
  const espera = ms => new Promise(r => setTimeout(r, ms));
  const ehCelular = () => matchMedia('(max-width: 760px)').matches;
  const temHover = () => matchMedia('(hover: hover) and (pointer: fine)').matches;
  const precoDe = (p, tipo) => (p.precos && p.precos[tipo]) ? p.precos[tipo].ultimo : null;
  const inativo = p => diasDesde(p.ultimo && p.ultimo.data) > CFG.DIAS_SEM_USO;
  const nomeCidade = p => p.cidade || 'Cidade não informada';
  const chaveCidade = p => `${p.uf}|${p._cidade}`;

  /** Marca em <mark> os trechos do texto que batem com os termos (sem acento). */
  function realcar(texto, termos) {
    const t = String(texto || '');
    if (!termos.length) return esc(t);
    const n = t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const marcas = new Array(t.length).fill(false);
    termos.forEach(q => {
      let i = n.indexOf(q);
      while (q && i !== -1) { for (let k = i; k < i + q.length; k++) marcas[k] = true; i = n.indexOf(q, i + q.length); }
    });
    // norm() preserva o comprimento para letras latinas comuns; se não, desiste do realce
    if (n.length !== t.length) return esc(t);
    let out = '', aberto = false;
    for (let k = 0; k < t.length; k++) {
      if (marcas[k] && !aberto) { out += '<mark>'; aberto = true; }
      if (!marcas[k] && aberto) { out += '</mark>'; aberto = false; }
      out += esc(t[k]);
    }
    return out + (aberto ? '</mark>' : '');
  }

  // ---------------------------------------------------------------- tema
  function aplicarTema(tema) {
    document.documentElement.dataset.theme = tema;
    const escuro = tema === 'escuro';
    el.btnTema.innerHTML = `<svg class="ic"><use href="#i-${escuro ? 'sol' : 'lua'}"/></svg>`;
    el.btnTema.setAttribute('aria-label', escuro ? 'Usar tema claro' : 'Usar tema escuro');
    $('meta[name="theme-color"]').setAttribute('content', escuro ? '#202428' : '#FFFFFF');
    if (typeof aplicarFundo === 'function' && mapa) aplicarFundo();
    if (camadaCidades) camadaCidades.setStyle(estiloCidade);
  }
  el.btnTema.addEventListener('click', () => {
    const novo = document.documentElement.dataset.theme === 'escuro' ? 'claro' : 'escuro';
    ls.set('mapa-tema', novo);
    aplicarTema(novo);
  });

  // ---------------------------------------------------------------- mapa
  const mapa = L.map('mapa', { zoomControl: false, minZoom: 4, maxZoom: 18, attributionControl: true })
    .setView([-12.6, -41.7], 6);
  L.control.zoom({ position: 'bottomright', zoomInTitle: 'Aproximar', zoomOutTitle: 'Afastar' }).addTo(mapa);
  mapa.attributionControl.setPrefix(false);
  const temaInicial = document.documentElement.dataset.theme === 'escuro' ? 'escuro' : 'claro';
  let camadaCidades = null;
  mapa.createPane('rotulos').style.zIndex = 450;
  mapa.getPane('rotulos').style.pointerEvents = 'none';
  let fundo = ls.get('mapa-fundo') === 'mapa' ? 'mapa' : 'satelite';
  let camadasFundo = [];
  const temaAtual = () => (document.documentElement.dataset.theme === 'escuro' ? 'escuro' : 'claro');
  function aplicarFundo() {
    camadasFundo.forEach(c => mapa.removeLayer(c));
    const f = FUNDOS[fundo](temaAtual());
    camadasFundo = [L.tileLayer(f.base, { attribution: f.atrib, maxZoom: 19, maxNativeZoom: f.nativo, crossOrigin: 'anonymous' })]
      .concat(f.refs.map(u => L.tileLayer(u, { pane: 'rotulos', maxZoom: 19, maxNativeZoom: 16, crossOrigin: 'anonymous' })));
    camadasFundo.forEach(c => c.addTo(mapa));
    el.mapa.classList.toggle('satelite', fundo === 'satelite');
    $$('[data-fundo]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.fundo === fundo)));
  }
  function definirFundo(f) { fundo = f; ls.set('mapa-fundo', f); aplicarFundo(); }
  document.addEventListener('click', e => { const b = e.target.closest('[data-fundo]'); if (b) definirFundo(b.dataset.fundo); });
  aplicarTema(temaInicial);

  mapa.createPane('malhas').style.zIndex = 350;
  const corTeal = () => getComputedStyle(document.documentElement).getPropertyValue('--teal').trim() || '#00989E';

  const grupo = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: z => (z >= 10 ? 48 : 72),
    spiderfyOnMaxZoom: true,
    disableClusteringAtZoom: 12,
    iconCreateFunction(cluster) {
      const n = cluster.getChildCount();
      const tam = n < 10 ? 34 : n < 50 ? 40 : 46;
      return L.divIcon({
        className: 'tag-ancora',
        html: `<div class="grupo-pin" style="width:${tam}px;height:${tam}px" title="${plural(n, 'posto', 'postos')} — aproxime para ver">${n}</div>`,
        iconSize: [tam, tam], iconAnchor: [tam / 2, tam / 2]
      });
    }
  });
  mapa.addLayer(grupo);
  let marcadores = {};
  let marcadorVoce = null;

  function carregarMalhaUFs() {
    fetch(`${IBGE}/v3/malhas/paises/BR?intrarregiao=UF&formato=application/vnd.geo%2Bjson&qualidade=minima`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(geo => {
        L.geoJSON(geo, { pane: 'malhas', interactive: false, style: () => ({ color: corTeal(), weight: 1, opacity: .4, fill: false }) }).addTo(mapa);
      })
      .catch(() => { /* contornos são opcionais */ });
  }

  // Cidades com postos: contorno e preenchimento do município (malha IBGE por estado)
  const malhasUF = {};
  function carregarCidades() {
    const porUF = {};
    estado.postos.forEach(p => { if (p.cidadeId && UF_CODIGO[p.uf]) (porUF[p.uf] = porUF[p.uf] || new Set()).add(Number(p.cidadeId)); });
    const ufs = Object.keys(porUF);
    if (!ufs.length) return;
    Promise.all(ufs.map(uf => malhasUF[uf] || (malhasUF[uf] = fetch(`${IBGE}/v3/malhas/estados/${UF_CODIGO[uf]}?intrarregiao=municipio&formato=application/vnd.geo%2Bjson&qualidade=minima`)
      .then(r => r.ok ? r.json() : null).catch(() => null))))
      .then(geos => {
        const feats = [];
        geos.forEach((g, i) => {
          if (!g || !g.features) return;
          g.features.forEach(f => { if (porUF[ufs[i]].has(Number(f.properties.codarea))) feats.push(f); });
        });
        if (camadaCidades) mapa.removeLayer(camadaCidades);
        camadaCidades = L.geoJSON({ type: 'FeatureCollection', features: feats }, {
          pane: 'malhas',
          style: estiloCidade,
          onEachFeature(f, camada) {
            const id = Number(f.properties.codarea);
            const info = estado.cidades.get(id);
            if (!info) return;
            camada.bindTooltip(esc(info.nome), { permanent: true, direction: 'center', className: 'rotulo-cidade', interactive: false, pane: 'rotulos' });
            camada.on('mouseover', e => { camada.setStyle({ fillOpacity: .22 }); mostrarDicaCidade(info, e.latlng); });
            camada.on('mousemove', e => dicaCidade.setLatLng(e.latlng));
            camada.on('mouseout', () => { camadaCidades.resetStyle(camada); mapa.closeTooltip(dicaCidade); });
            camada.on('click', e => {
              L.DomEvent.stopPropagation(e);
              const k = info.chave;
              definirFiltro({ cidade: estado.cidade === k ? null : k });
            });
          }
        }).addTo(mapa);
        atualizarRotulos();
      });
  }
  function estiloCidade(f) {
    const id = Number(f.properties.codarea);
    const info = estado.cidades.get(id);
    const ativo = info && estado.cidade === info.chave;
    const visivel = info && estado.filtrados.some(p => Number(p.cidadeId) === id);
    return {
      color: corTeal(), weight: ativo ? 2.5 : 1.25, opacity: visivel ? (ativo ? 1 : .8) : .25,
      fillColor: corTeal(), fillOpacity: ativo ? .2 : visivel ? .1 : .03
    };
  }
  function atualizarRotulos() { el.mapa.classList.toggle('mostra-cidades', mapa.getZoom() >= ZOOM_ROTULOS); }
  mapa.on('zoomend', atualizarRotulos);

  const dicaCidade = L.tooltip({ direction: 'top', offset: [0, -12], className: 'dica-cidade' });
  function mostrarDicaCidade(info, latlng) {
    if (!temHover()) return;
    const ps = estado.filtrados.filter(p => chaveCidade(p) === info.chave);
    dicaCidade.setLatLng(latlng).setContent(`<b>${esc(info.nome)}/${esc(info.uf)}</b> · ${plural(ps.length, 'posto', 'postos')}<br>${COMBUSTIVEIS[estado.combustivel]} ${faixaTexto(ps)}<small>${estado.cidade === info.chave ? 'Clique para ver todas as cidades' : 'Clique para filtrar esta cidade'}</small>`);
    mapa.openTooltip(dicaCidade);
  }

  // ---------------------------------------------------------------- dados
  async function carregarDados() {
    renderEsqueleto();
    const exemplo = !CFG.API_URL;
    const url = exemplo ? 'dados-exemplo.json' : CFG.API_URL;
    const chaveCache = 'mapa-dados-v2';

    if (!exemplo) {
      const salvo = ls.get(chaveCache);
      if (salvo) { try { aplicarDados(JSON.parse(salvo), false, true); } catch (e) { /* cache inválido */ } }
    }
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 25000);
      const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
      clearTimeout(t);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = await r.json();
      if (!json || !Array.isArray(json.postos)) throw new Error('Resposta sem a lista de postos');
      if (!exemplo) ls.set(chaveCache, JSON.stringify(json));
      aplicarDados(json, exemplo || !!json.exemplo, false);
    } catch (e) {
      if (estado.dados) {
        toast('Sem conexão com a planilha. Mostrando a última cópia salva.');
        return;
      }
      el.status.textContent = 'Não foi possível carregar os dados';
      el.lista.innerHTML = `<div class="vazio"><strong>Não consegui carregar os postos</strong>
        Verifique a conexão ou a URL do App da Web em config.js.<br><small>${esc(e.message || e)}</small><br>
        <button class="botao" type="button" id="tentar">Tentar de novo</button></div>`;
      $('#tentar').addEventListener('click', carregarDados);
    }
  }

  function aplicarDados(json, exemplo, doCache) {
    estado.dados = json;
    estado.postos = json.postos.map(p => {
      const precos = { gasolina: (p.precos && p.precos.gasolina) || null, dieselS10: (p.precos && p.precos.dieselS10) || null };
      return Object.assign({}, p, {
        precos,
        _nome: norm(p.nome),
        _cidade: norm(p.cidade),
        _busca: norm([p.nome, p.razao, p.endereco, p.cidade, p.uf, UF_NOME[p.uf]].join(' ')),
        _cnpj: String(p.cnpj || '').replace(/\D/g, ''),
        _temCoord: p.lat !== null && p.lng !== null && !isNaN(p.lat) && !isNaN(p.lng)
      });
    });
    estado.porId = {};
    estado.cidades = new Map();
    estado.postos.forEach(p => {
      estado.porId[p.id] = p;
      if (p.cidadeId) estado.cidades.set(Number(p.cidadeId), { nome: p.cidade, uf: p.uf, chave: chaveCidade(p) });
    });
    el.aviso.hidden = !exemplo;
    const quandoGerado = json.geradoEm ? new Date(json.geradoEm) : null;
    const g = quandoGerado && !isNaN(quandoGerado) ? quandoGerado.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', ' às') : '—';
    estado.atualizadoTexto = exemplo ? `Dados de exemplo (sintéticos) de ${g}` : `Dados atualizados em ${g}${doCache ? ' (cópia salva)' : ''}`;
    el.status.innerHTML = `${exemplo ? `<b>Dados de exemplo</b> de ${esc(g)}` : `Atualizado em <b>${esc(g)}</b>${doCache ? ' (cópia salva)' : ''}`} · <b>${inteiro(estado.postos.length)}</b> postos`;
    el.statusMovel.textContent = `${exemplo ? `Dados de exemplo de ${g}` : `Atualizado em ${g}`} · ${plural(estado.postos.length, 'posto', 'postos')}`;
    lerHash();
    atualizar({ ajustar: true });
    carregarCidades();
  }

  // ---------------------------------------------------------------- busca e filtros
  const termosBusca = () => { const q = norm(estado.busca); return q ? q.split(/\s+/).filter(Boolean) : []; };

  /** Pontuação de um posto para os termos: 0 = não serve. Nome pesa mais que cidade, que pesa mais que o resto. */
  function pontuar(p, termos) {
    let total = 0;
    for (const t of termos) {
      const dig = t.replace(/\D/g, '');
      let s = 0;
      if (p._nome.startsWith(t) || p._nome.includes(' ' + t)) s = 6;
      else if (p._nome.includes(t)) s = 4;
      else if (p._cidade.startsWith(t) || p._cidade.includes(' ' + t)) s = 4;
      else if (p._cidade.includes(t)) s = 3;
      else if (t.length === 2 && norm(p.uf) === t) s = 2;
      else if (p._busca.includes(t)) s = 1;
      else if (dig.length >= 4 && dig === t && p._cnpj.includes(dig)) s = 5;
      if (!s) return 0;
      total += s;
    }
    return total;
  }

  function filtrar() {
    const termos = estado.aba === 'posto' ? termosBusca() : [];
    return estado.postos.filter(p => {
      if (estado.periodo !== 'tudo' && diasDesde(p.ultimo && p.ultimo.data) > Number(estado.periodo)) return false;
      if (estado.uf && p.uf !== estado.uf) return false;
      if (estado.cidade && chaveCidade(p) !== estado.cidade) return false;
      if (termos.length) { p._pontos = pontuar(p, termos); if (!p._pontos) return false; }
      return true;
    });
  }

  function calcularFaixa(lista) {
    const vals = lista.filter(p => !inativo(p)).map(p => precoDe(p, estado.combustivel)).filter(v => v !== null).sort((a, b) => a - b);
    const todos = lista.map(p => precoDe(p, estado.combustivel)).filter(v => v !== null);
    if (!todos.length) return null;
    const q = f => vals.length ? vals[Math.min(vals.length - 1, Math.floor(f * vals.length))] : null;
    return { min: Math.min(...todos), max: Math.max(...todos), p33: q(1 / 3), p67: q(2 / 3), n: todos.length };
  }
  function nivel(v, faixa) {
    const f = faixa || estado.faixa;
    if (v === null || !f) return 'sem';
    if (f.p33 === null || f.min === f.max) return 'medio';
    if (v <= f.p33) return 'baixo';
    if (v > f.p67) return 'alto';
    return 'medio';
  }

  function definirFiltro(mud, opcoes) {
    Object.assign(estado, mud);
    atualizar(Object.assign({ ajustar: true }, opcoes));
  }

  function atualizar(opcoes) {
    opcoes = opcoes || {};
    estado.filtrados = filtrar();
    estado.faixa = calcularFaixa(estado.filtrados);
    if (estado.selecionado && !estado.porId[estado.selecionado]) estado.selecionado = null;
    renderMarcadores();
    renderChips();
    renderSugestoes();
    renderResumo();
    renderLista();
    renderLegenda();
    if (camadaCidades) camadaCidades.setStyle(estiloCidade);
    if (raio.ativo) desenharRaio(false);
    if (opcoes.ajustar && !raio.ativo) ajustarMapa();
    escreverHash();
  }

  function ajustarMapa() {
    const pts = estado.filtrados.filter(p => p._temCoord).map(p => [p.lat, p.lng]);
    if (!pts.length) return;
    const pad = ehCelular() ? { paddingTopLeft: [24, 60], paddingBottomRight: [24, 190] } : { paddingTopLeft: [40, 70], paddingBottomRight: [estado.selecionado ? 420 : 40, 40] };
    if (pts.length === 1) mapa.setView(pts[0], 14, { animate: true });
    else mapa.fitBounds(L.latLngBounds(pts), Object.assign({ maxZoom: 13, animate: true }, pad));
  }

  // ---------------------------------------------------------------- marcadores (pino padrão)
  const PINO = '<svg viewBox="0 0 30 40" width="30" height="40" aria-hidden="true"><path class="pino-corpo" d="M15 38.5S26.5 25.6 26.5 15.6a11.5 11.5 0 0 0-23 0C3.5 25.6 15 38.5 15 38.5Z"/><circle class="pino-miolo" cx="15" cy="15.4" r="4.6"/></svg>';
  function iconePino(p, sel) {
    const cls = ['pino', nivel(precoDe(p, estado.combustivel)), inativo(p) ? 'inativo' : '', sel ? 'sel' : ''].join(' ');
    return L.divIcon({ className: 'tag-ancora' + (sel ? ' selecionado' : ''), html: `<div class="${cls}">${PINO}</div>`, iconSize: [30, 40], iconAnchor: [15, 39] });
  }
  function renderMarcadores() {
    fecharCartao(true);
    grupo.clearLayers();
    marcadores = {};
    const novos = [];
    estado.filtrados.forEach(p => {
      if (!p._temCoord) return;
      const m = L.marker([p.lat, p.lng], {
        icon: iconePino(p, p.id === estado.selecionado),
        alt: `${p.nome}, ${nomeCidade(p)}/${p.uf}`,
        keyboard: true,
        riseOnHover: true
      });
      m.on('click', () => { fecharCartao(true); selecionar(p.id, { centralizar: false }); });
      m.on('mouseover', () => { if (temHover()) abrirCartao(p, m); });
      m.on('mouseout', () => agendarFechar());
      marcadores[p.id] = m;
      novos.push(m);
    });
    grupo.addLayers(novos);
  }

  // ---------------------------------------------------------------- cartão ao passar o mouse
  const cartao = L.popup({ closeButton: false, autoPan: false, offset: [0, -34], className: 'cartao', maxWidth: 320, minWidth: 260 });
  let cartaoId = null, cartaoTimer = null;
  function htmlCartao(p) {
    const u = p.ultimo || {};
    const linha = tipo => {
      const info = p.precos[tipo];
      const ativo = tipo === estado.combustivel ? ' ativo' : '';
      return `<div class="cartao-preco${ativo}"><span>${COMBUSTIVEIS[tipo]}</span>${info
        ? `<b><small>R$</small>${preco(info.ultimo)}</b><em>${dataCurta(info.data)}</em>`
        : '<b class="sem">—</b><em>sem registro</em>'}</div>`;
    };
    return `<div class="cartao-corpo" data-id="${esc(p.id)}">
      <strong class="cartao-nome">${esc(p.nome)}</strong>
      <span class="cartao-local">${esc(nomeCidade(p))}/${esc(p.uf)}${estado.usuario ? ` · ${km(distanciaKm(estado.usuario, p))}` : ''}</span>
      <div class="cartao-precos">${linha('gasolina')}${linha('dieselS10')}</div>
      <p class="cartao-ultimo${inativo(p) ? ' inativo' : ''}">Último abastecimento <b>${dataBR(u.data)}${u.hora ? ' ' + esc(u.hora) : ''}</b> · ${esc(nomeServico(u.combustivel))}</p>
      <div class="cartao-acoes">
        <a class="botao primario" href="${esc(p.rotaUrl || p.mapsUrl)}" target="_blank" rel="noopener"><svg class="ic"><use href="#i-rota"/></svg>Como chegar</a>
        <button class="botao" type="button" data-acao="localizacao"><svg class="ic"><use href="#i-pino"/></svg>Gerar localização</button>
      </div>
    </div>`;
  }
  function abrirCartao(p, m) {
    clearTimeout(cartaoTimer);
    if (cartaoId === p.id && mapa.hasLayer(cartao)) return;
    cartaoId = p.id;
    cartao.setLatLng(m.getLatLng()).setContent(htmlCartao(p)).openOn(mapa);
    const no = cartao.getElement();
    if (no && !no._ligado) {
      no._ligado = true;
      no.addEventListener('mouseenter', () => clearTimeout(cartaoTimer));
      no.addEventListener('mouseleave', () => agendarFechar());
    }
  }
  function agendarFechar() { clearTimeout(cartaoTimer); cartaoTimer = setTimeout(() => fecharCartao(), 280); }
  function fecharCartao(agora) { clearTimeout(cartaoTimer); if (mapa.hasLayer(cartao)) mapa.closePopup(cartao); cartaoId = null; if (agora) cartaoTimer = null; }
  mapa.on('popupclose', e => { if (e.popup === cartao) cartaoId = null; });
  el.mapa.addEventListener('click', e => {
    const b = e.target.closest('.cartao [data-acao]');
    if (!b) return;
    const p = estado.porId[b.closest('[data-id]').dataset.id];
    if (p && b.dataset.acao === 'localizacao') copiarLocalizacao(p);
  });

  async function copiarLocalizacao(p) {
    const texto = `${p.nome} — ${p.endereco ? p.endereco + ', ' : ''}${nomeCidade(p)}/${p.uf}\n${p.mapsUrl}`;
    try { await navigator.clipboard.writeText(texto); toast('Localização copiada. Cole no WhatsApp ou onde quiser.'); }
    catch (err) { prompt('Copie a localização:', p.mapsUrl); }
  }

  // ---------------------------------------------------------------- painel
  function renderEsqueleto() {
    el.lista.innerHTML = Array.from({ length: 7 }, () => '<div class="esqueleto"><i></i><i></i></div>').join('');
  }

  function renderChips() {
    const chips = [];
    if (estado.uf) chips.push(['uf', `${UF_NOME[estado.uf] || estado.uf}`, 'Estado']);
    if (estado.cidade) {
      const p = estado.postos.find(x => chaveCidade(x) === estado.cidade);
      chips.push(['cidade', p ? `${nomeCidade(p)}/${p.uf}` : 'Cidade', 'Cidade']);
    }
    el.chips.innerHTML = chips.map(([k, nome, tipo]) =>
      `<button class="chip" type="button" data-remover="${k}" aria-label="Remover filtro ${esc(tipo)}: ${esc(nome)}"><span>${esc(tipo)}</span> ${esc(nome)}<svg class="ic"><use href="#i-fechar"/></svg></button>`).join('');
  }
  el.chips.addEventListener('click', e => {
    const b = e.target.closest('[data-remover]');
    if (!b) return;
    const k = b.dataset.remover;
    if (k === 'uf') definirFiltro({ uf: null, cidade: null });
    if (k === 'cidade') definirFiltro({ cidade: null });
  });

  /** Cidades cujo nome bate com a busca (lista de cidades do conjunto atual, sem a própria busca). */
  function cidadesQueBatem(q) {
    if (!q) return [];
    const base = estado.postos.filter(p => (estado.periodo === 'tudo' || diasDesde(p.ultimo && p.ultimo.data) <= Number(estado.periodo)) && (!estado.uf || p.uf === estado.uf));
    const grupos = agrupar(base, chaveCidade);
    return [...grupos.entries()]
      .map(([k, ps]) => ({ k, ps, n: ps[0]._cidade }))
      .filter(c => c.n && (c.n.startsWith(q) || c.n.includes(' ' + q) || (q.length >= 3 && c.n.includes(q))))
      .sort((a, b) => (b.n.startsWith(q) - a.n.startsWith(q)) || b.ps.length - a.ps.length || a.n.localeCompare(b.n));
  }

  function renderSugestoes() {
    const q = norm(estado.busca);
    if (estado.aba !== 'posto' || !q || estado.cidade) { el.sugestoes.innerHTML = ''; return; }
    const cs = cidadesQueBatem(q).slice(0, 4);
    el.sugestoes.innerHTML = cs.length ? `<span class="sugestoes-rotulo">Cidades</span>` + cs.map(c =>
      `<button class="sugestao" type="button" data-cidade="${esc(c.k)}"><svg class="ic"><use href="#i-pino"/></svg>${realcar(c.ps[0].cidade, [q])}<span>/${esc(c.ps[0].uf)} · ${c.ps.length}</span></button>`).join('') : '';
  }
  el.sugestoes.addEventListener('click', e => {
    const b = e.target.closest('[data-cidade]');
    if (b) escolherCidade(b.dataset.cidade);
  });
  function escolherCidade(k) {
    estado.busca = ''; el.busca.value = ''; el.buscaLimpar.hidden = true;
    trocarAba('posto', true);
    definirFiltro({ cidade: k });
  }

  function renderResumo() {
    const n = estado.filtrados.length;
    const f = estado.faixa;
    const nome = COMBUSTIVEIS[estado.combustivel];
    el.resumo.innerHTML = n === 0 ? 'Nenhum posto'
      : `<b>${inteiro(n)}</b> ${n === 1 ? 'posto' : 'postos'}` + (f ? ` · ${nome} <b class="num">${preco(f.min)}</b> a <b class="num">${preco(f.max)}</b>` : ` · sem preço de ${nome}`);
    $('#ordem-wrap').hidden = estado.aba !== 'posto';
  }

  function largura(v) {
    const f = estado.faixa;
    if (v === null || !f) return 0;
    if (f.max === f.min) return 60;
    return 14 + 86 * (v - f.min) / (f.max - f.min);
  }

  function itemPosto(p, termos) {
    const v = precoDe(p, estado.combustivel);
    const info = p.precos[estado.combustivel];
    const inat = inativo(p);
    const dist = estado.usuario && p._temCoord ? `<span class="distancia">${km(distanciaKm(estado.usuario, p))}</span> · ` : '';
    const dias = diasDesde(p.ultimo && p.ultimo.data);
    return `<button class="item${inat ? ' inativo' : ''}" role="listitem" data-id="${esc(p.id)}" aria-current="${p.id === estado.selecionado}">
      <span class="item-nome">${realcar(p.nome, termos)}${inat ? `<span class="carimbo">SEM USO ${dias}D</span>` : ''}</span>
      <span class="item-preco"><span class="valor">${v === null ? '<small>sem</small>—' : `<small>R$</small>${preco(v)}`}</span><span class="quando">${info ? dataCurta(info.data) : COMBUSTIVEIS[estado.combustivel]}</span></span>
      <span class="item-sub">${dist}${realcar(nomeCidade(p), termos)}/${esc(p.uf)} · ${quando(p.ultimo && p.ultimo.data)}</span>
      <span class="item-barra" aria-hidden="true"><i class="${nivel(v)}" style="width:${largura(v)}%"></i></span>
    </button>`;
  }

  function ordenar(lista) {
    const c = estado.combustivel;
    const l = lista.slice();
    if (estado.ordem === 'preco') l.sort((a, b) => (precoDe(a, c) ?? 1e9) - (precoDe(b, c) ?? 1e9));
    else if (estado.ordem === 'nome') l.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    else if (estado.ordem === 'distancia' && estado.usuario) l.sort((a, b) => (a._temCoord ? distanciaKm(estado.usuario, a) : 1e9) - (b._temCoord ? distanciaKm(estado.usuario, b) : 1e9));
    else l.sort((a, b) => ((b.ultimo.data + b.ultimo.hora) > (a.ultimo.data + a.ultimo.hora) ? 1 : -1));
    // Com busca, o mais relevante vem primeiro; a ordem escolhida desempata
    if (termosBusca().length && estado.ordem !== 'distancia') {
      const pos = new Map(l.map((p, i) => [p.id, i]));
      l.sort((a, b) => (b._pontos || 0) - (a._pontos || 0) || pos.get(a.id) - pos.get(b.id));
    }
    return l;
  }

  function faixaTexto(lista) {
    const vs = lista.map(p => precoDe(p, estado.combustivel)).filter(v => v !== null);
    if (!vs.length) return '—';
    const mn = Math.min(...vs), mx = Math.max(...vs);
    return mn === mx ? preco(mn) : `${preco(mn)} – ${preco(mx)}`;
  }

  function agrupar(lista, chave) {
    const g = new Map();
    lista.forEach(p => { const k = chave(p); if (!g.has(k)) g.set(k, []); g.get(k).push(p); });
    return g;
  }

  function semResultado(temFiltro) {
    return `<div class="vazio"><strong>Nada encontrado</strong>
      ${estado.busca ? `Nenhum resultado para “${esc(estado.busca)}”. Tente parte do nome, a cidade ou o estado.` : 'Nenhum abastecimento neste filtro.'}
      ${temFiltro ? '<br><button class="botao" type="button" data-acao="limpar">Limpar busca e filtros</button>' : ''}</div>`;
  }

  function renderLista() {
    const temFiltro = estado.busca || estado.uf || estado.cidade || estado.periodo !== 'tudo';
    const q = norm(estado.busca);
    let html = '';
    if (estado.aba === 'posto') {
      const lista = estado.filtrados;
      html = lista.length ? ordenar(lista).map(p => itemPosto(p, termosBusca())).join('') : semResultado(temFiltro);
    } else if (estado.aba === 'cidade') {
      const cs = q ? cidadesQueBatem(q).map(c => [c.k, c.ps.filter(p => estado.filtrados.includes(p))]).filter(c => c[1].length)
        : [...agrupar(estado.filtrados, chaveCidade).entries()].sort((a, b) => b[1].length - a[1].length || nomeCidade(a[1][0]).localeCompare(nomeCidade(b[1][0]), 'pt-BR'));
      html = cs.length ? cs.map(([k, ps]) => {
        const ativa = estado.cidade === k;
        return `<button class="item item-grupo cidade${ativa ? ' ativa' : ''}" role="listitem" data-cidade="${esc(k)}" aria-current="${ativa}">
          <span class="item-nome">${realcar(nomeCidade(ps[0]), q ? [q] : [])} <span class="item-uf">/ ${esc(ps[0].uf)}</span></span>
          <span class="item-preco faixa">${faixaTexto(ps)}</span>
          <span class="item-sub">${plural(ps.length, 'posto', 'postos')} · ${COMBUSTIVEIS[estado.combustivel]}</span>
          <svg class="ic"><use href="#i-chevron"/></svg></button>`;
      }).join('') : semResultado(temFiltro);
    } else {
      const ufs = [...agrupar(estado.filtrados, p => p.uf).entries()]
        .filter(([uf]) => !q || norm(`${uf} ${UF_NOME[uf] || ''}`).split(' ').some(w => w.startsWith(q)) || norm(UF_NOME[uf] || '').startsWith(q))
        .sort((a, b) => b[1].length - a[1].length);
      html = ufs.length ? ufs.map(([uf, ps]) => `<button class="item item-grupo uf" role="listitem" data-uf="${esc(uf)}" aria-current="${estado.uf === uf}">
          <span class="item-nome">${realcar(UF_NOME[uf] || uf, q ? [q] : [])} <span class="item-uf">${esc(uf)}</span></span>
          <span class="item-preco faixa">${faixaTexto(ps)}</span>
          <span class="item-sub">${plural(ps.length, 'posto', 'postos')} · ${plural(new Set(ps.map(p => p._cidade)).size, 'cidade', 'cidades')}</span>
          <svg class="ic"><use href="#i-chevron"/></svg></button>`).join('') : semResultado(temFiltro);
    }
    el.lista.innerHTML = html;
  }

  el.lista.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.acao === 'limpar') {
      el.busca.value = ''; estado.busca = ''; el.buscaLimpar.hidden = true;
      marcarSeg('#seg-periodo', 'tudo'); estado.periodo = 'tudo';
      definirFiltro({ uf: null, cidade: null });
      return;
    }
    if (b.dataset.id) { selecionar(b.dataset.id, { centralizar: true }); return; }
    if (b.dataset.cidade) { escolherCidade(b.dataset.cidade); return; }
    if (b.dataset.uf) {
      estado.busca = ''; el.busca.value = ''; el.buscaLimpar.hidden = true;
      trocarAba('posto', true);
      definirFiltro({ uf: b.dataset.uf, cidade: null });
    }
  });

  const PLACEHOLDER = { posto: 'Nome, cidade, endereço ou CNPJ', cidade: 'Digite o nome da cidade', estado: 'Digite o estado ou a sigla' };
  function trocarAba(aba, limparBusca) {
    estado.aba = aba;
    $$('.aba').forEach(b => b.setAttribute('aria-selected', String(b.dataset.aba === aba)));
    el.busca.placeholder = PLACEHOLDER[aba];
    if (limparBusca && estado.busca) { estado.busca = ''; el.busca.value = ''; el.buscaLimpar.hidden = true; }
  }
  $$('.aba').forEach(b => b.addEventListener('click', () => { trocarAba(b.dataset.aba, false); atualizar(); }));
  $('.abas').addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const abas = $$('.aba'); const i = abas.findIndex(a => a.dataset.aba === estado.aba);
    const n = abas[(i + (e.key === 'ArrowRight' ? 1 : abas.length - 1)) % abas.length];
    n.focus(); n.click();
  });

  // Busca dinâmica: cada tecla atualiza lista e mapa; campo vazio volta ao início
  let buscaQuadro = 0;
  function resetarBusca() {
    cancelAnimationFrame(buscaQuadro);
    el.busca.value = ''; el.buscaLimpar.hidden = true;
    estado.busca = '';
    definirFiltro({ uf: null, cidade: null });
  }
  el.busca.addEventListener('input', () => {
    const v = el.busca.value;
    el.buscaLimpar.hidden = !v;
    if (!v.trim()) { resetarBusca(); return; }
    cancelAnimationFrame(buscaQuadro);
    buscaQuadro = requestAnimationFrame(() => {
      estado.busca = v;
      // Uma busca nova procura em todas as cidades, não só na escolhida antes
      if (estado.cidade) estado.cidade = null;
      atualizar({ ajustar: estado.aba === 'posto' });
    });
  });
  el.busca.addEventListener('keydown', e => {
    if (e.key === 'Escape' && el.busca.value) { e.stopPropagation(); el.buscaLimpar.click(); return; }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    cancelAnimationFrame(buscaQuadro);
    estado.busca = el.busca.value;
    atualizar({ ajustar: estado.aba === 'posto' });
    const primeiro = el.lista.querySelector('button.item');
    if (primeiro && estado.aba !== 'posto') primeiro.click();
    else if (primeiro && estado.filtrados.length === 1) primeiro.click();
  });
  el.busca.addEventListener('focus', () => { if (ehCelular()) definirFolha('cheio'); });
  el.buscaLimpar.addEventListener('click', () => { resetarBusca(); el.busca.focus(); });

  function marcarSeg(sel, valor) { $$(`${sel} button`).forEach(b => b.setAttribute('aria-checked', String(b.dataset.valor === valor))); }
  function ligarSeg(sel, campo) {
    $(sel).addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      marcarSeg(sel, b.dataset.valor);
      estado[campo] = b.dataset.valor;
      atualizar({ ajustar: campo === 'periodo' });
      if (estado.selecionado) renderDetalhe();
    });
    $(sel).addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const bs = $$(`${sel} button`); const i = bs.findIndex(b => b.getAttribute('aria-checked') === 'true');
      const n = bs[(i + (e.key === 'ArrowRight' ? 1 : bs.length - 1)) % bs.length]; n.focus(); n.click();
    });
  }
  ligarSeg('#seg-combustivel', 'combustivel');
  ligarSeg('#seg-periodo', 'periodo');
  el.ordem.addEventListener('change', () => { estado.ordem = el.ordem.value; renderLista(); });

  function renderLegenda() {
    const nome = COMBUSTIVEIS[estado.combustivel];
    el.legenda.innerHTML = estado.faixa ? `<strong>${nome}</strong>
      <span class="amostra"><i class="baixo"></i>Mais barato</span>
      <span class="amostra"><i class="medio"></i>Na média</span>
      <span class="amostra"><i class="alto"></i>Mais caro</span>` : '';
  }

  // ---------------------------------------------------------------- seleção + detalhe
  function selecionar(id, opcoes) {
    const anterior = estado.selecionado;
    estado.selecionado = id;
    [anterior, id].forEach(x => {
      const p = estado.porId[x], m = marcadores[x];
      if (p && m) m.setIcon(iconePino(p, x === id));
    });
    $$('.item[data-id]').forEach(b => b.setAttribute('aria-current', String(b.dataset.id === id)));
    renderDetalhe();
    const p = estado.porId[id];
    if (p && p._temCoord && opcoes && opcoes.centralizar !== false) {
      // Desloca o centro para o posto não ficar atrás do painel de detalhes
      const zoom = Math.min(Math.max(mapa.getZoom(), 13), 15);
      const alvo = mapa.project([p.lat, p.lng], zoom);
      const desloc = ehCelular() ? L.point(0, Math.round(innerHeight * 0.56 / 2)) : L.point(195, 0);
      mapa.setView(mapa.unproject(alvo.add(desloc), zoom), zoom, { animate: !(opcoes && opcoes.semAnimacao) });
    }
    if (ehCelular()) definirFolha('espiar');
    escreverHash();
  }

  function fecharDetalhe() {
    const id = estado.selecionado;
    estado.selecionado = null;
    el.detalhe.hidden = true;
    const p = estado.porId[id], m = marcadores[id];
    if (p && m) m.setIcon(iconePino(p, false));
    $$('.item[data-id]').forEach(b => b.setAttribute('aria-current', 'false'));
    escreverHash();
  }

  function linkPosto(p) {
    const u = new URL(location.href);
    u.hash = `posto=${encodeURIComponent(p.id)}`;
    return u.toString();
  }

  function blocoPreco(p, tipo) {
    const info = p.precos[tipo];
    const ativo = tipo === estado.combustivel ? ' ativo' : '';
    if (!info) return `<div class="preco vazio-preco${ativo}"><div class="preco-nome">${COMBUSTIVEIS[tipo]}</div><div class="preco-valor">—</div><div class="preco-data">sem registro</div></div>`;
    let media = '<div class="preco-media">sem média 30d</div>';
    if (info.media30d !== null && info.media30d !== undefined) {
      const d = info.ultimo - info.media30d;
      const cls = Math.abs(d) < 0.005 ? '' : d > 0 ? 'sobe' : 'desce';
      const sinal = Math.abs(d) < 0.005 ? '=' : d > 0 ? `+${preco(d)}` : `−${preco(-d)}`;
      media = `<div class="preco-media">média 30d ${preco(info.media30d)} <span class="${cls}">${sinal}</span></div>`;
    }
    return `<div class="preco${ativo}"><div class="preco-nome">${COMBUSTIVEIS[tipo]}</div>
      <div class="preco-valor"><small>R$ </small>${preco(info.ultimo)}</div>
      <div class="preco-data">${dataBR(info.data)}</div>${media}</div>`;
  }

  function renderDetalhe() {
    const p = estado.porId[estado.selecionado];
    if (!p) { el.detalhe.hidden = true; return; }
    const dias = diasDesde(p.ultimo && p.ultimo.data);
    const inat = dias > CFG.DIAS_SEM_USO;
    const dist = estado.usuario && p._temCoord ? ` · ${km(distanciaKm(estado.usuario, p))} de você` : '';
    const u = p.ultimo || {};
    el.detalhe.innerHTML = `
      <div class="det-cabeca">
        <button class="det-fechar" type="button" data-acao="fechar" aria-label="Fechar detalhes"><svg class="ic"><use href="#i-fechar"/></svg></button>
        <h2 class="det-nome">${esc(p.nome)}</h2>
        <p class="det-razao">${esc(p.razao || '')}${p.cnpj ? ` · <span class="nowrap">CNPJ ${esc(cnpjFmt(p.cnpj))}</span>` : ''}</p>
        <div class="det-local"><svg class="ic"><use href="#i-pino"/></svg><div>
          <b>${esc(p.endereco || 'Endereço não informado')}</b>${esc(nomeCidade(p))}/${esc(p.uf)}${dist}
          ${p._temCoord ? '' : '<br><span class="det-aviso">Sem coordenadas na Sisatec. O link busca pelo endereço no Google Maps.</span>'}
        </div></div>
        <span class="det-status${inat ? ' inativo' : ''}">${inat ? `Sem uso há ${dias} dias` : `Último abastecimento ${quando(u.data)}`}</span>
      </div>
      <div class="det-corpo">
        <section class="det-secao"><h3>Último preço pago (R$/L)</h3>
          <div class="precos">${Object.keys(COMBUSTIVEIS).map(t => blocoPreco(p, t)).join('')}</div>
        </section>
        <section class="det-secao"><h3>Último abastecimento</h3>
          <dl class="fatos">
            <div class="fato"><dt>Data</dt><dd>${dataBR(u.data)} ${esc(u.hora || '')}</dd></div>
            <div class="fato"><dt>Combustível</dt><dd>${esc(nomeServico(u.combustivel))}</dd></div>
          </dl>
        </section>
      </div>
      <div class="det-acoes">
        <a class="botao primario" href="${esc(p.rotaUrl || p.mapsUrl)}" target="_blank" rel="noopener"><svg class="ic"><use href="#i-rota"/></svg>${p.rotaUrl ? 'Como chegar' : 'Abrir no Google Maps'}</a>
        <button class="botao" type="button" data-acao="localizacao"><svg class="ic"><use href="#i-pino"/></svg>Gerar localização</button>
        <button class="botao" type="button" data-acao="compartilhar"><svg class="ic"><use href="#i-compartilhar"/></svg>Compartilhar</button>
      </div>`;
    el.detalhe.hidden = false;
  }

  el.detalhe.addEventListener('click', async e => {
    const b = e.target.closest('[data-acao]');
    if (!b) return;
    const p = estado.porId[estado.selecionado];
    if (b.dataset.acao === 'fechar') { fecharDetalhe(); return; }
    if (!p) return;
    if (b.dataset.acao === 'localizacao') copiarLocalizacao(p);
    if (b.dataset.acao === 'compartilhar') {
      const v = precoDe(p, estado.combustivel);
      const dados = { title: p.nome, text: `${p.nome} (${nomeCidade(p)}/${p.uf})${v !== null ? ` — ${COMBUSTIVEIS[estado.combustivel]} R$ ${preco(v)}` : ''}`, url: p.mapsUrl };
      if (navigator.share) { try { await navigator.share(dados); } catch (err) { /* cancelado */ } }
      else {
        try { await navigator.clipboard.writeText(`${dados.text}\n${p.mapsUrl}\n${linkPosto(p)}`); toast('Texto para compartilhar copiado'); }
        catch (err) { prompt('Copie o link:', p.mapsUrl); }
      }
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!el.captura.hidden) { sairCaptura(); return; }
    if (raio.ativo) { sairRaio(); return; }
    if (mapa.hasLayer(cartao)) { fecharCartao(true); return; }
    if (!el.detalhe.hidden) fecharDetalhe();
  });

  // ---------------------------------------------------------------- perto de mim
  el.btnPerto.addEventListener('click', () => {
    if (!navigator.geolocation) { toast('Seu navegador não informa a localização'); return; }
    el.btnPerto.classList.add('ocupado');
    navigator.geolocation.getCurrentPosition(pos => {
      el.btnPerto.classList.remove('ocupado');
      el.btnPerto.setAttribute('aria-pressed', 'true');
      estado.usuario = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (marcadorVoce) mapa.removeLayer(marcadorVoce);
      marcadorVoce = L.marker([estado.usuario.lat, estado.usuario.lng], {
        icon: L.divIcon({ className: 'tag-ancora', html: '<div class="voce"></div>', iconSize: [18, 18] }),
        keyboard: false, zIndexOffset: 2000, title: 'Você está aqui'
      }).addTo(mapa);
      $('#ordem option[value="distancia"]').disabled = false;
      estado.ordem = 'distancia'; el.ordem.value = 'distancia';
      trocarAba('posto', false);
      atualizar();
      const proximos = ordenar(estado.filtrados.filter(p => p._temCoord)).slice(0, 5);
      const pts = proximos.map(p => [p.lat, p.lng]).concat([[estado.usuario.lat, estado.usuario.lng]]);
      if (ehCelular()) definirFolha('meio');
      // No celular a folha sobe até a metade: deixa os pontos acima dela
      mapa.fitBounds(L.latLngBounds(pts), ehCelular() ? { paddingTopLeft: [30, 70], paddingBottomRight: [30, Math.round(innerHeight * 0.52) + 30], maxZoom: 14 } : { padding: [60, 60], maxZoom: 14 });
      if (proximos[0]) toast(`Mais perto: ${proximos[0].nome}, a ${km(distanciaKm(estado.usuario, proximos[0]))}`);
    }, err => {
      el.btnPerto.classList.remove('ocupado');
      toast(err.code === 1 ? 'Permita o acesso à localização para ver os postos perto de você' : 'Não foi possível obter sua localização');
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  });

  // ---------------------------------------------------------------- folha (celular)
  const ALTURAS = { espiar: () => 190, meio: () => innerHeight * 0.52, cheio: () => innerHeight - 62 };
  function definirFolha(f) { el.painel.dataset.folha = f; el.alca.setAttribute('aria-label', f === 'cheio' ? 'Recolher lista' : 'Expandir lista'); }
  (function arrastarFolha() {
    let y0 = null, h0 = 0, movido = false;
    const inicio = e => { if (!ehCelular()) return; y0 = e.clientY; h0 = el.painel.getBoundingClientRect().height; movido = false; el.painel.classList.add('arrastando'); el.alca.setPointerCapture(e.pointerId); };
    const mover = e => {
      if (y0 === null) return;
      const dy = y0 - e.clientY;
      if (Math.abs(dy) > 4) movido = true;
      el.painel.style.setProperty('--folha-h', `${Math.max(120, Math.min(innerHeight - 62, h0 + dy))}px`);
    };
    const fim = () => {
      if (y0 === null) return;
      el.painel.classList.remove('arrastando');
      const h = el.painel.getBoundingClientRect().height;
      el.painel.style.removeProperty('--folha-h');
      y0 = null;
      if (!movido) { definirFolha(el.painel.dataset.folha === 'espiar' ? 'meio' : el.painel.dataset.folha === 'meio' ? 'cheio' : 'espiar'); return; }
      const alvo = Object.keys(ALTURAS).reduce((a, k) => Math.abs(ALTURAS[k]() - h) < Math.abs(ALTURAS[a]() - h) ? k : a, 'espiar');
      definirFolha(alvo);
    };
    el.alca.addEventListener('pointerdown', inicio);
    el.alca.addEventListener('pointermove', mover);
    el.alca.addEventListener('pointerup', fim);
    el.alca.addEventListener('pointercancel', fim);
  })();
  mapa.on('click', () => { if (ehCelular() && el.painel.dataset.folha !== 'espiar') definirFolha('espiar'); });

  // ---------------------------------------------------------------- captura de área
  let cap = null;
  function entrarCaptura() {
    if (!window.htmlToImage) { toast('A biblioteca de imagem não carregou. Verifique a conexão.'); return; }
    fecharCartao(true);
    if (raio.ativo) sairRaio();
    el.captura.hidden = false;
    el.capturaDica.hidden = false;
    el.capturaRet.hidden = true;
    el.capturaBarra.hidden = true;
    el.captura.classList.remove('ativo');
    el.btnCaptura.setAttribute('aria-pressed', 'true');
    cap = { ret: null };
    if (ehCelular()) definirFolha('espiar');
  }
  function sairCaptura() {
    el.captura.hidden = true;
    el.btnCaptura.setAttribute('aria-pressed', 'false');
    cap = null;
  }
  el.btnCaptura.addEventListener('click', () => (el.captura.hidden ? entrarCaptura() : sairCaptura()));
  $('#captura-cancelar').addEventListener('click', sairCaptura);
  $('#captura-sair').addEventListener('click', sairCaptura);
  $('#captura-refazer').addEventListener('click', entrarCaptura);
  $('#captura-tela').addEventListener('click', e => {
    e.stopPropagation();
    const r = el.captura.getBoundingClientRect();
    cap.ret = { x: 0, y: 0, w: r.width, h: r.height };
    gerarImagem();
  });
  $('#captura-baixar').addEventListener('click', gerarImagem);

  el.captura.addEventListener('pointerdown', e => {
    if (!cap || e.target.closest('.captura-dica, .captura-barra')) return;
    const r = el.captura.getBoundingClientRect();
    cap.x0 = e.clientX - r.left; cap.y0 = e.clientY - r.top; cap.arrastando = true;
    el.captura.setPointerCapture(e.pointerId);
    el.captura.classList.add('ativo');
    el.capturaDica.hidden = true; el.capturaBarra.hidden = true; el.capturaRet.hidden = false;
    desenharRet(cap.x0, cap.y0);
  });
  el.captura.addEventListener('pointermove', e => {
    if (!cap || !cap.arrastando) return;
    const r = el.captura.getBoundingClientRect();
    desenharRet(Math.max(0, Math.min(r.width, e.clientX - r.left)), Math.max(0, Math.min(r.height, e.clientY - r.top)));
  });
  const soltar = () => {
    if (!cap || !cap.arrastando) return;
    cap.arrastando = false;
    if (!cap.ret || cap.ret.w < 40 || cap.ret.h < 40) { entrarCaptura(); toast('Arraste para formar uma área maior'); return; }
    el.capturaBarra.hidden = false;
  };
  el.captura.addEventListener('pointerup', soltar);
  el.captura.addEventListener('pointercancel', soltar);
  function desenharRet(x1, y1) {
    const x = Math.min(cap.x0, x1), y = Math.min(cap.y0, y1), w = Math.abs(x1 - cap.x0), h = Math.abs(y1 - cap.y0);
    cap.ret = { x, y, w, h };
    Object.assign(el.capturaRet.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    el.capturaMedida.textContent = `${Math.round(w * 2)} × ${Math.round(h * 2)} px`;
  }

  function descricaoFiltros() {
    const partes = [COMBUSTIVEIS[estado.combustivel]];
    if (estado.uf) partes.push(UF_NOME[estado.uf] || estado.uf);
    if (estado.cidade) { const p = estado.postos.find(x => chaveCidade(x) === estado.cidade); if (p) partes.push(`${nomeCidade(p)}/${p.uf}`); }
    partes.push(estado.periodo === 'tudo' ? 'todo o período' : `últimos ${estado.periodo} dias`);
    if (estado.busca) partes.push(`busca “${estado.busca}”`);
    return partes.filter(Boolean).join(' · ');
  }

  async function gerarImagem() {
    if (!cap || !cap.ret) return;
    const ret = cap.ret;
    const botao = $('#captura-baixar');
    botao.setAttribute('aria-disabled', 'true');
    el.captura.hidden = true;
    toast('Gerando imagem…');
    const escala = 2;
    try {
      await document.fonts.ready;
      const css = getComputedStyle(document.documentElement);
      const corFundo = css.getPropertyValue('--sup').trim();
      const mapaCanvas = await window.htmlToImage.toCanvas(el.mapa, {
        pixelRatio: escala,
        backgroundColor: corFundo,
        filter: n => !(n.classList && (n.classList.contains('leaflet-control-container') || n.classList.contains('leaflet-popup-pane')))
      });
      const cab = 64 * escala, rod = 58 * escala;
      const out = document.createElement('canvas');
      out.width = Math.round(ret.w * escala);
      out.height = Math.round(ret.h * escala) + cab + rod;
      const c = out.getContext('2d');
      c.fillStyle = corFundo; c.fillRect(0, 0, out.width, out.height);
      c.drawImage(mapaCanvas, Math.round(ret.x * escala), Math.round(ret.y * escala), out.width, Math.round(ret.h * escala), 0, cab, out.width, Math.round(ret.h * escala));
      // cabeçalho
      const pad = 16 * escala;
      let x = pad;
      if (el.logo.complete && el.logo.naturalWidth && !el.logo.classList.contains('sem-logo')) {
        const h = 30 * escala, w = h * el.logo.naturalWidth / el.logo.naturalHeight;
        c.drawImage(el.logo, x, (cab - h) / 2, w, h);
        x += w + 14 * escala;
      }
      c.fillStyle = css.getPropertyValue('--texto').trim();
      c.font = `600 ${17 * escala}px Barlow, sans-serif`;
      c.textBaseline = 'alphabetic';
      c.fillText(CFG.TITULO, x, cab / 2 - 2 * escala);
      c.fillStyle = css.getPropertyValue('--texto-3').trim();
      c.font = `500 ${12 * escala}px Barlow, sans-serif`;
      c.fillText(descricaoFiltros(), x, cab / 2 + 15 * escala);
      c.fillStyle = css.getPropertyValue('--teal').trim();
      c.fillRect(0, cab - 2 * escala, out.width * 0.72, 2 * escala);
      c.fillStyle = css.getPropertyValue('--laranja').trim();
      c.fillRect(out.width * 0.72, cab - 2 * escala, out.width * 0.28, 2 * escala);
      // rodapé com legenda
      const yR = out.height - rod + 24 * escala;
      let xr = pad;
      [['--tag-baixo', 'Mais barato'], ['--pino-medio', 'Na média'], ['--tag-alto', 'Mais caro']].forEach(([v, t]) => {
        c.fillStyle = css.getPropertyValue(v).trim();
        c.fillRect(xr, yR - 9 * escala, 14 * escala, 10 * escala);
        c.strokeStyle = css.getPropertyValue('--linha-forte').trim(); c.lineWidth = escala;
        c.strokeRect(xr, yR - 9 * escala, 14 * escala, 10 * escala);
        c.fillStyle = css.getPropertyValue('--texto-2').trim();
        c.font = `500 ${11 * escala}px Barlow, sans-serif`;
        c.fillText(t, xr + 19 * escala, yR);
        xr += 19 * escala + c.measureText(t).width + 14 * escala;
      });
      const agora = new Date();
      const geradoTxt = agora.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', ' às');
      c.fillStyle = css.getPropertyValue('--texto-3').trim();
      c.fillText(`Imagem gerada em ${geradoTxt} · ${estado.atualizadoTexto || ''}`, pad, yR + 20 * escala);
      const blob = await new Promise(res => out.toBlob(res, 'image/png'));
      const a = document.createElement('a');
      const stamp = `${agora.getFullYear()}${String(agora.getMonth() + 1).padStart(2, '0')}${String(agora.getDate()).padStart(2, '0')}-${String(agora.getHours()).padStart(2, '0')}${String(agora.getMinutes()).padStart(2, '0')}`;
      a.href = URL.createObjectURL(blob);
      a.download = `mapa-abastecimentos-${stamp}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('Imagem baixada');
      sairCaptura();
    } catch (err) {
      console.error(err);
      el.captura.hidden = false;
      toast('Não foi possível gerar a imagem. Tente uma área menor.');
    } finally {
      botao.removeAttribute('aria-disabled');
    }
  }

  // ---------------------------------------------------------------- mapa por raio (imagem 1920×1080)
  const RAIO_W = 1920, RAIO_H = 1080, RAIO_CAB = 100, RAIO_ROD = 56;
  const RAIO_MAX = 500;
  const raio = { ativo: false, centro: null, km: 50, nomeCentro: '', circulo: null, marcaCentro: null };
  const elR = {
    painel: $('#raio'), cidade: $('#raio-cidade'), km: $('#raio-km'), contagem: $('#raio-contagem'),
    gerar: $('#raio-gerar'), dica: $('#raio-dica'), btn: $('#btn-raio')
  };

  const noPeriodo = p => estado.periodo === 'tudo' || diasDesde(p.ultimo && p.ultimo.data) <= Number(estado.periodo);
  function postosNoRaio() {
    if (!raio.centro) return [];
    return estado.postos
      .filter(p => p._temCoord && noPeriodo(p))
      .map(p => Object.assign(p, { _distRaio: distanciaKm(raio.centro, p) }))
      .filter(p => p._distRaio <= raio.km);
  }

  function opcoesCidadesRaio() {
    const cs = [...agrupar(estado.postos.filter(p => p._temCoord && p.cidade), chaveCidade).entries()]
      .sort((a, b) => nomeCidade(a[1][0]).localeCompare(nomeCidade(b[1][0]), 'pt-BR'));
    const atual = elR.cidade.value;
    elR.cidade.innerHTML = '<option value="">Escolha a cidade central</option>'
      + (estado.usuario ? '<option value="@voce">Minha localização</option>' : '')
      + cs.map(([k, ps]) => `<option value="${esc(k)}">${esc(nomeCidade(ps[0]))}/${esc(ps[0].uf)} (${ps.length})</option>`).join('');
    elR.cidade.value = atual;
  }

  function centroDaCidade(k) {
    const ps = estado.postos.filter(p => chaveCidade(p) === k && p._temCoord);
    const id = ps[0] && Number(ps[0].cidadeId);
    let c = null;
    if (camadaCidades && id) camadaCidades.eachLayer(l => { if (Number(l.feature.properties.codarea) === id) c = l.getBounds().getCenter(); });
    if (c) return { lat: c.lat, lng: c.lng };
    return { lat: ps.reduce((s, p) => s + p.lat, 0) / ps.length, lng: ps.reduce((s, p) => s + p.lng, 0) / ps.length };
  }

  /** Nome para um ponto clicado: a cidade do posto mais próximo (até 25 km) ou a coordenada. */
  function nomePerto(pt) {
    let melhor = null, d = Infinity;
    estado.postos.forEach(p => { if (p._temCoord && p.cidade) { const x = distanciaKm(pt, p); if (x < d) { d = x; melhor = p; } } });
    if (melhor && d <= 25) return `perto de ${nomeCidade(melhor)}/${melhor.uf}`;
    return `${pt.lat.toFixed(4).replace('.', ',')}, ${pt.lng.toFixed(4).replace('.', ',')}`;
  }

  function desenharRaio(enquadrar) {
    if (raio.circulo) { mapa.removeLayer(raio.circulo); raio.circulo = null; }
    if (raio.marcaCentro) { mapa.removeLayer(raio.marcaCentro); raio.marcaCentro = null; }
    const lista = postosNoRaio();
    elR.gerar.setAttribute('aria-disabled', String(!lista.length));
    if (!raio.centro) {
      elR.contagem.innerHTML = 'Defina o centro';
      elR.dica.textContent = 'Escolha a cidade ou clique no mapa';
      return;
    }
    elR.dica.textContent = raio.nomeCentro;
    elR.contagem.innerHTML = lista.length ? `<b>${inteiro(lista.length)}</b> ${lista.length === 1 ? 'posto' : 'postos'} no raio` : 'Nenhum posto no raio';
    raio.circulo = L.circle([raio.centro.lat, raio.centro.lng], {
      radius: raio.km * 1000, color: corTeal(), weight: 2, dashArray: '6 5', fillColor: corTeal(), fillOpacity: .06, interactive: false
    }).addTo(mapa);
    raio.marcaCentro = L.marker([raio.centro.lat, raio.centro.lng], {
      icon: L.divIcon({ className: 'tag-ancora', html: '<div class="raio-centro"></div>', iconSize: [16, 16] }), interactive: false, keyboard: false
    }).addTo(mapa);
    if (enquadrar) {
      const pad = ehCelular() ? { paddingTopLeft: [20, 230], paddingBottomRight: [20, 200] } : { paddingTopLeft: [440, 40], paddingBottomRight: [40, 40] };
      mapa.fitBounds(raio.circulo.getBounds(), Object.assign({ animate: true }, pad));
    }
  }

  function definirKm(v, enquadrar) {
    const n = Math.round(Number(String(v).replace(',', '.')));
    raio.km = Math.max(1, Math.min(RAIO_MAX, isNaN(n) ? 50 : n));
    elR.km.value = raio.km;
    marcarSeg('#seg-raio', String(raio.km));
    desenharRaio(enquadrar);
  }

  function entrarRaio() {
    fecharCartao(true);
    if (!el.captura.hidden) sairCaptura();
    raio.ativo = true;
    opcoesCidadesRaio();
    if (!raio.centro && estado.cidade) {
      raio.centro = centroDaCidade(estado.cidade);
      const p = estado.postos.find(x => chaveCidade(x) === estado.cidade);
      raio.nomeCentro = p ? `${nomeCidade(p)}/${p.uf}` : '';
      elR.cidade.value = estado.cidade;
    }
    elR.painel.hidden = false;
    elR.btn.setAttribute('aria-pressed', 'true');
    el.mapa.classList.add('modo-raio');
    if (ehCelular()) definirFolha('espiar');
    definirKm(raio.km, true);
  }
  function sairRaio() {
    raio.ativo = false;
    elR.painel.hidden = true;
    elR.btn.setAttribute('aria-pressed', 'false');
    el.mapa.classList.remove('modo-raio');
    if (raio.circulo) { mapa.removeLayer(raio.circulo); raio.circulo = null; }
    if (raio.marcaCentro) { mapa.removeLayer(raio.marcaCentro); raio.marcaCentro = null; }
  }
  elR.btn.addEventListener('click', () => (raio.ativo ? sairRaio() : entrarRaio()));
  $('#raio-cancelar').addEventListener('click', sairRaio);
  mapa.on('click', e => {
    if (!raio.ativo) return;
    raio.centro = { lat: e.latlng.lat, lng: e.latlng.lng };
    raio.nomeCentro = nomePerto(raio.centro);
    elR.cidade.value = '';
    desenharRaio(false);
  });
  elR.cidade.addEventListener('change', () => {
    const k = elR.cidade.value;
    if (!k) return;
    if (k === '@voce' && estado.usuario) { raio.centro = Object.assign({}, estado.usuario); raio.nomeCentro = 'sua localização'; }
    else {
      raio.centro = centroDaCidade(k);
      const p = estado.postos.find(x => chaveCidade(x) === k);
      raio.nomeCentro = p ? `${nomeCidade(p)}/${p.uf}` : '';
    }
    desenharRaio(true);
  });
  $('#seg-raio').addEventListener('click', e => { const b = e.target.closest('button'); if (b) definirKm(b.dataset.valor, true); });
  elR.km.addEventListener('input', () => { if (elR.km.value !== '') definirKm(elR.km.value, false); });
  elR.km.addEventListener('change', () => definirKm(elR.km.value, true));
  elR.gerar.addEventListener('click', () => { if (elR.gerar.getAttribute('aria-disabled') !== 'true') gerarImagemRaio(); });

  const CAMINHO_PINO = typeof Path2D !== 'undefined' ? new Path2D('M15 38.5S26.5 25.6 26.5 15.6a11.5 11.5 0 0 0-23 0C3.5 25.6 15 38.5 15 38.5Z') : null;

  function sobreposicao(r, ocupados) {
    let soma = 0;
    for (const o of ocupados) {
      const w = Math.min(r.x + r.w, o.x + o.w) - Math.max(r.x, o.x);
      const h = Math.min(r.y + r.h, o.y + o.h) - Math.max(r.y, o.y);
      if (w > 0 && h > 0) soma += w * h;
    }
    return soma;
  }
  const dentro = (r, a) => r.x >= a.x && r.y >= a.y && r.x + r.w <= a.x + a.w && r.y + r.h <= a.y + a.h;

  function encurtar(c, texto, max) {
    if (c.measureText(texto).width <= max) return texto;
    let t = texto;
    while (t.length > 4 && c.measureText(t + '…').width > max) t = t.slice(0, -1);
    return t.trimEnd() + '…';
  }

  function carregarImagem(url) {
    return new Promise(res => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const t = setTimeout(() => res(null), 20000);
      img.onload = () => { clearTimeout(t); res(img); };
      img.onerror = () => { clearTimeout(t); res(null); };
      img.src = url;
    });
  }

  /**
   * Desenha o fundo (blocos 256 px do Esri) direto no canvas, numa área W×H
   * centrada em `centro` com zoom fracionário `z`. Devolve a projeção usada.
   */
  async function desenharFundo(c, area, centro, z, f) {
    const crs = L.CRS.EPSG3857;
    const zt = Math.max(1, Math.min(f.nativo, Math.ceil(z)));
    const escala = Math.pow(2, z - zt);
    const ts = 256 * escala;
    const pc = crs.latLngToPoint(centro, z);
    const ox = pc.x - area.w / 2, oy = pc.y - area.h / 2;
    const n = Math.pow(2, zt);
    const x0 = Math.floor(ox / ts), x1 = Math.floor((ox + area.w) / ts);
    const y0 = Math.max(0, Math.floor(oy / ts)), y1 = Math.min(n - 1, Math.floor((oy + area.h) / ts));
    const urls = [f.base].concat(f.refs);
    const pedidos = [];
    urls.forEach((u, camada) => {
      // rótulos e ruas não passam de 16 no Esri; acima disso, amplia o bloco de 16
      const ztc = camada === 0 ? zt : Math.min(zt, 16);
      const fat = Math.pow(2, zt - ztc);
      for (let ty = Math.floor(y0 / fat); ty <= Math.floor(y1 / fat); ty++) {
        for (let tx = Math.floor(x0 / fat); tx <= Math.floor(x1 / fat); tx++) {
          const txw = ((tx % (n / fat)) + n / fat) % (n / fat);
          const url = u.replace('{z}', ztc).replace('{y}', ty).replace('{x}', txw);
          pedidos.push(carregarImagem(url).then(img => ({ img, camada, x: tx * ts * fat - ox, y: ty * ts * fat - oy, t: ts * fat })));
        }
      }
    });
    const blocos = await Promise.all(pedidos);
    const falhas = blocos.filter(b => !b.img && b.camada === 0).length;
    c.save();
    c.beginPath(); c.rect(area.x, area.y, area.w, area.h); c.clip();
    c.fillStyle = '#9AA3A6'; c.fillRect(area.x, area.y, area.w, area.h);
    if (f.escurecer) c.filter = 'brightness(.68) contrast(1.08)';
    [0, 1, 2].forEach(camada => blocos.filter(b => b.img && b.camada === camada).forEach(b => {
      if (camada === 1 && f.escurecer) c.filter = 'none';
      c.drawImage(b.img, area.x + b.x, area.y + b.y, b.t + .5, b.t + .5);
    }));
    c.filter = 'none';
    c.restore();
    return {
      falhas, total: blocos.filter(b => b.camada === 0).length,
      ponto: ll => { const q = crs.latLngToPoint(L.latLng(ll), z); return { x: area.x + q.x - ox, y: area.y + q.y - oy }; }
    };
  }

  async function gerarImagemRaio() {
    const postos = postosNoRaio();
    if (!postos.length) { toast('Nenhum posto dentro deste raio'); return; }
    const conteudoBotao = elR.gerar.innerHTML;
    elR.gerar.setAttribute('aria-disabled', 'true');
    elR.gerar.innerHTML = '<svg class="ic girando"><use href="#i-raio"/></svg>Gerando imagem…';
    const css = getComputedStyle(document.documentElement);
    const cor = v => css.getPropertyValue(v).trim();
    const tema = temaAtual();
    const sat = fundo === 'satelite';
    const f = FUNDOS[fundo](tema);
    const comb = estado.combustivel, nomeComb = COMBUSTIVEIS[comb];
    try {
      await Promise.all([document.fonts.ready, document.fonts.load('600 16px Barlow'), document.fonts.load('700 16px Barlow'), document.fonts.load('700 16px "Barlow Semi Condensed"')]);
      const W = RAIO_W, H = RAIO_H, CAB = RAIO_CAB, ROD = RAIO_ROD, LISTA = 500;
      const area = { x: 0, y: CAB, w: W - LISTA, h: H - CAB - ROD };
      const out = document.createElement('canvas');
      out.width = W; out.height = H;
      const c = out.getContext('2d');
      c.fillStyle = cor('--sup'); c.fillRect(0, 0, W, H);

      // zoom que encaixa o círculo na área do mapa, com folga
      const centro = L.latLng(raio.centro.lat, raio.centro.lng);
      const bb = centro.toBounds(raio.km * 2000);
      const p0 = L.CRS.EPSG3857.latLngToPoint(bb.getNorthWest(), 0), p1 = L.CRS.EPSG3857.latLngToPoint(bb.getSouthEast(), 0);
      const folga = 70;
      const z = Math.min(18, Math.log2(Math.min((area.w - folga * 2) / (p1.x - p0.x), (area.h - folga * 2) / (p1.y - p0.y))));
      const proj = await desenharFundo(c, area, centro, z, f);
      if (proj.falhas === proj.total) throw new Error('Os blocos do mapa não carregaram');

      // ordem da lista = numeração: mais barato primeiro, depois mais perto do centro
      const faixa = calcularFaixa(postos);
      const itens = postos.map(p => ({ p, v: precoDe(p, comb), d: p._distRaio, n: 0 }))
        .sort((a, b) => ((a.v ?? 1e9) - (b.v ?? 1e9)) || a.d - b.d);
      itens.forEach((it, i) => { it.n = i + 1; it.nivel = nivel(it.v, faixa); const q = proj.ponto([it.p.lat, it.p.lng]); it.rx = q.x; it.ry = q.y; });

      // raio: fora esmaecido, contorno, centro e rótulo de km
      const pc = proj.ponto(centro);
      const rpx = Math.abs(pc.y - proj.ponto([centro.lat + raio.km / 110.574, centro.lng]).y);
      c.save();
      c.beginPath(); c.rect(area.x, area.y, area.w, area.h); c.clip();
      c.beginPath(); c.rect(area.x, area.y, area.w, area.h); c.arc(pc.x, pc.y, rpx, 0, Math.PI * 2, true);
      c.fillStyle = sat ? 'rgba(8, 14, 16, .55)' : tema === 'escuro' ? 'rgba(10, 12, 15, .5)' : 'rgba(245, 246, 248, .6)';
      c.fill('evenodd');
      c.beginPath(); c.arc(pc.x, pc.y, rpx, 0, Math.PI * 2);
      c.lineWidth = 6; c.strokeStyle = 'rgba(0, 0, 0, .35)'; c.stroke();
      c.setLineDash([14, 10]); c.lineWidth = 3; c.strokeStyle = sat ? '#FFFFFF' : cor('--teal'); c.stroke();
      c.setLineDash([]);
      c.beginPath(); c.arc(pc.x, pc.y, 8, 0, Math.PI * 2); c.fillStyle = '#FFFFFF'; c.fill();
      c.lineWidth = 3.5; c.strokeStyle = cor('--teal'); c.stroke();
      c.beginPath(); c.arc(pc.x, pc.y, 2.5, 0, Math.PI * 2); c.fillStyle = cor('--teal'); c.fill();
      const rotKm = `${inteiro(raio.km)} km`;
      c.font = '700 18px "Barlow Semi Condensed", Barlow, sans-serif';
      const wk = c.measureText(rotKm).width + 24;
      const yk = Math.max(area.y + 10, pc.y - rpx - 15);
      c.fillStyle = cor('--tag-baixo');
      c.beginPath(); c.roundRect(pc.x - wk / 2, yk, wk, 30, 15); c.fill();
      c.fillStyle = cor('--tag-baixo-tx'); c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(rotKm, pc.x, yk + 15.5);
      c.textAlign = 'left';
      c.restore();

      // posição dos pinos: postos colados são afastados em anel, com linha até o ponto real
      const S = 1.3, PW = 30 * S, PH = 40 * S, MIN = 30;
      const colocados = [];
      itens.forEach(it => {
        let x = it.rx, y = it.ry;
        const livre = (px, py) => colocados.every(o => Math.hypot(o.x - px, o.y - py) >= MIN);
        if (!livre(x, y)) {
          let achou = false;
          for (let anel = 1; anel <= 4 && !achou; anel++) {
            const r = anel * 34, passos = 8 * anel;
            for (let k = 0; k < passos; k++) {
              const ang = -Math.PI / 2 + (k / passos) * Math.PI * 2;
              const nx = it.rx + Math.cos(ang) * r, ny = it.ry + Math.sin(ang) * r;
              if (livre(nx, ny) && nx > area.x + PW && nx < area.x + area.w - PW && ny > area.y + PH && ny < area.y + area.h - 8) { x = nx; y = ny; achou = true; break; }
            }
          }
        }
        it.x = x; it.y = y; it.deslocado = x !== it.rx || y !== it.ry;
        colocados.push({ x, y });
      });

      const corPino = n => n === 'baixo' ? cor('--tag-baixo') : n === 'alto' ? cor('--tag-alto') : n === 'sem' ? '#C9D0D2' : cor('--pino-medio');
      const corNum = n => n === 'baixo' ? cor('--tag-baixo') : n === 'alto' ? '#B4441B' : '#142023';
      // linhas guia dos pinos deslocados
      itens.filter(it => it.deslocado).forEach(it => {
        c.beginPath(); c.moveTo(it.rx, it.ry); c.lineTo(it.x, it.y);
        c.lineWidth = 3; c.strokeStyle = 'rgba(0, 0, 0, .45)'; c.stroke();
        c.lineWidth = 1.5; c.strokeStyle = '#FFFFFF'; c.stroke();
        c.beginPath(); c.arc(it.rx, it.ry, 4, 0, Math.PI * 2); c.fillStyle = '#FFFFFF'; c.fill();
        c.lineWidth = 1.5; c.strokeStyle = 'rgba(0, 0, 0, .5)'; c.stroke();
      });
      // pinos numerados (de cima para baixo, os de baixo por cima)
      [...itens].sort((a, b) => a.y - b.y).forEach(it => {
        c.save();
        c.translate(it.x - 15 * S, it.y - 39 * S);
        c.scale(S, S);
        if (inativo(it.p)) c.globalAlpha = .7;
        c.shadowColor = 'rgba(0, 0, 0, .45)'; c.shadowBlur = 6; c.shadowOffsetY = 2;
        c.fillStyle = corPino(it.nivel); c.fill(CAMINHO_PINO);
        c.shadowColor = 'transparent';
        c.lineWidth = 1.4; c.strokeStyle = '#FFFFFF'; c.stroke(CAMINHO_PINO);
        c.beginPath(); c.arc(15, 15.2, 8.6, 0, Math.PI * 2); c.fillStyle = '#FFFFFF'; c.fill();
        c.restore();
        c.font = `700 ${it.n > 99 ? 12 : 15}px "Barlow Semi Condensed", Barlow, sans-serif`;
        c.fillStyle = corNum(it.nivel); c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(String(it.n), it.x, it.y - 39 * S + 15.6 * S);
        c.textAlign = 'left';
      });

      // nome em cima do posto, só onde cabe sem sobrepor nada
      const areaRot = { x: area.x + 6, y: area.y + 6, w: area.w - 12, h: area.h - 12 };
      const ocupados = itens.map(it => ({ x: it.x - PW / 2 - 2, y: it.y - PH - 2, w: PW + 4, h: PH + 4 }));
      ocupados.push({ x: pc.x - wk / 2, y: Math.max(area.y + 10, pc.y - rpx - 15), w: wk, h: 30 });
      const RH = 26, fNome = '600 14px Barlow, sans-serif';
      let semRotulo = 0;
      itens.forEach(it => {
        c.font = fNome;
        const nome = encurtar(c, it.p.nome, 230);
        const RW = c.measureText(nome).width + 18;
        const topo = it.y - PH;
        const cands = [
          { x: it.x - RW / 2, y: topo - 5 - RH },
          { x: it.x + PW / 2 + 2, y: topo - RH + 8 },
          { x: it.x - PW / 2 - 2 - RW, y: topo - RH + 8 },
          { x: it.x + PW / 2 + 4, y: it.y - PH / 2 - RH / 2 - 4 },
          { x: it.x - PW / 2 - 4 - RW, y: it.y - PH / 2 - RH / 2 - 4 },
          { x: it.x - RW / 2, y: it.y + 4 }
        ].map(r => Object.assign(r, { w: RW, h: RH }));
        const r = cands.find(q => dentro(q, areaRot) && !sobreposicao(q, ocupados));
        if (!r) { semRotulo++; return; }
        ocupados.push(r);
        c.save();
        c.shadowColor = 'rgba(0, 0, 0, .35)'; c.shadowBlur = 8; c.shadowOffsetY = 2;
        c.fillStyle = 'rgba(255, 255, 255, .97)';
        c.beginPath(); c.roundRect(r.x, r.y, r.w, r.h, 6); c.fill();
        c.restore();
        c.font = fNome; c.fillStyle = '#142023'; c.textBaseline = 'middle';
        c.fillText(nome, r.x + 9, r.y + RH / 2 + 1);
      });

      // atribuição do fundo
      c.font = '500 12px Barlow, sans-serif';
      const wa = c.measureText(f.atribTexto).width + 16;
      c.fillStyle = 'rgba(255, 255, 255, .82)';
      c.fillRect(area.x + area.w - wa, area.y + area.h - 22, wa, 22);
      c.fillStyle = '#455458'; c.textBaseline = 'middle';
      c.fillText(f.atribTexto, area.x + area.w - wa + 8, area.y + area.h - 11);

      // lista lateral
      const lx = W - LISTA, ly = CAB;
      c.fillStyle = cor('--sup'); c.fillRect(lx, ly, LISTA, area.h);
      c.fillStyle = cor('--linha'); c.fillRect(lx, ly, 1, area.h);
      c.textBaseline = 'alphabetic';
      c.font = '700 13px Barlow, sans-serif'; c.fillStyle = cor('--texto-3');
      c.fillText('POSTOS NO RAIO · MENOR PREÇO PRIMEIRO', lx + 28, ly + 34);
      c.font = '700 13px Barlow, sans-serif';
      const tit2 = `${nomeComb} R$/L`;
      c.textAlign = 'right'; c.fillText(tit2.toUpperCase(), W - 28, ly + 34); c.textAlign = 'left';
      const topoLista = ly + 50, fimLista = ly + area.h - 16;
      const disp = fimLista - topoLista;
      let alt = Math.floor(disp / itens.length);
      let cabe = itens.length;
      if (alt < 30) { alt = 30; cabe = Math.floor((disp - 30) / alt); }
      alt = Math.min(alt, 58);
      const duasLinhas = alt >= 46;
      itens.slice(0, cabe).forEach((it, i) => {
        const y = topoLista + i * alt;
        if (i) { c.fillStyle = cor('--linha'); c.fillRect(lx + 28, y, LISTA - 56, 1); }
        const cy = y + alt / 2;
        const rb = duasLinhas ? 14 : 12;
        c.beginPath(); c.arc(lx + 28 + rb, cy, rb, 0, Math.PI * 2); c.fillStyle = corPino(it.nivel); c.fill();
        c.font = `700 ${duasLinhas ? 15 : 13}px "Barlow Semi Condensed", Barlow, sans-serif`;
        c.fillStyle = it.nivel === 'baixo' ? cor('--tag-baixo-tx') : it.nivel === 'alto' ? cor('--tag-alto-tx') : it.nivel === 'sem' ? '#142023' : '#FFFFFF';
        c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(it.n), lx + 28 + rb, cy + 1); c.textAlign = 'left';
        const tx = lx + 28 + rb * 2 + 12;
        const precoTxt = it.v === null ? '—' : preco(it.v);
        c.font = `700 ${duasLinhas ? 24 : 18}px "Barlow Semi Condensed", Barlow, sans-serif`;
        const wp = c.measureText(precoTxt).width;
        c.fillStyle = it.v === null ? cor('--texto-3') : it.nivel === 'baixo' ? cor('--destaque') : it.nivel === 'alto' ? cor('--acao-forte') : cor('--texto');
        c.textAlign = 'right';
        c.fillText(precoTxt, W - 28, duasLinhas ? cy - 4 : cy + 1);
        if (duasLinhas && it.v !== null) {
          c.font = '500 12px Barlow, sans-serif'; c.fillStyle = cor('--texto-3');
          c.fillText(dataBR(it.p.precos[comb].data), W - 28, cy + 15);
        }
        c.textAlign = 'left';
        const maxNome = W - 28 - wp - 16 - tx;
        c.font = `600 ${duasLinhas ? 16 : 14}px Barlow, sans-serif`; c.fillStyle = inativo(it.p) ? cor('--texto-3') : cor('--texto');
        c.fillText(encurtar(c, it.p.nome, maxNome), tx, duasLinhas ? cy - 6 : cy + 1);
        if (duasLinhas) {
          c.font = '500 13px Barlow, sans-serif'; c.fillStyle = cor('--texto-3');
          const sub = `${nomeCidade(it.p)}/${it.p.uf} · ${km(it.d)} do centro${inativo(it.p) ? ' · sem uso' : ''}`;
          c.fillText(encurtar(c, sub, maxNome), tx, cy + 13);
        }
      });
      if (cabe < itens.length) {
        c.font = '600 14px Barlow, sans-serif'; c.fillStyle = cor('--acao-forte');
        c.fillText(`+ ${plural(itens.length - cabe, 'posto', 'postos')} fora da lista. Reduza o raio para ver todos.`, lx + 28, fimLista);
      }

      // cabeçalho
      c.fillStyle = cor('--sup'); c.fillRect(0, 0, W, CAB);
      let x = 40;
      if (el.logo.complete && el.logo.naturalWidth && !el.logo.classList.contains('sem-logo')) {
        const h = 48, w = h * el.logo.naturalWidth / el.logo.naturalHeight;
        c.drawImage(el.logo, x, (CAB - h) / 2, w, h);
        x += w + 24;
        c.fillStyle = cor('--linha-forte'); c.fillRect(x, 26, 1, CAB - 52);
        x += 24;
      }
      c.textBaseline = 'alphabetic';
      c.fillStyle = cor('--texto'); c.font = '600 28px Barlow, sans-serif';
      c.fillText(CFG.TITULO, x, 44);
      const resumo = [`Raio de ${inteiro(raio.km)} km a partir de ${raio.nomeCentro.replace(/^perto de /, '')}`,
        estado.periodo === 'tudo' ? 'todo o período' : `últimos ${estado.periodo} dias`].join('  ·  ');
      c.fillStyle = cor('--texto-2'); c.font = '500 18px Barlow, sans-serif';
      c.fillText(resumo, x, 72);
      // números-chave à direita
      const chave = [[inteiro(itens.length), itens.length === 1 ? 'posto' : 'postos'],
        [faixa ? preco(faixa.min) : '—', `menor ${nomeComb}`], [faixa ? preco(faixa.max) : '—', `maior ${nomeComb}`]];
      let xc = W - 40;
      [...chave].reverse().forEach(([num, rot]) => {
        c.font = '500 13px Barlow, sans-serif';
        const wr = c.measureText(rot).width;
        c.font = '700 30px "Barlow Semi Condensed", Barlow, sans-serif';
        const wn = c.measureText(num).width;
        const wcol = Math.max(wr, wn);
        c.textAlign = 'right';
        c.fillStyle = cor('--texto'); c.fillText(num, xc, 48);
        c.font = '500 13px Barlow, sans-serif'; c.fillStyle = cor('--texto-3'); c.fillText(rot, xc, 70);
        c.textAlign = 'left';
        xc -= wcol + 40;
      });
      c.fillStyle = cor('--teal'); c.fillRect(0, CAB - 3, W * .72, 3);
      c.fillStyle = cor('--laranja'); c.fillRect(W * .72, CAB - 3, W * .28, 3);

      // rodapé
      const yR = H - ROD;
      c.fillStyle = cor('--sup'); c.fillRect(0, yR, W, ROD);
      c.fillStyle = cor('--linha'); c.fillRect(0, yR, W, 1);
      c.textBaseline = 'middle';
      let xr = 40;
      c.font = '700 15px Barlow, sans-serif'; c.fillStyle = cor('--texto');
      c.fillText(nomeComb, xr, yR + ROD / 2); xr += c.measureText(nomeComb).width + 22;
      [['baixo', 'Mais barato'], ['medio', 'Na média'], ['alto', 'Mais caro']].forEach(([n, t]) => {
        c.beginPath(); c.arc(xr + 8, yR + ROD / 2, 8, 0, Math.PI * 2); c.fillStyle = corPino(n); c.fill();
        c.font = '500 15px Barlow, sans-serif'; c.fillStyle = cor('--texto-2');
        c.fillText(t, xr + 22, yR + ROD / 2); xr += 22 + c.measureText(t).width + 26;
      });
      if (semRotulo) {
        c.font = '500 14px Barlow, sans-serif'; c.fillStyle = cor('--texto-3');
        c.fillText('O número no pino corresponde à lista ao lado.', xr + 8, yR + ROD / 2);
      }
      const agora = new Date();
      const geradoTxt = agora.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', ' às');
      c.font = '500 14px Barlow, sans-serif'; c.fillStyle = cor('--texto-3'); c.textAlign = 'right';
      c.fillText(`Imagem gerada em ${geradoTxt}  ·  ${estado.atualizadoTexto || ''}`, W - 40, yR + ROD / 2);
      c.textAlign = 'left';

      const blob = await new Promise(res => out.toBlob(res, 'image/png'));
      const stamp = `${agora.getFullYear()}${String(agora.getMonth() + 1).padStart(2, '0')}${String(agora.getDate()).padStart(2, '0')}-${String(agora.getHours()).padStart(2, '0')}${String(agora.getMinutes()).padStart(2, '0')}`;
      const slug = norm(raio.nomeCentro.replace(/^perto de /, '')).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'centro';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `mapa-raio-${raio.km}km-${slug}-${stamp}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast(proj.falhas ? `Imagem baixada. ${proj.falhas} blocos do mapa não carregaram.` : `Imagem 1920×1080 baixada com ${plural(itens.length, 'posto', 'postos')}`);
    } catch (err) {
      console.error(err);
      toast('Não foi possível gerar a imagem: ' + (err && err.message ? err.message : 'erro desconhecido'));
    } finally {
      elR.gerar.innerHTML = conteudoBotao;
      elR.gerar.setAttribute('aria-disabled', String(!postosNoRaio().length));
    }
  }

  // ---------------------------------------------------------------- URL (#hash)
  let escrevendoHash = false;
  function escreverHash() {
    const p = new URLSearchParams();
    if (estado.selecionado) p.set('posto', estado.selecionado);
    if (estado.uf) p.set('uf', estado.uf);
    if (estado.cidade) p.set('cidade', estado.cidade);
    if (estado.combustivel !== CFG.COMBUSTIVEL_PADRAO) p.set('c', estado.combustivel);
    if (estado.periodo !== 'tudo') p.set('p', estado.periodo);
    const h = p.toString();
    if (('#' + h) === location.hash || (!h && !location.hash)) return;
    escrevendoHash = true;
    history.replaceState(null, '', h ? '#' + h : location.pathname + location.search);
    setTimeout(() => { escrevendoHash = false; }, 0);
  }
  function lerHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    const uf = p.get('uf');
    estado.uf = uf && UF_CODIGO[uf] ? uf : null;
    estado.cidade = p.get('cidade') || null;
    if (p.get('c') && COMBUSTIVEIS[p.get('c')]) estado.combustivel = p.get('c');
    if (['30', '90'].includes(p.get('p'))) estado.periodo = p.get('p');
    marcarSeg('#seg-combustivel', estado.combustivel);
    marcarSeg('#seg-periodo', estado.periodo);
    const id = p.get('posto');
    if (id && estado.porId[id]) setTimeout(() => { mapa.stop(); selecionar(id, { centralizar: true, semAnimacao: true }); }, 450);
  }
  addEventListener('hashchange', () => { if (!escrevendoHash && estado.dados) { lerHash(); atualizar({ ajustar: !location.hash.includes('posto=') }); } });

  // ---------------------------------------------------------------- início
  document.title = CFG.TITULO;
  $('#titulo').textContent = CFG.TITULO;
  if (CFG.LOGO) el.logo.src = CFG.LOGO;
  el.logo.addEventListener('error', () => { el.logo.classList.add('sem-logo'); $('.marca-divisor').hidden = true; });
  marcarSeg('#seg-combustivel', estado.combustivel);
  trocarAba('posto', false);
  carregarMalhaUFs();
  carregarDados();
  addEventListener('resize', () => mapa.invalidateSize());
})();
