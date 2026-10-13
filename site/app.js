/* Mapa de Abastecimentos — app.js (sem build, sem framework) */
(function () {
  'use strict';

  const CFG = Object.assign({
    API_URL: '', TITULO: 'Mapa de Abastecimentos', LOGO: '', COMBUSTIVEL_PADRAO: 'dieselS10', DIAS_SEM_USO: 90
  }, window.MAPA_CONFIG || {});

  const COMBUSTIVEIS = { gasolina: 'Gasolina', dieselS10: 'Diesel S10', arla: 'ARLA' };
  const UF_CODIGO = { RO: 11, AC: 12, AM: 13, RR: 14, PA: 15, AP: 16, TO: 17, MA: 21, PI: 22, CE: 23, RN: 24, PB: 25, PE: 26, AL: 27, SE: 28, BA: 29, MG: 31, ES: 32, RJ: 33, SP: 35, PR: 41, SC: 42, RS: 43, MS: 50, MT: 51, GO: 52, DF: 53 };
  const UF_NOME = { AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins' };
  const IBGE = 'https://servicodados.ibge.gov.br/api';
  const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/';
  const TILES = {
    claro: { base: ESRI + 'World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', ref: ESRI + 'World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}' },
    escuro: { base: ESRI + 'World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', ref: ESRI + 'World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}' }
  };
  const ATRIB = 'Mapa &copy; <a href="https://www.esri.com">Esri</a>, HERE, Garmin, &copy; OpenStreetMap · Malhas IBGE';

  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const el = {
    status: $('#status'), statusMovel: $('#status-movel'), lista: $('#lista'), busca: $('#busca'), buscaLimpar: $('#busca-limpar'),
    chips: $('#chips'), resumo: $('#resumo'), ordem: $('#ordem'), legenda: $('#legenda'),
    detalhe: $('#detalhe'), painel: $('#painel'), alca: $('#painel-alca'), toast: $('#toast'),
    btnTema: $('#btn-tema'), btnPerto: $('#btn-perto'), btnCaptura: $('#btn-captura'),
    captura: $('#captura'), capturaRet: $('#captura-ret'), capturaDica: $('#captura-dica'),
    capturaBarra: $('#captura-barra'), capturaMedida: $('#captura-medida'), logo: $('#logo'),
    aviso: $('#aviso-exemplo'), mapa: $('#mapa')
  };

  const estado = {
    dados: null, postos: [], porId: {},
    aba: 'posto', busca: '', periodo: 'tudo', combustivel: CFG.COMBUSTIVEL_PADRAO in COMBUSTIVEIS ? CFG.COMBUSTIVEL_PADRAO : 'dieselS10',
    uf: null, mesoId: null, cidade: null, selecionado: null, ordem: 'recente',
    usuario: null, filtrados: [], faixa: null
  };

  // ---------------------------------------------------------------- utilidades
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const moeda = n => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
    if (n.includes('ARLA')) return 'ARLA 32';
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
  const ehCelular = () => matchMedia('(max-width: 760px)').matches;
  const precoDe = (p, tipo) => (p.precos && p.precos[tipo]) ? p.precos[tipo].ultimo : null;
  const inativo = p => diasDesde(p.ultimo && p.ultimo.data) > CFG.DIAS_SEM_USO;

  // ---------------------------------------------------------------- tema
  function aplicarTema(tema) {
    document.documentElement.dataset.theme = tema;
    const escuro = tema === 'escuro';
    el.btnTema.innerHTML = `<svg class="ic"><use href="#i-${escuro ? 'sol' : 'lua'}"/></svg>`;
    el.btnTema.setAttribute('aria-label', escuro ? 'Usar tema claro' : 'Usar tema escuro');
    $('meta[name="theme-color"]').setAttribute('content', escuro ? '#202428' : '#FFFFFF');
    if (camadaBase) { camadaBase.setUrl(TILES[tema].base); camadaRef.setUrl(TILES[tema].ref); }
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
  let camadaBase = L.tileLayer(TILES[temaInicial].base, { attribution: ATRIB, maxZoom: 19, maxNativeZoom: 16, crossOrigin: 'anonymous' }).addTo(mapa);
  mapa.createPane('rotulos').style.zIndex = 450;
  mapa.getPane('rotulos').style.pointerEvents = 'none';
  let camadaRef = L.tileLayer(TILES[temaInicial].ref, { pane: 'rotulos', maxZoom: 19, maxNativeZoom: 16, crossOrigin: 'anonymous' }).addTo(mapa);
  aplicarTema(temaInicial);

  const malhaPane = mapa.createPane('malhas');
  malhaPane.style.zIndex = 350;
  let camadaUFs = null, camadaMeso = null, mesoNomes = {};

  const grupo = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: z => (z >= 10 ? 64 : 92),
    spiderfyOnMaxZoom: true,
    disableClusteringAtZoom: 12,
    iconCreateFunction(cluster) {
      const filhos = cluster.getAllChildMarkers();
      let min = null;
      filhos.forEach(m => { const v = m.options.preco; if (v !== null && (min === null || v < min)) min = v; });
      const n = filhos.length;
      return L.divIcon({
        className: 'tag-ancora',
        html: `<div class="grupo-pin ${nivel(min)}" title="${plural(n, 'posto', 'postos')}${min !== null ? `, menor preço R$ ${preco(min)}` : ''}"><b>${n}</b>${min !== null ? `<span><small>mín.</small> ${preco(min)}</span>` : ''}</div>`,
        iconSize: [110, 36], iconAnchor: [55, 18]
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
        camadaUFs = L.geoJSON(geo, {
          pane: 'malhas', interactive: false,
          style: () => ({ color: getComputedStyle(document.documentElement).getPropertyValue('--teal').trim() || '#00989E', weight: 1, opacity: .45, fill: false })
        }).addTo(mapa);
      })
      .catch(() => { /* contornos são opcionais */ });
  }

  let mesoPedido = 0;
  function carregarMalhaMeso(uf) {
    const pedido = ++mesoPedido;
    if (camadaMeso) { mapa.removeLayer(camadaMeso); camadaMeso = null; }
    if (!uf || !UF_CODIGO[uf]) return;
    const cod = UF_CODIGO[uf];
    Promise.all([
      fetch(`${IBGE}/v3/malhas/estados/${cod}?intrarregiao=mesorregiao&formato=application/vnd.geo%2Bjson&qualidade=minima`).then(r => r.json()),
      fetch(`${IBGE}/v1/localidades/estados/${cod}/mesorregioes`).then(r => r.json()).catch(() => [])
    ]).then(([geo, nomes]) => {
      if (pedido !== mesoPedido) return;
      (nomes || []).forEach(m => { mesoNomes[m.id] = m.nome; });
      camadaMeso = L.geoJSON(geo, {
        pane: 'malhas',
        style: f => estiloMeso(f),
        onEachFeature(f, camada) {
          const id = Number(f.properties.codarea);
          camada.bindTooltip(mesoNomes[id] || 'Mesorregião', { sticky: true, className: 'rotulo-meso', direction: 'top', offset: [0, -8] });
          camada.on('click', () => { definirFiltro({ mesoId: estado.mesoId === id ? null : id, cidade: null }); });
          camada.on('mouseover', () => camada.setStyle({ fillOpacity: estado.mesoId === id ? .16 : .08 }));
          camada.on('mouseout', () => camadaMeso && camadaMeso.resetStyle(camada));
        }
      }).addTo(mapa);
    }).catch(() => { /* sem malha: segue só com os postos */ });
  }
  function estiloMeso(f) {
    const id = Number(f.properties.codarea);
    const ativo = estado.mesoId === id;
    const cor = getComputedStyle(document.documentElement).getPropertyValue('--teal').trim() || '#00989E';
    return { color: cor, weight: ativo ? 2.5 : 1.25, opacity: ativo ? 1 : .7, fillColor: cor, fillOpacity: ativo ? .12 : 0, dashArray: ativo ? null : '4 3' };
  }

  // ---------------------------------------------------------------- dados
  async function carregarDados() {
    renderEsqueleto();
    const exemplo = !CFG.API_URL;
    const url = exemplo ? 'dados-exemplo.json' : CFG.API_URL;
    const chaveCache = 'mapa-dados-v1';

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
    estado.postos = json.postos.map(p => Object.assign({}, p, {
      _busca: norm([p.nome, p.razao, p.endereco, p.cidade, p.uf, p.cnpj, p.mesorregiao].join(' ')),
      _cidade: norm(p.cidade), _temCoord: p.lat !== null && p.lng !== null && !isNaN(p.lat) && !isNaN(p.lng)
    }));
    estado.porId = {};
    estado.postos.forEach(p => { estado.porId[p.id] = p; if (p.mesorregiaoId) mesoNomes[p.mesorregiaoId] = p.mesorregiao; });
    el.aviso.hidden = !exemplo;
    const quandoGerado = json.geradoEm ? new Date(json.geradoEm) : null;
    const g = quandoGerado && !isNaN(quandoGerado) ? quandoGerado.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', ' às') : '—';
    estado.atualizadoTexto = exemplo ? `Dados de exemplo (sintéticos) de ${g}` : `Dados atualizados em ${g}${doCache ? ' (cópia salva)' : ''}`;
    el.status.innerHTML = `${exemplo ? `<b>Dados de exemplo</b> de ${esc(g)}` : `Atualizado em <b>${esc(g)}</b>${doCache ? ' (cópia salva)' : ''}`} · <b>${inteiro(estado.postos.length)}</b> postos desde ${dataBR(json.periodoInicio)}`;
    el.statusMovel.textContent = `${exemplo ? `Dados de exemplo de ${g}` : `Atualizado em ${g}`} · ${plural(estado.postos.length, 'posto', 'postos')}`;
    lerHash();
    atualizar({ ajustar: true });
  }

  // ---------------------------------------------------------------- filtros
  function filtrar() {
    const q = norm(estado.busca);
    const termos = q ? q.split(/\s+/) : [];
    return estado.postos.filter(p => {
      if (estado.periodo !== 'tudo' && diasDesde(p.ultimo && p.ultimo.data) > Number(estado.periodo)) return false;
      if (estado.uf && p.uf !== estado.uf) return false;
      if (estado.mesoId && p.mesorregiaoId !== estado.mesoId) return false;
      if (estado.cidade && `${p.uf}|${p._cidade}` !== estado.cidade) return false;
      if (termos.length) {
        const alvo = estado.aba === 'cidade' ? `${p._cidade} ${norm(p.uf)}`
          : estado.aba === 'estado' ? norm(`${p.uf} ${UF_NOME[p.uf] || ''} ${p.mesorregiao}`) : p._busca;
        if (!termos.every(t => alvo.includes(t))) return false;
      }
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
  function nivel(v) {
    const f = estado.faixa;
    if (v === null || !f) return 'sem';
    if (f.p33 === null || f.min === f.max) return 'medio';
    if (v <= f.p33) return 'baixo';
    if (v > f.p67) return 'alto';
    return 'medio';
  }

  function definirFiltro(mud, opcoes) {
    const ufAntes = estado.uf;
    Object.assign(estado, mud);
    if (mud.uf !== undefined && mud.uf !== ufAntes) { estado.mesoId = mud.mesoId || null; carregarMalhaMeso(estado.uf); }
    else if (camadaMeso) camadaMeso.setStyle(estiloMeso);
    atualizar(Object.assign({ ajustar: true }, opcoes));
  }

  function atualizar(opcoes) {
    opcoes = opcoes || {};
    estado.filtrados = filtrar();
    estado.faixa = calcularFaixa(estado.filtrados);
    renderMarcadores();
    renderChips();
    renderResumo();
    renderLista();
    renderLegenda();
    if (estado.selecionado && !estado.porId[estado.selecionado]) estado.selecionado = null;
    if (opcoes.ajustar) ajustarMapa();
    escreverHash();
  }

  function ajustarMapa() {
    const pts = estado.filtrados.filter(p => p._temCoord).map(p => [p.lat, p.lng]);
    if (!pts.length) return;
    const pad = ehCelular() ? { paddingTopLeft: [24, 60], paddingBottomRight: [24, 190] } : { paddingTopLeft: [40, 70], paddingBottomRight: [estado.selecionado ? 420 : 40, 40] };
    if (pts.length === 1) mapa.setView(pts[0], 13, { animate: true });
    else mapa.fitBounds(L.latLngBounds(pts), Object.assign({ maxZoom: 13, animate: true }, pad));
  }

  // ---------------------------------------------------------------- marcadores
  function iconeTag(p, sel) {
    const v = precoDe(p, estado.combustivel);
    const cls = ['tag', nivel(v), inativo(p) ? 'inativo' : '', sel ? 'sel' : ''].join(' ');
    const txt = v === null ? '—' : `<small>R$</small>${preco(v)}`;
    return L.divIcon({ className: 'tag-ancora' + (sel ? ' selecionado' : ''), html: `<div class="${cls}">${txt}</div>`, iconSize: [84, 40], iconAnchor: [42, 40] });
  }
  function renderMarcadores() {
    grupo.clearLayers();
    marcadores = {};
    const novos = [];
    estado.filtrados.forEach(p => {
      if (!p._temCoord) return;
      const m = L.marker([p.lat, p.lng], {
        icon: iconeTag(p, p.id === estado.selecionado),
        preco: precoDe(p, estado.combustivel),
        title: `${p.nome} — ${p.cidade}/${p.uf}`,
        keyboard: true,
        riseOnHover: true
      });
      m.on('click', () => selecionar(p.id, { centralizar: false }));
      marcadores[p.id] = m;
      novos.push(m);
    });
    grupo.addLayers(novos);
  }

  // ---------------------------------------------------------------- painel
  function renderEsqueleto() {
    el.lista.innerHTML = Array.from({ length: 7 }, () => '<div class="esqueleto"><i></i><i></i></div>').join('');
  }

  function renderChips() {
    const chips = [];
    if (estado.uf) chips.push(['uf', `${UF_NOME[estado.uf] || estado.uf}`, 'Estado']);
    if (estado.mesoId) chips.push(['meso', mesoNomes[estado.mesoId] || 'Mesorregião', 'Mesorregião']);
    if (estado.cidade) {
      const p = estado.postos.find(x => `${x.uf}|${x._cidade}` === estado.cidade);
      chips.push(['cidade', p ? `${p.cidade}/${p.uf}` : 'Cidade', 'Cidade']);
    }
    el.chips.innerHTML = chips.map(([k, nome, tipo]) =>
      `<button class="chip" type="button" data-remover="${k}" aria-label="Remover filtro ${esc(tipo)}: ${esc(nome)}"><span>${esc(tipo)}</span> ${esc(nome)}<svg class="ic"><use href="#i-fechar"/></svg></button>`).join('');
  }
  el.chips.addEventListener('click', e => {
    const b = e.target.closest('[data-remover]');
    if (!b) return;
    const k = b.dataset.remover;
    if (k === 'uf') definirFiltro({ uf: null, mesoId: null, cidade: null });
    if (k === 'meso') definirFiltro({ mesoId: null, cidade: null });
    if (k === 'cidade') definirFiltro({ cidade: null });
  });

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

  function itemPosto(p) {
    const v = precoDe(p, estado.combustivel);
    const info = p.precos && p.precos[estado.combustivel];
    const inat = inativo(p);
    const dist = estado.usuario && p._temCoord ? `<span class="distancia">${km(distanciaKm(estado.usuario, p))}</span> · ` : '';
    const dias = diasDesde(p.ultimo && p.ultimo.data);
    return `<button class="item${inat ? ' inativo' : ''}" role="listitem" data-id="${esc(p.id)}" aria-current="${p.id === estado.selecionado}">
      <span class="item-nome">${esc(p.nome)}${inat ? `<span class="carimbo">SEM USO ${dias}D</span>` : ''}</span>
      <span class="item-preco"><span class="valor">${v === null ? '<small>sem</small>—' : `<small>R$</small>${preco(v)}`}</span><span class="quando">${info ? dataCurta(info.data) : COMBUSTIVEIS[estado.combustivel]}</span></span>
      <span class="item-sub">${dist}${esc(p.cidade)}/${esc(p.uf)} · ${quando(p.ultimo && p.ultimo.data)}</span>
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

  function renderLista() {
    const lista = estado.filtrados;
    if (!lista.length) {
      const temFiltro = estado.busca || estado.uf || estado.cidade || estado.periodo !== 'tudo';
      el.lista.innerHTML = `<div class="vazio"><strong>Nenhum posto encontrado</strong>
        ${estado.busca ? `Nada corresponde a “${esc(estado.busca)}”.` : 'Nenhum abastecimento neste filtro.'}
        ${temFiltro ? '<br><button class="botao" type="button" data-acao="limpar">Limpar filtros</button>' : ''}</div>`;
      return;
    }
    let html = '';
    if (estado.aba === 'posto') {
      html = ordenar(lista).map(itemPosto).join('');
    } else if (estado.aba === 'cidade') {
      const grupos = [...agrupar(lista, p => `${p.uf}|${p._cidade}`).entries()]
        .sort((a, b) => b[1].length - a[1].length || a[1][0].cidade.localeCompare(b[1][0].cidade, 'pt-BR'));
      html = grupos.map(([k, ps]) => `<button class="item item-grupo" role="listitem" data-cidade="${esc(k)}">
          <span class="item-nome">${esc(ps[0].cidade)} <span style="color:var(--texto-3);font-weight:500">/ ${esc(ps[0].uf)}</span></span>
          <span class="item-preco faixa">${faixaTexto(ps)}</span>
          <span class="item-sub">${plural(ps.length, 'posto', 'postos')} · ${esc(ps[0].mesorregiao)}</span>
          <svg class="ic"><use href="#i-chevron"/></svg></button>`).join('');
    } else {
      const ufs = [...agrupar(lista, p => p.uf).entries()].sort((a, b) => b[1].length - a[1].length);
      html = ufs.map(([uf, ps]) => {
        const mesos = [...agrupar(ps, p => p.mesorregiaoId || p.mesorregiao).entries()].sort((a, b) => b[1].length - a[1].length);
        return `<div class="grupo-titulo"><span>${esc(UF_NOME[uf] || uf)}</span><span>${plural(ps.length, 'posto', 'postos')}</span></div>
          <button class="item item-grupo uf" role="listitem" data-uf="${esc(uf)}">
            <span class="item-nome">Todo o estado · ${esc(uf)}</span><span class="item-preco faixa">${faixaTexto(ps)}</span>
            <span class="item-sub">${plural(mesos.length, 'mesorregião', 'mesorregiões')} · ${plural(new Set(ps.map(p => p._cidade)).size, 'cidade', 'cidades')}</span>
            <svg class="ic"><use href="#i-chevron"/></svg></button>` +
          mesos.map(([id, mp]) => `<button class="item item-grupo meso" role="listitem" data-uf="${esc(uf)}" data-meso="${esc(mp[0].mesorregiaoId || '')}">
            <span class="item-nome">${esc(mp[0].mesorregiao)}</span><span class="item-preco faixa">${faixaTexto(mp)}</span>
            <span class="item-sub">${plural(mp.length, 'posto', 'postos')} · ${plural(new Set(mp.map(p => p._cidade)).size, 'cidade', 'cidades')}</span>
            <svg class="ic"><use href="#i-chevron"/></svg></button>`).join('');
      }).join('');
    }
    el.lista.innerHTML = html;
  }

  el.lista.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.acao === 'limpar') {
      el.busca.value = ''; estado.busca = ''; el.buscaLimpar.hidden = true;
      marcarSeg('#seg-periodo', 'tudo'); estado.periodo = 'tudo';
      definirFiltro({ uf: null, mesoId: null, cidade: null });
      return;
    }
    if (b.dataset.id) { selecionar(b.dataset.id, { centralizar: true }); return; }
    if (b.dataset.cidade) {
      trocarAba('posto', true);
      definirFiltro({ cidade: b.dataset.cidade });
      return;
    }
    if (b.dataset.uf) {
      const meso = b.dataset.meso ? Number(b.dataset.meso) || null : null;
      trocarAba('posto', true);
      definirFiltro({ uf: b.dataset.uf, mesoId: meso, cidade: null });
    }
  });

  function trocarAba(aba, limparBusca) {
    estado.aba = aba;
    $$('.aba').forEach(b => b.setAttribute('aria-selected', String(b.dataset.aba === aba)));
    el.busca.placeholder = aba === 'posto' ? 'Buscar posto, endereço ou CNPJ' : aba === 'cidade' ? 'Buscar cidade' : 'Buscar estado ou mesorregião';
    if (limparBusca && estado.busca) { estado.busca = ''; el.busca.value = ''; el.buscaLimpar.hidden = true; }
  }
  $$('.aba').forEach(b => b.addEventListener('click', () => { trocarAba(b.dataset.aba, false); atualizar(); }));
  $('.abas').addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const abas = $$('.aba'); const i = abas.findIndex(a => a.dataset.aba === estado.aba);
    const n = abas[(i + (e.key === 'ArrowRight' ? 1 : abas.length - 1)) % abas.length];
    n.focus(); n.click();
  });

  let buscaTimer;
  el.busca.addEventListener('input', () => {
    el.buscaLimpar.hidden = !el.busca.value;
    clearTimeout(buscaTimer);
    buscaTimer = setTimeout(() => { estado.busca = el.busca.value; atualizar({ ajustar: true }); }, 160);
  });
  el.busca.addEventListener('focus', () => { if (ehCelular()) definirFolha('cheio'); });
  el.buscaLimpar.addEventListener('click', () => { el.busca.value = ''; estado.busca = ''; el.buscaLimpar.hidden = true; el.busca.focus(); atualizar({ ajustar: true }); });

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
      <span class="amostra"><i style="background:var(--tag-baixo)"></i>Mais barato</span>
      <span class="amostra"><i style="background:var(--tag-medio);border-color:var(--linha-forte)"></i>Na média</span>
      <span class="amostra"><i style="background:var(--tag-alto)"></i>Mais caro</span>` : '';
  }

  // ---------------------------------------------------------------- seleção + detalhe
  function selecionar(id, opcoes) {
    const anterior = estado.selecionado;
    estado.selecionado = id;
    [anterior, id].forEach(x => {
      const p = estado.porId[x], m = marcadores[x];
      if (p && m) m.setIcon(iconeTag(p, x === id));
    });
    $$('.item[data-id]').forEach(b => b.setAttribute('aria-current', String(b.dataset.id === id)));
    renderDetalhe();
    const p = estado.porId[id];
    if (p && p._temCoord && opcoes && opcoes.centralizar !== false) {
      const m = marcadores[id];
      const ir = () => {
        // Desloca o centro para o posto não ficar atrás do painel de detalhes
        const zoom = Math.min(Math.max(mapa.getZoom(), 13), 15);
        const alvo = mapa.project([p.lat, p.lng], zoom);
        // celular: a folha de detalhes ocupa até 56% da altura; o posto fica no centro da faixa visível
        const desloc = ehCelular() ? L.point(0, Math.round(innerHeight * 0.56 / 2)) : L.point(195, 0);
        mapa.setView(mapa.unproject(alvo.add(desloc), zoom), zoom, { animate: !(opcoes && opcoes.semAnimacao) });
      };
      ir();
    }
    if (ehCelular()) definirFolha('espiar');
    escreverHash();
  }

  function fecharDetalhe() {
    const id = estado.selecionado;
    estado.selecionado = null;
    el.detalhe.hidden = true;
    const p = estado.porId[id], m = marcadores[id];
    if (p && m) m.setIcon(iconeTag(p, false));
    $$('.item[data-id]').forEach(b => b.setAttribute('aria-current', 'false'));
    escreverHash();
  }

  function linkPosto(p) {
    const u = new URL(location.href);
    u.hash = `posto=${encodeURIComponent(p.id)}`;
    return u.toString();
  }

  function blocoPreco(p, tipo) {
    const info = p.precos && p.precos[tipo];
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
          <b>${esc(p.endereco || 'Endereço não informado')}</b>${esc(p.cidade)}/${esc(p.uf)} · ${esc(p.mesorregiao)}${dist}
          ${p._temCoord ? '' : '<br><span style="color:var(--acao-forte)">Sem coordenadas na Sisatec — busca pelo endereço no Google Maps.</span>'}
        </div></div>
        <span class="det-status${inat ? ' inativo' : ''}">${inat ? `Sem uso há ${dias} dias` : `Último abastecimento ${quando(u.data)}`}</span>
      </div>
      <div class="det-corpo">
        <section class="det-secao"><h3>Último preço pago (R$/L)</h3>
          <div class="precos">${['gasolina', 'dieselS10', 'arla'].map(t => blocoPreco(p, t)).join('')}</div>
        </section>
        <section class="det-secao"><h3>Último abastecimento</h3>
          <dl class="fatos">
            <div class="fato"><dt>Data</dt><dd>${dataBR(u.data)} ${esc(u.hora || '')}</dd></div>
            <div class="fato"><dt>Serviço</dt><dd>${esc(nomeServico(u.combustivel))}</dd></div>
            <div class="fato"><dt>Litros</dt><dd>${u.litros ? moeda(u.litros) + ' L' : '—'}</dd></div>
            <div class="fato"><dt>Valor</dt><dd>${u.valor ? 'R$ ' + moeda(u.valor) : '—'}</dd></div>
          </dl>
        </section>
        <section class="det-secao"><h3>Desde ${dataBR(p.totais && p.totais.primeiro)}</h3>
          <dl class="fatos">
            <div class="fato"><dt>Abastecimentos</dt><dd>${inteiro(p.totais ? p.totais.abastecimentos : 0)}</dd></div>
            <div class="fato"><dt>Litros</dt><dd>${inteiro(p.totais ? p.totais.litros : 0)} L</dd></div>
            <div class="fato largo"><dt>Valor total</dt><dd>R$ ${moeda(p.totais ? p.totais.valor : 0)}</dd></div>
            ${p.outrosServicos && p.outrosServicos.length ? `<div class="fato largo"><dt>Outros serviços</dt><dd>${esc(p.outrosServicos.map(nomeServico).join(', '))}</dd></div>` : ''}
          </dl>
        </section>
      </div>
      <div class="det-acoes">
        <a class="botao primario" href="${esc(p.rotaUrl || p.mapsUrl)}" target="_blank" rel="noopener"><svg class="ic"><use href="#i-rota"/></svg>${p.rotaUrl ? 'Como chegar' : 'Abrir no Google Maps'}</a>
        <button class="botao" type="button" data-acao="copiar"><svg class="ic"><use href="#i-link"/></svg>Copiar link</button>
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
    const textoMaps = `${p.nome} — ${p.endereco ? p.endereco + ', ' : ''}${p.cidade}/${p.uf}\n${p.mapsUrl}`;
    if (b.dataset.acao === 'copiar') {
      try { await navigator.clipboard.writeText(textoMaps); toast('Link do Google Maps copiado'); }
      catch (err) { prompt('Copie o link:', p.mapsUrl); }
    }
    if (b.dataset.acao === 'compartilhar') {
      const v = precoDe(p, estado.combustivel);
      const dados = { title: p.nome, text: `${p.nome} (${p.cidade}/${p.uf})${v !== null ? ` — ${COMBUSTIVEIS[estado.combustivel]} R$ ${preco(v)}` : ''}`, url: p.mapsUrl };
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
    const fim = e => {
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
    if (estado.mesoId) partes.push(mesoNomes[estado.mesoId] || '');
    if (estado.cidade) { const p = estado.postos.find(x => `${x.uf}|${x._cidade}` === estado.cidade); if (p) partes.push(`${p.cidade}/${p.uf}`); }
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
        filter: n => !(n.classList && (n.classList.contains('leaflet-control-container')))
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
      [['--tag-baixo', 'Mais barato'], ['--tag-medio', 'Na média'], ['--tag-alto', 'Mais caro']].forEach(([v, t]) => {
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
      const carimbo = `Imagem gerada em ${geradoTxt} · ${estado.atualizadoTexto || ''}`;
      // segunda linha: carimbo de data/origem dos dados
      c.fillStyle = css.getPropertyValue('--texto-3').trim();
      c.fillText(carimbo, pad, yR + 20 * escala);
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

  // ---------------------------------------------------------------- URL (#hash)
  let escrevendoHash = false;
  function escreverHash() {
    const p = new URLSearchParams();
    if (estado.selecionado) p.set('posto', estado.selecionado);
    if (estado.uf) p.set('uf', estado.uf);
    if (estado.mesoId) p.set('meso', estado.mesoId);
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
    estado.mesoId = p.get('meso') ? Number(p.get('meso')) : null;
    estado.cidade = p.get('cidade') || null;
    if (p.get('c') && COMBUSTIVEIS[p.get('c')]) estado.combustivel = p.get('c');
    if (['30', '90'].includes(p.get('p'))) estado.periodo = p.get('p');
    marcarSeg('#seg-combustivel', estado.combustivel);
    marcarSeg('#seg-periodo', estado.periodo);
    if (estado.uf) carregarMalhaMeso(estado.uf);
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
  carregarMalhaUFs();
  carregarDados();
  addEventListener('resize', () => mapa.invalidateSize());
})();
