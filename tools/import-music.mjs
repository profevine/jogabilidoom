#!/usr/bin/env node
/**
 * Prepara a trilha do mapa: pega um arquivo local ou um link, extrai o áudio e
 * grava `data/music.ogg` — que o build embute como lump `D_JOGA` e passa a ser a
 * música do MAP01.
 *
 *   node tools/import-music.mjs /caminho/para/faixa.mp3
 *   node tools/import-music.mjs https://www.youtube.com/watch?v=xxxx
 *   node tools/import-music.mjs https://... --inicio 0:30 --duracao 1:30
 *
 * Precisa do ffmpeg no PATH; para links, também do yt-dlp. O OGG (Vorbis) é o
 * formato preferido: é o que o GZDoom repete sem emenda e o que ocupa menos.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const [, , entrada, ...resto] = process.argv;
if (!entrada) {
  console.error('uso: node tools/import-music.mjs <arquivo-ou-link> [--inicio 0:30] [--duracao 1:30] [--loop-crossfade 1.5] [--saida data/music.ogg]');
  process.exit(1);
}
const opcao = (nome) => {
  const at = resto.indexOf(`--${nome}`);
  return at >= 0 ? resto[at + 1] : null;
};
const saida = resolve(process.cwd(), opcao('saida') ?? 'data/music.ogg');
const inicio = opcao('inicio');
const duracao = opcao('duracao');
const eLink = /^https?:\/\//i.test(entrada);

const tem = (bin) => {
  try { execFileSync('which', [bin], { stdio: 'ignore' }); return true; } catch { return false; }
};
const rodar = (bin, args) => execFileSync(bin, args, { stdio: ['ignore', 'inherit', 'inherit'] });

if (!tem('ffmpeg')) {
  console.error('! ffmpeg não encontrado no PATH (instale com: sudo pacman -S ffmpeg).');
  process.exit(1);
}

const temporario = resolve(process.cwd(), '.music-tmp');
let fonte = entrada;
if (eLink) {
  if (!tem('yt-dlp')) {
    console.error('! yt-dlp não encontrado no PATH (instale com: sudo pacman -S yt-dlp).');
    process.exit(1);
  }
  mkdirSync(temporario, { recursive: true });
  console.log('baixando o áudio...');
  rodar('yt-dlp', ['-x', '--audio-format', 'best', '-o', `${temporario}/faixa.%(ext)s`, entrada]);
  const { readdirSync } = await import('node:fs');
  const arquivo = readdirSync(temporario).find((nome) => nome.startsWith('faixa.'));
  if (!arquivo) {
    console.error('! não consegui baixar o áudio do link.');
    process.exit(1);
  }
  fonte = resolve(temporario, arquivo);
} else if (!existsSync(fonte)) {
  console.error(`! arquivo não encontrado: ${fonte}`);
  process.exit(1);
}

mkdirSync(resolve(saida, '..'), { recursive: true });
// Normaliza a altura (EBU R128) para a música não destoar dos sons do jogo.
const normalizar = 'loudnorm=I=-16:TP=-1.5:LRA=11';
const crossfade = opcao('loop-crossfade');
const args = ['-hide_banner', '-loglevel', 'error', '-y'];
if (inicio) args.push('-ss', inicio);
if (duracao) args.push('-t', duracao);
args.push('-i', fonte);
if (crossfade) {
  // Loop sem emenda: o fim do trecho é misturado com o começo dele mesmo, então
  // a repetição do GZDoom não tem corte. `d` é a duração da mistura, em segundos.
  args.push(
    '-filter_complex',
    `[0:a]${normalizar},asplit=2[a][b];`
    + `[b]atrim=0:${crossfade},asetpts=N/SR/TB[cabeca];`
    + `[a][cabeca]acrossfade=d=${crossfade}:c1=tri:c2=tri[saida]`,
    '-map', '[saida]',
  );
} else {
  args.push('-af', normalizar);
}
args.push('-ac', '2', '-ar', '44100', '-c:a', 'libvorbis', '-q:a', '5', saida);
console.log(crossfade ? `convertendo para OGG com loop de ${crossfade}s...` : 'convertendo para OGG...');
rodar('ffmpeg', args);
rmSync(temporario, { recursive: true, force: true });

const mb = statSync(saida).size / (1024 * 1024);
console.log(`pronto: ${saida} (${mb.toFixed(2)} MiB)`);
if (mb > 8) console.warn('! arquivo grande: o PWAD vai ficar pesado. Considere --duracao para usar só um trecho.');
console.log('agora rode: node tools/build-wad.mjs');
