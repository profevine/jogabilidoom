#!/usr/bin/env node
/**
 * Gera a trilha do museu: uma faixa **própria em MIDI** (o formato que o Doom
 * toca nativamente) montada em cima do encerramento das lives do Jogabilidade.
 *
 * O que veio do trecho gravado (19,6s), por transcrição em
 * `tools/analyze-music.mjs`:
 *   - andamento 105 BPM, 8 compassos de 4/4
 *   - progressão: Bm | C | Am | D | Em | C | Am | D
 *   - linha de baixo, colcheia por colcheia, compasso a compasso
 *   - textura densa: baixo pesado, acorde sustentado e batida eletrônica
 * O que é invenção (o trecho não deixa claro): o desenho do lead — aqui ele é
 * um arpejo dos próprios acordes, para nunca brigar com a harmonia —, os
 * arranjos das seções B/C, os fills e a virada final.
 *
 *   node tools/make-music.mjs [data/music.mid]
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const saida = resolve(process.cwd(), process.argv[2] ?? 'data/music.mid');
const BPM = 105;
const TPQ = 480;
const COMPASSO = TPQ * 4;

const NOTAS = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
const n = (nome) => {
  const m = /^([A-G]#?)(-?\d)$/.exec(nome);
  return 12 * (Number(m[2]) + 1) + NOTAS[m[1]];
};

// ---- o trecho transcrito -----------------------------------------------------
// Baixo compasso a compasso (8 colcheias cada), no registro audível de um synth
// bass (E2..D3). O primeiro compasso do trecho é parcial: o baixo entra no 3º tempo.
const LOOP = [
  { acorde: ['B', 'm'], baixo: ['E3', 'E3', 'B2', 'B2', 'B2', 'B2', 'B2', 'B2'], parcial: true },
  { acorde: ['C', ''], baixo: ['F#3', 'E3', 'D3', 'C3', 'C3', 'C3', 'G3', 'C4'] },
  { acorde: ['A', 'm'], baixo: ['E3', 'D3', 'C3', 'B2', 'A2', 'A2', 'G2', 'G2'] },
  { acorde: ['D', ''], baixo: ['C3', 'B2', 'C3', 'D3', 'D3', 'D3', 'F#3', 'F#3'] },
  { acorde: ['E', 'm'], baixo: ['G3', 'F#3', 'E3', 'E3', 'E3', 'E3', 'D3', 'D3'] },
  { acorde: ['C', ''], baixo: ['F#3', 'E3', 'B2', 'B2', 'C3', 'C3', 'C4', 'D4'] },
  { acorde: ['A', 'm'], baixo: ['E3', 'C3', 'B2', 'A2', 'A2', 'A2', 'B2', 'A3'] },
  { acorde: ['D', ''], baixo: ['C3', 'A2', 'A2', 'A2', 'D3', 'D3', 'F#3', 'D4'] },
];
const TRiADE = { m: [0, 3, 7], '': [0, 4, 7] };
const acorde = ([grau, tipo], oitava = 4) => TRiADE[tipo].map((s) => n(`${grau}${oitava}`) + s);
// Arpejo do lead (invenção consonante: notas dos próprios acordes).
const ARPEJO = {
  Bm: ['F#4', 'B4', 'D5', 'B4'], C: ['E4', 'G4', 'C5', 'G4'],
  Am: ['E4', 'A4', 'C5', 'A4'], D: ['F#4', 'A4', 'D5', 'A4'], Em: ['G4', 'B4', 'E5', 'B4'],
};

// ---- estrutura ---------------------------------------------------------------
// 48 compassos a 105 BPM ≈ 1min50, com o loop transcrito aparecendo inteiro.
const SECOES = [
  { nome: 'intro', compassos: 4, bateria: 'leve', acordes: false, lead: false, arp: false },
  { nome: 'A', compassos: 8, bateria: 'cheia', acordes: true, lead: false, arp: false },
  { nome: "A'", compassos: 8, bateria: 'cheia', acordes: true, lead: false, arp: false },
  { nome: 'B', compassos: 8, bateria: 'cheia', acordes: true, lead: true, arp: true, brilho: true },
  { nome: 'C', compassos: 8, bateria: 'quebrada', acordes: true, lead: false, arp: false },
  { nome: "A''", compassos: 8, bateria: 'cheia', acordes: true, lead: false, arp: false },
  { nome: 'final', compassos: 4, bateria: 'leve', acordes: true, lead: false, arp: false },
];

// ---- MIDI --------------------------------------------------------------------
const pistas = [];
const novaPista = (nome, programa, canal) => {
  const p = { nome, programa, canal, eventos: [] };
  pistas.push(p);
  return p;
};
const nota = (pista, inicio, duracao, pitch, velocidade) => {
  pista.eventos.push([inicio, 0x90 | pista.canal, pitch, velocidade]);
  pista.eventos.push([inicio + duracao, 0x80 | pista.canal, pitch, 0]);
};

const lead = novaPista('lead', 81, 0);
const baixo = novaPista('baixo', 38, 2);
const pads = novaPista('acordes', 89, 3);
const stabs = novaPista('stabs', 81, 4);
const arpejo = novaPista('arpejo', 82, 5);
const bateria = novaPista('bateria', 0, 9);

let semente = 20112026;
const rand = () => { semente = (semente * 1103515245 + 12345) & 0x7fffffff; return semente / 0x7fffffff; };
const P = { bumbo: 36, caixa: 38, chimbal: 42, chimbalAberto: 46, prato: 49, tom: 45 };

function batida(inicio, tipo, ultimo) {
  const p = (tempo, perc, vel) => nota(bateria, inicio + Math.round(tempo * TPQ), TPQ / 8, perc, vel);
  if (tipo === 'leve') {
    for (let t = 0; t < 4; t += 0.5) p(t, P.chimbal, t % 1 === 0 ? 90 : 68);
    p(0, P.bumbo, 112); p(2, P.bumbo, 108);
    if (ultimo) for (let t = 3; t < 4; t += 0.25) p(t, P.caixa, 78 + Math.round((t - 3) * 120));
    return;
  }
  if (tipo === 'quebrada') {
    for (let t = 0; t < 4; t += 1) p(t, P.chimbal, 74);
    p(0, P.bumbo, 108); p(2.5, P.caixa, 92);
    if (ultimo) for (let t = 2; t < 4; t += 0.25) p(t, P.caixa, 84 + Math.round((t - 2) * 40));
    return;
  }
  for (let t = 0; t < 4; t += 0.5) p(t, P.chimbal, t % 1 === 0 ? 96 : 72);
  p(3.5, P.chimbalAberto, 86);
  for (let t = 0; t < 4; t++) p(t, P.bumbo, t === 0 ? 120 : 106);
  p(1.75, P.bumbo, 92 + Math.round(rand() * 12));
  p(1, P.caixa, 110); p(3, P.caixa, 114);
  if (ultimo) {
    for (let t = 2; t < 4; t += 0.25) p(t, P.caixa, 84 + Math.round((t - 2) * 40));
    p(3.75, P.tom, 102);
  }
}

let inicio = 0;
for (const secao of SECOES) {
  for (let c = 0; c < secao.compassos; c++) {
    const compasso = LOOP[c % LOOP.length];
    const base = acorde(compasso.acorde, 4);
    const ultimo = (c + 1) % 4 === 0;
    if (inicio === 0) nota(bateria, 0, TPQ / 4, P.prato, 104);

    batida(inicio, secao.bateria, ultimo);

    compasso.baixo.forEach((nome, i) => {
      if (compasso.parcial && i < 4) return;
      const t = inicio + i * (TPQ / 2);
      nota(baixo, t, Math.round(TPQ * 0.45), n(nome), i % 2 === 0 ? 118 : 104);
    });

    if (secao.acordes) {
      for (const pitch of base) nota(pads, inicio, COMPASSO - TPQ / 6, pitch, 76);
      for (const tempo of [0.5, 2.5]) {
        for (const pitch of base) nota(stabs, inicio + Math.round(tempo * TPQ), Math.round(TPQ * 0.4), pitch + 12, secao.brilho ? 78 : 66);
      }
    }

    if (secao.lead) {
      const notas = ARPEJO[compasso.acorde[0] + compasso.acorde[1]];
      notas.forEach((nome, i) => {
        const t = inicio + i * (TPQ / 2);
        nota(lead, t, Math.round(TPQ * 0.42), n(nome) + (secao.brilho ? 12 : 0), 74);
      });
    }

    if (secao.arp) {
      const ciclo = [...base, base[0] + 12];
      for (let i = 0; i < 8; i++) {
        nota(arpejo, inicio + i * (TPQ / 2), Math.round(TPQ * 0.4), ciclo[i % ciclo.length] + 12, i % 2 ? 70 : 84);
      }
    }
    inicio += COMPASSO;
  }
}

// ---- escrita -----------------------------------------------------------------
const vlq = (valor) => {
  const bytes = [valor & 0x7f];
  let v = valor >> 7;
  while (v > 0) { bytes.unshift((v & 0x7f) | 0x80); v >>= 7; }
  return Buffer.from(bytes);
};
const texto = (str) => Buffer.concat([Buffer.from([0xff, 0x03, str.length]), Buffer.from(str, 'latin1')]);
const meta = (tipo, dados) => Buffer.concat([Buffer.from([0xff, tipo, dados.length]), Buffer.from(dados)]);
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v); return b; };

function pistaParaBuffer(pista) {
  const eventos = pista.eventos.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const partes = [Buffer.from([0x00]), texto(pista.nome)];
  if (pista.programa && pista.canal !== 9) partes.push(Buffer.from([0x00, 0xc0 | pista.canal, pista.programa]));
  let anterior = 0;
  for (const [tick, status, a, b] of eventos) {
    partes.push(vlq(tick - anterior));
    partes.push(Buffer.from(b === undefined ? [status, a] : [status, a, b]));
    anterior = tick;
  }
  partes.push(Buffer.from([0x00, 0xff, 0x2f, 0x00]));
  const corpo = Buffer.concat(partes);
  return Buffer.concat([Buffer.from('MTrk', 'ascii'), u32(corpo.length), corpo]);
}

const microsPorTempo = Math.round(60000000 / BPM);
const regencia = Buffer.concat([
  Buffer.from([0x00]), texto('Jogabilidoom'),
  Buffer.from([0x00]), meta(0x51, [(microsPorTempo >> 16) & 0xff, (microsPorTempo >> 8) & 0xff, microsPorTempo & 0xff]),
  Buffer.from([0x00]), meta(0x58, [4, 2, 24, 8]),
  Buffer.from([0x00]), meta(0x59, [0, 1]),
  Buffer.from([0x00, 0xff, 0x2f, 0x00]),
]);
const pista0 = Buffer.concat([Buffer.from('MTrk', 'ascii'), u32(regencia.length), regencia]);
const todas = [pista0, ...pistas.map(pistaParaBuffer)];
const cabecalho = Buffer.concat([
  Buffer.from('MThd', 'ascii'), u32(6), Buffer.from([0x00, 0x01]),
  Buffer.from([(todas.length >> 8) & 0xff, todas.length & 0xff]),
  Buffer.from([(TPQ >> 8) & 0xff, TPQ & 0xff]),
]);
writeFileSync(saida, Buffer.concat([cabecalho, ...todas]));

const segundos = (inicio / TPQ) * (60 / BPM);
console.log(`MIDI gerado: ${saida}`);
console.log(`  ${SECOES.reduce((a, s) => a + s.compassos, 0)} compassos, ${BPM} BPM, ${Math.round(segundos)}s (~${(segundos / 60).toFixed(1)} min)`);
console.log(`  loop transcrito: ${LOOP.map((c) => c.acorde.join('')).join(' | ')}`);
console.log('  agora rode: node tools/build-wad.mjs');
