#!/usr/bin/env node
/**
 * Gera o PWAD Jogabilidoom sem depender de um editor gráfico.
 *
 * A torre tem três partes: o museu (um patamar por ano, cada um com o salão do
 * Top 10 daquele ano), a torre dos chefes (quatro arenas acima do museu, uma
 * por integrante do Jogabilidade, com progressão travada) e a câmara do
 * troféu, no topo, onde o mapa termina.
 *
 * Cada salão e cada arena fica na mesma altura do seu patamar, então "subir de
 * andar" e "entrar na sala" são o mesmo movimento.
 *
 * O mapa usa o formato binário clássico de Doom II, que o GZDoom carrega
 * nativamente (ele reconstrói NODES/BLOCKMAP no load). Mantê-lo como código
 * deixa o museu reproduzível e fácil de revisar antes de levá-lo ao UDB.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';

const output = resolve(process.cwd(), 'jogabilidoom.wad');
const museum = JSON.parse(readFileSync(resolve(process.cwd(), 'data/museum.json'), 'utf8'));
const rooms = [...museum.rooms].sort((a, b) => a.year - b.year);
const bossCatalog = JSON.parse(readFileSync(resolve(process.cwd(), 'data/bosses.json'), 'utf8'));
const bosses = bossCatalog.bosses;

if (!rooms.length) throw new Error('data/museum.json não tem nenhuma sala.');
if (!bosses.length) throw new Error('data/bosses.json não tem nenhum chefe.');
for (const room of rooms) {
  if (!Number.isInteger(room.year) || !room.games?.length || room.games.length > 10) {
    throw new Error(`Sala inválida: ${JSON.stringify(room.year)} precisa de 1 a 10 jogos.`);
  }
}
for (const boss of bosses) {
  for (const field of ['id', 'nome', 'apelido', 'titulo', 'base', 'health', 'arena', 'rosto']) {
    if (boss[field] === undefined) throw new Error(`Chefe ${boss.id ?? '?'} sem o campo "${field}".`);
  }
  for (const field of ['wall', 'floor', 'ceiling']) {
    if (!boss.arena[field]) throw new Error(`A arena de ${boss.id} precisa de "${field}".`);
  }
}

// A torre: museu embaixo, torre dos chefes em cima e a câmara do troféu no topo.
// `index` é sempre o andar global — é ele que define a altura do chão e a letra
// do sprite (A..Z), então museu e chefes dividem a mesma numeração.
const MUSEUM_FLOORS = rooms.length;
const BOSS_FIRST = MUSEUM_FLOORS;
const TROPHY_FLOOR = BOSS_FIRST + bosses.length;
const TOTAL_FLOORS = TROPHY_FLOOR + 1;
if (TOTAL_FLOORS > 26) {
  throw new Error(`O nome dos sprites só comporta 26 andares (a torre tem ${TOTAL_FLOORS}).`);
}

// ---------------------------------------------------------------- tipografia

const glyphs = {
  A: ['01110','10001','10001','11111','10001','10001','10001'], B: ['11110','10001','10001','11110','10001','10001','11110'],
  C: ['01111','10000','10000','10000','10000','10000','01111'], D: ['11110','10001','10001','10001','10001','10001','11110'],
  E: ['11111','10000','10000','11110','10000','10000','11111'], F: ['11111','10000','10000','11110','10000','10000','10000'],
  G: ['01111','10000','10000','10111','10001','10001','01110'], H: ['10001','10001','10001','11111','10001','10001','10001'],
  I: ['11111','00100','00100','00100','00100','00100','11111'], J: ['00111','00010','00010','00010','10010','10010','01100'],
  K: ['10001','10010','10100','11000','10100','10010','10001'], L: ['10000','10000','10000','10000','10000','10000','11111'],
  M: ['10001','11011','10101','10101','10001','10001','10001'], N: ['10001','11001','10101','10011','10001','10001','10001'],
  O: ['01110','10001','10001','10001','10001','10001','01110'], P: ['11110','10001','10001','11110','10000','10000','10000'],
  Q: ['01110','10001','10001','10001','10101','10010','01101'], R: ['11110','10001','10001','11110','10100','10010','10001'],
  S: ['01111','10000','10000','01110','00001','00001','11110'], T: ['11111','00100','00100','00100','00100','00100','00100'],
  U: ['10001','10001','10001','10001','10001','10001','01110'], V: ['10001','10001','10001','10001','10001','01010','00100'],
  W: ['10001','10001','10001','10101','10101','10101','01010'], X: ['10001','01010','00100','00100','00100','01010','10001'],
  Y: ['10001','01010','00100','00100','00100','00100','00100'], Z: ['11111','00001','00010','00100','01000','10000','11111'],
  0: ['01110','10001','10011','10101','11001','10001','01110'], 1: ['00100','01100','00100','00100','00100','00100','01110'],
  2: ['01110','10001','00001','00010','00100','01000','11111'], 3: ['11110','00001','00001','01110','00001','00001','11110'],
  4: ['00010','00110','01010','10010','11111','00010','00010'], 5: ['11111','10000','10000','11110','00001','00001','11110'],
  6: ['01110','10000','10000','11110','10001','10001','01110'], 7: ['11111','00001','00010','00100','01000','01000','01000'],
  8: ['01110','10001','10001','01110','10001','10001','01110'], 9: ['01110','10001','10001','01111','00001','00001','01110'],
  ' ': ['00000','00000','00000','00000','00000','00000','00000'], '-': ['00000','00000','00000','11111','00000','00000','00000'],
  '#': ['01010','11111','01010','01010','11111','01010','00000'], '&': ['01100','10010','10100','01000','10101','10010','01101'],
  ':': ['00000','00100','00100','00000','00100','00100','00000'], "'": ['00100','00100','01000','00000','00000','00000','00000'],
  '.': ['00000','00000','00000','00000','00000','00100','00100'], ',': ['00000','00000','00000','00000','00100','00100','01000'],
  '/': ['00001','00010','00100','01000','10000','00000','00000'], '+': ['00000','00100','00100','11111','00100','00100','00000'],
  '!': ['00100','00100','00100','00100','00100','00000','00100'], '?': ['01110','10001','00001','00110','00100','00000','00100'],
  '(': ['00010','00100','01000','01000','01000','00100','00010'], ')': ['01000','00100','00010','00010','00010','00100','01000'],
  '*': ['00100','10101','01110','11111','01110','10101','00100'],
};

const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;

/** Deixa o título no alfabeto do museu: sem acento, caixa alta, só glifos conhecidos. */
function normalizeText(text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .toUpperCase()
    .split('')
    .map((char) => (glyphs[char] ? char : (char.trim() ? ' ' : ' ')))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function wrapText(text, width, maxLines) {
  const words = normalizeText(text).split(' ').filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= width) { line = candidate; continue; }
    if (line) lines.push(line);
    line = word.length <= width ? word : `${word.slice(0, width - 1)}-`;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, width - 3).trim()}...`;
    return kept;
  }
  return lines;
}

// --------------------------------------------------------------------- PNG

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** ZIP sem compressão (método 0): basta para o GZDoom abrir um PK3. */
function zipStore(files) {
  const local = []; const central = []; let offset = 0;
  for (const [name, data] of files) {
    const fileName = Buffer.from(name, 'ascii');
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4);
    head.writeUInt32LE(crc, 14); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(fileName.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6);
    dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(data.length, 20); dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(fileName.length, 28); dir.writeUInt32LE(offset, 42);
    local.push(head, fileName, data);
    central.push(dir, fileName);
    offset += 30 + fileName.length + data.length;
  }
  const centralSize = central.reduce((sum, b) => sum + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

function pngChunk(type, data) {
  const typeData = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeData.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeData, data])), 8 + data.length);
  return chunk;
}

/**
 * Decodificador do PNG que data/rostos/ guarda: 8 bits por canal, RGBA, sem
 * entrelaçamento (é o que o ImageMagick escreve no preparo das caras). Devolve
 * largura, altura e os pixels crus, para o build poder redesenhar o rosto em
 * todos os quadros do chefe.
 */
function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG sem assinatura válida.');
  let at = 8;
  let header = null;
  const data = [];
  while (at < buffer.length) {
    const size = buffer.readUInt32BE(at);
    const type = buffer.toString('ascii', at + 4, at + 8);
    const chunk = buffer.subarray(at + 8, at + 8 + size);
    if (type === 'IHDR') header = chunk;
    if (type === 'IDAT') data.push(chunk);
    at += 12 + size;
  }
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  if (header[8] !== 8 || header[9] !== 6 || header[12] !== 0) {
    throw new Error('data/rostos/*.png precisa ser PNG RGBA de 8 bits sem entrelaçamento.');
  }
  const raw = inflateSync(Buffer.concat(data));
  const pixels = Buffer.alloc(width * height * 4);
  const stride = width * 4;
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? pixels[y * stride + x - 4] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= 4 ? pixels[(y - 1) * stride + x - 4] : 0;
      let value = row[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) value += paeth(left, up, upLeft);
      pixels[y * stride + x] = value & 0xff;
    }
  }
  return { width, height, pixels };
}

const hexColor = (hex) => [
  parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255,
];

/**
 * Canvas RGBA mínimo. O chunk grAb carrega os offsets do sprite: o GZDoom os
 * usa como em um patch clássico, ou seja, o topo da imagem fica `top` pixels
 * acima do chão do ator. É assim que as placas ficam suspensas no ar.
 */
function canvas(width, height) {
  const pixels = Buffer.alloc(width * height * 4);
  const setPixel = (x, y, [r, g, b, a = 255]) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const at = (y * width + x) * 4;
    pixels[at] = r; pixels[at + 1] = g; pixels[at + 2] = b; pixels[at + 3] = a;
  };
  return {
    width,
    height,
    pixels,
    rect(x, y, w, h, color) {
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) setPixel(xx, yy, color);
    },
    /** Mistura uma cor sobre o que já existe (usado nas luzes e nos sombreados). */
    blend(x, y, [r, g, b, a = 255]) {
      if (x < 0 || y < 0 || x >= width || y >= height || a <= 0) return;
      const at = (y * width + x) * 4;
      const alpha = a / 255;
      const old = pixels[at + 3] / 255;
      const out = alpha + old * (1 - alpha);
      pixels[at] = Math.round((r * alpha + pixels[at] * old * (1 - alpha)) / (out || 1));
      pixels[at + 1] = Math.round((g * alpha + pixels[at + 1] * old * (1 - alpha)) / (out || 1));
      pixels[at + 2] = Math.round((b * alpha + pixels[at + 2] * old * (1 - alpha)) / (out || 1));
      pixels[at + 3] = Math.round(out * 255);
    },
    ellipse(cx, cy, rx, ry, color) {
      for (let y = Math.ceil(cy - ry); y <= Math.floor(cy + ry); y++) {
        for (let x = Math.ceil(cx - rx); x <= Math.floor(cx + rx); x++) {
          const dx = (x - cx) / rx; const dy = (y - cy) / ry;
          if (dx * dx + dy * dy <= 1) this.blend(x, y, color);
        }
      }
    },
    /**
     * Cola uma imagem RGBA (o rosto) com escala, giro, cor e transparência.
     * Vizinho mais próximo de propósito: o resultado continua pixel art.
     */
    paste(image, dx, dy, { scale = 1, rotate = 0, tint = null, amount = 0, alpha = 1, squash = 1 } = {}) {
      const w = image.width * scale;
      const h = image.height * scale * squash;
      const rad = (rotate * Math.PI) / 180;
      const cos = Math.cos(rad); const sin = Math.sin(rad);
      const radius = Math.ceil(Math.hypot(w, h) / 2) + 2;
      for (let y = -radius; y <= radius; y++) {
        for (let x = -radius; x <= radius; x++) {
          const sx = Math.round((x * cos + y * sin) / scale + image.width / 2);
          const sy = Math.round((-x * sin + y * cos) / (scale * squash) + image.height / 2);
          if (sx < 0 || sy < 0 || sx >= image.width || sy >= image.height) continue;
          const at = (sy * image.width + sx) * 4;
          const a = image.pixels[at + 3] * alpha;
          if (a <= 0) continue;
          let r = image.pixels[at]; let g = image.pixels[at + 1]; let b = image.pixels[at + 2];
          if (tint && amount > 0) {
            r += (tint[0] - r) * amount;
            g += (tint[1] - g) * amount;
            b += (tint[2] - b) * amount;
          }
          this.blend(Math.round(dx + x), Math.round(dy + y), [Math.round(r), Math.round(g), Math.round(b), Math.round(a)]);
        }
      }
    },
    text(value, x, y, color, scale) {
      const pitch = (GLYPH_WIDTH + 1) * scale;
      [...value].forEach((char, index) => {
        const glyph = glyphs[char] || glyphs[' '];
        glyph.forEach((row, yy) => [...row].forEach((on, xx) => {
          if (on === '1') this.rect(x + index * pitch + xx * scale, y + yy * scale, scale, scale, color);
        }));
      });
    },
    textWidth: (value, scale) => value.length * (GLYPH_WIDTH + 1) * scale - scale,
    toPng(left, top) {
      const raw = Buffer.alloc((width * 4 + 1) * height);
      for (let y = 0; y < height; y++) {
        raw[y * (width * 4 + 1)] = 0;
        pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
      }
      const header = Buffer.alloc(13);
      header.writeUInt32BE(width, 0);
      header.writeUInt32BE(height, 4);
      header[8] = 8; header[9] = 6;
      const grab = Buffer.alloc(8);
      grab.writeInt32BE(left, 0);
      grab.writeInt32BE(top, 4);
      return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        pngChunk('IHDR', header),
        pngChunk('grAb', grab),
        pngChunk('IDAT', deflateSync(raw)),
        pngChunk('IEND', Buffer.alloc(0)),
      ]);
    },
  };
}

const CYAN = [0, 230, 255, 255];
const GOLD = [255, 210, 0, 255];
const INK = [235, 255, 255, 255];
const GLASS = [0, 16, 24, 220];

/** Placa de um jogo. A do primeiro lugar sai toda dourada, para o pódio. */
function labelPng(rank, title, { highlight = false } = {}) {
  const scale = 3;
  const frame = highlight ? GOLD : CYAN;
  const lines = wrapText(title, 16, 4);
  const image = canvas(384, 128);
  const boxHeight = 16 + lines.length * 24;
  image.rect(0, 0, 384, boxHeight, GLASS);
  image.rect(0, 0, 384, 3, frame);
  image.rect(0, boxHeight - 3, 384, 3, frame);
  image.rect(60, 8, 2, boxHeight - 16, frame);
  image.text(`#${String(rank).padStart(2, '0')}`, 8, Math.round((boxHeight - GLYPH_HEIGHT * scale) / 2), GOLD, scale);
  lines.forEach((line, index) => image.text(line, 76, 12 + index * 24, highlight ? GOLD : INK, scale));
  // Offsets em pixels: o topo do sprite fica `grAb * Scale` unidades acima do
  // chão do ator. A placa comum usa Scale 0.5; a do pódio usa Scale 0.75 e sobe
  // o bastante para não ficar atrás do pilar do vencedor (132 unidades).
  return highlight ? image.toPng(192, 176 + boxHeight) : image.toPng(192, 208 + boxHeight);
}

/** Totem do andar: "ANDAR 03" pequeno sobre o ano em corpo grande. */
function floorSignPng(floorNumber, year, count, grabTop) {
  const image = canvas(384, 160);
  image.rect(0, 0, 384, 152, GLASS);
  image.rect(0, 0, 384, 4, CYAN);
  image.rect(0, 148, 384, 4, CYAN);
  const andar = `ANDAR ${String(floorNumber).padStart(2, '0')}`;
  const year6 = String(year);
  const foot = `TOP ${count} JOGABILIDADE`;
  image.text(andar, Math.round((384 - image.textWidth(andar, 3)) / 2), 14, CYAN, 3);
  image.text(year6, Math.round((384 - image.textWidth(year6, 8)) / 2), 44, GOLD, 8);
  image.text(foot, Math.round((384 - image.textWidth(foot, 2)) / 2), 116, INK, 2);
  return image.toPng(192, grabTop);
}

// ------------------------------------------------------------ placas dos chefes

const centered = (image, value, scale, width) => Math.round((width - image.textWidth(value, scale)) / 2);

function starRow(image, count, x, y, scale, color) {
  for (let index = 0; index < count; index++) {
    image.text('*', x + index * (GLYPH_WIDTH + 1) * scale, y, color, scale);
  }
}

/** Empilha linhas centralizadas numa placa de vidro e devolve imagem + altura. */
function stackedSign(width, lines, { stars = 0, frame = CYAN } = {}) {
  const pad = 18;
  const gap = 8;
  const starScale = 4;
  let height = pad * 2;
  for (const line of lines) height += GLYPH_HEIGHT * line.scale + gap;
  if (stars) height += GLYPH_HEIGHT * starScale + gap;
  const image = canvas(width, height);
  image.rect(0, 0, width, height, GLASS);
  image.rect(0, 0, width, 4, frame);
  image.rect(0, height - 4, width, 4, frame);
  let y = pad;
  for (const line of lines) {
    image.text(line.text, centered(image, line.text, line.scale, width), y, line.color, line.scale);
    y += GLYPH_HEIGHT * line.scale + gap;
  }
  if (stars) {
    const row = stars * (GLYPH_WIDTH + 1) * starScale - starScale;
    starRow(image, stars, Math.round((width - row) / 2), y, starScale, GOLD);
  }
  return image;
}

const bossFooter = (boss, bossIndex) => (boss.final
  ? `CHEFAO FINAL — ${String(bossIndex + 1).padStart(2, '0')} DE ${String(bosses.length).padStart(2, '0')}`
  : `CHEFAO ${String(bossIndex + 1).padStart(2, '0')} DE ${String(bosses.length).padStart(2, '0')}`);

/** Placa grande do chefe, pendurada na parede do fundo da arena. */
function bossSignPng(boss, bossIndex, { compact = false } = {}) {
  const width = compact ? 384 : 640;
  const apelidoScale = compact ? 4 : 7;
  const nomeScale = compact ? 2 : 3;
  const epithet = wrapText(boss.titulo, compact ? 22 : 40, 3);
  const image = stackedSign(width, [
    { text: normalizeText(boss.apelido), scale: apelidoScale, color: GOLD },
    { text: normalizeText(boss.nome), scale: nomeScale, color: INK },
    ...epithet.map((line) => ({ text: line, scale: 2, color: CYAN })),
    { text: normalizeText(bossFooter(boss, bossIndex)), scale: 2, color: INK },
  ], { stars: boss.estrelas ?? 0, frame: boss.final ? GOLD : CYAN });
  return compact ? image.toPng(192, 300) : image.toPng(Math.round(width / 2), 640);
}

/** Totem do andar do chefe: "ANDAR 11" em cima, o apelido em corpo grande. */
function bossFloorSignPng(floorNumber, boss, bossIndex, grabTop) {
  const image = canvas(384, 160);
  image.rect(0, 0, 384, 152, GLASS);
  image.rect(0, 0, 384, 4, CYAN);
  image.rect(0, 148, 384, 4, CYAN);
  const andar = `ANDAR ${String(floorNumber).padStart(2, '0')}`;
  const apelido = normalizeText(boss.apelido);
  const foot = normalizeText(bossFooter(boss, bossIndex));
  image.text(andar, centered(image, andar, 3, 384), 14, CYAN, 3);
  image.text(apelido, centered(image, apelido, 8, 384), 44, GOLD, 8);
  image.text(foot, centered(image, foot, 2, 384), 116, INK, 2);
  return image.toPng(192, grabTop);
}

/** Placa do fim do jogo, na câmara do troféu. */
function victorySignPng(grabTop) {
  const image = canvas(640, 224);
  image.rect(0, 0, 640, 216, GLASS);
  image.rect(0, 0, 640, 5, GOLD);
  image.rect(0, 211, 640, 5, GOLD);
  image.text('VOCE VENCEU', centered(image, 'VOCE VENCEU', 6, 640), 22, GOLD, 6);
  image.text('A TORRE DOS CHEFOES CAIU', centered(image, 'A TORRE DOS CHEFOES CAIU', 3, 640), 78, CYAN, 3);
  image.text('OBRIGADO POR JOGAR', centered(image, 'OBRIGADO POR JOGAR', 3, 640), 118, INK, 3);
  starRow(image, 5, Math.round((640 - (5 * (GLYPH_WIDTH + 1) * 5 - 5)) / 2), 156, 5, GOLD);
  image.text('JOGABILIDADE', centered(image, 'JOGABILIDADE', 2, 640), 192, CYAN, 2);
  return image.toPng(320, grabTop);
}

/** Totem do andar do troféu, na alcova da escadaria. */
function trophySignPng(floorNumber, grabTop) {
  const image = canvas(384, 160);
  image.rect(0, 0, 384, 152, GLASS);
  image.rect(0, 0, 384, 4, GOLD);
  image.rect(0, 148, 384, 4, GOLD);
  const andar = `ANDAR ${String(floorNumber).padStart(2, '0')}`;
  image.text(andar, centered(image, andar, 3, 384), 14, CYAN, 3);
  image.text('TROFEU', centered(image, 'TROFEU', 8, 384), 44, GOLD, 8);
  image.text('FIM DE JOGO', centered(image, 'FIM DE JOGO', 2, 384), 116, INK, 2);
  return image.toPng(192, grabTop);
}

// ------------------------------------------------------------------ geometria

const WALL = 'STARTAN3';
const STEP_TEX = 'STEP1';

class MapBuilder {
  constructor() {
    this.vertices = [];
    this.vertexIds = new Map();
    this.sides = [];
    this.lines = [];
    this.sectors = [];
    this.things = [];
  }

  sector(props) { this.sectors.push(props); return this.sectors.length - 1; }

  vertex(x, y) {
    if (!Number.isInteger(x) || !Number.isInteger(y)) throw new Error(`Vértice não inteiro: ${x},${y}`);
    const key = `${x},${y}`;
    if (this.vertexIds.has(key)) return this.vertexIds.get(key);
    this.vertices.push([x, y]);
    this.vertexIds.set(key, this.vertices.length - 1);
    return this.vertices.length - 1;
  }

  side(props) { this.sides.push(props); return this.sides.length - 1; }

  /**
   * Parede sólida. O lado da frente (à direita de a→b) precisa olhar para
   * dentro do setor. `extra` carrega special/tag (usado no interruptor de fim
   * de jogo, na câmara do troféu).
   */
  wall(a, b, sector, middle = WALL, extra = {}) {
    this.lines.push({
      start: this.vertex(...a), end: this.vertex(...b), flags: 1,
      special: extra.special ?? 0, tag: extra.tag ?? 0,
      front: this.side({ middle, sector }), back: 0xffff, sectors: [sector],
    });
  }

  /** Passagem entre dois setores. `front` é o setor à direita de a→b — é dele que o teleporte dispara. */
  portal(a, b, front, back, { special = 0, tag = 0, upper = WALL, lower = STEP_TEX } = {}) {
    this.lines.push({
      start: this.vertex(...a), end: this.vertex(...b), flags: 4, special, tag,
      front: this.side({ upper, lower, middle: '-', sector: front }),
      back: this.side({ upper, lower, middle: '-', sector: back }),
      sectors: [front, back],
    });
  }

  thing(x, y, type, angle = 0) { this.things.push([Math.round(x), Math.round(y), angle, type, 7]); }

  /** Cada setor precisa ser um contorno fechado: todo vértice dele toca duas arestas. */
  validate() {
    const touches = new Map();
    for (const line of this.lines) {
      for (const sector of line.sectors) {
        for (const vertex of [line.start, line.end]) {
          const key = `${sector}:${vertex}`;
          touches.set(key, (touches.get(key) || 0) + 1);
        }
      }
      if (line.start === line.end) throw new Error('Linedef degenerado (mesmo vértice nas duas pontas).');
    }
    for (const [key, count] of touches) {
      if (count % 2 !== 0) {
        const [sector, vertex] = key.split(':');
        throw new Error(`Setor ${sector} aberto no vértice ${this.vertices[Number(vertex)]}.`);
      }
    }
    const used = new Set(this.sides.map((side) => side.sector));
    for (let index = 0; index < this.sectors.length; index++) {
      if (!used.has(index)) throw new Error(`Setor ${index} não tem nenhuma parede.`);
    }
  }
}

const map = new MapBuilder();

// A torre: um patamar por ano, ligados por lances de escada de três degraus.
const HUB_HALF = 160;      // meia largura do corredor da escadaria
const LOBBY_LEN = 320;
const LANDING_LEN = 384;
const STEP_LEN = 48;
const STEP_RISE = 24;      // o jogador só sobe 24 unidades por vez
const STEPS_PER_FLOOR = 3;
const FLOOR_HEIGHT = STEP_RISE * STEPS_PER_FLOOR;
const DOOR_HALF = 96;      // meia largura da porta de teleporte
const ALCOVE_DEPTH = 192;
const HEAD_ROOM = 256;

const LANDING_TAG = 10;    // tags 10..: patamares; 100..: salões; 200..: arenas
const HALL_TAG = 100;
const ARENA_TAG = 200;
const TROPHY_TAG = 240;
const GATE_TAG = 300;      // 300..: portão de cada arena (aberto quando o chefe cai)

const HALL_X0 = 0;
const HALL_WIDTH = 1536;
const HALL_DEPTH = 768;
const HALL_Y0 = 1024;
const HALL_PITCH = 1024;   // distância entre salões vizinhos

// As arenas ficam num bloco à parte, longe da escadaria (x até ~7.600) e dos
// salões (x até 1.536), para que crescer a torre nunca encoste numa na outra.
const ARENA_X0 = 8192;
const ARENA_WIDTH = 2048;
const ARENA_DEPTH = 2048;
const ARENA_Y0 = 2048;
const ARENA_PITCH = 3072;
const ARENA_ENTRY_X = 256;   // onde o jogador cai ao entrar na arena
const GATE_HALF = 128;       // meia largura do portão de saída
const GATE_DEPTH = 64;       // espessura do setor da porta
const VESTIBULE_DEPTH = 192; // vestíbulo atrás do portão, já com o teleporte
const DOOR_TEX = 'BIGDOOR1';

const TROPHY_X0 = ARENA_X0;
const TROPHY_WIDTH = 1536;
const TROPHY_DEPTH = 1024;

const floorOf = (index) => index * FLOOR_HEIGHT;

// A planta da torre, de baixo para cima: museu, arenas dos chefes e troféu.
const floors = [
  ...rooms.map((room, index) => ({ index, kind: 'museum', room })),
  ...bosses.map((boss, index) => ({ index: BOSS_FIRST + index, kind: 'boss', boss, bossIndex: index })),
  { index: TROPHY_FLOOR, kind: 'trophy' },
];

/** Para onde a alcova de cada patamar teleporta. */
const alcoveTarget = (floor) => {
  if (floor.kind === 'museum') return HALL_TAG + floor.index;
  if (floor.kind === 'boss') return ARENA_TAG + floor.bossIndex;
  return TROPHY_TAG;
};

// --- escadaria -------------------------------------------------------------

const segments = [];
let cursor = 0;
segments.push({ x0: cursor, x1: cursor + LOBBY_LEN, floor: 0, kind: 'lobby' });
cursor += LOBBY_LEN;
for (const floor of floors) {
  if (floor.index > 0) {
    for (let step = 0; step < STEPS_PER_FLOOR; step++) {
      segments.push({
        x0: cursor, x1: cursor + STEP_LEN,
        floor: floorOf(floor.index - 1) + STEP_RISE * (step + 1), kind: 'step',
      });
      cursor += STEP_LEN;
    }
  }
  segments.push({
    x0: cursor, x1: cursor + LANDING_LEN,
    floor: floorOf(floor.index), kind: 'landing', floorDesc: floor,
  });
  cursor += LANDING_LEN;
}

for (const segment of segments) {
  const isMuseum = segment.kind === 'landing' && segment.floorDesc.kind === 'museum';
  segment.sector = map.sector({
    floor: segment.floor,
    ceiling: segment.floor + HEAD_ROOM,
    floorTexture: segment.kind === 'landing' ? (isMuseum ? 'FLOOR4_8' : 'FLOOR7_1') : 'FLOOR0_1',
    ceilingTexture: 'CEIL3_5',
    // Os patamares dos chefes são mais escuros: o museu é passeio, em cima é briga.
    light: segment.kind === 'landing' ? (isMuseum ? 176 : 144) : 132,
    tag: segment.kind === 'landing' ? LANDING_TAG + segment.floorDesc.index : 0,
  });
}

segments.forEach((segment, index) => {
  const { x0, x1, sector } = segment;
  map.wall([x1, -HUB_HALF], [x0, -HUB_HALF], sector);            // parede sul
  if (index === 0) map.wall([x0, -HUB_HALF], [x0, HUB_HALF], sector);
  if (index === segments.length - 1) map.wall([x1, HUB_HALF], [x1, -HUB_HALF], sector);
  else map.portal([x1, -HUB_HALF], [x1, HUB_HALF], segments[index + 1].sector, sector);

  if (segment.kind !== 'landing') {
    map.wall([x0, HUB_HALF], [x1, HUB_HALF], sector);            // parede norte inteira
    return;
  }

  // Patamar: a parede norte abre uma alcova, e cruzar essa soleira teleporta
  // (para o salão do ano, para a arena do chefe ou para a câmara do troféu).
  const center = (x0 + x1) / 2;
  const alcove = map.sector({
    floor: segment.floor,
    ceiling: segment.floor + 144,
    floorTexture: 'GATE1',
    ceilingTexture: 'TLITE6_1',
    light: 255,
  });
  map.wall([x0, HUB_HALF], [center - DOOR_HALF, HUB_HALF], sector);
  map.portal(
    [center - DOOR_HALF, HUB_HALF], [center + DOOR_HALF, HUB_HALF], sector, alcove,
    { special: 97, tag: alcoveTarget(segment.floorDesc) },
  );
  map.wall([center + DOOR_HALF, HUB_HALF], [x1, HUB_HALF], sector);
  map.wall([center - DOOR_HALF, HUB_HALF], [center - DOOR_HALF, HUB_HALF + ALCOVE_DEPTH], alcove);
  map.wall([center - DOOR_HALF, HUB_HALF + ALCOVE_DEPTH], [center + DOOR_HALF, HUB_HALF + ALCOVE_DEPTH], alcove);
  map.wall([center + DOOR_HALF, HUB_HALF + ALCOVE_DEPTH], [center + DOOR_HALF, HUB_HALF], alcove);

  // Destino dos teleportes que trazem o jogador de volta (ou do salão/arena
  // anterior para este patamar).
  map.thing(center, 0, 14, 0);

  segment.center = center;
  segment.alcove = alcove;
});

const landings = segments.filter((segment) => segment.kind === 'landing');

// --- salões ----------------------------------------------------------------

// A leitura do salão vai da porta para o fundo: quem entra encontra primeiro as
// últimas colocações, aos pares dos dois lados do corredor, e sobe a lista até
// o primeiro lugar, sozinho no pódio iluminado da parede do fundo.
const ROW_X = [288, 480, 672, 864, 1056];
const ALTAR_ROW_OFFSET = 176;
const SIGN_X = 1200;
const PODIUM_X0 = 1280;
const PODIUM_X1 = 1472;
const PODIUM_HALF = 128;
const PODIUM_RISE = 24;
const PODIUM_CENTER = (PODIUM_X0 + PODIUM_X1) / 2;

function altarSlots(count) {
  const slots = [{ rank: 1, x: PODIUM_CENTER, side: 0, podium: true }];
  // Pares descendo: 10 e 9 na porta, 8 e 7 atrás, e assim por diante. Em ano com
  // número par de colocações o vice sobra sozinho, ao lado do pódio.
  for (let rank = count, row = 0; rank >= 2; rank -= 2, row += 1) {
    const x = ROW_X[Math.min(row, ROW_X.length - 1)];
    slots.push({ rank, x, side: -1 });
    if (rank - 1 >= 2) slots.push({ rank: rank - 1, x, side: 1 });
  }
  return slots;
}

rooms.forEach((room, index) => {
  const floor = floorOf(index);
  const y0 = HALL_Y0 + index * HALL_PITCH;
  const y1 = y0 + HALL_DEPTH;
  const x1 = HALL_X0 + HALL_WIDTH;
  const centerY = (y0 + y1) / 2;
  const hall = map.sector({
    floor,
    ceiling: floor + HEAD_ROOM,
    floorTexture: 'FLOOR4_8',
    ceilingTexture: 'CEIL3_5',
    light: 208,
    tag: HALL_TAG + index,
  });
  const exit = map.sector({
    floor,
    ceiling: floor + 144,
    floorTexture: 'GATE1',
    ceilingTexture: 'TLITE6_1',
    light: 255,
  });

  map.wall([x1, y0], [HALL_X0, y0], hall);                       // parede sul
  map.wall([HALL_X0, y0], [HALL_X0, centerY - DOOR_HALF], hall); // parede oeste, até a porta
  map.portal(
    [HALL_X0, centerY - DOOR_HALF], [HALL_X0, centerY + DOOR_HALF], hall, exit,
    { special: 97, tag: LANDING_TAG + index },
  );
  map.wall([HALL_X0, centerY + DOOR_HALF], [HALL_X0, y1], hall);
  map.wall([HALL_X0, y1], [x1, y1], hall);                       // parede norte
  map.wall([x1, y1], [x1, y0], hall);                            // parede leste
  map.wall([HALL_X0, centerY - DOOR_HALF], [HALL_X0 - ALCOVE_DEPTH, centerY - DOOR_HALF], exit);
  map.wall([HALL_X0 - ALCOVE_DEPTH, centerY - DOOR_HALF], [HALL_X0 - ALCOVE_DEPTH, centerY + DOOR_HALF], exit);
  map.wall([HALL_X0 - ALCOVE_DEPTH, centerY + DOOR_HALF], [HALL_X0, centerY + DOOR_HALF], exit);

  // Chegada: do patamar cai-se no salão olhando para os altares. O destino do
  // teleporte de volta foi criado junto do patamar, na escadaria.
  map.thing(HALL_X0 + 160, centerY, 14, 0);

  // Pódio do primeiro lugar: um degrau iluminado recortado no chão do salão.
  const podium = map.sector({
    floor: floor + PODIUM_RISE,
    ceiling: floor + HEAD_ROOM,
    floorTexture: 'TLITE6_4',
    ceilingTexture: 'CEIL3_5',
    light: 255,
  });
  const px0 = HALL_X0 + PODIUM_X0;
  const px1 = HALL_X0 + PODIUM_X1;
  map.portal([px1, centerY - PODIUM_HALF], [px0, centerY - PODIUM_HALF], podium, hall);
  map.portal([px0, centerY - PODIUM_HALF], [px0, centerY + PODIUM_HALF], podium, hall);
  map.portal([px0, centerY + PODIUM_HALF], [px1, centerY + PODIUM_HALF], podium, hall);
  map.portal([px1, centerY + PODIUM_HALF], [px1, centerY - PODIUM_HALF], podium, hall);

  // Cada coluna tecnológica é um jogo; a ordem sobe da porta até o pódio.
  altarSlots(room.games.length).forEach(({ rank, x, side, podium: onPodium }) => {
    const ax = HALL_X0 + x;
    const ay = centerY + side * ALTAR_ROW_OFFSET;
    map.thing(ax, ay, 48);                                  // pilar/altar
    map.thing(ax, ay, 31100 + index * 10 + (rank - 1));     // placa holográfica
    if (onPodium) {
      map.thing(px0 + 48, centerY - 96, 85);                // holofotes do pódio
      map.thing(px0 + 48, centerY + 96, 85);
    } else {
      map.thing(ax, ay - side * 40, 2028);                  // luminária virada para o corredor
    }
  });

  map.thing(HALL_X0 + SIGN_X, centerY, 31200 + index);              // totem alto sobre o pódio
  map.thing(landings[index].center, HUB_HALF + 128, 31000 + index); // e o da alcova, na escada
});

// --- arenas dos chefes ------------------------------------------------------
//
// Cada arena é uma caixa fechada, como os salões: chega-se por teleporte e a
// única saída é o portão do fundo, trancado até o chefe cair. O portão é um
// setor com o teto no chão (a porta clássica do Doom) e o DECORATE do chefe
// chama Door_Open no tag daquele setor quando ele morre; atrás do portão, a
// soleira do vestíbulo teleporta para o patamar seguinte.

// Itens clássicos do Doom II, por nome — é o que deixa o arsenal dos chefes
// legível em data/bosses.json.
const ITEM = {
  backpack: 8, chainsaw: 2005, shotgun: 2001, ssg: 82, chaingun: 2002,
  rocket: 2003, plasma: 2004, bfg: 2006,
  clip: 2007, shells: 2008, rocketAmmo: 2010, cell: 17,
  boxBullets: 2048, boxShells: 2049, boxRockets: 2046, cellPack: 2047,
  stimpack: 2011, medikit: 2012, soulsphere: 2013, megasphere: 83,
  greenArmor: 2018, blueArmor: 2019, berserk: 2023,
  healthBonus: 2014, armorBonus: 2015,
};

// Editor numbers: o Doom só aceita até 32767, e o museu já ocupa 31000..31299.
const BOSS_THING = 32010;    // + índice*10
const ARENA_SIGN = 31300;    // placa grande do chefe na arena, + índice*10
const ARENA_TOTEM = 31400;   // totem do andar dentro da arena, + índice*10
const PORCH_TOTEM = 31500;   // totem da alcova, no patamar da escada, + índice

const itemType = (name) => {
  const type = ITEM[name];
  if (!type) throw new Error(`Item desconhecido em data/bosses.json: ${name}`);
  return type;
};

/** Distribui itens nos lugares livres da arena, empurrando o que sobrar. */
const scatter = (items, slots, swap = {}) => items.forEach((name, index) => {
  const [x, y] = slots[index % slots.length];
  map.thing(x + Math.floor(index / slots.length) * 32, y, swap[name] ?? itemType(name));
});

// Editor numbers dos itens e enfeites temáticos (os atores ficam em THEMES).
const THEME = {
  moeda: 31730, cogumelo: 31731, estrela: 31732,
  cano: 31740, blocoQ: 31741, triforce: 31742, bolinha: 31743,
  coracao: 31750, arcoIris: 31751,
  sepith: 31760, sepithAzul: 31761, tearaBalm: 31762,
  quartzo: 31770,   // + cor (0..6)
  estandarte: 31777, brasao: 31778, posteOrbal: 31779, cristal: 31780, coluna: 31781,
  suplemento: 31790, palheta: 31791, kitMedico: 31792,
  carro: 31793, girafa: 31794, violao: 31795, vagalume: 31796, placaSk8: 31797, skate: 31798,
  alma: 31800, brasa: 31801, estus: 31802,
  caixa: 31803, alvo: 31804, fogueira: 31805, picross: 31806, mensagem: 31807, nevoa: 31808,
};

/** Um ator de DECORATE com um estado Spawn só. */
const decoActor = (header, props, spawn) => [
  `ACTOR ${header}`, '{', ...props.map((line) => `  ${line}`),
  '  States', '  {', '  Spawn:', ...spawn.map((line) => `    ${line}`), '  }', '}',
].join('\n');
const FLOATING = ['+NOGRAVITY', '+NOBLOCKMAP', '+NOINTERACTION'];

/**
 * Temas de arena (`"tema"` em data/bosses.json): o que entra no lugar dos
 * pilares e das luminárias, os enfeites, a troca de itens, as texturas, os
 * sprites e os atores. Tudo desenhado pelo próprio build.
 */
const THEMES = {
  nintendo: {
    pilar: THEME.cano,
    itens: { healthBonus: THEME.moeda, medikit: THEME.cogumelo, armorBonus: THEME.estrela },
    // Blocos "?" no ar, moedas em anel no meio, os triângulos no alto das
    // paredes norte e sul e duas bolinhas vermelhas e brancas pelo chão.
    enfeites({ x0, x1, y0, y1, centerY }) {
      for (const [px, py] of [
        [x0 + 704, centerY - 256], [x0 + 704, centerY + 256], [x0 + 1216, y0 + 320],
        [x0 + 1216, y1 - 320], [x1 - 320, centerY - 512], [x1 - 320, centerY + 512],
      ]) map.thing(px, py, THEME.blocoQ);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * 2 * Math.PI;
        map.thing(x0 + 1200 + Math.cos(a) * 224, centerY + Math.sin(a) * 224, THEME.moeda);
      }
      map.thing(x0 + 1024, y0 + 24, THEME.triforce);
      map.thing(x0 + 1024, y1 - 24, THEME.triforce);
      map.thing(x0 + 320, y0 + 704, THEME.bolinha);
      map.thing(x1 - 384, y1 - 640, THEME.bolinha);
    },
    texturas: () => nintendoTextures(),
    sprites: () => nintendoSprites(),
    atores: () => [
      decoActor(`JogMoeda : HealthBonus ${THEME.moeda}`, ['Inventory.PickupMessage "MOEDA! +1 DE VIDA"'], ['JNM0 ABCDCB 5 BRIGHT', 'Loop']),
      decoActor(`JogCogumelo : Medikit ${THEME.cogumelo}`, ['Inventory.PickupMessage "COGUMELO! +25 DE VIDA"'], ['JNG0 A -1', 'Stop']),
      decoActor(`JogEstrela : ArmorBonus ${THEME.estrela}`, ['Inventory.PickupMessage "ESTRELINHA! +1 DE ARMADURA"', '+FLOATBOB'], ['JNE0 A -1 BRIGHT', 'Stop']),
      decoActor(`JogCano ${THEME.cano}`, ['Radius 44', 'Height 128', '+SOLID'], ['JNC0 A -1', 'Stop']),
      decoActor(`JogBlocoQ ${THEME.blocoQ}`, [...FLOATING, '+FLOATBOB'], ['JNQ0 A 24 BRIGHT', 'JNQ0 B 8 BRIGHT', 'Loop']),
      decoActor(`JogTriforce ${THEME.triforce}`, FLOATING, ['JNT0 A -1 BRIGHT', 'Stop']),
      decoActor(`JogBolinha ${THEME.bolinha}`, ['Radius 16', 'Height 32'], ['JNP0 A -1', 'Stop']),
    ],
  },
  trails: {
    pilar: THEME.coluna,
    lampada: THEME.posteOrbal,
    itens: { healthBonus: THEME.sepith, armorBonus: THEME.sepithAzul, medikit: THEME.tearaBalm },
    // Quartzos das sete cores no ar, estandartes nas paredes norte e sul, o
    // brasão na parede oeste e o cristal gigante fora do eixo da entrada.
    enfeites({ x0, x1, y0, y1, centerY }) {
      [
        [x0 + 704, centerY - 256], [x0 + 704, centerY + 256], [x0 + 1216, y0 + 320], [x0 + 1216, y1 - 320],
        [x1 - 320, centerY - 512], [x1 - 320, centerY + 512], [x0 + 1500, centerY - 700],
      ].forEach(([px, py], i) => map.thing(px, py, THEME.quartzo + i));
      for (const px of [x0 + 320, x0 + 768, x0 + 1280, x0 + 1728]) {
        map.thing(px, y0 + 24, THEME.estandarte);
        map.thing(px, y1 - 24, THEME.estandarte);
      }
      map.thing(x0 + 24, centerY, THEME.brasao);
      map.thing(x0 + 1024, centerY + 640, THEME.cristal);
    },
    texturas: () => trailsTextures(),
    sprites: () => trailsSprites(),
    atores: () => [
      decoActor(`JogSepith : HealthBonus ${THEME.sepith}`, ['Inventory.PickupMessage "SEPITH! +1 DE VIDA"', '+FLOATBOB'], ['JKS0 A -1 BRIGHT', 'Stop']),
      decoActor(`JogSepithAzul : ArmorBonus ${THEME.sepithAzul}`, ['Inventory.PickupMessage "SEPITH! +1 DE ARMADURA"', '+FLOATBOB'], ['JKS0 B -1 BRIGHT', 'Stop']),
      decoActor(`JogTearaBalm : Medikit ${THEME.tearaBalm}`, ['Inventory.PickupMessage "TEARA BALM! +25 DE VIDA"'], ['JKT0 A -1', 'Stop']),
      ...QUARTZ_COLORS.map((_, i) => decoActor(`JogQuartzo${i} ${THEME.quartzo + i}`, [...FLOATING, '+FLOATBOB'], [`JKQ0 ${'ABCDEFG'[i]} -1 BRIGHT`, 'Stop'])),
      decoActor(`JogEstandarte ${THEME.estandarte}`, FLOATING, ['JKB0 A -1', 'Stop']),
      decoActor(`JogBrasao ${THEME.brasao}`, FLOATING, ['JKE0 A -1', 'Stop']),
      decoActor(`JogPosteOrbal ${THEME.posteOrbal}`, ['Radius 12', 'Height 112', '+SOLID'], ['JKL0 A 30 BRIGHT', 'JKL0 B 20 BRIGHT', 'Loop']),
      decoActor(`JogCristal ${THEME.cristal}`, ['Radius 40', 'Height 220', '+SOLID'], ['JKX0 A -1 BRIGHT', 'Stop']),
      decoActor(`JogColuna ${THEME.coluna}`, ['Radius 34', 'Height 140', '+SOLID'], ['JKP0 A -1', 'Stop']),
    ],
  },
};

THEMES.tlou = {
  pilar: THEME.carro,
  lampada: 70, // barril em chamas do Doom
  itens: { healthBonus: THEME.suplemento, armorBonus: THEME.palheta, medikit: THEME.kitMedico },
  // A girafa num canto, vaga-lumes espalhados, o violão, a placa "SK8" na
  // parede norte e o skate no chão.
  enfeites({ x0, x1, y0, y1, centerY }) {
    map.thing(x0 + 1600, y1 - 260, THEME.girafa, 180);
    for (let i = 0; i < 14; i++) {
      map.thing(x0 + 300 + noise(i, 31) * 1450, y0 + 200 + noise(i, 32) * 1650, THEME.vagalume);
    }
    map.thing(x0 + 220, y0 + 220, THEME.violao);
    map.thing(x1 - 300, y0 + 260, THEME.violao);
    map.thing(x0 + 1024, y1 - 24, THEME.placaSk8);
    map.thing(x0 + 1400, centerY - 300, THEME.skate);
  },
  texturas: () => tlouTextures(),
  sprites: () => tlouSprites(),
  atores: () => [
    decoActor(`JogSuplemento : HealthBonus ${THEME.suplemento}`, ['Inventory.PickupMessage "SUPLEMENTOS! +1 DE VIDA"'], ['JUP0 A -1', 'Stop']),
    decoActor(`JogPalheta : ArmorBonus ${THEME.palheta}`, ['Inventory.PickupMessage "PALHETA ROSA! +1 DE ARMADURA"', '+FLOATBOB'], ['JUA0 A -1 BRIGHT', 'Stop']),
    decoActor(`JogKitMedico : Medikit ${THEME.kitMedico}`, ['Inventory.PickupMessage "KIT MEDICO! +25 DE VIDA"'], ['JUM0 A -1', 'Stop']),
    decoActor(`JogCarro ${THEME.carro}`, ['Radius 60', 'Height 80', '+SOLID'], ['JUC0 A -1', 'Stop']),
    decoActor(`JogGirafa ${THEME.girafa}`, ['Radius 28', 'Height 220', '+SOLID'], ['JUG0 A -1', 'Stop']),
    decoActor(`JogViolao ${THEME.violao}`, ['Radius 14', 'Height 60'], ['JUV0 A -1', 'Stop']),
    decoActor(`JogVagalume ${THEME.vagalume}`, [...FLOATING, '+FLOATBOB', 'RenderStyle Add'], ['JUF0 A 12 BRIGHT', 'JUF0 B 18 BRIGHT', 'Loop']),
    decoActor(`JogPlacaSk8 ${THEME.placaSk8}`, FLOATING, ['JUS0 A -1', 'Stop']),
    decoActor(`JogSkate ${THEME.skate}`, ['Radius 20', 'Height 8'], ['JUK0 A -1', 'Stop']),
  ],
};

THEMES.souls = {
  pilar: THEME.caixa,
  lampada: 35, // candelabro do Doom
  itens: { healthBonus: THEME.alma, armorBonus: THEME.brasa, medikit: THEME.estus },
  // A névoa logo atrás de quem chega, a fogueira fora do eixo, os alvos de
  // Sokoban perto das caixas, o Picross na parede norte e as mensagens no chão.
  enfeites({ x0, x1, y0, y1, centerY }) {
    map.thing(x0 + 40, centerY, THEME.nevoa);
    map.thing(x0 + 1100, centerY + 420, THEME.fogueira);
    for (const [px, py] of [[x0 + 576, y0 + 448], [x0 + 448, y1 - 576], [x1 - 576, y0 + 448], [x1 - 448, y1 - 320]]) {
      map.thing(px, py, THEME.alvo);
    }
    map.thing(x0 + 1024, y1 - 24, THEME.picross);
    map.thing(x0 + 640, centerY - 96, THEME.mensagem);
    map.thing(x1 - 900, centerY + 160, THEME.mensagem);
  },
  texturas: () => soulsTextures(),
  sprites: () => soulsSprites(),
  atores: () => [
    decoActor(`JogAlma : HealthBonus ${THEME.alma}`, ['Inventory.PickupMessage "ALMA! +1 DE VIDA"', '+FLOATBOB', 'RenderStyle Add'], ['JSA0 A -1 BRIGHT', 'Stop']),
    decoActor(`JogBrasa : ArmorBonus ${THEME.brasa}`, ['Inventory.PickupMessage "BRASA! +1 DE ARMADURA"', '+FLOATBOB'], ['JSB0 A -1 BRIGHT', 'Stop']),
    decoActor(`JogEstus : Medikit ${THEME.estus}`, ['Inventory.PickupMessage "FRASCO DE ESTUS! +25 DE VIDA"'], ['JSE0 A -1 BRIGHT', 'Stop']),
    decoActor(`JogCaixa ${THEME.caixa}`, ['Radius 40', 'Height 80', '+SOLID'], ['JSC0 A -1', 'Stop']),
    decoActor(`JogAlvo ${THEME.alvo}`, ['Radius 16', 'Height 4'], ['JSX0 A -1', 'Stop']),
    decoActor(`JogFogueira ${THEME.fogueira}`, ['Radius 24', 'Height 48', '+SOLID'], ['JSF0 A 4 BRIGHT', 'JSF0 B 4 BRIGHT', 'JSF0 C 4 BRIGHT', 'Loop']),
    decoActor(`JogPicross ${THEME.picross}`, FLOATING, ['JSP0 A -1', 'Stop']),
    decoActor(`JogMensagem ${THEME.mensagem}`, ['Radius 8', 'Height 4', 'Scale 0.5'], ['JSM0 A -1 BRIGHT', 'Stop']),
    decoActor(`JogNevoa ${THEME.nevoa}`, [...FLOATING, 'RenderStyle Add', 'Alpha 0.8'], ['JSN0 A -1 BRIGHT', 'Stop']),
  ],
};

const DIMENSION_ACTORS = () => [
  decoActor(`JogCoracao ${THEME.coracao}`, [...FLOATING, '+FLOATBOB', 'RenderStyle Add'], ['JDC0 A -1 BRIGHT', 'Stop']),
  decoActor(`JogArcoIris ${THEME.arcoIris}`, [...FLOATING, 'RenderStyle Translucent', 'Alpha 0.85'], ['JDA0 A -1 BRIGHT', 'Stop']),
];

// A dimensão dos corações: sala fechada a leste das arenas, para onde o chefe
// que suga (`"especial": "sugar"`) manda o jogador antes de cuspi-lo de volta.
const DIMENSION_TAG = 250;
const DIMENSION_X0 = 11776;
const DIMENSION_Y0 = 2048;
const DIMENSION_SIZE = 1536;

bosses.forEach((boss, k) => {
  const floorDesc = floors[BOSS_FIRST + k];
  const floor = floorOf(floorDesc.index);
  const landing = landings[floorDesc.index];
  const x0 = ARENA_X0;
  const x1 = ARENA_X0 + ARENA_WIDTH;
  const y0 = ARENA_Y0 + k * ARENA_PITCH;
  const y1 = y0 + ARENA_DEPTH;
  const centerY = (y0 + y1) / 2;
  const yB = centerY - GATE_HALF;
  const yT = centerY + GATE_HALF;
  const xGate = x1 + GATE_DEPTH;
  const xVest = xGate + VESTIBULE_DEPTH;

  const arena = map.sector({
    floor,
    ceiling: floor + boss.arena.height,
    floorTexture: boss.arena.floor,
    ceilingTexture: boss.arena.ceiling,
    light: boss.arena.light,
    tag: ARENA_TAG + k,
  });
  const gate = map.sector({
    floor, ceiling: floor,               // porta fechada: teto no chão
    floorTexture: 'FLOOR0_1', ceilingTexture: 'CEIL3_5', light: 176,
    tag: GATE_TAG + k,
  });
  const vestibule = map.sector({
    floor,
    ceiling: floor + 144,
    floorTexture: 'GATE1',
    ceilingTexture: 'TLITE6_1',
    light: 255,
  });

  map.wall([x1, y0], [x0, y0], arena, boss.arena.wall);       // parede sul
  map.wall([x0, y0], [x0, y1], arena, boss.arena.wall);       // parede oeste
  map.wall([x0, y1], [x1, y1], arena, boss.arena.wall);       // parede norte
  map.wall([x1, y1], [x1, yT], arena, boss.arena.wall);       // leste, acima do portão
  map.wall([x1, yB], [x1, y0], arena, boss.arena.wall);       // leste, abaixo do portão
  map.wall([x1, yT], [xGate, yT], gate, boss.arena.wall);     // ombreira norte
  map.wall([xGate, yB], [x1, yB], gate, boss.arena.wall);     // ombreira sul

  // O portão em si não tem special nenhum: quem abre é o DECORATE do chefe,
  // pelo tag do setor. Assim o jogador não consegue abrir na mão.
  map.portal([x1, yB], [x1, yT], gate, arena, { upper: DOOR_TEX, lower: '-', middle: '-' });
  // Cruzar a soleira do vestíbulo sobe para o patamar seguinte.
  map.portal(
    [xGate, yT], [xGate, yB], gate, vestibule,
    { special: 97, tag: LANDING_TAG + floorDesc.index + 1, upper: DOOR_TEX, lower: '-', middle: '-' },
  );
  map.wall([xGate, yT], [xVest, yT], vestibule);
  map.wall([xVest, yT], [xVest, yB], vestibule);
  map.wall([xVest, yB], [xGate, yB], vestibule);

  // Chegada no oeste, de frente para o chefe, que encara a entrada.
  map.thing(x0 + ARENA_ENTRY_X, centerY, 14, 0);
  map.thing(x1 - 640, centerY, BOSS_THING + k * 10, 180);

  map.thing(x1 - 96, centerY, ARENA_SIGN + k * 10);   // placa alta sobre o portão
  map.thing(x0 + 384, centerY, ARENA_TOTEM + k * 10); // totem logo na entrada
  map.thing(landing.center, HUB_HALF + 128, PORCH_TOTEM + k); // e o da escada

  // Pilares e luminárias: cobertura para a briga e luz para ver o chefe. Tudo
  // fora do eixo da entrada, para nada barrar quem chega ou quem sai.
  const theme = boss.arena.tema ? THEMES[boss.arena.tema] : null;
  if (boss.arena.tema && !theme) throw new Error(`Tema desconhecido em data/bosses.json: ${boss.arena.tema}`);
  for (const [px, py] of [
    [x0 + 448, y0 + 448], [x0 + 448, y1 - 448],
    [x1 - 448, y0 + 448], [x1 - 448, y1 - 448],
    [x0 + 960, centerY - 448], [x0 + 960, centerY + 448],
  ]) map.thing(px, py, theme?.pilar ?? 48);
  theme?.enfeites({ x0, x1, y0, y1, centerY });
  for (const [px, py] of [
    [x1 - 640, centerY - 192], [x1 - 640, centerY + 192],
    [x0 + 448, centerY - 320], [x0 + 448, centerY + 320],
  ]) map.thing(px, py, theme?.lampada ?? 2028);

  // O arsenal fica no patamar, antes de entrar; os suprimentos, na arena.
  scatter(boss.arsenal ?? [], [
    [landing.center - 128, 96], [landing.center, 96], [landing.center + 128, 96],
    [landing.center - 128, -96], [landing.center, -96], [landing.center + 128, -96],
    [landing.center - 64, 0], [landing.center + 64, 0],
  ]);
  scatter(boss.supplies ?? [], [
    [x0 + 512, y0 + 128], [x0 + 896, y0 + 128], [x0 + 1280, y0 + 128],
    [x0 + 512, y1 - 128], [x0 + 896, y1 - 128], [x0 + 1280, y1 - 128],
    [x0 + 192, centerY], [x0 + 192, centerY - 128], [x0 + 192, centerY + 128],
    [x1 - 256, y0 + 128], [x1 - 256, y1 - 128], [x0 + 1600, centerY],
  ], theme?.itens ?? {});
});

if (bosses.some((boss) => boss.especial === 'sugar')) {
  const x0 = DIMENSION_X0; const x1 = x0 + DIMENSION_SIZE;
  const y0 = DIMENSION_Y0; const y1 = y0 + DIMENSION_SIZE;
  const dimension = map.sector({
    floor: 0, ceiling: 640, floorTexture: 'JCORACAO', ceilingTexture: 'JCEUROSA', light: 255, tag: DIMENSION_TAG,
  });
  map.wall([x1, y0], [x0, y0], dimension, 'JARCOIRI');
  map.wall([x0, y0], [x0, y1], dimension, 'JARCOIRI');
  map.wall([x0, y1], [x1, y1], dimension, 'JARCOIRI');
  map.wall([x1, y1], [x1, y0], dimension, 'JARCOIRI');
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      if ((i === 1 || i === 2) && (j === 1 || j === 2)) continue; // o meio fica livre para a chegada
      map.thing(x0 + 192 + i * 384, y0 + 192 + j * 384, THEME.coracao);
    }
  }
  map.thing(x0 + 768, y0 + 64, THEME.arcoIris);
  map.thing(x0 + 768, y1 - 64, THEME.arcoIris);
  map.thing(x0 + 64, y0 + 768, THEME.arcoIris);
  map.thing(x1 - 64, y0 + 768, THEME.arcoIris);
  for (const [px, py] of [[x0 + 576, y0 + 768], [x0 + 960, y0 + 768], [x0 + 768, y0 + 576], [x0 + 768, y0 + 960]]) {
    map.thing(px, py, THEME.coracao);
  }
}

// --- câmara do troféu -------------------------------------------------------
//
// Último andar: quem matou o Sushi chega aqui, vê as placas dos quatro e
// aperta o interruptor que encerra o mapa (MAPINFO manda para o EndGameC).

const VICTORY_SIGN = 31650;
const TROPHY_TOTEM = 31550;   // totem do andar 15, na alcova da escada
const CREDITS_SIGN = 31600;   // + índice

{
  const floor = floorOf(TROPHY_FLOOR);
  const x0 = TROPHY_X0;
  const x1 = TROPHY_X0 + TROPHY_WIDTH;
  const y0 = ARENA_Y0 + bosses.length * ARENA_PITCH;
  const y1 = y0 + TROPHY_DEPTH;
  const centerY = (y0 + y1) / 2;

  const trophy = map.sector({
    floor,
    ceiling: floor + 384,
    floorTexture: 'TLITE6_4',
    ceilingTexture: 'CEIL3_5',
    light: 255,
    tag: TROPHY_TAG,
  });

  map.wall([x1, y0], [x0, y0], trophy);                        // parede sul
  map.wall([x0, y0], [x0, y1], trophy);                        // parede oeste
  map.wall([x0, y1], [x1, y1], trophy);                        // parede norte
  map.wall([x1, y1], [x1, centerY + 96], trophy);              // parede leste
  map.wall([x1, centerY + 96], [x1, centerY - 96], trophy, 'SW1EXIT', { special: 11 });
  map.wall([x1, centerY - 96], [x1, y0], trophy);

  map.thing(x0 + 192, centerY, 14, 0);          // chegada, de frente para a saída
  map.thing(x1 - 128, centerY, VICTORY_SIGN);   // placa da vitória, no alto da parede
  map.thing(landings[TROPHY_FLOOR].center, HUB_HALF + 128, TROPHY_TOTEM); // totem na escada
  // A fila dos quatro, na parede norte.
  bosses.forEach((boss, k) => {
    map.thing(x0 + 320 + k * 256, y1 - 96, CREDITS_SIGN + k);
  });
  // Luminárias encostadas nas laterais: o caminho da entrada até o
  // interruptor fica livre.
  for (const [px, py] of [
    [x0 + 320, centerY - 320], [x0 + 320, centerY + 320],
    [x0 + 768, centerY - 320], [x0 + 768, centerY + 320],
    [x1 - 320, centerY - 320], [x1 - 320, centerY + 320],
  ]) map.thing(px, py, 2028);
  map.thing(x0 + 768, centerY, 2013);   // a recompensa: um soulsphere
}

map.thing(96, 0, 1, 0); // jogador nasce no saguão, de frente para a escadaria
map.validate();

// -------------------------------------------------------------------- lumps

function fixedName(name) {
  const bytes = Buffer.alloc(8);
  bytes.write(name.toUpperCase().slice(0, 8), 'ascii');
  return bytes;
}

const lump = (name, data = Buffer.alloc(0)) => ({ name, data: Buffer.from(data) });

function things(entries) {
  const data = Buffer.alloc(entries.length * 10);
  entries.forEach(([x, y, angle, type, flags], index) => {
    const at = index * 10;
    data.writeInt16LE(x, at);
    data.writeInt16LE(y, at + 2);
    data.writeUInt16LE(angle, at + 4);
    data.writeUInt16LE(type, at + 6);
    data.writeUInt16LE(flags, at + 8);
  });
  return data;
}

function vertices(entries) {
  const data = Buffer.alloc(entries.length * 4);
  entries.forEach(([x, y], index) => {
    data.writeInt16LE(x, index * 4);
    data.writeInt16LE(y, index * 4 + 2);
  });
  return data;
}

function sidedefs(entries) {
  const data = Buffer.alloc(entries.length * 30);
  entries.forEach(({ upper = '-', lower = '-', middle = '-', sector = 0 }, index) => {
    const at = index * 30;
    data.writeInt16LE(0, at);
    data.writeInt16LE(0, at + 2);
    fixedName(upper).copy(data, at + 4);
    fixedName(lower).copy(data, at + 12);
    fixedName(middle).copy(data, at + 20);
    data.writeUInt16LE(sector, at + 28);
  });
  return data;
}

function linedefs(entries) {
  const data = Buffer.alloc(entries.length * 14);
  entries.forEach(({ start, end, flags = 1, special = 0, tag = 0, front, back = 0xffff }, index) => {
    const at = index * 14;
    data.writeUInt16LE(start, at);
    data.writeUInt16LE(end, at + 2);
    data.writeUInt16LE(flags, at + 4);
    data.writeUInt16LE(special, at + 6);
    data.writeUInt16LE(tag, at + 8);
    data.writeUInt16LE(front, at + 10);
    data.writeUInt16LE(back, at + 12);
  });
  return data;
}

function sectors(entries) {
  const data = Buffer.alloc(entries.length * 26);
  entries.forEach(({ floor = 0, ceiling = 128, floorTexture = 'FLOOR0_1', ceilingTexture = 'CEIL3_5', light = 176, special = 0, tag = 0 }, index) => {
    const at = index * 26;
    data.writeInt16LE(floor, at);
    data.writeInt16LE(ceiling, at + 2);
    fixedName(floorTexture).copy(data, at + 4);
    fixedName(ceilingTexture).copy(data, at + 12);
    data.writeInt16LE(light, at + 20);
    data.writeInt16LE(special, at + 22);
    data.writeInt16LE(tag, at + 24);
  });
  return data;
}

const letter = (index) => String.fromCharCode(65 + index);
const labelSprite = (year, rank) => `JL${letter(year)}${rank}`;
const doorSignSprite = (year) => `JY${letter(year)}0`;
const hallSignSprite = (year) => `JZ${letter(year)}0`;
const bossPlateSprite = (index) => `JB${letter(index)}0`;
const bossPorchSprite = (index) => `JY${letter(index)}0`;
const bossArenaSprite = (index) => `JZ${letter(index)}0`;
const creditSprite = (index) => `JC${letter(index)}0`;
const faceSprite = (index) => `JF${letter(index)}0`;
const headSprite = (index) => `JH${letter(index)}0`;
const headModel = (index) => `cabeca-${letter(index).toLowerCase()}.md3`;
const headSkin = (index) => `cabeca-${letter(index).toLowerCase()}.png`;

/** O rosto de um chefe vem de data/rostos/<id>.png (opcional). */
function faceFile(boss) {
  const path = resolve(process.cwd(), 'data/rostos', `${boss.id}.png`);
  return existsSync(path) ? readFileSync(path) : null;
}

// ------------------------------------------------------- sprite do chefe
//
// O chefe não é um monstro do IWAD com um rosto colado por cima: o sprite
// inteiro é desenhado aqui. A cara do integrante vira a cabeça de uma criatura
// flutuante, com gola, aura na cor do andar e nove quadros (A..I) que cobrem
// tudo o que os estados do monstro base usam: parado, andando, ataque, dor e a
// sequência de morte.

const BOSS_FRAME_SIZE = [160, 200];

/** Desenha um quadro do chefe. `etapa` muda a pose conforme a letra do quadro. */
function bossFramePng(face, boss, letter) {
  const [width, height] = BOSS_FRAME_SIZE;
  const cor = hexColor(boss.rosto.cor ?? '#888888');
  const aura = [cor[0], cor[1], cor[2], 255];
  const image = canvas(width, height);
  const headY = { A: 18, B: 22, C: 16, D: 12, E: 20, F: 26, G: 34, H: 44, I: 58 }[letter] ?? 18;
  const headScale = { A: 1, B: 1, C: 1.05, D: 1.12, E: 1.02, F: 1, G: 0.98, H: 0.94, I: 0.9 }[letter] ?? 1;
  const tilt = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 10, G: 26, H: 48, I: 78 }[letter] ?? 0;
  const escurece = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0.25, G: 0.45, H: 0.62, I: 0.78 }[letter] ?? 0;
  const brilho = { A: 0.10, B: 0.08, C: 0.18, D: 0.32, E: 0.14, F: 0.08, G: 0.05, H: 0.03, I: 0.02 }[letter] ?? 0.1;
  const queda = { F: 4, G: 12, H: 24, I: 40 }[letter] ?? 0;
  const squash = { H: 0.75, I: 0.5 }[letter] ?? 1;
  const gola = { A: 0, B: 2, C: 0, D: -2, E: 2, F: 6, G: 14, H: 26, I: 42 }[letter] ?? 0;

  // Aura: anéis concêntricos atrás da cabeça, na cor do andar.
  for (let raio = 78; raio > 52; raio -= 4) {
    image.ellipse(80, 82 - queda / 2, raio, raio * 1.05, [aura[0], aura[1], aura[2], Math.round(4 + brilho * 40)]);
  }
  // Gola/torso: a criatura é uma cabeça flutuante com um tronco esfarrapado.
  image.ellipse(80, 168 + gola, 54, 40, [cor[0] * 0.35, cor[1] * 0.35, cor[2] * 0.35, 235]);
  image.ellipse(80, 158 + gola, 44, 30, [cor[0] * 0.55, cor[1] * 0.55, cor[2] * 0.55, 245]);
  image.ellipse(80, 148 + gola, 34, 22, [240, 240, 240, 60]);

  // A cabeça: o rosto do integrante, com giro e escurecimento na morte.
  const escuro = [20, 18, 22];
  image.paste(face, 80, 82 - queda + (headY - 18), {
    scale: (122 / face.width) * headScale,
    rotate: tilt,
    tint: escurece > 0 ? escuro : (letter === 'E' ? [220, 70, 60] : (letter === 'D' ? aura : null)),
    amount: escurece > 0 ? escurece : (letter === 'E' ? 0.4 : (letter === 'D' ? 0.22 : 0)),
    squash,
  });

  return image.toPng(Math.round(width / 2), height);
}

// ------------------------------------------------- chefe de corpo inteiro
//
// Com `"corpo": "heroi"` em data/bosses.json o chefe deixa de ser a cabeça
// flutuante: vira um herói baixinho de capa, túnica na cor do andar, luvas e
// botas, de pé numa nuvem (o monstro herdado voa). A cabeça continua sendo o rosto
// do integrante. Cada parte é desenhada com contorno escuro por baixo e a
// próxima parte por cima, o que deixa a linha de separação do pixel art.

const OUTLINE = [24, 14, 18, 255];
const BODY_FRAME_SIZE = [220, 200];

const shade = (color, k) => [
  Math.min(255, Math.round(color[0] * k)), Math.min(255, Math.round(color[1] * k)),
  Math.min(255, Math.round(color[2] * k)), color[3] ?? 255,
];

function fillPolygon(image, points, color) {
  const ys = points.map(([, y]) => y);
  for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
    const xs = [];
    points.forEach(([x0, y0], i) => {
      const [x1, y1] = points[(i + 1) % points.length];
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
    });
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      for (let x = Math.ceil(xs[i]); x <= Math.floor(xs[i + 1]); x++) image.blend(x, y, color);
    }
  }
}

function roundRect(image, x, y, w, h, r, color) {
  for (let yy = Math.round(y); yy < y + h; yy++) {
    for (let xx = Math.round(x); xx < x + w; xx++) {
      const cx = Math.min(Math.max(xx, x + r), x + w - r);
      const cy = Math.min(Math.max(yy, y + r), y + h - r);
      if ((xx - cx) ** 2 + (yy - cy) ** 2 <= r * r) image.blend(xx, yy, color);
    }
  }
}

/** Membro: carimba círculos ao longo do segmento (braços e pernas). */
function limb(image, x0, y0, x1, y1, radius, color) {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    image.ellipse(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius, radius, color);
  }
}

function star(image, cx, cy, radius, color) {
  const points = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? radius * 0.45 : radius;
    points.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  fillPolygon(image, points, color);
}

/** Contorno primeiro, preenchimento depois: `draw(grow, color)` desenha a forma. */
const outlined = (draw, color) => { draw(2, OUTLINE); draw(0, color); };

function fireball(image, x, y, radius) {
  for (let r = radius * 2.2; r > radius; r -= 2) image.ellipse(x, y, r, r, [255, 140, 30, 22]);
  image.ellipse(x, y, radius + 2, radius + 2, OUTLINE);
  image.ellipse(x, y, radius, radius, [235, 70, 20, 255]);
  image.ellipse(x - radius * 0.15, y - radius * 0.15, radius * 0.7, radius * 0.7, [255, 170, 40, 255]);
  image.ellipse(x - radius * 0.3, y - radius * 0.3, radius * 0.35, radius * 0.35, [255, 245, 190, 255]);
}

/** O herói em pé, num quadro 160×200 sem giro; a pose vem de `pose`. */
function heroPose(face, boss, pose) {
  const image = canvas(160, 200);
  const cor = hexColor(boss.rosto.cor ?? '#c0392b');
  const capa = shade(cor, 0.55);
  const calca = [44, 52, 110, 255];
  const bota = [110, 62, 30, 255];
  const luva = [242, 242, 236, 255];
  const ouro = [255, 205, 40, 255];
  const b = pose.bob ?? 0;
  const ground = pose.nuvem === false ? 196 : 178;
  const lift = 178 - ground; // sem nuvem o corpo desce até o chão

  if (pose.nuvem !== false) {
    const f = pose.fase ?? 0;
    const puff = (x, y, rx, ry) => outlined((g, c) => image.ellipse(x, y, rx + g, ry + g, c), [246, 249, 255, 255]);
    puff(80, 188, 56, 11);
    puff(50 - f * 2, 182, 22, 12);
    puff(110 + f * 2, 182, 22, 12);
    puff(80 + f, 178, 30, 13);
    image.ellipse(80, 192, 50, 5, [176, 196, 230, 255]);
  }

  const y = (v) => v + b - lift;

  // Capa atrás do corpo, balançando com a fase.
  const sway = (pose.fase ?? 0) * 4;
  outlined((g, c) => fillPolygon(image, [
    [54 - g, y(102) - g], [106 + g, y(102) - g], [124 + g + sway, y(168) + g], [36 - g + sway, y(166) + g],
  ], c), capa);
  fillPolygon(image, [[60, y(108)], [70, y(108)], [52 + sway, y(160)], [42 + sway, y(160)]], shade(capa, 0.8));

  // Pernas e botas.
  outlined((g, c) => limb(image, 68, y(146), 66, ground - 8, 8 + g, c), calca);
  outlined((g, c) => limb(image, 92, y(146), 94, ground - 8, 8 + g, c), calca);
  outlined((g, c) => image.ellipse(63, ground - 4, 12 + g, 7 + g, c), bota);
  outlined((g, c) => image.ellipse(97, ground - 4, 12 + g, 7 + g, c), bota);
  image.ellipse(59, ground - 7, 5, 2, shade(bota, 1.4));
  image.ellipse(93, ground - 7, 5, 2, shade(bota, 1.4));

  // Túnica, cinto e a estrela no peito.
  outlined((g, c) => roundRect(image, 52 - g, y(102) - g, 56 + 2 * g, 50 + 2 * g, 14 + g, c), cor);
  roundRect(image, 58, y(108), 18, 28, 8, shade(cor, 1.25));
  roundRect(image, 92, y(112), 12, 34, 6, shade(cor, 0.8));
  outlined((g, c) => image.rect(52 - g, y(136) - g, 56 + 2 * g, 8 + 2 * g, c), [70, 40, 20, 255]);
  outlined((g, c) => image.rect(74 - g, y(134) - g, 12 + 2 * g, 12 + 2 * g, c), ouro);
  image.rect(78, y(138), 4, 4, [70, 40, 20, 255]);
  star(image, 80, y(120), 10, OUTLINE);
  star(image, 80, y(120), 8, ouro);

  // Braços: manga na cor da túnica e luva branca na ponta.
  const arm = (sx, sy, [hx, hy]) => {
    outlined((g, c) => limb(image, sx, y(sy), hx, y(hy), 8 + g, c), cor);
    outlined((g, c) => image.ellipse(hx, y(hy), 8 + g, 8 + g, c), luva);
    image.ellipse(hx - 2, y(hy) - 3, 3, 2, [255, 255, 255, 255]);
  };
  arm(56, 112, pose.maoE ?? [46, 146]);
  arm(104, 112, pose.maoD ?? [114, 146]);

  // Cabeça: o rosto do integrante, com contorno e uma sombra no queixo. Com a
  // cabeça 3D (`cabeca3d`) o sprite sai sem ela e o modelo é desenhado por cima.
  image.ellipse(80, y(104), 22, 5, shade(cor, 0.5));
  if (!pose.semCabeca) {
    image.ellipse(80, y(60), 48, 50, OUTLINE);
    image.paste(face, 80, y(60), { scale: 94 / face.width });
  }

  // A bola de fogo vem por último, na frente da cabeça.
  if (pose.fogo) fireball(image, pose.maoD[0] + 4, y(pose.maoD[1]) - pose.fogo - 2, pose.fogo);
  return image;
}

/** As poses dos nove quadros (A..I), na mesma ordem dos estados do chefe. */
const HERO_FRAMES = {
  A: { pose: {}, giro: 0 },
  B: { pose: { bob: 2, fase: 1, maoE: [44, 143], maoD: [116, 149] }, giro: 0 },
  C: { pose: { maoD: [132, 90], fogo: 7 }, giro: -4 },
  D: { pose: { bob: -2, maoD: [134, 104], fogo: 15 }, giro: 3 },
  E: { pose: { bob: 4, fase: 1, maoE: [34, 98], maoD: [126, 98] }, giro: -8, tinta: [230, 60, 50], forca: 0.4 },
  F: { pose: { nuvem: false, maoE: [34, 98], maoD: [126, 98] }, giro: 18, tinta: [20, 18, 22], forca: 0.15 },
  G: { pose: { nuvem: false, maoE: [36, 104], maoD: [124, 104] }, giro: 45, tinta: [20, 18, 22], forca: 0.3 },
  H: { pose: { nuvem: false }, giro: 75, tinta: [20, 18, 22], forca: 0.45, tontura: true },
  I: { pose: { nuvem: false }, giro: 90, tinta: [20, 18, 22], forca: 0.55, tontura: true },
};

function heroFramePng(face, boss, letter) {
  const [width, height] = BODY_FRAME_SIZE;
  const { pose, giro, tinta = null, forca = 0, tontura = false } = HERO_FRAMES[letter];
  // Da morte em diante a cabeça 3D some e o quadro volta a ter o rosto desenhado.
  const body = heroPose(face, boss, { ...pose, semCabeca: !!boss.cabeca3d && 'ABCDE'.includes(letter) });
  const image = canvas(width, height);
  // Girando em volta do centro do quadro em pé, o corpo deitado precisa descer:
  // de pé o centro fica a 100 px do chão; deitado, a meia espessura (~48 px).
  const t = Math.abs(giro) / 90;
  const cy = pose.nuvem === false ? 100 + 52 * t * t : 100;
  image.paste(body, width / 2, cy, { rotate: giro, tint: tinta, amount: forca });
  if (tontura) {
    const hx = width / 2 + Math.sin((giro * Math.PI) / 180) * 40;
    const hy = cy - Math.cos((giro * Math.PI) / 180) * 40 - 36;
    [[-22, 0], [0, -8], [22, 0]].forEach(([dx, dy]) => {
      star(image, hx + dx, hy + dy, 7, OUTLINE);
      star(image, hx + dx, hy + dy, 5, [255, 220, 60, 255]);
    });
  }
  return image.toPng(Math.round(width / 2), height);
}

// ------------------------------------------------ chefe bolinha (Kirby)
//
// Com `"corpo": "kirby"` o chefe vira uma bolinha rosa de pés vermelhos com o
// rosto do integrante na frente. O corpo é montado com elipsoides e
// renderizado aqui mesmo, por um ray tracer ortográfico pequeno, de 8 ângulos:
// quando o chefe vira, o corpo vira junto (de costas só se vê o rosa).
// Renderiza em baixa resolução e amplia 2×, com contorno, para ficar pixel art.

const KIRBY_LOGICAL = [120, 92];   // o quadro final é o dobro
const KIRBY_FRAME = [KIRBY_LOGICAL[0] * 2, KIRBY_LOGICAL[1] * 2];
const KIRBY_GROUND = 44;           // z do chão no espaço do modelo (pé em -44)
const KIRBY_PINK = [255, 158, 190, 255];
const KIRBY_FEET = [214, 32, 64, 255];

/**
 * Partes do corpo numa pose. Espaço do modelo: +X é a frente do ator, +Y a
 * esquerda, +Z para cima; o centro do corpo fica na origem.
 */
function kirbyParts(pose = {}) {
  const [sx, sy, sz] = pose.corpo ?? [1, 1, 1];
  const R = 34;
  const zc = pose.z ?? 0;
  const pe = pose.pes ?? 0;      // passo: um pé à frente, o outro atrás
  const parts = [
    { id: 1, c: [0, 0, zc], r: [R * sx, R * sy, R * sz], color: KIRBY_PINK, face: true },
    { id: 2, c: [4 + pe, 15, -KIRBY_GROUND + 7], r: [15, 10, 7], color: KIRBY_FEET },
    { id: 3, c: [4 - pe, -15, -KIRBY_GROUND + 7], r: [15, 10, 7], color: KIRBY_FEET },
  ];
  const [le, ld] = pose.bracos ?? [[0, 34, -6], [0, -34, -6]];
  parts.push({ id: 4, c: [le[0], le[1] * sy, le[2] + zc], r: [9, 9, 11], color: KIRBY_PINK });
  parts.push({ id: 5, c: [ld[0], ld[1] * sy, ld[2] + zc], r: [9, 9, 11], color: KIRBY_PINK });
  // A bola de fogo sai da mão direita (-Y), um pouco à frente do braço.
  if (pose.fogo) parts.push({ id: 6, c: [ld[0] + 14, ld[1] * sy - 6, ld[2] + zc + 10], r: [pose.fogo, pose.fogo, pose.fogo], color: [255, 150, 40, 255], luz: true });
  return parts;
}

/**
 * Renderiza partes (elipsoides, ou caixas com `box: true`) vistas de `phi`
 * graus, no sentido anti-horário a partir da frente. Ortográfico, com sombreado em degraus e contorno; o
 * resultado sai ampliado 2×. Cada parte só é testada nos pixels do seu
 * retângulo na tela, o que deixa corpos de muitas esferas rápidos.
 */
function renderBody(face, parts, phi, { size, ground, tinta = null, forca = 0, faceSpan = 0.78 } = {}) {
  const [W, H] = size;
  const a = (phi * Math.PI) / 180;
  const vx = Math.cos(a); const vy = Math.sin(a);      // do modelo para quem olha
  const rx = -Math.sin(a); const ry = Math.cos(a);     // direita da tela
  let lx = vx * 0.55 - rx * 0.4; let ly = vy * 0.55 - ry * 0.4; let lz = 0.7;
  const ll = Math.hypot(lx, ly, lz); lx /= ll; ly /= ll; lz /= ll;
  const ids = new Int16Array(W * H);
  const depth = new Float32Array(W * H).fill(Infinity);
  const rgb = new Uint8ClampedArray(W * H * 3);

  for (const part of parts) {
    const [cx, cy, cz] = part.c;
    const [ax, ay, az] = part.r;
    const cu = cx * rx + cy * ry;
    const reach = (part.box ? Math.hypot(ax, ay, az) : Math.max(ax, ay, az)) + 1;
    const px0 = Math.max(0, Math.floor(cu - reach + W / 2)); const px1 = Math.min(W - 1, Math.ceil(cu + reach + W / 2));
    const py0 = Math.max(0, Math.floor(H - ground - cz - reach)); const py1 = Math.min(H - 1, Math.ceil(H - ground - cz + reach));
    for (let py = py0; py <= py1; py++) {
      for (let px = px0; px <= px1; px++) {
        const u = px - W / 2 + 0.5;
        const z = H - ground - py - 0.5;
        const Ox = rx * u + vx * 500; const Oy = ry * u + vy * 500;
        const at = py * W + px;
        let t; let nx; let ny; let nz;
        if (part.box) {
          // Caixa alinhada aos eixos do modelo: interseção pelas faixas x e y
          // (o raio é horizontal, então só as faces laterais aparecem).
          if (Math.abs(z - cz) > az) continue;
          let tx0 = -Infinity; let tx1 = Infinity; let ty0 = -Infinity; let ty1 = Infinity;
          if (Math.abs(vx) > 1e-9) { const p0 = (cx - ax - Ox) / -vx; const p1 = (cx + ax - Ox) / -vx; tx0 = Math.min(p0, p1); tx1 = Math.max(p0, p1); } else if (Math.abs(Ox - cx) > ax) continue;
          if (Math.abs(vy) > 1e-9) { const p0 = (cy - ay - Oy) / -vy; const p1 = (cy + ay - Oy) / -vy; ty0 = Math.min(p0, p1); ty1 = Math.max(p0, p1); } else if (Math.abs(Oy - cy) > ay) continue;
          t = Math.max(tx0, ty0);
          if (t > Math.min(tx1, ty1) || t >= depth[at]) continue;
          if (tx0 > ty0) { nx = Math.sign(vx); ny = 0; } else { nx = 0; ny = Math.sign(vy); }
          nz = 0;
        } else {
          const ox = (Ox - cx) / ax; const oy = (Oy - cy) / ay; const oz = (z - cz) / az;
          const dx = -vx / ax; const dy = -vy / ay;
          const A = dx * dx + dy * dy; const B = 2 * (ox * dx + oy * dy); const C = ox * ox + oy * oy + oz * oz - 1;
          const disc = B * B - 4 * A * C;
          if (disc < 0) continue;
          t = (-B - Math.sqrt(disc)) / (2 * A);
          if (t >= depth[at]) continue;
          nx = (Ox - vx * t - cx) / (ax * ax); ny = (Oy - vy * t - cy) / (ay * ay); nz = (z - cz) / (az * az);
          const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
        }
        const mx = (Ox - vx * t - cx) / ax; const my = (Oy - vy * t - cy) / ay; const mz = (z - cz) / az;
        let [r, g, b] = part.color;
        let k;
        if (part.luz) {
          k = 1.15;
        } else {
          const lambert = Math.max(0, nx * lx + ny * ly + nz * lz);
          // Sombreado em degraus, como pixel art desenhado à mão.
          k = lambert > 0.75 ? 1.12 : lambert > 0.45 ? 1 : lambert > 0.15 ? 0.84 : 0.68;
        }
        if (part.face) {
          // O rosto é projetado de frente sobre a esfera: só na metade da frente.
          const fu = 0.5 + my / (2 * faceSpan); const fv = 0.5 - mz / (2 * faceSpan);
          if (mx > 0.25 && fu >= 0 && fu < 1 && fv >= 0 && fv < 1) {
            const fp = (Math.floor(fv * face.height) * face.width + Math.floor(fu * face.width)) * 4;
            const fa = face.pixels[fp + 3] / 255;
            if (fa > 0) {
              r = r * (1 - fa) + face.pixels[fp] * fa;
              g = g * (1 - fa) + face.pixels[fp + 1] * fa;
              b = b * (1 - fa) + face.pixels[fp + 2] * fa;
              k = 0.9 + (k - 0.84) * 0.5; // o rosto escurece menos que o resto
            }
          }
        }
        r *= k; g *= k; b *= k;
        if (tinta && forca > 0) {
          r += (tinta[0] - r) * forca; g += (tinta[1] - g) * forca; b += (tinta[2] - b) * forca;
        }
        depth[at] = t;
        ids[at] = part.id;
        rgb[at * 3] = r; rgb[at * 3 + 1] = g; rgb[at * 3 + 2] = b;
      }
    }
  }

  // Contorno: por fora da silhueta e onde uma parte passa por trás da outra.
  const out = canvas(W, H);
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const at = py * W + px;
      const neighbors = [];
      if (px > 0) neighbors.push(at - 1);
      if (px < W - 1) neighbors.push(at + 1);
      if (py > 0) neighbors.push(at - W);
      if (py < H - 1) neighbors.push(at + W);
      if (!ids[at]) {
        if (neighbors.some((n) => ids[n])) out.rect(px, py, 1, 1, OUTLINE);
        continue;
      }
      const behind = neighbors.some((n) => ids[n] && ids[n] !== ids[at] && depth[n] < depth[at] - 3);
      out.rect(px, py, 1, 1, behind ? OUTLINE : [rgb[at * 3], rgb[at * 3 + 1], rgb[at * 3 + 2], 255]);
    }
  }
  const big = canvas(W * 2, H * 2);
  big.paste(out, W, H, { scale: 2 });
  return big;
}

const renderKirby = (face, parts, phi, opts = {}) => renderBody(face, parts, phi, { size: KIRBY_LOGICAL, ground: KIRBY_GROUND, ...opts });

/**
 * As poses. Letras com `rotacoes` saem em 8 ângulos; as da morte, em um só.
 * J (sugando), K (bochechas cheias) e L (cuspindo) são do golpe especial.
 */
const KIRBY_POSES = {
  A: { pose: {} },
  B: { pose: { z: 2, pes: 6, bracos: [[4, 35, -4], [-4, -35, -8]] } },
  C: { pose: { corpo: [1, 1, 1.06], bracos: [[0, 34, 14], [0, -34, 14]] } },
  D: { pose: { corpo: [1.05, 1, 0.96], bracos: [[18, 30, 0], [18, -30, 0]], fogo: 10 } },
  E: { pose: { corpo: [1.05, 1.1, 0.86], z: -4, bracos: [[0, 38, 10], [0, -38, 10]] }, tinta: [230, 60, 50], forca: 0.4 },
  J: { pose: { corpo: [1.1, 1.05, 1], bracos: [[16, 36, 6], [16, -36, 6]] } },
  K: { pose: { corpo: [1.22, 1.22, 1.16], z: 3, bracos: [[0, 36, 2], [0, -36, 2]] } },
  L: { pose: { corpo: [1.15, 0.95, 0.9], bracos: [[-12, 32, 4], [-12, -32, 4]] } },
  F: { pose: { corpo: [1.08, 1.08, 0.82], z: -6 }, tinta: [20, 18, 22], forca: 0.2, morte: true },
  G: { pose: { corpo: [1.2, 1.2, 0.62], z: -13, bracos: [[0, 36, -14], [0, -36, -14]] }, tinta: [20, 18, 22], forca: 0.35, morte: true },
  H: { pose: { corpo: [1.32, 1.32, 0.45], z: -19, bracos: [[0, 36, -20], [0, -36, -20]] }, tinta: [20, 18, 22], forca: 0.45, morte: true, tontura: true },
  I: { pose: { corpo: [1.42, 1.42, 0.32], z: -23, bracos: [[0, 36, -24], [0, -36, -24]] }, tinta: [20, 18, 22], forca: 0.55, morte: true, tontura: true },
};

/** Todos os lumps de sprite do chefe bolinha: [nome, png]. */
function kirbySprites(face, sprite) {
  const lumps = [];
  for (const [letter, frame] of Object.entries(KIRBY_POSES)) {
    const parts = kirbyParts(frame.pose);
    const angles = frame.morte ? [0] : [0, 45, 90, 135, 180, 225, 270, 315];
    angles.forEach((phi, i) => {
      const image = renderKirby(face, parts, phi, frame);
      const fogo = parts.find((part) => part.luz);
      const a = (phi * Math.PI) / 180;
      if (fogo && fogo.c[0] * Math.cos(a) + fogo.c[1] * Math.sin(a) > -10) {
        // Brilho da bola de fogo, de onde ela aparece (de costas o corpo a esconde).
        const fx = KIRBY_FRAME[0] / 2 + 2 * (-fogo.c[0] * Math.sin(a) + fogo.c[1] * Math.cos(a));
        const fy = 2 * (KIRBY_LOGICAL[1] - KIRBY_GROUND - fogo.c[2]);
        for (let r = 36; r > 16; r -= 3) image.ellipse(fx, fy, r, r, [255, 150, 40, 18]);
      }
      if (frame.tontura) {
        [[-26, 0], [0, -8], [26, 0]].forEach(([dx, dy]) => {
          star(image, KIRBY_FRAME[0] / 2 + dx, 92 + dy, 8, OUTLINE);
          star(image, KIRBY_FRAME[0] / 2 + dx, 92 + dy, 6, [255, 220, 60, 255]);
        });
      }
      const rotation = frame.morte ? 0 : i + 1;
      lumps.push([`${sprite}${letter}${rotation}`, image.toPng(KIRBY_FRAME[0] / 2, KIRBY_FRAME[1])]);
    });
  }
  return lumps;
}

// ------------------------------------------- arena temática (Nintendo)
//
// `"tema": "nintendo"` na arena troca as paredes, o chão e o teto por texturas
// próprias, os pilares por canos, espalha blocos "?" flutuando e troca os
// itens por versões temáticas: moeda (bônus de vida), cogumelo (medikit) e
// estrela (bônus de armadura). Toda a arte é desenhada aqui, em pixel art.

const NES = {
  tijolo: [200, 76, 12, 255], tijoloClaro: [252, 152, 56, 255], massa: [60, 20, 4, 255],
  chao: [228, 120, 52, 255], chaoClaro: [252, 188, 140, 255], chaoEscuro: [140, 56, 12, 255],
  ceu: [92, 148, 252, 255], nuvem: [252, 252, 252, 255], nuvemSombra: [188, 220, 252, 255],
  verde: [0, 168, 0, 255], verdeClaro: [128, 216, 72, 255], verdeEscuro: [0, 88, 0, 255],
  ouro: [252, 188, 60, 255], ouroClaro: [255, 240, 160, 255], ouroEscuro: [200, 120, 20, 255],
  vermelho: [220, 30, 30, 255], branco: [252, 252, 252, 255], bege: [252, 216, 168, 255],
};

function heart(image, cx, cy, s, color) {
  image.ellipse(cx - s * 0.5, cy - s * 0.25, s * 0.56, s * 0.56, color);
  image.ellipse(cx + s * 0.5, cy - s * 0.25, s * 0.56, s * 0.56, color);
  fillPolygon(image, [[cx - s * 1.04, cy - s * 0.1], [cx + s * 1.04, cy - s * 0.1], [cx, cy + s * 1.05]], color);
}

/** Texturas (TX_START): valem para parede, chão e teto no GZDoom. */
function nintendoTextures() {
  const tex = {};

  const brick = canvas(128, 128);
  brick.rect(0, 0, 128, 128, NES.massa);
  for (let row = 0; row < 4; row++) {
    for (let col = -1; col < 3; col++) {
      const x = col * 64 + (row % 2 ? 32 : 0) + 2; const y = row * 32 + 2;
      brick.rect(x, y, 60, 28, NES.tijolo);
      brick.rect(x, y, 60, 3, NES.tijoloClaro);
      brick.rect(x, y, 3, 28, NES.tijoloClaro);
    }
  }
  tex.JTIJOLO = brick;

  const ground = canvas(64, 64);
  ground.rect(0, 0, 64, 64, NES.chao);
  for (const [x, y] of [[0, 0], [32, 0], [0, 32], [32, 32]]) {
    ground.rect(x, y, 32, 2, NES.chaoClaro);
    ground.rect(x, y, 2, 32, NES.chaoClaro);
    ground.rect(x + 30, y, 2, 32, NES.chaoEscuro);
    ground.rect(x, y + 30, 32, 2, NES.chaoEscuro);
    ground.rect(x + 8, y + 10, 4, 4, NES.chaoEscuro);
    ground.rect(x + 20, y + 18, 4, 4, NES.chaoEscuro);
  }
  tex.JCHAOBL = ground;

  const sky = canvas(128, 128);
  sky.rect(0, 0, 128, 128, NES.ceu);
  for (const [x, y] of [[36, 40], [96, 98]]) {
    for (const [dx, dy, r] of [[-14, 4, 12], [0, -4, 15], [14, 4, 12]]) sky.ellipse(x + dx, y + dy + 2, r, r * 0.8, NES.nuvemSombra);
    for (const [dx, dy, r] of [[-14, 4, 11], [0, -4, 14], [14, 4, 11]]) sky.ellipse(x + dx, y + dy, r, r * 0.8, NES.nuvem);
  }
  tex.JCEUAZUL = sky;

  return Object.entries(tex).map(([name, image]) => [name, image.toPng(0, 0)]);
}

/** Texturas da dimensão dos corações. */
function dimensionTextures() {
  const tex = {};

  const rainbow = canvas(128, 128);
  const bands = [[255, 64, 64], [255, 150, 40], [255, 230, 60], [80, 210, 90], [70, 160, 255], [120, 90, 230], [200, 110, 240]];
  bands.forEach((c, i) => rainbow.rect(0, Math.round((i * 128) / 7), 128, Math.ceil(128 / 7) + 1, [...c, 255]));
  for (const [x, y] of [[20, 30], [70, 80], [110, 20], [40, 110], [96, 56]]) star(rainbow, x, y, 6, [255, 255, 255, 220]);
  tex.JARCOIRI = rainbow;

  const hearts = canvas(64, 64);
  hearts.rect(0, 0, 64, 64, [255, 196, 222, 255]);
  heart(hearts, 32, 30, 14, [150, 20, 70, 255]);
  heart(hearts, 32, 29, 12, [240, 50, 110, 255]);
  hearts.ellipse(26, 24, 3, 2, [255, 200, 220, 255]);
  tex.JCORACAO = hearts;

  const pinkSky = canvas(128, 128);
  pinkSky.rect(0, 0, 128, 128, [236, 210, 255, 255]);
  for (const [x, y] of [[20, 24], [84, 40], [44, 92], [108, 104]]) star(pinkSky, x, y, 7, [255, 255, 255, 255]);
  for (const [x, y] of [[60, 16], [110, 70], [14, 70]]) heart(pinkSky, x, y, 6, [255, 150, 200, 255]);
  tex.JCEUROSA = pinkSky;

  return Object.entries(tex).map(([name, image]) => [name, image.toPng(0, 0)]);
}

/** Sprites temáticos: [nome do lump, png]. Os offsets já deixam cada um na altura certa. */
function nintendoSprites() {
  const out = [];

  // Cano: largo e sólido, no lugar dos pilares.
  const pipe = canvas(120, 132);
  const pipeBody = (x, y, w, h) => {
    pipe.rect(x - 3, y - 3, w + 6, h + 6, OUTLINE);
    pipe.rect(x, y, w, h, NES.verde);
    pipe.rect(x + 8, y, 10, h, NES.verdeClaro);
    pipe.rect(x + 24, y, 4, h, NES.verdeClaro);
    pipe.rect(x + w - 14, y, 10, h, NES.verdeEscuro);
  };
  pipeBody(14, 34, 92, 95);
  pipeBody(4, 4, 112, 30);
  out.push(['JNC0A0', pipe.toPng(60, 132)]);

  // Bloco "?" flutuando, com um brilho que alterna em dois quadros.
  for (const [frame, glow] of [['A', NES.ouro], ['B', NES.ouroClaro]]) {
    const block = canvas(64, 64);
    block.rect(0, 0, 64, 64, OUTLINE);
    block.rect(3, 3, 58, 58, glow);
    block.rect(3, 3, 58, 4, NES.ouroClaro);
    block.rect(3, 57, 58, 4, NES.ouroEscuro);
    for (const [x, y] of [[8, 8], [52, 8], [8, 52], [52, 52]]) block.rect(x, y, 4, 4, NES.ouroEscuro);
    // O "?" em blocos de 4 px.
    const q = ['01110', '10001', '00001', '00010', '00100', '00000', '00100'];
    q.forEach((row, yy) => [...row].forEach((on, xx) => {
      if (on === '1') { block.rect(22 + xx * 4, 16 + yy * 4, 4, 4, NES.ouroEscuro); block.rect(21 + xx * 4, 15 + yy * 4, 4, 4, NES.branco); }
    }));
    out.push([`JNQ0${frame}0`, block.toPng(32, 64 + 150)]);
  }

  // Moeda girando: quatro larguras.
  ['A', 'B', 'C', 'D'].forEach((frame, i) => {
    const w = [12, 8, 3, 8][i];
    const coin = canvas(32, 44);
    coin.ellipse(16, 22, w + 2, 20, OUTLINE);
    coin.ellipse(16, 22, w, 18, NES.ouro);
    if (w > 4) coin.rect(15, 10, 3, 24, NES.ouroEscuro);
    coin.ellipse(16 - w / 2, 14, Math.max(1, w / 4), 4, NES.ouroClaro);
    out.push([`JNM0${frame}0`, coin.toPng(16, 44 + 12)]);
  });

  // Cogumelo vermelho de bolinhas brancas.
  const mush = canvas(52, 52);
  mush.ellipse(26, 40, 14, 12, OUTLINE);
  mush.ellipse(26, 40, 12, 10, NES.bege);
  mush.rect(20, 36, 3, 7, OUTLINE); mush.rect(29, 36, 3, 7, OUTLINE);
  mush.ellipse(26, 22, 25, 18, OUTLINE);
  mush.ellipse(26, 22, 23, 16, NES.vermelho);
  mush.rect(4, 26, 44, 8, NES.vermelho);
  for (const [x, y, r] of [[26, 14, 7], [10, 24, 5], [42, 24, 5]]) mush.ellipse(x, y, r, r, NES.branco);
  out.push(['JNG0A0', mush.toPng(26, 52)]);

  // Estrela com olhinhos.
  const starImg = canvas(52, 52);
  star(starImg, 26, 27, 25, OUTLINE);
  star(starImg, 26, 27, 22, [255, 220, 40, 255]);
  starImg.rect(20, 22, 3, 8, OUTLINE); starImg.rect(29, 22, 3, 8, OUTLINE);
  out.push(['JNE0A0', starImg.toPng(26, 52 + 8)]);

  // Três triângulos dourados, pendurados no alto da parede.
  const tri = canvas(132, 116);
  const triangle = (x, y, s, c) => fillPolygon(tri, [[x, y], [x + s, y + s * 0.87 * 2], [x - s, y + s * 0.87 * 2]], c);
  for (const [x, y] of [[66, 2], [33, 59], [99, 59]]) { triangle(x, y, 32, OUTLINE); triangle(x, y + 5, 26, NES.ouro); }
  out.push(['JNT0A0', tri.toPng(66, 116 + 300)]);

  // Bola vermelha e branca, no chão.
  const ball = canvas(48, 48);
  ball.ellipse(24, 24, 23, 23, OUTLINE);
  ball.ellipse(24, 24, 20, 20, NES.branco);
  for (let y = 4; y < 23; y++) for (let x = 4; x < 45; x++) if ((x - 24) ** 2 + (y - 24) ** 2 <= 400) ball.rect(x, y, 1, 1, NES.vermelho);
  ball.rect(4, 22, 40, 4, OUTLINE);
  ball.ellipse(24, 24, 7, 7, OUTLINE);
  ball.ellipse(24, 24, 4, 4, NES.branco);
  out.push(['JNP0A0', ball.toPng(24, 48)]);

  return out;
}

/** Sprites da dimensão dos corações. */
function dimensionSprites() {
  const out = [];

  // Coração e arco-íris.
  const h = canvas(52, 48);
  heart(h, 26, 20, 20, OUTLINE);
  heart(h, 26, 20, 17, [240, 50, 110, 255]);
  h.ellipse(16, 12, 5, 3, [255, 200, 220, 255]);
  out.push(['JDC0A0', h.toPng(26, 48 + 40)]);
  const arc = canvas(260, 136);
  const colors = [[255, 64, 64], [255, 150, 40], [255, 230, 60], [80, 210, 90], [70, 160, 255], [120, 90, 230]];
  colors.forEach((c, i) => {
    const r = 128 - i * 10;
    for (let y = 0; y < 136; y++) {
      for (let x = 0; x < 260; x++) {
        const d = Math.hypot(x - 130, y - 134);
        if (d <= r && d > r - 10 && y <= 134) arc.rect(x, y, 1, 1, [...c, 230]);
      }
    }
  });
  out.push(['JDA0A0', arc.toPng(130, 136 + 120)]);
  return out;
}

// --------------------------------------------- chefe espadachim (Trails)
//
// Com `"corpo": "espadachim"` o chefe vira um espadachim baixinho de uniforme
// vermelho de academia militar, calça escura, botas e katana, com o rosto do
// integrante na cabeça e o resto dela na cor do cabelo. Usa o mesmo ray
// tracer da bolinha: braços, pernas e a lâmina são cápsulas de esferas.

const TENGU_LOGICAL = [120, 136];
const TENGU_GROUND = 56;
const TENGU_FRAME = [TENGU_LOGICAL[0] * 2, TENGU_LOGICAL[1] * 2];

const TR = {
  pedra: [124, 118, 112, 255], pedraClara: [160, 154, 146, 255], pedraEscura: [76, 72, 70, 255], junta: [44, 40, 40, 255],
  marfim: [226, 216, 196, 255], azulNoite: [36, 48, 92, 255],
  madeira: [98, 60, 34, 255], madeiraClara: [142, 94, 54, 255], madeiraEscura: [52, 30, 16, 255],
  vermelho: [178, 26, 38, 255], vermelhoEscuro: [112, 14, 24, 255],
  ouro: [230, 186, 74, 255], ouroEscuro: [150, 108, 30, 255],
  calca: [40, 40, 50, 255], bota: [58, 38, 28, 255], cinto: [30, 26, 24, 255], branco: [238, 238, 232, 255],
  pele: [240, 200, 170, 255], lamina: [214, 224, 238, 255], cabo: [92, 50, 150, 255], bainha: [26, 22, 26, 255],
  corte: [170, 240, 255, 255],
};

const vec = {
  add: (p, q) => [p[0] + q[0], p[1] + q[1], p[2] + q[2]],
  scale: (p, k) => [p[0] * k, p[1] * k, p[2] * k],
  unit: (p) => { const l = Math.hypot(...p) || 1; return [p[0] / l, p[1] / l, p[2] / l]; },
};

/** Partes do espadachim numa pose (mesmo espaço do modelo da bolinha). */
function tenguParts(pose = {}, hair) {
  const parts = [];
  let id = 0;
  const add = (c, r, color, extra = {}) => { parts.push({ id: extra.id ?? ++id, c, r, color, ...extra }); };
  const capsule = (a, b, rad, color, extra = {}) => {
    const pid = ++id;
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / (rad * 0.7)));
    for (let i = 0; i <= n; i++) add(vec.add(a, vec.scale(vec.add(b, vec.scale(a, -1)), i / n)), [rad, rad, rad], color, { ...extra, id: pid });
  };

  if (pose.deitado) {
    // Caído de lado, atravessado na frente de quem olha, com a katana no chão.
    add([0, 4, -44], [10, 18, 11], TR.vermelho);
    add([-2, -14, -48], [7, 8, 7], TR.vermelhoEscuro);
    for (const x of [6, -6]) {
      capsule([x, -18, -49], [x, -44, -52], 6, TR.calca);
      add([x + 3, -50, -51], [8, 5, 5], TR.bota);
    }
    capsule([6, 14, -40], [16, 24, -54], 5, TR.vermelho);
    capsule([-6, 14, -42], [-12, 26, -54], 5, TR.vermelho);
    add([17, 25, -54], [4.4, 4.4, 4.4], TR.pele);
    capsule([18, -34, -55], [18, 20, -55], 1.7, TR.lamina);
    add([0, 36, -38], [20, 21, 21], hair, { face: true });
    return parts;
  }

  const lean = pose.tronco ?? [0, 0, 0];
  const T = (x, y, z) => [x + lean[0], y + lean[1], z + lean[2]];

  // Pernas: em pé (com passo) ou ajoelhado.
  const [pe, pd] = pose.pes ?? [0, 0];
  for (const [y, step] of [[8, pe], [-8, pd]]) {
    if (pose.ajoelhado) {
      capsule(T(0, y, -26), [12, y, -48], 6, TR.calca);
      capsule([12, y, -48], [-8, y, -52], 5.5, TR.calca);
      add([-11, y, -51], [6, 5, 4.5], TR.bota);
    } else {
      capsule(T(0, y, -26), [step, y, -48], 6, TR.calca);
      add([step + 3, y, -52], [9, 6, 4.5], TR.bota);
    }
  }

  // Uniforme: abas do casaco atrás, tronco, cinto e a gola branca.
  add(T(-5, 0, -30), [7, 15, 9], TR.vermelhoEscuro);
  add(T(0, 0, -8), [11, 15, 18], TR.vermelho);
  add(T(0, 0, -22), [11.6, 15.6, 2.4], TR.cinto);
  add(T(9, 0, 5), [4, 6, 4], TR.branco);
  add(T(10.5, 0, -10), [1.2, 1.6, 9], TR.ouro);         // abotoamento dourado
  capsule(T(-2, 17, -18), T(-14, 19, -44), 2.6, TR.bainha);

  // Braços (ombro, cotovelo, mão) e a katana na mão direita (-Y).
  const arm = (side, hand) => {
    const shoulder = T(0, 17 * side, 3);
    const elbow = [(shoulder[0] + hand[0]) / 2 - 3, (shoulder[1] + hand[1]) / 2 + 3 * side, (shoulder[2] + hand[2]) / 2 - 2];
    capsule(shoulder, elbow, 5, TR.vermelho);
    capsule(elbow, hand, 4.6, TR.vermelho);
    add(hand, [4.4, 4.4, 4.4], TR.pele);
  };
  const maoE = T(...(pose.maoE ?? [4, 20, -16]));
  const maoD = T(...(pose.maoD ?? [8, -20, -18]));
  arm(1, maoE);
  arm(-1, maoD);
  const dir = vec.unit(pose.lamina ?? [0.5, -0.15, -0.85]);
  capsule(vec.add(maoD, vec.scale(dir, -10)), maoD, 2.2, TR.cabo);
  add(vec.add(maoD, vec.scale(dir, 2)), [3.4, 3.4, 3.4], TR.ouro);
  capsule(vec.add(maoD, vec.scale(dir, 5)), vec.add(maoD, vec.scale(dir, 54)), 1.7, TR.lamina);

  // Cabeça: o rosto na frente, cabelo no resto.
  add(T(0, 0, 30), [21, 21, 22], hair, { face: true });

  // O rastro do golpe: um arco de luz na frente do corpo.
  if (pose.golpe) {
    const pid = ++id;
    for (let deg = -110; deg <= 70; deg += 6) {
      const t = (deg * Math.PI) / 180;
      add(T(14 + 44 * Math.cos(t), 44 * Math.sin(t), -6 + deg * 0.1), [3.2, 3.2, 3.2], TR.corte, { id: pid, luz: true });
    }
  }
  return parts;
}

const TENGU_POSES = {
  A: { pose: {} },
  B: { pose: { pes: [8, -8], maoE: [-2, 21, -17], maoD: [12, -21, -16] } },
  C: { pose: { tronco: [-2, 0, 0], maoD: [-4, -12, 32], maoE: [2, 6, 28], lamina: [-0.55, 0.25, 0.8] } },
  D: { pose: { tronco: [3, 0, -1], maoD: [22, -4, -2], maoE: [16, 10, -2], lamina: [0.6, 0.75, -0.15], golpe: true } },
  E: { pose: { tronco: [-4, 0, -2], maoE: [-4, 25, -6], maoD: [-4, -25, -8], lamina: [-0.2, -0.3, -1] }, tinta: [230, 60, 50], forca: 0.4 },
  F: { pose: { ajoelhado: true, tronco: [2, 0, -16], maoD: [16, -16, -14], maoE: [8, 18, -14], lamina: [0.1, 0, -1] }, tinta: [20, 18, 22], forca: 0.2, morte: true },
  G: { pose: { ajoelhado: true, tronco: [6, 0, -20], maoD: [18, -18, -18], maoE: [14, 16, -20], lamina: [0.15, 0, -1] }, tinta: [20, 18, 22], forca: 0.35, morte: true },
  H: { pose: { deitado: true }, tinta: [20, 18, 22], forca: 0.45, morte: true, tontura: true },
  I: { pose: { deitado: true }, tinta: [20, 18, 22], forca: 0.55, morte: true, tontura: true },
};

/** Todos os lumps de sprite do espadachim: [nome, png]. */
const tenguSprites = (face, sprite) => {
  const hair = hairColor(face);
  return bodySprites(face, sprite, {
    poses: TENGU_POSES,
    parts: (pose) => tenguParts(pose, hair),
    size: TENGU_LOGICAL,
    ground: TENGU_GROUND,
    faceSpan: 0.66,
    // Estrelinhas sobre a cabeça caída (centro em y = 36, z = -38).
    dizzy: () => [TENGU_FRAME[0] / 2 + 2 * 36, 2 * (TENGU_LOGICAL[1] - TENGU_GROUND - (-38 + 30))],
  });
};

// --------------------------------------------- arena temática (Trails)
//
// `"tema": "trails"`: um salão de academia militar em pedra, com estandartes
// vermelhos, um brasão, postes de luz orbal no lugar das luminárias, colunas
// de pedra, quartzos flutuando nas sete cores dos elementos e, num canto, um
// cristal azul gigante. Os itens viram sepith (bônus) e Teara Balm (medikit).

/** Ruído determinístico (o build sempre gera o mesmo arquivo). */
function noise(x, y) {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

function trailsTextures() {
  const tex = {};

  const wall = canvas(128, 128);
  wall.rect(0, 0, 128, 128, TR.junta);
  for (let row = 0; row < 4; row++) {
    for (let col = -1; col < 3; col++) {
      const x = col * 64 + (row % 2 ? 32 : 0) + 1; const y = row * 32 + 1;
      wall.rect(x, y, 62, 30, TR.pedra);
      for (let i = 0; i < 40; i++) {
        const sx = x + Math.floor(noise(x + i, y) * 60); const sy = y + Math.floor(noise(y + i, x) * 28);
        wall.rect(sx, sy, 2, 2, noise(sx, sy) > 0.5 ? TR.pedraClara : TR.pedraEscura);
      }
      wall.rect(x, y, 62, 2, TR.pedraClara);
      wall.rect(x, y + 28, 62, 2, TR.pedraEscura);
    }
  }
  tex.JPEDRA = wall;

  const floor = canvas(64, 64);
  for (const [x, y, c] of [[0, 0, TR.marfim], [32, 32, TR.marfim], [32, 0, TR.azulNoite], [0, 32, TR.azulNoite]]) floor.rect(x, y, 32, 32, c);
  for (const v of [0, 31, 32, 63]) { floor.rect(v, 0, 1, 64, TR.ouroEscuro); floor.rect(0, v, 64, 1, TR.ouroEscuro); }
  tex.JPISO = floor;

  const ceiling = canvas(128, 128);
  ceiling.rect(0, 0, 128, 128, TR.madeiraEscura);
  for (const [x, y] of [[0, 0], [64, 0], [0, 64], [64, 64]]) {
    ceiling.rect(x + 8, y + 8, 48, 48, TR.madeira);
    ceiling.rect(x + 14, y + 14, 36, 36, TR.madeiraClara);
    ceiling.rect(x + 30, y + 30, 4, 4, TR.ouro);
  }
  tex.JTETO = ceiling;

  return Object.entries(tex).map(([name, image]) => [name, image.toPng(0, 0)]);
}

const QUARTZ_COLORS = [
  [184, 124, 64], [64, 132, 240], [232, 64, 44], [72, 204, 96], [96, 80, 128], [244, 204, 72], [208, 208, 232],
];

function gem(image, cx, top, w, h, color) {
  const pts = [[cx, top], [cx + w / 2, top + h * 0.22], [cx + w / 2, top + h * 0.78], [cx, top + h], [cx - w / 2, top + h * 0.78], [cx - w / 2, top + h * 0.22]];
  fillPolygon(image, pts.map(([x, y]) => [x + (x > cx ? 2 : x < cx ? -2 : 0), y + (y < top + 1 ? -2 : y > top + h - 1 ? 2 : 0)]), OUTLINE);
  fillPolygon(image, pts, [...color.slice(0, 3), 255]);
  fillPolygon(image, [[cx, top], [cx - w / 2, top + h * 0.22], [cx - w / 2, top + h * 0.78], [cx, top + h]], shade(color, 1.3));
  fillPolygon(image, [[cx - w * 0.12, top + h * 0.2], [cx + w * 0.12, top + h * 0.2], [cx + w * 0.12, top + h * 0.8], [cx - w * 0.12, top + h * 0.8]], shade(color, 1.55));
}

function trailsSprites() {
  const out = [];

  // Quartzos nas sete cores (terra, água, fogo, vento, tempo, espaço, miragem).
  QUARTZ_COLORS.forEach((c, i) => {
    const q = canvas(44, 64);
    for (let r = 22; r > 10; r -= 3) q.ellipse(22, 32, r, r * 1.3, [...c, 20]);
    gem(q, 22, 4, 28, 56, [...c, 255]);
    out.push([`JKQ0${'ABCDEFG'[i]}0`, q.toPng(22, 64 + 170)]);
  });

  // Estandarte vermelho com franja e um emblema dourado próprio.
  const banner = canvas(56, 160);
  banner.rect(0, 0, 56, 8, TR.madeiraEscura);
  banner.rect(4, 6, 48, 140, OUTLINE);
  banner.rect(6, 8, 44, 136, TR.vermelho);
  banner.rect(6, 8, 6, 136, TR.vermelhoEscuro);
  fillPolygon(banner, [[6, 144], [50, 144], [28, 158]], TR.vermelho);
  for (let x = 8; x < 50; x += 4) banner.rect(x, 140, 2, 8, TR.ouro);
  banner.ellipse(28, 60, 15, 15, TR.ouro);
  banner.ellipse(28, 60, 11, 11, TR.vermelho);
  banner.rect(27, 40, 3, 40, TR.ouro);
  banner.rect(20, 52, 17, 3, TR.ouro);
  out.push(['JKB0A0', banner.toPng(28, 160 + 190)]);

  // Brasão: escudo com espada e estrela, no alto da parede oeste.
  const crest = canvas(84, 96);
  const shield = (g) => [[42 - 38 - g, 4 - g], [42 + 38 + g, 4 - g], [42 + 38 + g, 50], [42, 92 + g], [42 - 38 - g, 50]];
  fillPolygon(crest, shield(3), OUTLINE);
  fillPolygon(crest, shield(0), TR.ouro);
  fillPolygon(crest, [[10, 10], [74, 10], [74, 48], [42, 84], [10, 48]], TR.azulNoite);
  crest.rect(40, 16, 5, 56, TR.branco);
  crest.rect(30, 56, 25, 4, TR.ouro);
  star(crest, 42, 30, 9, TR.ouro);
  out.push(['JKE0A0', crest.toPng(42, 96 + 230)]);

  // Poste de luz orbal: haste preta e um globo ciano que pulsa (dois quadros).
  for (const [frame, glow] of [['A', 30], ['B', 60]]) {
    const lamp = canvas(40, 124);
    lamp.rect(17, 30, 6, 90, OUTLINE);
    lamp.rect(12, 116, 16, 8, OUTLINE);
    for (let r = 20; r > 8; r -= 3) lamp.ellipse(20, 18, r, r, [120, 230, 255, glow]);
    lamp.ellipse(20, 18, 10, 10, OUTLINE);
    lamp.ellipse(20, 18, 8, 8, [150, 240, 255, 255]);
    lamp.ellipse(18, 15, 3, 3, [240, 255, 255, 255]);
    lamp.rect(10, 28, 20, 3, TR.ouro);
    out.push([`JKL0${frame}0`, lamp.toPng(20, 124)]);
  }

  // Coluna de pedra com uma faixa vermelha.
  const column = canvas(76, 140);
  column.rect(2, 120, 72, 20, OUTLINE); column.rect(4, 122, 68, 16, TR.pedraClara);
  column.rect(2, 0, 72, 18, OUTLINE); column.rect(4, 2, 68, 14, TR.pedraClara);
  column.rect(10, 16, 56, 106, OUTLINE); column.rect(12, 16, 52, 106, TR.pedra);
  for (const x of [20, 32, 44, 56]) column.rect(x, 16, 3, 106, TR.pedraEscura);
  column.rect(12, 50, 52, 14, TR.vermelho); column.rect(12, 54, 52, 2, TR.ouro);
  out.push(['JKP0A0', column.toPng(38, 140)]);

  // Sepith: lascas de cristal pequenas (verde = vida, azul = armadura).
  for (const [frame, c] of [['A', [72, 220, 110, 255]], ['B', [80, 150, 255, 255]]]) {
    const s = canvas(24, 30);
    gem(s, 12, 2, 14, 26, c);
    out.push([`JKS0${frame}0`, s.toPng(12, 30 + 10)]);
  }

  // Teara Balm: potinho de vidro com tampa de cortiça e remédio verde.
  const balm = canvas(32, 40);
  balm.rect(5, 10, 22, 28, OUTLINE);
  balm.rect(7, 12, 18, 24, [200, 236, 255, 255]);
  balm.rect(7, 22, 18, 14, [90, 210, 130, 255]);
  balm.rect(9, 14, 3, 18, [255, 255, 255, 255]);
  balm.rect(8, 2, 16, 10, OUTLINE);
  balm.rect(10, 4, 12, 7, [150, 100, 60, 255]);
  balm.rect(7, 25, 18, 5, TR.marfim);
  out.push(['JKT0A0', balm.toPng(16, 40)]);

  // O cristal azul gigante, flutuando um pouco acima do chão.
  const crystal = canvas(104, 232);
  for (let r = 50; r > 20; r -= 4) crystal.ellipse(52, 116, r, r * 2.1, [90, 170, 255, 16]);
  gem(crystal, 52, 6, 70, 220, [70, 150, 250, 255]);
  out.push(['JKX0A0', crystal.toPng(52, 232 + 24)]);

  // Corte: a onda de luz em meia-lua que o espadachim atira.
  for (const [frame, k] of [['A', 1], ['B', 0.7]]) {
    const slash = canvas(72, 72);
    for (let y = 0; y < 72; y++) {
      for (let x = 0; x < 72; x++) {
        const outer = Math.hypot(x - 36, (y - 36) * 1.1) <= 32;
        const inner = Math.hypot(x - 26, (y - 36) * 1.1) <= 30;
        if (outer && !inner) slash.rect(x, y, 1, 1, [Math.round(170 * k), Math.round(240 * k), 255, 255]);
      }
    }
    out.push([`JKC0${frame}0`, slash.toPng(36, 36)]);
  }
  return out;
}

/**
 * Exporta um corpo renderizado: 8 ângulos por letra (1 só nas da morte) e,
 * se o quadro pedir, estrelinhas de tontura onde `dizzy` mandar.
 */
function bodySprites(face, sprite, { poses, parts, size, ground, faceSpan, dizzy }) {
  const frame = [size[0] * 2, size[1] * 2];
  const lumps = [];
  for (const [letter, def] of Object.entries(poses)) {
    const list = parts(def.pose);
    const angles = def.morte ? [0] : [0, 45, 90, 135, 180, 225, 270, 315];
    angles.forEach((phi, i) => {
      const image = renderBody(face, list, phi, { size, ground, faceSpan, ...def });
      if (def.tontura) {
        const [x, y] = dizzy(def);
        [[-26, 0], [0, -8], [26, 0]].forEach(([dx, dy]) => {
          star(image, x + dx, y + dy, 8, OUTLINE);
          star(image, x + dx, y + dy, 6, [255, 220, 60, 255]);
        });
      }
      lumps.push([`${sprite}${letter}${def.morte ? 0 : i + 1}`, image.toPng(frame[0] / 2, frame[1])]);
    });
  }
  return lumps;
}

/** Monta partes: `add` cria um elipsoide; `capsule`, uma fileira de esferas com o mesmo id. */
function bodyBuilder() {
  const parts = [];
  let id = 0;
  const add = (c, r, color, extra = {}) => { parts.push({ id: extra.id ?? ++id, c, r, color, ...extra }); };
  const capsule = (a, b, rad, color, extra = {}) => {
    const pid = ++id;
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / (rad * 0.7)));
    for (let i = 0; i <= n; i++) add(vec.add(a, vec.scale(vec.add(b, vec.scale(a, -1)), i / n)), [rad, rad, rad], color, { ...extra, id: pid });
  };
  return { parts, add, capsule };
}

// ------------------------------------------------ chefe majin (Buu)
//
// Com `"corpo": "majin"` o chefe vira um gorducho rosa de colete preto, calça
// branca bufante, botas douradas, capa roxa e cinto com fivela dourada, com a
// anteninha na cabeça e o rosto do integrante. A magia dele é rosa. Na morte
// ele derrete numa poça rosa, como massa de modelar.

const MAJIN_LOGICAL = [128, 136];
const MAJIN_GROUND = 56;
const MAJIN_FRAME = [MAJIN_LOGICAL[0] * 2, MAJIN_LOGICAL[1] * 2];

const MJ = {
  rosa: [255, 150, 190, 255], colete: [34, 30, 40, 255], ouro: [236, 190, 60, 255],
  calca: [244, 244, 240, 255], bota: [236, 200, 70, 255], luva: [250, 250, 250, 255],
  capa: [104, 52, 140, 255], cinto: [40, 40, 70, 255], magia: [255, 110, 200, 255],
};

function majinParts(pose = {}) {
  const { parts, add, capsule } = bodyBuilder();
  const z0 = pose.z ?? 0;
  const T = (x, y, z) => [x, y, z + z0];
  const [pe, pd] = pose.pes ?? [0, 0];

  add(T(-20, 0, -16), [5, 30, 32], MJ.capa);
  for (const [y, step] of [[13, pe], [-13, pd]]) {
    add([step * 0.5, y, -40], [14, 13, 12], MJ.calca);
    add([step + 4, y, -52], [10, 8, 5], MJ.bota);
  }
  add(T(-2, 0, -2), [20, 29, 22], MJ.colete);
  add(T(4, 0, -10), [24, 26, 24], MJ.rosa);
  add(T(15, 16, -2), [2.4, 2.4, 15], MJ.ouro);
  add(T(15, -16, -2), [2.4, 2.4, 15], MJ.ouro);
  add(T(2, 0, -26), [25, 29, 3.6], MJ.cinto);
  add(T(26, 0, -26), [2.4, 6, 5], MJ.ouro);

  for (const [side, hand] of [[1, pose.maoE ?? [6, 34, -20]], [-1, pose.maoD ?? [6, -34, -20]]]) {
    const h = T(...hand);
    capsule(T(0, 28 * side, 4), h, 7, MJ.rosa);
    add(h, [6.5, 6.5, 6.5], MJ.luva);
  }

  add(T(2, 0, 28), [19, 20, 19], MJ.rosa, { face: true });
  capsule(T(-4, 0, 44), T(-14, 0, 52), 4.2, MJ.rosa);
  capsule(T(-14, 0, 52), T(-22, 0, 47), 3.6, MJ.rosa);

  // Magia rosa: uma bola sobre a cabeça ou nas mãos, apontada para a frente.
  if (pose.magia === 'alto') add(T(6, 0, 62), [9, 9, 9], MJ.magia, { luz: true });
  if (pose.magia === 'frente') add(T(40, 0, 6), [11, 11, 11], MJ.magia, { luz: true });

  if (pose.derrete) {
    // Derretendo: tudo desce para o chão, achata e espalha para os lados.
    const f = pose.derrete;
    for (const part of parts) {
      part.c = [part.c[0], part.c[1] * (1 + f * 0.3), -MAJIN_GROUND + (part.c[2] + MAJIN_GROUND) * (1 - f)];
      part.r = [part.r[0] * (1 + f * 0.25), part.r[1] * (1 + f * 0.5), Math.max(1.5, part.r[2] * (1 - f * 0.75))];
    }
  }
  return parts;
}

// Letras do Arch-Vile: A e B andam; C, D, L e J são o ataque (erguer, carregar,
// lançar e abrir os braços); K é a cura; E, a dor; F..I, a morte.
const MAJIN_POSES = {
  A: { pose: {} },
  B: { pose: { pes: [6, -6], z: 1, maoE: [-4, 36, -18], maoD: [10, -34, -20] } },
  C: { pose: { maoE: [4, 30, 40], maoD: [4, -30, 40] } },
  D: { pose: { maoE: [6, 24, 48], maoD: [6, -24, 48], magia: 'alto' } },
  L: { pose: { maoE: [28, 14, 6], maoD: [28, -14, 6], magia: 'frente' } },
  J: { pose: { maoE: [0, 46, 10], maoD: [0, -46, 10] } },
  K: { pose: { maoE: [6, 24, 48], maoD: [6, -24, 48], magia: 'alto' } },
  E: { pose: { z: -3, maoE: [-6, 40, 14], maoD: [-6, -40, 14] }, tinta: [230, 60, 50], forca: 0.4 },
  F: { pose: { derrete: 0.25 }, tinta: [20, 18, 22], forca: 0.15, morte: true },
  G: { pose: { derrete: 0.5 }, tinta: [20, 18, 22], forca: 0.2, morte: true },
  H: { pose: { derrete: 0.7 }, tinta: [20, 18, 22], forca: 0.25, morte: true, tontura: true },
  I: { pose: { derrete: 0.85 }, tinta: [20, 18, 22], forca: 0.3, morte: true, tontura: true },
};

const majinSprites = (face, sprite) => bodySprites(face, sprite, {
  poses: MAJIN_POSES,
  parts: majinParts,
  size: MAJIN_LOGICAL,
  ground: MAJIN_GROUND,
  faceSpan: 0.62,
  // Estrelinhas sobre a cabeça derretida.
  dizzy: ({ pose }) => [MAJIN_FRAME[0] / 2, 2 * (MAJIN_LOGICAL[1] - MAJIN_GROUND - (-MAJIN_GROUND + 84 * (1 - pose.derrete) + 16))],
});

// ------------------------------------- arena temática (Last of Us + Avril)
//
// `"tema": "tlou"`: ruínas tomadas pelo mato, a céu aberto, com carros
// enferrujados no lugar dos pilares, barris em chamas no lugar das
// luminárias, a girafa, vaga-lumes, um violão e o toque pop-punk: pichação
// rosa com estrelas, a placa "SK8" e um skate rosa. Os itens viram
// suplementos (bônus de vida), palheta de guitarra (bônus de armadura) e kit
// médico (medikit).

const RU = {
  concreto: [128, 126, 120, 255], concretoClaro: [156, 154, 146, 255], concretoEscuro: [84, 82, 78, 255],
  musgo: [70, 116, 52, 255], musgoClaro: [110, 156, 70, 255], folha: [52, 130, 50, 255],
  asfalto: [54, 54, 58, 255], asfaltoClaro: [84, 84, 88, 255],
  rosa: [255, 70, 170, 255], rosaClaro: [255, 160, 210, 255], preto: [24, 22, 26, 255],
  ferrugem: [140, 74, 40, 255], ferrugemClara: [180, 110, 60, 255], azulDesbotado: [90, 120, 130, 255],
  girafa: [232, 186, 92, 255], mancha: [140, 84, 36, 255],
  madeira: [196, 140, 80, 255], madeiraEscura: [90, 56, 30, 255],
};

function vine(image, x, top, length, seed) {
  for (let y = top; y < top + length; y++) {
    const wx = Math.round(x + Math.sin((y + seed) / 6) * 3);
    image.rect(wx, y, 2, 1, RU.folha);
    if ((y + seed) % 9 === 0) image.ellipse(wx + ((y % 2) ? 4 : -3), y, 3, 2, RU.musgoClaro);
  }
}

function tlouTextures() {
  const tex = {};

  const wall = canvas(256, 128);
  wall.rect(0, 0, 256, 128, RU.concreto);
  for (let i = 0; i < 900; i++) {
    const x = Math.floor(noise(i, 1) * 256); const y = Math.floor(noise(i, 2) * 128);
    wall.rect(x, y, 2, 2, noise(i, 3) > 0.5 ? RU.concretoClaro : RU.concretoEscuro);
  }
  for (const [x, y, len] of [[40, 10, 50], [170, 30, 60], [110, 70, 40]]) {
    let cx = x; let cy = y;
    for (let s = 0; s < len; s++) { wall.rect(cx, cy, 2, 2, RU.preto); cx += Math.round(noise(s, x) * 2 - 0.5); cy += 1; }
  }
  for (let x = 0; x < 256; x += 2) {
    const h = 10 + Math.round(noise(x, 7) * 18);
    wall.rect(x, 128 - h, 2, h, noise(x, 8) > 0.4 ? RU.musgo : RU.musgoClaro);
  }
  for (const [x, len, seed] of [[18, 70, 1], [88, 40, 5], [150, 96, 9], [230, 60, 3]]) vine(wall, x, 0, len, seed);
  // Pichação pop-punk: estrela rosa, faixa listrada e "SK8".
  star(wall, 200, 52, 20, RU.preto);
  star(wall, 200, 52, 16, RU.rosa);
  for (let x = 60; x < 140; x += 8) wall.rect(x, 96, 4, 6, (x / 8) % 2 ? RU.rosa : RU.preto);
  wall.text('SK8', 66, 74, RU.rosa, 3);
  tex.JRUINA = wall;

  const floor = canvas(64, 64);
  floor.rect(0, 0, 64, 64, RU.asfalto);
  for (let i = 0; i < 160; i++) floor.rect(Math.floor(noise(i, 11) * 64), Math.floor(noise(i, 12) * 64), 1, 1, RU.asfaltoClaro);
  let cx = 6; for (let y = 0; y < 64; y++) { floor.rect(cx, y, 1, 1, RU.preto); cx += Math.round(noise(y, 13) * 2 - 1); cx = (cx + 64) % 64; }
  for (const [x, y] of [[40, 20], [20, 48], [52, 54]]) {
    for (let k = -3; k <= 3; k++) floor.rect(x + k, y - Math.abs(k) - 3 + (k % 2), 1, 4, RU.musgoClaro);
  }
  tex.JASFALTO = floor;

  return Object.entries(tex).map(([name, image]) => [name, image.toPng(0, 0)]);
}

function tlouSprites() {
  const out = [];

  // Carro abandonado e enferrujado, com mato por cima: cobertura sólida.
  const car = canvas(168, 88);
  fillPolygon(car, [[10, 40], [44, 16], [118, 16], [150, 40], [162, 44], [162, 74], [6, 74], [6, 44]], OUTLINE);
  fillPolygon(car, [[12, 42], [46, 19], [116, 19], [148, 42], [159, 46], [159, 71], [9, 71], [9, 46]], RU.azulDesbotado);
  fillPolygon(car, [[50, 23], [80, 23], [80, 40], [30, 40]], RU.preto);
  fillPolygon(car, [[86, 23], [112, 23], [136, 40], [86, 40]], RU.preto);
  for (let i = 0; i < 120; i++) car.rect(10 + Math.floor(noise(i, 21) * 148), 44 + Math.floor(noise(i, 22) * 26), 3, 3, noise(i, 23) > 0.5 ? RU.ferrugem : RU.ferrugemClara);
  for (const x of [40, 128]) { car.ellipse(x, 74, 15, 13, OUTLINE); car.ellipse(x, 74, 11, 9, [40, 40, 44, 255]); }
  for (let x = 20; x < 150; x += 3) car.rect(x, 14 + Math.round(noise(x, 24) * 6), 3, 4, noise(x, 25) > 0.5 ? RU.musgo : RU.folha);
  out.push(['JUC0A0', car.toPng(84, 88)]);

  // A girafa, de perfil.
  const g = canvas(132, 236);
  const giraffe = (c, k) => {
    g.ellipse(64, 132, 44 + k, 26 + k, c);                       // corpo
    for (const x of [30, 46, 82, 98]) g.rect(x - 4 - k, 140, 9 + 2 * k, 94 + k, c); // pernas
    fillPolygon(g, [[88 - k, 122], [104 + k, 116], [118 + k, 30], [104 - k, 28]], c); // pescoço
    g.ellipse(116, 24, 14 + k, 9 + k, c);                        // cabeça
    g.rect(110 - k, 4 - k, 3 + 2 * k, 12 + k, c); g.rect(118 - k, 4 - k, 3 + 2 * k, 12 + k, c);
  };
  giraffe(OUTLINE, 2);
  giraffe(RU.girafa, 0);
  for (const [x, y, r] of [[40, 124, 8], [62, 118, 9], [84, 128, 7], [54, 142, 7], [76, 146, 8], [100, 120, 6], [108, 80, 5], [112, 54, 4], [104, 98, 5]]) {
    g.ellipse(x, y, r, r * 0.8, RU.mancha);
  }
  g.rect(122, 20, 3, 3, OUTLINE);
  out.push(['JUG0A0', g.toPng(66, 236)]);

  // Violão encostado no pedestal.
  const guitar = canvas(56, 120);
  guitar.ellipse(28, 92, 21, 22, OUTLINE); guitar.ellipse(28, 62, 15, 15, OUTLINE);
  guitar.ellipse(28, 92, 18, 19, RU.madeira); guitar.ellipse(28, 62, 12, 12, RU.madeira);
  guitar.ellipse(28, 72, 6, 6, RU.preto);
  guitar.rect(25, 4, 7, 60, OUTLINE); guitar.rect(26, 6, 5, 58, RU.madeiraEscura);
  guitar.rect(22, 0, 13, 10, RU.madeiraEscura);
  guitar.rect(27, 6, 1, 90, [230, 230, 220, 255]); guitar.rect(29, 6, 1, 90, [230, 230, 220, 255]);
  guitar.rect(20, 104, 16, 3, RU.preto);
  out.push(['JUV0A0', guitar.toPng(28, 120)]);

  // Vaga-lume piscando (dois quadros), voando a meia altura.
  for (const [frame, a] of [['A', 255], ['B', 90]]) {
    const f = canvas(16, 16);
    f.ellipse(8, 8, 7, 7, [210, 255, 120, Math.round(a * 0.25)]);
    f.ellipse(8, 8, 3, 3, [240, 255, 170, a]);
    out.push([`JUF0${frame}0`, f.toPng(8, 16 + 96)]);
  }

  // Placa pichada "SK8" com estrela, no alto da parede.
  const sign = canvas(136, 72);
  sign.rect(0, 0, 136, 72, OUTLINE);
  sign.rect(3, 3, 130, 66, RU.preto);
  for (let x = 3; x < 133; x += 10) sign.rect(x, 3, 5, 6, RU.rosa);
  for (let x = 8; x < 133; x += 10) sign.rect(x, 63, 5, 6, RU.rosa);
  sign.text('SK8', 12, 20, RU.rosa, 5);
  star(sign, 110, 36, 16, RU.rosaClaro);
  out.push(['JUS0A0', sign.toPng(68, 72 + 200)]);

  // Skate rosa de estrelinhas pretas, largado no chão.
  const board = canvas(80, 24);
  board.ellipse(40, 9, 38, 8, OUTLINE); board.ellipse(40, 9, 35, 6, RU.rosa);
  for (const x of [24, 40, 56]) star(board, x, 9, 4, RU.preto);
  for (const x of [18, 62]) board.ellipse(x, 19, 4, 4, OUTLINE);
  out.push(['JUK0A0', board.toPng(40, 24)]);

  // Itens: frasco de suplementos, palheta rosa e kit médico.
  const pills = canvas(22, 30);
  pills.rect(3, 8, 16, 21, OUTLINE); pills.rect(5, 10, 12, 17, [236, 140, 40, 255]);
  pills.rect(5, 15, 12, 7, [250, 250, 245, 255]);
  pills.rect(4, 2, 14, 7, OUTLINE); pills.rect(5, 3, 12, 5, [250, 250, 245, 255]);
  out.push(['JUP0A0', pills.toPng(11, 30)]);
  const pick = canvas(26, 28);
  fillPolygon(pick, [[1, 3], [25, 3], [13, 27]], OUTLINE);
  pick.ellipse(13, 7, 12, 6, OUTLINE);
  fillPolygon(pick, [[4, 5], [22, 5], [13, 24]], RU.rosa);
  pick.ellipse(13, 7, 10, 4, RU.rosa);
  star(pick, 13, 10, 4, RU.preto);
  out.push(['JUA0A0', pick.toPng(13, 28 + 8)]);
  const kit = canvas(40, 30);
  kit.rect(2, 6, 36, 23, OUTLINE); kit.rect(4, 8, 32, 19, [120, 110, 80, 255]);
  kit.rect(4, 14, 32, 6, [236, 230, 210, 255]);
  kit.ellipse(30, 6, 7, 6, OUTLINE); kit.ellipse(30, 6, 5, 4, [236, 230, 210, 255]);
  kit.rect(8, 2, 10, 8, OUTLINE); kit.rect(9, 3, 8, 6, [170, 200, 220, 255]);
  out.push(['JUM0A0', kit.toPng(20, 30)]);
  return out;
}

// ------------------------------------------- chefe mecha (Armored Core)
//
// Com `"corpo": "mecha"` o chefe vira um robô bípede de cor grafite com
// detalhes na cor dele: pernas e tronco em caixas, lançadores de mísseis nos
// ombros, rifle na mão direita, lâmina de luz azul na esquerda, mochila de
// propulsores e a cabine com o rosto do integrante. Na morte ele desmorona
// em sucata pegando fogo.

const MECH_LOGICAL = [136, 112];
const MECH_GROUND = 50;
const MECH_FRAME = [MECH_LOGICAL[0] * 2, MECH_LOGICAL[1] * 2];

function mechParts(pose = {}, accent) {
  const { parts, add } = bodyBuilder();
  const box = (c, half, color, extra = {}) => add(c, half, color, { box: true, ...extra });
  const metal = [92, 98, 110, 255]; const metalClaro = [138, 146, 160, 255]; const escuro = [40, 42, 50, 255];
  const ouro = accent; const brilho = [120, 220, 255, 255];
  const z0 = pose.z ?? 0;
  const T = (x, y, z) => [x, y, z + z0];
  const [pe, pd] = pose.pes ?? [0, 0];

  // Pernas: coxa, joelho, canela e pé, com o passo vindo da pose.
  for (const [y, step] of [[12, pe], [-12, pd]]) {
    box(T(step * 0.3, y, -18), [6, 5, 9], metal);
    add(T(step * 0.6 + 3, y, -28), [5, 5, 5], escuro);
    box([step + 2, y * 1.08, -38], [7, 6, 9], metalClaro);
    box([step + 2, y * 1.08 + (y > 0 ? 6.5 : -6.5), -38], [6, 0.8, 6], ouro);
    box([step + 5, y * 1.08, -48], [11, 7, 2.5], escuro);
  }

  // Tronco: núcleo, placa do peito com faixa dourada, cintura e mochila.
  box(T(0, 0, -6), [8, 10, 4], escuro);
  box(T(0, 0, 6), [12, 16, 11], metal);
  box(T(8, 0, 6), [5, 13, 8], metalClaro);
  box(T(13.2, 0, 2), [0.6, 13, 1.6], ouro);
  box(T(-15, 0, 8), [5, 12, 10], escuro);
  if (pose.propulsor) for (const y of [6, -6]) add(T(-22, y, 0), [5, 4, 4], [255, 160, 60, 255], { luz: true });

  // Ombros: lançadores de mísseis com quatro tubos virados para a frente.
  for (const y of [24, -24]) {
    box(T(-2, y, 22), [9, 8, 7], metal);
    box(T(-2, y + (y > 0 ? 8.5 : -8.5), 22), [8, 0.6, 6], ouro);
    for (const [dy, dz] of [[-3.5, 3], [3.5, 3], [-3.5, -3], [3.5, -3]]) {
      box(T(7.4, y + dy, 22 + dz), [0.8, 2.2, 2.2], pose.missil ? [255, 190, 90, 255] : escuro, pose.missil ? { luz: true } : {});
    }
  }

  // Braços: rifle na direita (-Y), lâmina de luz na esquerda (+Y).
  const braco = pose.braco ?? 0;     // 0 = baixo, 1 = apontando para a frente
  for (const y of [24, -24]) {
    box(T(0, y, 4), [5, 5, 7], metalClaro);
    box(T(4 + braco * 8, y * 1.04, -8 + braco * 8), [5 + braco * 3, 5, 6 - braco * 2], metal);
  }
  box(T(20 + braco * 10, -25, -12 + braco * 10), [16, 2.6, 2.6], escuro);
  box(T(12 + braco * 10, -25, -16 + braco * 10), [3, 2, 5], escuro);
  box(T(18 + braco * 4, 25, -14 + braco * 6), [14, 1.4, 2.2], brilho, { luz: true });

  // Cabine: o rosto do integrante num capacete, com antenas e viseira dourada.
  add(T(4, 0, 27), [15, 15, 15], metal, { face: true });
  box(T(4, 0, 43), [6, 10, 1.4], ouro);
  for (const y of [10, -10]) box(T(-2, y, 46), [1, 1, 7], escuro);

  if (pose.desmonta) {
    // Sucata: tudo desce para o chão e espalha, com fogo e fumaça por cima.
    const f = pose.desmonta;
    for (const part of parts) {
      part.c = [part.c[0] * (1 + f * 0.3), part.c[1] * (1 + f * 0.4), -MECH_GROUND + (part.c[2] + MECH_GROUND) * (1 - f * 0.85)];
    }
    const pid = parts.length + 1;
    for (let i = 0; i < 6; i++) {
      const x = (noise(i, 41) - 0.5) * 40; const y = (noise(i, 42) - 0.5) * 50;
      add([x, y, -MECH_GROUND + 14 + noise(i, 43) * 22 * f], [5, 5, 6], i % 2 ? [255, 140, 40, 255] : [255, 210, 90, 255], { luz: true, id: pid });
    }
  }
  return parts;
}

// Letras do Cyberdemon: A, B e C andam (C é o passo pesado); D atira; E é a
// dor; F..I, a morte.
const MECH_POSES = {
  A: { pose: {} },
  B: { pose: { pes: [6, -6], z: 1 } },
  C: { pose: { pes: [-6, 6], z: -1, propulsor: true } },
  D: { pose: { braco: 1, missil: true, propulsor: true } },
  E: { pose: { z: -2, braco: 0.4 }, tinta: [230, 60, 50], forca: 0.4 },
  F: { pose: { desmonta: 0.2 }, tinta: [20, 18, 22], forca: 0.15, morte: true },
  G: { pose: { desmonta: 0.45 }, tinta: [20, 18, 22], forca: 0.25, morte: true },
  H: { pose: { desmonta: 0.7 }, tinta: [20, 18, 22], forca: 0.35, morte: true },
  I: { pose: { desmonta: 0.9 }, tinta: [20, 18, 22], forca: 0.45, morte: true },
};

const mechSprites = (face, sprite, accent) => bodySprites(face, sprite, {
  poses: MECH_POSES,
  parts: (pose) => mechParts(pose, accent),
  size: MECH_LOGICAL,
  ground: MECH_GROUND,
  faceSpan: 0.6,
});

// ------------------------------------- arena temática (Souls + quebra-cabeça)
//
// `"tema": "souls"`: uma catedral escura de pedra com a fogueira da espada
// espiralada, a névoa na entrada, mensagens laranjas no chão e candelabros.
// O toque de quebra-cabeça: caixas de Sokoban como cobertura (com os alvos em
// X no chão) e um quadro de Picross na parede, resolvido, com um sushi.
// Os itens viram almas (bônus de vida), brasas (bônus de armadura) e o frasco
// de Estus (medikit).

const SO = {
  pedra: [70, 68, 72, 255], pedraClara: [98, 96, 100, 255], pedraEscura: [40, 38, 44, 255], junta: [24, 22, 26, 255],
  laje: [64, 60, 58, 255], lajeClara: [88, 84, 80, 255],
  madeira: [150, 100, 54, 255], madeiraClara: [196, 146, 84, 255], madeiraEscura: [84, 52, 26, 255],
  fogo: [255, 150, 40, 255], fogoClaro: [255, 230, 120, 255], brasa: [255, 90, 30, 255],
  laranja: [255, 170, 60, 255], alma: [220, 240, 255, 255],
};

function soulsTextures() {
  const tex = {};

  const wall = canvas(128, 128);
  wall.rect(0, 0, 128, 128, SO.junta);
  for (let row = 0; row < 8; row++) {
    for (let col = -1; col < 5; col++) {
      const x = col * 32 + (row % 2 ? 16 : 0) + 1; const y = row * 16 + 1;
      const tone = noise(col + 7, row) > 0.6 ? SO.pedraClara : noise(col, row + 3) > 0.7 ? SO.pedraEscura : SO.pedra;
      wall.rect(x, y, 30, 14, tone);
      wall.rect(x, y, 30, 1, SO.pedraClara);
    }
  }
  // Uma janela gótica estreita, escura, no meio de cada painel.
  fillPolygon(wall, [[56, 100], [56, 40], [64, 24], [72, 40], [72, 100]], SO.junta);
  fillPolygon(wall, [[58, 98], [58, 41], [64, 28], [70, 41], [70, 98]], [20, 26, 44, 255]);
  tex.JGOTICO = wall;

  const floor = canvas(64, 64);
  floor.rect(0, 0, 64, 64, SO.junta);
  for (const [x, y, w, h] of [[1, 1, 30, 22], [33, 1, 30, 14], [33, 17, 30, 20], [1, 25, 22, 38], [25, 39, 38, 24], [25, 25, 6, 12]]) {
    floor.rect(x, y, w, h, noise(x, y) > 0.5 ? SO.laje : SO.lajeClara);
  }
  tex.JLAJE = floor;

  const vault = canvas(128, 128);
  vault.rect(0, 0, 128, 128, SO.pedraEscura);
  for (let i = 0; i < 128; i += 2) { vault.rect(i, i, 3, 3, SO.pedra); vault.rect(127 - i, i, 3, 3, SO.pedra); }
  vault.rect(0, 62, 128, 4, SO.pedra); vault.rect(62, 0, 4, 128, SO.pedra);
  vault.ellipse(64, 64, 8, 8, SO.pedraClara);
  tex.JABOBADA = vault;

  return Object.entries(tex).map(([name, image]) => [name, image.toPng(0, 0)]);
}

function flame(image, cx, base, w, h, k) {
  for (let i = 0; i < 5; i++) {
    const dx = (i - 2) * w * 0.22; const hh = h * (0.6 + noise(i, k) * 0.4);
    fillPolygon(image, [[cx + dx - w * 0.2, base], [cx + dx + w * 0.2, base], [cx + dx + (noise(i, k + 1) - 0.5) * 6, base - hh]], SO.fogo);
  }
  fillPolygon(image, [[cx - w * 0.25, base], [cx + w * 0.25, base], [cx, base - h * 0.55]], SO.fogoClaro);
}

/** Largura de um texto na escala 2, com folga para a sombra. */
const msgWidth = (text) => text.length * (GLYPH_WIDTH + 1) * 2 + 2;

function soulsSprites() {
  const out = [];

  // Fogueira: brasas, a espada espiralada cravada e o fogo (três quadros).
  ['A', 'B', 'C'].forEach((frame, k) => {
    const b = canvas(80, 112);
    for (let r = 36; r > 14; r -= 4) b.ellipse(40, 84, r, r * 0.8, [255, 140, 40, 14]);
    flame(b, 40, 100, 44, 52 + k * 6, 50 + k);
    b.ellipse(40, 102, 30, 8, OUTLINE);
    b.ellipse(40, 101, 27, 6, [70, 64, 60, 255]);
    for (let i = 0; i < 8; i++) b.rect(18 + i * 6, 97 + (i % 2) * 3, 4, 3, SO.brasa);
    // A espada: lâmina torcida em espiral e o cabo.
    for (let y = 30; y < 98; y += 2) b.rect(39 + Math.round(Math.sin(y / 4) * 2), y, 3, 2, [160, 160, 170, 255]);
    b.rect(33, 26, 15, 4, OUTLINE); b.rect(38, 8, 5, 18, OUTLINE); b.rect(39, 9, 3, 16, [110, 80, 50, 255]);
    out.push([`JSF0${frame}0`, b.toPng(40, 112)]);
  });

  // Névoa na entrada: parede de luz cinza translúcida.
  const fog = canvas(200, 200);
  for (let y = 0; y < 200; y++) {
    for (let x = 0; x < 200; x++) {
      const a = 70 + 60 * Math.sin(x / 9 + y / 23) * Math.cos(y / 17 - x / 31);
      fog.rect(x, y, 1, 1, [210, 214, 222, Math.max(0, Math.round(a))]);
    }
  }
  out.push(['JSN0A0', fog.toPng(100, 200)]);

  // Caixa de Sokoban: madeira com o X de reforço.
  const crate = canvas(80, 80);
  crate.rect(0, 0, 80, 80, OUTLINE);
  crate.rect(3, 3, 74, 74, SO.madeira);
  crate.rect(3, 3, 74, 8, SO.madeiraClara); crate.rect(3, 69, 74, 8, SO.madeiraEscura);
  crate.rect(3, 3, 8, 74, SO.madeiraClara); crate.rect(69, 3, 8, 74, SO.madeiraEscura);
  for (let i = 0; i < 58; i++) { crate.rect(11 + i, 11 + i, 3, 3, SO.madeiraEscura); crate.rect(66 - i, 11 + i, 3, 3, SO.madeiraEscura); }
  out.push(['JSC0A0', crate.toPng(40, 80)]);

  // Alvo de Sokoban no chão: um X vermelho baixinho.
  const goal = canvas(40, 14);
  for (let i = 0; i < 12; i++) { goal.rect(Math.round(6 + i * 2.4), 1 + i, 4, 2, [230, 40, 40, 255]); goal.rect(Math.round(32 - i * 2.4), 1 + i, 4, 2, [230, 40, 40, 255]); }
  out.push(['JSX0A0', goal.toPng(20, 14)]);

  // Quadro de Picross resolvido: as dicas nas bordas e um sushi no meio.
  const pic = [
    '..........',
    '...####...',
    '.########.',
    '.#WWWWWW#.',
    '.#WOOOOW#.',
    '.#WOOOOW#.',
    '.#WWWWWW#.',
    '.########.',
    '..........',
    '..........',
  ];
  const cell = 10; const left = 34; const top = 34;
  const board = canvas(left + 10 * cell + 6, top + 10 * cell + 6);
  board.rect(0, 0, board.width, board.height, OUTLINE);
  board.rect(3, 3, board.width - 6, board.height - 6, [236, 232, 220, 255]);
  pic.forEach((row, y) => [...row].forEach((c, x) => {
    const color = { '#': [30, 30, 34, 255], W: [250, 250, 250, 255], O: [255, 120, 70, 255] }[c];
    board.rect(left + x * cell, top + y * cell, cell - 1, cell - 1, color ?? [214, 210, 198, 255]);
  }));
  // Dicas: quantos quadrados pintados há em cada linha e coluna.
  pic.forEach((row, y) => {
    const n = [...row].filter((c) => c !== '.').length;
    if (n) board.text(String(n), 8, top + y * cell + 2, [40, 40, 44, 255], 1);
  });
  for (let x = 0; x < 10; x++) {
    const n = pic.filter((row) => row[x] !== '.').length;
    if (n) board.text(String(n), left + x * cell + 2, 10, [40, 40, 44, 255], 1);
  }
  out.push(['JSP0A0', board.toPng(Math.round(board.width / 2), board.height + 220)]);

  // Mensagem laranja escrita no chão, que brilha baixinho.
  const texto = 'BE WARY OF ROBOT';
  const msg = canvas(msgWidth(texto), 26);
  msg.text(texto, 2, 2, [120, 50, 10, 255], 2);
  msg.text(texto, 0, 0, SO.laranja, 2);
  out.push(['JSM0A0', msg.toPng(Math.round(msg.width / 2), 26 + 4)]);

  // Itens: alma (bônus de vida), brasa (bônus de armadura) e o frasco de Estus.
  const soul = canvas(24, 30);
  for (let r = 11; r > 3; r -= 2) soul.ellipse(12, 16, r, r, [200, 230, 255, 40]);
  soul.ellipse(12, 16, 4, 5, SO.alma);
  out.push(['JSA0A0', soul.toPng(12, 30 + 16)]);
  const ember = canvas(24, 28);
  for (let r = 11; r > 4; r -= 2) ember.ellipse(12, 15, r, r, [255, 120, 40, 40]);
  fillPolygon(ember, [[12, 4], [18, 14], [12, 25], [6, 14]], SO.brasa);
  fillPolygon(ember, [[12, 9], [15, 14], [12, 20], [9, 14]], SO.fogoClaro);
  out.push(['JSB0A0', ember.toPng(12, 28 + 12)]);
  const estus = canvas(28, 40);
  estus.ellipse(14, 28, 12, 11, OUTLINE); estus.rect(10, 4, 8, 16, OUTLINE);
  estus.ellipse(14, 28, 10, 9, [140, 110, 70, 255]);
  estus.ellipse(14, 30, 8, 6, SO.fogo); estus.ellipse(12, 28, 3, 2, SO.fogoClaro);
  estus.rect(11, 6, 6, 14, [140, 110, 70, 255]); estus.rect(9, 2, 10, 4, [90, 60, 30, 255]);
  out.push(['JSE0A0', estus.toPng(14, 40)]);
  return out;
}

// ------------------------------------------------------- cabeça 3D
//
// O GZDoom só procura modelos em pacotes com pastas, não em lumps de WAD:
// por isso o MODELDEF, o MD3 e a textura vão para jogabilidoom-modelos.pk3,
// que se carrega junto (-file jogabilidoom.wad jogabilidoom-modelos.pk3).
//
// Com `"cabeca3d": true` a cabeça vira um modelo MD3: uma esfera com a foto
// projetada de frente e a cor do cabelo no resto. Ela é um ator à parte que o
// chefe cria ao nascer e que gruda nele a cada tic (A_Warp), virando para onde
// ele vira. O MD3 é reconhecido pelo cabeçalho, então o lump de 8 letras basta.

const HEAD_RADIUS = 46;   // unidades do mapa
const HEAD_CENTER = 140;  // altura do centro da cabeça acima do pé do chefe

/** A cor do cabelo: média do anel de fora do rosto recortado, um pouco mais escura. */
function hairColor(face) {
  let r = 0; let g = 0; let b = 0; let n = 0;
  const c = face.width / 2;
  for (let y = 0; y < face.height; y++) {
    for (let x = 0; x < face.width; x++) {
      const at = (y * face.width + x) * 4;
      if (face.pixels[at + 3] < 200 || Math.hypot(x - c, y - c) < c * 0.8) continue;
      r += face.pixels[at]; g += face.pixels[at + 1]; b += face.pixels[at + 2]; n++;
    }
  }
  return n ? [r / n * 0.7, g / n * 0.7, b / n * 0.7, 255].map(Math.round) : [40, 30, 25, 255];
}

/** Textura 256×256: a foto no meio, cabelo em volta (e no canto que pinta a nuca). */
function headSkinPng(face) {
  const image = canvas(256, 256);
  image.rect(0, 0, 256, 256, hairColor(face));
  image.paste(face, 128, 128, { scale: 256 / face.width });
  return image.toPng(0, 0);
}

/**
 * Esfera MD3 de um quadro só. Os vértices não são compartilhados: cada
 * triângulo da frente (+X, para onde o ator olha) projeta a foto de frente e
 * cada triângulo de trás aponta para o canto da textura, que é só cabelo.
 */
function headMd3() {
  const LAT = 18; const LON = 28; const R = HEAD_RADIUS;
  const point = (i, j) => {
    const t = (i / LAT) * Math.PI; const f = (j / LON) * 2 * Math.PI;
    return [Math.sin(t) * Math.cos(f), Math.sin(t) * Math.sin(f), Math.cos(t)];
  };
  const verts = [];
  const tris = [];
  const add = (corners) => {
    const front = corners.reduce((sum, [x]) => sum + x, 0) > 0;
    const base = verts.length;
    for (const n of corners) {
      const uv = front ? [0.5 + n[1] / 2, 0.5 - n[2] / 2] : [0.02, 0.02];
      verts.push({ n, uv });
    }
    tris.push([base, base + 1, base + 2]);
  };
  for (let i = 0; i < LAT; i++) {
    for (let j = 0; j < LON; j++) {
      const a = point(i, j); const b = point(i + 1, j); const c = point(i + 1, j + 1); const d = point(i, j + 1);
      add([a, b, c]);
      add([a, c, d]);
    }
  }

  const surfaceHeader = 108; const shaderSize = 68;
  const ofsTris = surfaceHeader + shaderSize;
  const ofsSt = ofsTris + tris.length * 12;
  const ofsXyz = ofsSt + verts.length * 8;
  const surfaceSize = ofsXyz + verts.length * 8;
  const surface = Buffer.alloc(surfaceSize);
  surface.write('IDP3', 0, 'ascii');
  surface.write('cabeca', 4, 'ascii');
  surface.writeInt32LE(0, 68);
  surface.writeInt32LE(1, 72);             // quadros
  surface.writeInt32LE(1, 76);             // shaders
  surface.writeInt32LE(verts.length, 80);
  surface.writeInt32LE(tris.length, 84);
  surface.writeInt32LE(ofsTris, 88);
  surface.writeInt32LE(surfaceHeader, 92);
  surface.writeInt32LE(ofsSt, 96);
  surface.writeInt32LE(ofsXyz, 100);
  surface.writeInt32LE(surfaceSize, 104);
  tris.forEach((tri, k) => tri.forEach((v, m) => surface.writeInt32LE(v, ofsTris + k * 12 + m * 4)));
  verts.forEach(({ n, uv }, k) => {
    surface.writeFloatLE(uv[0], ofsSt + k * 8);
    surface.writeFloatLE(uv[1], ofsSt + k * 8 + 4);
    const at = ofsXyz + k * 8;
    n.forEach((value, m) => surface.writeInt16LE(Math.round(value * R * 64), at + m * 2));
    const lat = Math.round((Math.acos(Math.max(-1, Math.min(1, n[2]))) * 255) / (2 * Math.PI)) & 255;
    const lng = Math.round((Math.atan2(n[1], n[0]) * 255) / (2 * Math.PI)) & 255;
    surface.writeUInt16LE((lat << 8) | lng, at + 6);
  });

  const header = Buffer.alloc(108);
  const frame = Buffer.alloc(56);
  [-R, -R, -R, R, R, R, 0, 0, 0, R].forEach((v, m) => frame.writeFloatLE(v, m * 4));
  frame.write('cabeca', 40, 'ascii');
  header.write('IDP3', 0, 'ascii');
  header.writeInt32LE(15, 4);
  header.write('jogabilidoom', 8, 'ascii');
  header.writeInt32LE(1, 76);    // quadros
  header.writeInt32LE(0, 80);    // tags
  header.writeInt32LE(1, 84);    // superfícies
  header.writeInt32LE(0, 88);    // skins
  header.writeInt32LE(108, 92);  // quadros
  header.writeInt32LE(164, 96);  // tags
  header.writeInt32LE(164, 100); // superfícies
  header.writeInt32LE(164 + surfaceSize, 104);
  return Buffer.concat([header, frame, surface]);
}

const headActorName = (boss) => `JogCabeca${boss.id[0].toUpperCase()}${boss.id.slice(1)}`;

/** A cabeça segue o chefe a cada tic; quando ele morre, ela some na mesma hora. */
const headActor = (boss, k) => {
  const s = headSprite(BOSS_FIRST + k);
  return [
    `ACTOR ${headActorName(boss)}`, '{',
    '  Radius 1', '  Height 1', '  +NOGRAVITY', '  +NOBLOCKMAP', '  +NOINTERACTION', '  +NOCLIP',
    '  States', '  {', '  Spawn:',
    `    ${s} A 0 A_Warp(AAPTR_MASTER, 0, 0, ${HEAD_CENTER * (boss.rosto.escala ?? 1)}, 0, WARPF_NOCHECKPOSITION | WARPF_INTERPOLATE)`,
    // O corpo é sprite e sempre aparece de frente; a cabeça acompanha e olha
    // para o alvo do chefe (o jogador). Sem alvo, fica na direção do chefe.
    `    ${s} A 0 A_TransferPointer(AAPTR_MASTER, AAPTR_DEFAULT, AAPTR_TARGET, AAPTR_TARGET)`,
    `    ${s} A 0 A_FaceTarget`,
    `    ${s} A 1 A_JumpIfHealthLower(1, "Some", AAPTR_MASTER)`,
    '    Loop',
    '  Some:',
    `    ${s} A 0`,
    '    Stop',
    '  }', '}',
  ].join('\n');
};

const headModelDef = (boss, k) => {
  const index = BOSS_FIRST + k;
  const scale = boss.rosto.escala ?? 1;
  return [
    `Model ${headActorName(boss)}`, '{',
    '  Path "models/"',
    `  Model 0 "${headModel(index)}"`,
    `  Skin 0 "${headSkin(index)}"`,
    `  Scale ${scale} ${scale} ${scale}`,
    `  FrameIndex ${headSprite(index)} A 0 0`,
    '}',
  ].join('\n');
};

const bossFrame = (face, boss, letter) => (boss.corpo === 'heroi'
  ? heroFramePng(face, boss, letter)
  : bossFramePng(face, boss, letter));

/**
 * Estados do chefe: mesmo comportamento do monstro base (o GZDoom traz as funções de
 * ataque de cada um), mas com os quadros desenhados aqui. A morte avisa o
 * jogador e abre o portão da arena pelo tag do setor — uma ação por estado,
 * porque duas funções que devolvem estado no mesmo state derrubam o
 * compilador do DECORATE.
 */
const bossStates = (boss, k) => {
  const s = faceSprite(BOSS_FIRST + k);
  const nome = normalizeText(boss.apelido);
  const andar = `  See:
    ${s} AB 3 A_Chase
    Loop`;
  let combate = {
    Cacodemon: `${andar}
  Missile:
    ${s} B 5 A_FaceTarget
    ${s} C 5 A_FaceTarget
    ${s} D 5 BRIGHT A_HeadAttack
    Goto See`,
    HellKnight: `${andar}
  Melee:
  Missile:
    ${s} B 8 A_FaceTarget
    ${s} D 8 A_BruisAttack
    Goto See`,
    Archvile: `  See:
    ${s} AB 2 A_VileChase
    Loop
  Missile:
    ${s} B 0 BRIGHT A_VileStart
    ${s} B 10 BRIGHT A_FaceTarget
    ${s} C 8 BRIGHT A_VileTarget
    ${s} D 8 BRIGHT A_FaceTarget
    ${s} E 8 BRIGHT A_VileAttack
    ${s} F 20 BRIGHT
    Goto See
  Heal:
    ${s} G 10 BRIGHT
    Goto See`,
    Cyberdemon: `  See:
    ${s} A 3 A_Hoof
    ${s} ABB 3 A_Chase
    ${s} C 3 A_Metal
    ${s} C 3 A_Chase
    Loop
  Missile:
    ${s} B 6 A_FaceTarget
    ${s} D 12 A_CyberAttack
    ${s} B 12 A_FaceTarget
    ${s} D 12 A_CyberAttack
    Goto See`,
  }[boss.base];
  if (!combate) throw new Error(`Sem estados para o monstro base ${boss.base}.`);
  // O espadachim ergue a katana (C) e corta (D): de perto é golpe, de longe
  // sai a onda de corte.
  const golpe = `${s} B 8 A_FaceTarget\n    ${s} D 8 A_BruisAttack`;
  if (boss.corpo === 'majin') {
    if (boss.base !== 'Archvile') throw new Error('O majin precisa do monstro base Archvile.');
    combate = combate
      .replace(`${s} C 8 BRIGHT A_VileTarget`, `${s} C 8 BRIGHT A_VileTarget("JogFogoRosa")`)
      .replace(`${s} E 8 BRIGHT A_VileAttack`, `${s} L 8 BRIGHT A_VileAttack`)
      .replace(`${s} F 20 BRIGHT`, `${s} J 20 BRIGHT`)
      .replace(`${s} G 10 BRIGHT`, `${s} K 10 BRIGHT`);
  }
  if (boss.corpo === 'espadachim') {
    if (!combate.includes(golpe)) throw new Error('O espadachim precisa do monstro base HellKnight.');
    combate = combate.replace(golpe, `${s} C 8 A_FaceTarget\n    ${s} D 8 A_CustomComboAttack("JogCorte", 120, 10 * random(1, 8), "baron/melee")`);
  }
  // Golpe especial: de vez em quando, perto o bastante e fora do intervalo de
  // descanso, o chefe suga o jogador em vez de atirar (ações em ZSCRIPT).
  const especial = boss.especial === 'sugar' ? `
  TentaSugar:
    ${s} J 0 A_JogTentaSugar(700)
    Goto Fogo
  Sugar:
    ${s} J 0 A_FaceTarget
    ${s} J 8 A_JogComecaSugar
  Sugando:
    ${s} J 0 A_FaceTarget
    ${s} J 2 A_JogSuga(900, 2.4)
    Loop
  Engole:
    ${s} K 0 A_JogEngole
    ${s} K 210
    ${s} L 0 A_JogCospe
    ${s} L 14 BRIGHT
    Goto See` : '';
  const ataque = especial
    ? combate.replace('  Missile:\n', `  Missile:\n    ${s} A 0 A_Jump(80, "TentaSugar")\n  Fogo:\n`) + especial
    : combate;
  const cabeca = boss.cabeca3d
    ? `    ${s} A 0 NoDelay A_SpawnItemEx("${headActorName(boss)}", 0, 0, 0, 0, 0, 0, 0, SXF_SETMASTER | SXF_NOCHECKPOSITION)
  Idle:
`
    : '';
  return `  Spawn:
${cabeca}    ${s} A 10 A_Look
    Loop
${ataque}
  Pain:
    ${s} E 3
    ${s} E 3 A_Pain
    Goto See
  Death:
    ${s} F 8
    ${s} G 0 A_Print("${nome} DERROTADO!")
    ${s} G 0 A_Log("JOGABILIDOOM: andar ${String(BOSS_FIRST + k + 1).padStart(2, '0')} — ${nome} caiu, portao aberto.")
    ${s} G 0 Door_Open(${GATE_TAG + k}, 16)
    ${s} G 8 A_Scream
    ${s} H 8 A_NoBlocking
    ${s} I 8
    ${s} I -1
    Stop`;
};

/** Billboard sem colisão: as placas e totens flutuam e não atrapalham o passeio. */
const billboard = (name, editorNumber, sprite, scale) => [
  `ACTOR ${name} ${editorNumber}`, '{',
  '  Radius 1', '  Height 1', '  +NOGRAVITY', '  +NOBLOCKMAP', '  +NOCLIP',
  `  RenderStyle Add`, `  Scale ${scale}`,
  '  States', '  {', '  Spawn:', `    ${sprite} A -1`, '    Stop', '  }', '}',
].join('\n');

/**
 * Chefe jogável: herda um monstro clássico do Doom II (vida, sons, flags e o
 * comportamento das funções de ataque), mas os estados e o sprite são nossos —
 * uma cabeça flutuante com a cara do integrante. A caixa de colisão acompanha
 * o sprite, para o jogador acertar o que está vendo.
 */
const bossActor = (boss, k) => {
  const escala = boss.rosto.escala ?? 0.9;
  const frameHeight = { kirby: KIRBY_FRAME[1], espadachim: TENGU_FRAME[1], majin: MAJIN_FRAME[1], mecha: MECH_FRAME[1] }[boss.corpo] ?? BOSS_FRAME_SIZE[1];
  const altura = Math.round(frameHeight * escala);
  // O chefe que suga herda do JogSugador (ZScript), que por sua vez herda o
  // monstro base: o comportamento continua o mesmo, com as ações do golpe por cima.
  const parent = boss.especial === 'sugar' ? 'JogSugador' : boss.base;
  return [
    `// ${normalizeText(boss.nome)} — ${normalizeText(boss.titulo)}`,
    `ACTOR JogChefe${boss.id[0].toUpperCase()}${boss.id.slice(1)} : ${parent} ${BOSS_THING + k * 10}`,
    '{',
    `  Health ${boss.health}`,
    `  Speed ${boss.speed ?? 8}`,
    `  Scale ${escala}`,
    `  Radius ${boss.rosto.raio ?? 28}`,
    `  Height ${altura}`,
    `  Tag "${normalizeText(boss.apelido)}"`,
    '  States',
    '  {',
    ...bossStates(boss, k).split('\n'),
    '  }',
    '}',
  ].join('\n');
};

/** A onda de corte do espadachim: o projétil do ataque à distância. */
const SLASH_ACTOR = [
  'ACTOR JogCorte', '{',
  '  Radius 10', '  Height 16', '  Speed 16', '  Damage 6', '  Projectile', '  +BRIGHT',
  '  RenderStyle Add', '  Alpha 0.95', '  Scale 0.6', '  SeeSound "baron/attack"', '  DeathSound "baron/shotx"',
  '  States', '  {', '  Spawn:', '    JKC0 AB 3 BRIGHT', '    Loop',
  '  Death:', '    JKC0 B 3 BRIGHT A_FadeOut(0.3)', '    Wait', '  }', '}',
].join('\n');

const decorate = [];
const sprites = [];
const models = [];
const modelDefs = [];
rooms.forEach((room, index) => {
  // O mesmo totem em duas alturas: na alcova ele fica embaixo do teto baixo;
  // no salão, alto o bastante para coroar o pódio.
  const door = doorSignSprite(index);
  const hall = hallSignSprite(index);
  sprites.push(lump(`${door}A0`, floorSignPng(index + 1, room.year, room.games.length, 248)));
  sprites.push(lump(`${hall}A0`, floorSignPng(index + 1, room.year, room.games.length, 500)));
  decorate.push(billboard(`JogTotem${room.year}`, 31000 + index, door, '0.5'));
  decorate.push(billboard(`JogTotemSala${room.year}`, 31200 + index, hall, '0.5'));
  room.games.forEach((game, rank) => {
    const sprite = labelSprite(index, rank);
    const highlight = rank === 0;
    sprites.push(lump(`${sprite}A0`, labelPng(rank + 1, game, { highlight })));
    decorate.push(billboard(
      `JogPlaca${room.year}_${rank + 1}`, 31100 + index * 10 + rank, sprite, highlight ? '0.75' : '0.5',
    ));
  });
});

bosses.forEach((boss, k) => {
  const index = BOSS_FIRST + k;
  const plate = bossPlateSprite(index);
  const porch = bossPorchSprite(index);
  const arena = bossArenaSprite(index);
  // O totem do chefe também sai em duas alturas: na alcova do patamar e no
  // alto da arena.
  sprites.push(lump(`${plate}A0`, bossSignPng(boss, k)));
  sprites.push(lump(`${porch}A0`, bossFloorSignPng(index + 1, boss, k, 248)));
  sprites.push(lump(`${arena}A0`, bossFloorSignPng(index + 1, boss, k, 520)));
  sprites.push(lump(`${creditSprite(index)}A0`, bossSignPng(boss, k, { compact: true })));
  decorate.push(billboard(`JogChefePlaca${boss.id}`, ARENA_SIGN + k * 10, plate, '0.75'));
  decorate.push(billboard(`JogChefePorta${boss.id}`, PORCH_TOTEM + k, porch, '0.5'));
  decorate.push(billboard(`JogChefeArena${boss.id}`, ARENA_TOTEM + k * 10, arena, '0.5'));
  decorate.push(billboard(`JogCredito${boss.id}`, CREDITS_SIGN + k, creditSprite(index), '0.5'));
  const rosto = faceFile(boss);
  if (!rosto) {
    console.warn(`! sem data/rostos/${boss.id}.png: o chefe ${boss.apelido} fica sem sprite próprio.`);
  } else {
    const face = decodePng(rosto);
    if (boss.corpo === 'kirby') {
      for (const [name, png] of kirbySprites(face, faceSprite(index))) sprites.push(lump(name, png));
    } else if (boss.corpo === 'espadachim') {
      for (const [name, png] of tenguSprites(face, faceSprite(index))) sprites.push(lump(name, png));
    } else if (boss.corpo === 'majin') {
      for (const [name, png] of majinSprites(face, faceSprite(index))) sprites.push(lump(name, png));
    } else if (boss.corpo === 'mecha') {
      for (const [name, png] of mechSprites(face, faceSprite(index), hexColor(boss.rosto.cor ?? '#d4af37'))) sprites.push(lump(name, png));
    } else {
      for (const letter of 'ABCDEFGHI') {
        sprites.push(lump(`${faceSprite(index)}${letter}0`, bossFrame(face, boss, letter)));
      }
    }
    if (boss.cabeca3d) {
      // O sprite da cabeça é só um pixel transparente: quem aparece é o modelo.
      sprites.push(lump(`${headSprite(index)}A0`, canvas(1, 1).toPng(0, 0)));
      models.push([`models/${headModel(index)}`, headMd3()], [`models/${headSkin(index)}`, headSkinPng(face)]);
      modelDefs.push(headModelDef(boss, k));
      decorate.push(headActor(boss, k));
    }
    decorate.push(bossActor(boss, k));
  }
});

// Texturas, sprites e atores dos temas em uso (e da dimensão, se alguém suga).
const textures = [];
const themeActors = [];
for (const name of new Set(bosses.map((boss) => boss.arena.tema).filter(Boolean))) {
  const theme = THEMES[name];
  textures.push(...theme.texturas().map(([lumpName, png]) => lump(lumpName, png)));
  for (const [lumpName, png] of theme.sprites()) sprites.push(lump(lumpName, png));
  themeActors.push(...theme.atores());
}
if (bosses.some((boss) => boss.especial === 'sugar')) {
  textures.push(...dimensionTextures().map(([lumpName, png]) => lump(lumpName, png)));
  for (const [lumpName, png] of dimensionSprites()) sprites.push(lump(lumpName, png));
  themeActors.push(...DIMENSION_ACTORS());
}
if (bosses.some((boss) => boss.corpo === 'espadachim')) themeActors.push(SLASH_ACTOR);
// O fogo do Arch-Vile, em rosa, para a magia do majin.
if (bosses.some((boss) => boss.corpo === 'majin')) {
  themeActors.push(['ACTOR JogFogoRosa : ArchvileFire', '{', '  Translation "0:255=%[0.0,0.0,0.0]:[2.0,0.7,1.6]"', '}'].join('\n'));
}
// Antes dos chefes: o DECORATE resolve as classes citadas na hora de compilar.
if (themeActors.length) decorate.unshift(themeActors.join('\n\n'));

// O golpe de sugar: as ações do chefe que engole o jogador e o cospe de volta
// com a vida cheia. DECORATE herda desta classe e chama as ações nos estados.
const zscript = bosses.some((boss) => boss.especial === 'sugar') ? `version "4.5"

class JogSugador : Cacodemon
{
  int jogSucao;
  int jogProxima;
  Actor jogVitima;

  // Só tenta sugar com o alvo perto e fora do descanso de 12 segundos.
  action state A_JogTentaSugar(double alcance)
  {
    if (level.maptime < invoker.jogProxima || !target || !target.player || Distance2D(target) > alcance) return null;
    return ResolveState("Sugar");
  }

  action void A_JogComecaSugar()
  {
    invoker.jogSucao = 0;
    invoker.bNoPain = true;
    A_StartSound("caco/sight", CHAN_VOICE);
    if (target) target.A_Print("CUIDADO! O CHEFE ESTA TE SUGANDO!", 2);
  }

  // Puxa o alvo para a boca; ao chegar perto, vai para "Engole". Depois de
  // 3 segundos sem engolir, desiste e volta a andar.
  action state A_JogSuga(double alcance, double forca)
  {
    let t = target;
    invoker.jogSucao += 2;
    if (!t || !t.player || t.health <= 0 || invoker.jogSucao > 105)
    {
      invoker.bNoPain = false;
      invoker.jogProxima = level.maptime + 35 * 12;
      return ResolveState("See");
    }
    for (int i = 0; i < 5; i++)
    {
      double dist = frandom(90, 420);
      double lado = frandom(-140, 140);
      double alto = frandom(10, 170);
      A_SpawnParticle(random(0, 1) ? "White" : "LightBlue", SPF_RELATIVE | SPF_FULLBRIGHT, 14, frandom(3, 7), 0,
        dist, lado, alto, -(dist - 40) / 14, -lado / 14, (90 - alto) / 14);
    }
    double d = Distance2D(t);
    if (d < radius + t.radius + 40) return ResolveState("Engole");
    if (d > alcance) return null;
    t.vel.xy += Vec2To(t).Unit() * -forca * (0.4 + (1 - d / alcance));
    return null;
  }

  action void A_JogEngole()
  {
    let t = target;
    if (!t || !t.player) return;
    let it = level.CreateSectorTagIterator(${DIMENSION_TAG});
    int s = it.Next();
    if (s < 0) return;
    Sector sec = level.Sectors[s];
    Vector2 c = sec.centerspot;
    invoker.jogVitima = t;
    t.Teleport((c, sec.floorplane.ZatPoint(c)), angle, TELF_DESTFOG | TELF_SOURCEFOG);
    t.vel = (0, 0, 0);
    t.A_Print("NHAM! VOCE FOI ENGOLIDO...\nBEM-VINDO A DIMENSAO DOS CORACOES", 4);
  }

  // Cospe o jogador na frente do chefe (ou do lado que estiver livre), com a
  // vida cheia e um empurrão para longe.
  action void A_JogCospe()
  {
    let t = invoker.jogVitima;
    invoker.jogVitima = null;
    invoker.bNoPain = false;
    invoker.jogProxima = level.maptime + 35 * 12;
    if (!t || t.health <= 0) return;
    double saida = angle;
    Vector2 dest = Vec2Angle(radius + t.radius + 80, saida);
    for (int i = 0; i < 8; i++)
    {
      saida = angle + ((i + 1) / 2) * 45 * (i % 2 ? 1 : -1);
      dest = Vec2Angle(radius + t.radius + 80, saida);
      // Quem testa o lugar é o próprio chefe: o jogador ainda está na dimensão,
      // em outra altura, e o teste dele recusaria qualquer ponto da arena.
      if (CheckPosition(dest)) break;
    }
    t.Teleport((dest, floorz), saida + 180, TELF_DESTFOG);
    t.GiveBody(1000);
    t.vel.xy = AngleToVector(saida, 14);
    t.A_Print("PTUI! VOCE FOI CUSPIDO DE VOLTA\nVIDA CHEIA!", 3);
  }
}
` : null;

sprites.push(lump('JVV0A0', victorySignPng(460)));
sprites.push(lump('JVT0A0', trophySignPng(TROPHY_FLOOR + 1, 248)));
decorate.push(billboard('JogVitoria', VICTORY_SIGN, 'JVV0', '0.75'));
decorate.push(billboard('JogTrofeuTotem', TROPHY_TOTEM, 'JVT0', '0.5'));

// Trilha do mapa: qualquer arquivo data/music.* entra como lump D_JOGA e o
// MAPINFO passa a apontar para ele. Sem arquivo, cai na música padrão do IWAD.
// O OGG vem primeiro na lista porque é o formato que o GZDoom repete sem
// emenda; o WAV fica por último, que é o que mais engorda o PWAD.
const musicFile = ['ogg', 'mp3', 'flac', 'mod', 'it', 'xm', 'mid', 'wav']
  .map((extension) => resolve(process.cwd(), `data/music.${extension}`))
  .find((path) => existsSync(path));
const musicLump = musicFile ? lump('D_JOGA', readFileSync(musicFile)) : null;
if (musicLump && musicLump.data.length > 8 * 1024 * 1024) {
  console.warn(`! ${basename(musicFile)} tem ${(musicLump.data.length / 1048576).toFixed(1)} MiB: o PWAD fica pesado.`);
}

const mapInfo = `// Jogabilidoom — museu jogável para GZDoom
map MAP01 "JOGABILIDOOM: ${rooms.length} ANDARES DE TOP 10 + ${bosses.length} CHEFOES"
{
  next = "EndGameC"
  music = "${musicLump ? 'D_JOGA' : 'D_RUNNIN'}"
  sky1 = "SKY1", 0
}
`;

const exhibitInfo = [
  'JOGABILIDOOM — MUSEU DO TOP 10 DO JOGABILIDADE',
  `Fonte: ${rooms[0].source}`,
  '',
  'A escadaria central sobe um andar por ano. Em cada patamar, a alcova',
  'iluminada teleporta para o salão daquele Top 10; a alcova do salão traz',
  'de volta ao mesmo patamar.',
  '',
  ...rooms.flatMap((room, index) => [
    `ANDAR ${String(index + 1).padStart(2, '0')} — ${room.year}`,
    ...room.games.map((game, rank) => `  ${String(rank + 1).padStart(2, '0')}. ${game}`),
    '',
  ]),
  'Em cada salão os altares seguem a ordem da lista: primeira fileira da',
  'esquerda para a direita, depois a segunda.',
  '',
  `ACIMA DO MUSEU — ${(bossCatalog.meta?.titulo ?? 'A TORRE DOS CHEFOES')}`,
  'Depois do último ano a escada continua e leva às quatro arenas dos',
  'integrantes: em cada uma o portão do fundo só abre quando o chefe cai, e',
  'a soleira atrás do portão sobe para o andar seguinte. O último é o chefe',
  'final; quem o derrota chega à câmara do troféu, onde o mapa termina.',
  '',
  ...bosses.flatMap((boss, index) => [
    `ANDAR ${String(BOSS_FIRST + index + 1).padStart(2, '0')} — ARENA DE ${boss.apelido}`,
    `  ${boss.nome} — ${boss.titulo}`,
    `  ${bossFooter(boss, index)}${boss.estrelas ? ` — ${boss.estrelas} ESTRELAS` : ''}`,
    '',
  ]),
  `ANDAR ${String(TROPHY_FLOOR + 1).padStart(2, '0')} — CAMARA DO TROFEU`,
  '  O interruptor da parede leste encerra o mapa.',
].join('\n');

const lumps = [
  ...(musicLump ? [musicLump] : []),
  ...(zscript ? [lump('ZSCRIPT', Buffer.from(zscript, 'ascii'))] : []),
  lump('DECORATE', Buffer.from(`${decorate.join('\n\n')}\n`, 'ascii')),
  ...(textures.length ? [lump('TX_START'), ...textures, lump('TX_END')] : []),
  lump('S_START'),
  ...sprites,
  lump('S_END'),
  lump('MAPINFO', Buffer.from(mapInfo, 'ascii')),
  lump('JOGINFO', Buffer.from(exhibitInfo, 'utf8')),
  lump('MAP01'),
  lump('THINGS', things(map.things)),
  lump('LINEDEFS', linedefs(map.lines)),
  lump('SIDEDEFS', sidedefs(map.sides)),
  lump('VERTEXES', vertices(map.vertices)),
  lump('SEGS'),
  lump('SSECTORS'),
  lump('NODES'),
  lump('SECTORS', sectors(map.sectors)),
  lump('REJECT'),
  lump('BLOCKMAP'),
];

let dataOffset = 12;
const directory = [];
for (const entry of lumps) {
  directory.push({ offset: dataOffset, size: entry.data.length, name: entry.name });
  dataOffset += entry.data.length;
}

const directoryOffset = dataOffset;
const wad = Buffer.alloc(directoryOffset + lumps.length * 16);
wad.write('PWAD', 0, 'ascii');
wad.writeInt32LE(lumps.length, 4);
wad.writeInt32LE(directoryOffset, 8);

let write = 12;
for (const entry of lumps) {
  entry.data.copy(wad, write);
  write += entry.data.length;
}
directory.forEach((entry, index) => {
  const at = directoryOffset + index * 16;
  wad.writeInt32LE(entry.offset, at);
  wad.writeInt32LE(entry.size, at + 4);
  fixedName(entry.name).copy(wad, at + 8);
});

writeFileSync(output, wad);
console.log(`PWAD criado: ${output} (${(wad.length / 1024).toFixed(1)} KiB, ${lumps.length} lumps)`);
const modelsPk3 = resolve(process.cwd(), 'jogabilidoom-modelos.pk3');
if (modelDefs.length) {
  models.push(['modeldef.txt', Buffer.from(`${modelDefs.join('\n\n')}\n`, 'ascii')]);
  writeFileSync(modelsPk3, zipStore(models));
  console.log(`Modelos 3D: ${modelsPk3} (carregar junto com o WAD)`);
} else if (existsSync(modelsPk3)) {
  rmSync(modelsPk3);
}
console.log(`${map.sectors.length} setores, ${map.lines.length} linedefs, ${map.things.length} things, ${TOTAL_FLOORS} andares.`);
rooms.forEach((room, index) => {
  console.log(`  andar ${String(index + 1).padStart(2, '0')} — ${room.year}: ${room.games.length} altares (chão em ${floorOf(index)})`);
});
bosses.forEach((boss, index) => {
  const floorIndex = BOSS_FIRST + index;
  console.log(
    `  andar ${String(floorIndex + 1).padStart(2, '0')} — arena de ${boss.apelido}`
    + ` (comportamento de ${boss.base}, ${boss.health} de vida, sprite ${boss.rosto.escala}x,`
    + ` chão em ${floorOf(floorIndex)}, portão no tag ${GATE_TAG + index})`,
  );
});
console.log(`  andar ${String(TROPHY_FLOOR + 1).padStart(2, '0')} — câmara do troféu (chão em ${floorOf(TROPHY_FLOOR)})`);
console.log(musicFile
  ? `Trilha: ${basename(musicFile)} (${(musicLump.data.length / 1048576).toFixed(2)} MiB) embutida como D_JOGA.`
  : 'Trilha: nenhum data/music.* encontrado; usando D_RUNNIN do IWAD.');
