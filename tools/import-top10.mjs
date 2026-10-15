#!/usr/bin/env node
/**
 * Importa as abas anuais da planilha pública "Os Melhores do Ano do
 * Jogabilidade 2016-2025", organizada por Renato Mesquita, para o museu.
 *
 * Cada aba tem um layout um pouco diferente: a lista coletiva mudou de coluna
 * ao longo dos anos e nem sempre tem cabeçalho ("TOP 10" só aparece de 2022 em
 * diante; antes disso a pista é o 🏆 na primeira posição). Por isso a coluna de
 * cada ano fica explícita aqui, conferida célula a célula na planilha.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const input = resolve(process.argv[2] || '/tmp/jogabilidade-top10.xlsx');
const output = resolve(process.cwd(), 'data/museum.json');
const source = 'https://docs.google.com/spreadsheets/d/1Pn0UWUDnKS0O_lA4KNvk7nDRbUIqWOibAWX1vVjH1AQ/edit';

// Coluna da lista coletiva e primeira linha de jogos em cada aba.
const columnByYear = {
  2025: 'H', 2024: 'H', 2023: 'H', 2022: 'H', 2021: 'G',
  2020: 'G', 2019: 'G', 2018: 'F', 2017: 'G', 2016: 'G',
};
const firstRow = 3;
const maxGames = 10;

const readZip = (entry) => execFileSync('unzip', ['-p', input, entry], { encoding: 'utf8' });
const decode = (value) => value
  .replace(/&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const shared = [];
for (const match of readZip('xl/sharedStrings.xml').matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)) {
  shared.push(decode(match[1].replace(/<[^>]+>/g, '')));
}

function parseCells(sheetNumber) {
  const cells = new Map();
  const xml = readZip(`xl/worksheets/sheet${sheetNumber}.xml`);
  for (const match of xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
    const reference = /\br="([A-Z]+)(\d+)"/.exec(match[1]);
    const value = /<v>([\s\S]*?)<\/v>/.exec(match[2]);
    if (!reference || !value) continue;
    const isShared = /\bt="s"/.test(match[1]);
    cells.set(`${reference[1]}${reference[2]}`, isShared ? shared[Number(value[1])] : decode(value[1]));
  }
  return cells;
}

// As três primeiras posições vêm marcadas com 🏆/🥈/🥉 em vários anos.
const stripMedal = (title) => title.replace(/^(?:\p{Extended_Pictographic}|️|‍|\s)+/u, '').trim();
const isGame = (value) => value && Number.isNaN(Number(value)) && stripMedal(value).length > 1;

const sheets = new Map();
for (const match of readZip('xl/workbook.xml').matchAll(/<sheet[^>]*\bname="(\d{4})"[^>]*\bsheetId="(\d+)"/g)) {
  sheets.set(Number(match[1]), Number(match[2]));
}

const rooms = [];
for (const [year, sheetNumber] of sheets) {
  const column = columnByYear[year];
  if (!column) {
    console.warn(`Aba ${year} sem coluna mapeada; pulando.`);
    continue;
  }
  const cells = parseCells(sheetNumber);
  const games = [];
  for (let index = 0; index < maxGames; index++) {
    const value = cells.get(`${column}${firstRow + index}`);
    if (!isGame(value)) break;
    games.push(stripMedal(value));
  }
  if (games.length < 5) throw new Error(`A coluna ${column} da aba ${year} não parece ser a lista coletiva.`);
  if (games.length < maxGames) console.warn(`Aba ${year}: a planilha só tem ${games.length} colocações.`);
  rooms.push({ year, source, games });
}

rooms.sort((a, b) => a.year - b.year);
writeFileSync(output, `${JSON.stringify({ rooms }, null, 2)}\n`);
console.log(`Importados ${rooms.length} anos (${rooms[0].year}-${rooms.at(-1).year}) em ${output}.`);
for (const room of rooms) console.log(`  ${room.year}: ${room.games.length} jogos — 1º ${room.games[0]}`);
