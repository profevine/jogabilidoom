#!/usr/bin/env node
/**
 * Analisa o trecho gravado da live para tirar os parâmetros musicais que vão
 * servir de base para a faixa própria: andamento (BPM), tom, progressão de
 * acordes, linha de baixo, melodia e grade de bateria.
 *
 *   node .audio/analise.mjs .audio/cru.wav
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SR = 22050;
const caminho = process.argv[2];
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', caminho, '-ac', '1', '-ar', String(SR), '-f', 's16le', `${caminho}.pcm`]);
const bruto = readFileSync(`${caminho}.pcm`);
const N = Math.floor(bruto.length / 2);
const sinal = new Float64Array(N);
for (let i = 0; i < N; i++) sinal[i] = bruto.readInt16LE(i * 2) / 32768;
console.log(`amostras: ${N} (${(N / SR).toFixed(2)}s)`);

// ---- FFT iterativa (radix 2) -------------------------------------------------
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

const janela = (tamanho) => {
  const w = new Float64Array(tamanho);
  for (let i = 0; i < tamanho; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (tamanho - 1));
  return w;
};

function espectro(inicio, tamanho) {
  const re = new Float64Array(tamanho); const im = new Float64Array(tamanho);
  const w = janela(tamanho);
  for (let i = 0; i < tamanho; i++) re[i] = (sinal[inicio + i] || 0) * w[i];
  fft(re, im);
  const mag = new Float64Array(tamanho / 2);
  for (let i = 0; i < tamanho / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}

const hz = (bin, tamanho) => (bin * SR) / tamanho;
const NOTAS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// ---- envelope de onsets e BPM ------------------------------------------------
const JAN = 2048; const SALTO = 256;
const fluxos = [];
let anterior = null;
for (let i = 0; i + JAN < N; i += SALTO) {
  const mag = espectro(i, JAN);
  if (anterior) {
    let soma = 0;
    for (let k = 1; k < mag.length; k++) soma += Math.max(0, mag[k] - anterior[k]);
    fluxos.push(soma);
  }
  anterior = mag;
}
const mediaFluxo = fluxos.reduce((a, b) => a + b, 0) / fluxos.length;
const onsets = fluxos.map((v) => Math.max(0, v - mediaFluxo * 0.6));
const porSegundo = SR / SALTO;
let melhor = { bpm: 0, forca: 0 };
for (let bpm = 60; bpm <= 190; bpm += 0.25) {
  const atraso = Math.round((60 / bpm) * porSegundo);
  let soma = 0;
  for (let i = 0; i + atraso < onsets.length; i++) soma += onsets[i] * onsets[i + atraso];
  if (soma > melhor.forca) melhor = { bpm, forca: soma };
}
console.log(`BPM provável: ${melhor.bpm.toFixed(2)}`);

// ---- croma, tom e acordes ----------------------------------------------------
const JANC = 4096; const SALTO_C = 1024;
const croma = [];
for (let i = 0; i + JANC < N; i += SALTO_C) {
  const mag = espectro(i, JANC);
  const v = new Float64Array(12);
  for (let k = 4; k < mag.length; k++) {
    const f = hz(k, JANC);
    if (f < 55 || f > 3000) continue;
    const midi = 69 + 12 * Math.log2(f / 440);
    const classe = ((Math.round(midi) % 12) + 12) % 12;
    v[classe] += mag[k] * mag[k];
  }
  const total = v.reduce((a, b) => a + b, 0) || 1;
  croma.push([...v].map((x) => x / total));
}
const cromaTotal = new Array(12).fill(0);
for (const v of croma) for (let i = 0; i < 12; i++) cromaTotal[i] += v[i];
console.log('croma total:', cromaTotal.map((x, i) => `${NOTAS[i]}:${(x / croma.length * 100).toFixed(0)}`).join(' '));
const maior = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const menor = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const correl = (a, b) => {
  const ma = a.reduce((x, y) => x + y, 0) / a.length; const mb = b.reduce((x, y) => x + y, 0) / b.length;
  let num = 0; let da = 0; let db = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i] - ma; const y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  return num / Math.sqrt(da * db);
};
let tom = { nota: '?', modo: '?' }; let melhorTom = -2;
for (let r = 0; r < 12; r++) {
  const perfilM = maior.map((_, i) => maior[(i - r + 12) % 12]);
  const perfilm = menor.map((_, i) => menor[(i - r + 12) % 12]);
  const cm = correl(cromaTotal, perfilM); const cn = correl(cromaTotal, perfilm);
  if (cm > melhorTom) { melhorTom = cm; tom = { nota: NOTAS[r], modo: 'maior' }; }
  if (cn > melhorTom) { melhorTom = cn; tom = { nota: NOTAS[r], modo: 'menor' }; }
}
console.log(`tom provável: ${tom.nota} ${tom.modo}`);

const bpm = melhor.bpm;
const batidasPorSegundo = bpm / 60;
const quadrosPorBatida = (SR / SALTO_C) / batidasPorSegundo;
const acordes = [];
for (let c = 0; c + Math.round(quadrosPorBatida) <= croma.length; c += Math.round(quadrosPorBatida)) {
  const bloco = new Array(12).fill(0);
  for (let i = c; i < c + Math.round(quadrosPorBatida); i++) for (let j = 0; j < 12; j++) bloco[j] += croma[i][j];
  let melhorAc = { nome: '?', valor: -1 };
  for (let r = 0; r < 12; r++) {
    for (const [terca, sufixo] of [[4, ''], [3, 'm']]) {
      const valor = bloco[r] + bloco[(r + 7) % 12] * 0.8 + bloco[(r + terca) % 12] * 0.9;
      if (valor > melhorAc.valor) melhorAc = { nome: NOTAS[r] + sufixo, valor };
    }
  }
  acordes.push(melhorAc.nome);
}
console.log('acordes por tempo:', acordes.join(' | '));
const porCompasso = [];
for (let c = 0; c + acordes.length >= 0 && c < acordes.length; c += 4) porCompasso.push(acordes.slice(c, c + 4).join('-'));
console.log('acordes por compasso (4 tempos):', porCompasso.join(' | '));
// progressão confiável: croma só da região do baixo, por compasso
const cromaBaixo = [];
for (let i = 0; i + JANC < N; i += JANC) {
  const mag = espectro(i, JANC);
  const v = new Float64Array(12);
  for (let k = 1; k < mag.length; k++) {
    const f = hz(k, JANC);
    if (f < 40 || f > 250) continue;
    const midi = 69 + 12 * Math.log2(f / 440);
    v[((Math.round(midi) % 12) + 12) % 12] += mag[k] * mag[k];
  }
  const t = v.reduce((a, b) => a + b, 0) || 1;
  cromaBaixo.push([...v].map((x) => x / t));
}
const compasso = Math.round((60 / bpm) * 4 * (SR / JANC));
const prog = [];
for (let c = 0; c + compasso <= cromaBaixo.length; c += compasso) {
  const bloco = new Array(12).fill(0);
  for (let i = c; i < c + compasso; i++) for (let j = 0; j < 12; j++) bloco[j] += cromaBaixo[i][j];
  let melhorAc = { nome: '?', valor: -1 };
  for (let r = 0; r < 12; r++) for (const [terca, sufixo] of [[4, ''], [3, 'm']]) {
    const valor = bloco[r] + bloco[(r + 7) % 12] * 0.8 + bloco[(r + terca) % 12] * 0.9;
    if (valor > melhorAc.valor) melhorAc = { nome: NOTAS[r] + sufixo, valor };
  }
  prog.push(melhorAc.nome);
}
console.log('progressão (só graves, por compasso):', prog.join(' | '));

// ---- baixo e melodia por tempo ----------------------------------------------
const notaDominante = (inicio, fMin, fMax) => {
  const mag = espectro(inicio, JANC);
  let melhorK = 0; let melhorV = 0;
  for (let k = 1; k < mag.length; k++) {
    const f = hz(k, JANC);
    if (f < fMin || f > fMax) continue;
    if (mag[k] > melhorV) { melhorV = mag[k]; melhorK = k; }
  }
  if (!melhorK) return '-';
  const midi = Math.round(69 + 12 * Math.log2(hz(melhorK, JANC) / 440));
  return `${NOTAS[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
};
const baixos = []; const melodias = [];
const saltoBatida = Math.round(quadrosPorBatida * SALTO_C);
for (let i = 0; i + JANC < N; i += saltoBatida) {
  baixos.push(notaDominante(i, 40, 200));
  melodias.push(notaDominante(i, 300, 2000));
}
console.log('baixo por tempo  :', baixos.join(' '));
console.log('melodia por tempo:', melodias.join(' '));

// ---- grade de bateria (16 avos) ---------------------------------------------
const energiaBanda = (inicio, fMin, fMax) => {
  const mag = espectro(inicio, 1024);
  let soma = 0;
  for (let k = 1; k < mag.length; k++) {
    const f = hz(k, 1024);
    if (f >= fMin && f <= fMax) soma += mag[k] * mag[k];
  }
  return Math.sqrt(soma);
};
const passo16 = Math.round(SR * (60 / bpm) / 4); // uma semicolcheia
const grades = { bumbo: [], caixa: [], chimbal: [] };
for (let i = 0; i + 1024 < N; i += passo16) {
  grades.bumbo.push(energiaBanda(i, 40, 120));
  grades.caixa.push(energiaBanda(i, 180, 450));
  grades.chimbal.push(energiaBanda(i, 5000, 10000));
}
const linha = (valores) => {
  const max = Math.max(...valores) || 1;
  return valores.map((v) => (v > max * 0.45 ? 'x' : '.')).join('');
};
for (const [nome, valores] of Object.entries(grades)) {
  const semicolcheias = Math.round((60 / bpm) * 4 / (passo16 / SR));
  console.log(`${nome.padEnd(8)}:`, linha(valores.slice(0, semicolcheias * 8)).replace(new RegExp(`(.{${semicolcheias}})`, 'g'), '$1|'));
}
console.log(`(semicolcheia = ${(passo16 / SR * 1000).toFixed(0)} ms, ${Math.round((60 / bpm) * 4 / (passo16 / SR))} por compasso)`);
