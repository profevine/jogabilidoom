#!/usr/bin/env node
/**
 * Transcrição do trecho: em vez de só medir BPM/tom, tira as notas.
 *  - alinha o pulso (tempo + fase do compasso)
 *  - linha de baixo por colcheia (soma harmônica em 40..1500 Hz)
 *  - acordes por compasso e por 2 tempos (croma + baixo como raiz)
 *  - linha principal por colcheia (soma harmônica em 200..4000 Hz)
 *  - grade de bateria por semicolecheia (bumbo, caixa, chimbal)
 *
 *   node tools/transcribe-music.mjs caminho/para/trecho.wav
 *
 * Serve para refazer os dados que tools/make-music.mjs tem embutidos (baixo,
 * acordes, grades de bateria) a partir de outra gravação.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SR = 22050;
const caminho = process.argv[2];
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', caminho, '-ac', '1', '-ar', String(SR), '-f', 's16le', `${caminho}.pcm`]);
const bytes = readFileSync(`${caminho}.pcm`);
const N = Math.floor(bytes.length / 2);
const x = new Float64Array(N);
for (let i = 0; i < N; i++) x[i] = bytes.readInt16LE(i * 2) / 32768;

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k); const wi = Math.sin(ang * k);
        const ur = re[i + k]; const ui = im[i + k];
        const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
        const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
      }
    }
  }
}
const hann = (n) => Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
const JAN = 4096;
const janela = hann(JAN);
const cache = new Map();
function magNo(tick) {
  const inicio = Math.max(0, Math.min(N - JAN, Math.round(tick)));
  if (cache.has(inicio)) return cache.get(inicio);
  const re = new Float64Array(JAN); const im = new Float64Array(JAN);
  for (let i = 0; i < JAN; i++) re[i] = x[inicio + i] * janela[i];
  fft(re, im);
  const mag = new Float64Array(JAN / 2);
  for (let i = 0; i < JAN / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
  cache.set(inicio, mag);
  return mag;
}
const hz = (bin) => (bin * SR) / JAN;
const NOTAS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const nomeMidi = (m) => `${NOTAS[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
const freq = (m) => 440 * 2 ** ((m - 69) / 12);

/** Soma harmônica: mede quanto um pitch candidato explica o espectro. */
function forcaPitch(mag, midi, hMax = 5) {
  let soma = 0;
  for (let h = 1; h <= hMax; h++) {
    const f = freq(midi) * h;
    const bin = f / (SR / JAN);
    if (bin >= mag.length - 1) break;
    const i = Math.round(bin);
    soma += (mag[i - 1] + mag[i] + mag[i + 1]) / h;
  }
  return soma;
}

// ---- pulso -------------------------------------------------------------------
const SALTO = 128;
const fluxo = [];
let ant = null;
for (let i = 0; i + 2048 < N; i += SALTO) {
  const re = new Float64Array(2048); const im = new Float64Array(2048);
  for (let k = 0; k < 2048; k++) re[k] = x[i + k] * (0.5 - 0.5 * Math.cos((2 * Math.PI * k) / 2047));
  fft(re, im);
  const mag = Float64Array.from({ length: 1024 }, (_, k) => Math.hypot(re[k], im[k]));
  if (ant) { let s = 0; for (let k = 1; k < 1024; k++) s += Math.max(0, mag[k] - ant[k]); fluxo.push({ t: i, v: s }); }
  ant = mag;
}
const porSeg = SR / SALTO;
const media = fluxo.reduce((a, f) => a + f.v, 0) / fluxo.length;
const onset = fluxo.map((f) => Math.max(0, f.v - media * 0.5));
let bpm = 0; let forca = 0;
for (let b = 70; b <= 170; b += 0.1) {
  const atraso = Math.round((60 / b) * porSeg);
  let s = 0;
  for (let i = 0; i + atraso < onset.length; i++) s += onset[i] * onset[i + atraso];
  if (s > forca) { forca = s; bpm = b; }
}
// fase do pulso: testa deslocamentos e escolhe o que pega mais ataque no tempo
const amostrasPorTempo = (60 / bpm) * SR;
let fase = 0; let melhorFase = -1;
for (let f = 0; f < amostrasPorTempo; f += 64) {
  let s = 0;
  for (let k = 0; ; k++) {
    const t = f + k * amostrasPorTempo;
    if (t >= N) break;
    s += forcaPitch(magNo(t), 36, 2) + forcaPitch(magNo(t), 38, 2);
  }
  if (s > melhorFase) { melhorFase = s; fase = f; }
}
const compasso = amostrasPorTempo * 4;
console.log(`BPM ${bpm.toFixed(1)} | compasso ${(compasso / SR).toFixed(3)}s | fase ${(fase / SR * 1000).toFixed(0)}ms`);
const compassos = Math.floor((N - fase) / compasso);
console.log(`compassos no trecho: ${compassos}`);

// ---- baixo e melodia por colcheia -------------------------------------------
const baixo = []; const principal = [];
for (let c = 0; c < compassos; c++) {
  const linhaB = []; const linhaM = [];
  for (let i = 0; i < 8; i++) {
    const t = fase + c * compasso + i * (amostrasPorTempo / 2);
    const mag = magNo(t);
    let melhorB = { midi: 0, v: -1 };
    for (let m = 28; m <= 52; m++) { const v = forcaPitch(mag, m, 6); if (v > melhorB.v) melhorB = { midi: m, v }; }
    let melhorM = { midi: 0, v: -1 };
    for (let m = 55; m <= 84; m++) { const v = forcaPitch(mag, m, 5); if (v > melhorM.v) melhorM = { midi: m, v }; }
    linhaB.push(melhorB); linhaM.push(melhorM);
  }
  baixo.push(linhaB); principal.push(linhaM);
}
const mediana = (a) => a.slice().sort((p, q) => p - q)[Math.floor(a.length / 2)];
const suavizar = (linha) => {
  const m = linha.map((n) => n.midi);
  return m.map((_, i) => mediana(m.slice(Math.max(0, i - 1), i + 2)));
};
console.log('\nbaixo (uma linha por compasso, 8 colcheias):');
baixo.forEach((l, c) => console.log(`  ${c + 1}: ${suavizar(l).map(nomeMidi).join(' ').padEnd(34)} forças ${l.map((n) => n.v.toFixed(0)).join(',')}`));
console.log('\nlinha principal (candidata):');
principal.forEach((l, c) => console.log(`  ${c + 1}: ${suavizar(l).map(nomeMidi).join(' ').padEnd(34)} forças ${l.map((n) => n.v.toFixed(0)).join(',')}`));

// ---- acordes ----------------------------------------------------------------
const croma = (t) => {
  const mag = magNo(t);
  const v = new Array(12).fill(0);
  for (let m = 36; m <= 84; m++) v[((m % 12) + 12) % 12] += forcaPitch(mag, m, 3);
  const tot = v.reduce((a, b) => a + b, 0) || 1;
  return v.map((a) => a / tot);
};
const graus = { '': [0, 4, 7], m: [0, 3, 7] };
for (const divisao of [4, 2]) {
  const saida = [];
  for (let c = 0; c < compassos; c++) {
    for (let d = 0; d < 4 / divisao; d++) {
      const ini = fase + c * compasso + d * divisao * amostrasPorTempo;
      const v = new Array(12).fill(0);
      for (let k = 0; k < divisao; k++) {
        const u = croma(ini + k * amostrasPorTempo);
        for (let i = 0; i < 12; i++) v[i] += u[i];
      }
      let melhor = { nome: '?', v: -1 };
      for (let r = 0; r < 12; r++) {
        for (const [sufixo, intervalo] of Object.entries(graus)) {
          const valor = v[r] + v[(r + intervalo[1]) % 12] * 0.9 + v[(r + intervalo[2]) % 12] * 0.8;
          if (valor > melhor.v) melhor = { nome: NOTAS[r] + sufixo, v: valor };
        }
      }
      saida.push(melhor.nome);
    }
    saida.push('|');
  }
  console.log(`\nacordes por ${divisao} tempo(s):`, saida.join(' '));
}

// ---- bateria ----------------------------------------------------------------
const energia = (t, f0, f1) => {
  const mag = magNo(t);
  let s = 0;
  for (let k = 1; k < mag.length; k++) { const f = hz(k); if (f >= f0 && f <= f1) s += mag[k] * mag[k]; }
  return Math.sqrt(s);
};
const bandas = { bumbo: [40, 110], caixa: [180, 500], caixaAlta: [2000, 6000], chimbal: [7000, 12000] };
const grade = {};
for (const [nome, [f0, f1]] of Object.entries(bandas)) {
  const valores = [];
  const passo = amostrasPorTempo / 4;
  for (let c = 0; c < compassos; c++) for (let i = 0; i < 16; i++) valores.push(energia(fase + c * compasso + i * passo, f0, f1));
  const ordenado = valores.slice().sort((a, b) => a - b);
  const p = (q) => ordenado[Math.floor(ordenado.length * q)];
  const limite = p(0.72) + 0.15 * (p(0.98) - p(0.72));
  grade[nome] = valores.map((v) => (v > limite ? 'x' : '.'));
}
console.log('\nbateria (16 semicolecheias por compasso):');
for (const [nome, valores] of Object.entries(grade)) {
  const linhas = [];
  for (let c = 0; c < compassos; c++) linhas.push(valores.slice(c * 16, c * 16 + 16).join(''));
  console.log(`  ${nome.padEnd(10)} ${linhas.join('|')}`);
}
