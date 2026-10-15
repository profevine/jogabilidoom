#!/usr/bin/env node
// Publica a versão atual em blog.profevine.com.br/jogabilidoom.
//
// Monta a página (site/index.html), o PWAD, o pacote para Windows, o changelog
// e as capturas numa pasta local e sincroniza com o blog no servidor ax3 por
// rsync.
//
// O pacote para Windows junta o GZDoom e o Freedoom (baixados uma vez para
// .cache/, com o checksum do Freedoom conferido) ao WAD, com um JOGAR.bat que
// abre o jogo direto no mapa.
//
//   node tools/publish-site.mjs            # publica
//   node tools/publish-site.mjs --dry-run  # monta a pasta e mostra o que mudaria
//
// A versão publicada é a primeira de `data/changelog.json`. Antes de publicar
// uma atualização, acrescente a entrada nova no topo desse arquivo.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOST = process.env.SITE_HOST ?? 'ax3';
const DEST = process.env.SITE_DEST ?? '/var/www/blog/jogabilidoom/';
const URL = 'https://blog.profevine.com.br/jogabilidoom/';
const OUT = join(ROOT, '.site-build');
const dryRun = process.argv.includes('--dry-run');

const CACHE = join(ROOT, '.cache');
const GZDOOM = { tag: 'g4.14.2', file: 'gzdoom-4-14-2-windows.zip', repo: 'ZDoom/gzdoom' };
const FREEDOOM = {
  tag: 'v0.13.0', file: 'freedoom-0.13.0.zip', repo: 'freedoom/freedoom',
  sha256: '3f9b264f3e3ce503b4fb7f6bdcb1f419d93c7b546f4df3e874dd878db9688f59',
};

const fail = (msg) => { console.error(`erro: ${msg}`); process.exit(1); };
const ssh = (cmd) => execFileSync('ssh', [HOST, cmd], { encoding: 'utf8' });
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: ['ignore', 'ignore', 'inherit'] });
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const crlf = (lines) => `${lines.join('\r\n')}\r\n`;

/** Baixa (uma vez) um arquivo de release do GitHub para .cache/. */
function cached({ tag, file, repo, sha256: expected }) {
  const path = join(CACHE, file);
  if (!existsSync(path)) {
    mkdirSync(CACHE, { recursive: true });
    run('gh', ['release', 'download', tag, '--repo', repo, '--pattern', file, '--dir', CACHE]);
  }
  if (expected && sha(path) !== expected) fail(`${file} não confere com o checksum oficial.`);
  return path;
}

/** Pasta pronta para Windows: GZDoom + Freedoom + o WAD + JOGAR.bat, zipada. */
function windowsPackage(version, out) {
  const stage = join(ROOT, '.site-build-win');
  const dir = join(stage, 'Jogabilidoom');
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(join(dir, 'licencas'), { recursive: true });
  run('unzip', ['-q', cached(GZDOOM), '-d', dir]);
  run('unzip', ['-q', '-j', cached(FREEDOOM), 'freedoom-0.13.0/freedoom2.wad', 'freedoom-0.13.0/COPYING.txt', '-d', dir]);
  renameSync(join(dir, 'COPYING.txt'), join(dir, 'licencas', 'freedoom-COPYING.txt'));
  renameSync(join(dir, 'licenses.zip'), join(dir, 'licencas', 'gzdoom-licencas.zip'));
  copyFileSync(wad, join(dir, 'jogabilidoom.wad'));
  // Com este arquivo o GZDoom guarda configuração e saves na própria pasta.
  writeFileSync(join(dir, 'gzdoom_portable.ini'), '');
  writeFileSync(join(dir, 'JOGAR.bat'), crlf([
    '@echo off',
    'cd /d "%~dp0"',
    'start "" "gzdoom.exe" -iwad freedoom2.wad -file jogabilidoom.wad +map MAP01',
  ]));
  writeFileSync(join(dir, 'LEIA-ME.txt'), crlf([
    `JOGABILIDOOM ${version} (beta)`,
    '',
    'Um museu-torre para Doom com os Top 10 do Jogabilidade, de 2016 ate hoje,',
    'e quatro chefes no alto da escadaria.',
    '',
    'COMO JOGAR',
    '  1. Extraia o zip inteiro para uma pasta (nao rode de dentro do zip).',
    '  2. Clique duas vezes em JOGAR.bat.',
    '  Se o Windows avisar que protegeu o computador, clique em',
    '  "Mais informacoes" e depois em "Executar assim mesmo".',
    '',
    'CONTROLES',
    '  W A S D anda, o mouse mira, o botao esquerdo atira, E ou Espaco usa.',
    '  Tudo se troca em Opcoes > Controles. Esc abre o menu.',
    '',
    'NOVIDADES E ATUALIZACOES',
    `  ${URL}`,
    '',
    'CREDITOS',
    '  Listas do museu: planilha "Os Melhores do Ano do Jogabilidade 2016-2025",',
    '  organizada por Renato Mesquita. Valeu, Renato!',
    '  Ao Jogabilidade e a Rafael Quina (Rafa), Fernando Mucioli (Tengu),',
    '  Andre Campos e Eduardo Fonseca (Sushi): obrigado pelos anos de programa.',
    '',
    'SOBRE',
    '  O Jogabilidoom e um trabalho independente, feito por fas como homenagem',
    '  ao Jogabilidade (https://jogabilida.de). Nao tem vinculo com o podcast nem',
    '  e endossado por ele. E gratuito e sem fins comerciais.',
    '',
    'O QUE VEM NESTE PACOTE',
    '  GZDoom 4.14.2 - o motor do jogo. Licenca GPLv3; codigo-fonte em',
    '  https://github.com/ZDoom/gzdoom (licencas em licencas/gzdoom-licencas.zip).',
    '  Freedoom: Phase 2 0.13.0 - os graficos e sons base, livres. Licenca BSD;',
    '  https://freedoom.github.io (licenca em licencas/freedoom-COPYING.txt).',
  ]));
  const zipName = `jogabilidoom-${version}-windows.zip`;
  rmSync(join(out, zipName), { force: true });
  run('zip', ['-qr', '-9', '-X', join(out, zipName), 'Jogabilidoom'], stage);
  rmSync(stage, { recursive: true, force: true });
  return zipName;
}

const wad = join(ROOT, 'jogabilidoom.wad');
if (!existsSync(wad)) fail('jogabilidoom.wad não existe; rode `node tools/build-wad.mjs` antes.');

const changelog = JSON.parse(readFileSync(join(ROOT, 'data/changelog.json'), 'utf8'));
const [latest] = changelog.versions;
if (!latest?.version || !latest?.date || !latest?.changes?.length) fail('a primeira entrada de data/changelog.json está incompleta.');

const bytes = readFileSync(wad);
const sha256 = createHash('sha256').update(bytes).digest('hex');

// O WAD não pode mudar sem versão nova: confere com o que está no ar.
let live = null;
try { live = JSON.parse(ssh(`cat ${DEST}release.json 2>/dev/null || true`) || 'null'); } catch { /* primeira publicação */ }
if (live?.version === latest.version && live.sha256 !== sha256) {
  fail(`o WAD mudou mas a versão continua ${latest.version}; acrescente uma entrada nova em data/changelog.json.`);
}

// As versões antigas continuam baixáveis: o rsync não apaga nada em download/.
const file = `jogabilidoom-${latest.version}.wad`;
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'download'), { recursive: true });
mkdirSync(join(OUT, 'capturas'), { recursive: true });
copyFileSync(join(ROOT, 'site/index.html'), join(OUT, 'index.html'));
copyFileSync(wad, join(OUT, 'download', file));
copyFileSync(wad, join(OUT, 'download', 'jogabilidoom.wad'));
const winZip = windowsPackage(latest.version, join(OUT, 'download'));
const winPath = join(OUT, 'download', winZip);
for (const shot of readdirSync(join(ROOT, 'screenshots'))) {
  copyFileSync(join(ROOT, 'screenshots', shot), join(OUT, 'capturas', shot));
}
writeFileSync(join(OUT, 'changelog.json'), JSON.stringify(changelog, null, 2) + '\n');
writeFileSync(join(OUT, 'release.json'), JSON.stringify({
  version: latest.version,
  date: latest.date,
  file: `download/${file}`,
  size: bytes.length,
  sha256,
  windows: { file: `download/${winZip}`, size: statSync(winPath).size, sha256: sha(winPath) },
}, null, 2) + '\n');

console.log(`versão ${latest.version} (${(bytes.length / 1024).toFixed(0)} KB, sha256 ${sha256.slice(0, 12)}…)`);

ssh(`mkdir -p ${DEST}`);
execFileSync('rsync', [
  '-rtv', '--chmod=D755,F644', ...(dryRun ? ['--dry-run'] : []),
  `${OUT}/`, `${HOST}:${DEST}`,
], { stdio: 'inherit' });

console.log(dryRun ? '--dry-run: nada foi enviado.' : `publicado em ${URL}`);
