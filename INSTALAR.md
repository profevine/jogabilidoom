# Como instalar e jogar o Jogabilidoom

O Jogabilidoom é um mapa (um **PWAD**) que roda por cima do Doom. Para jogar são
três peças:

1. o motor **GZDoom** (ou o **UZDoom**, o sucessor dele);
2. um **IWAD**, os arquivos-base do jogo: o **Freedoom: Phase 2**
   (`freedoom2.wad`, gratuito e livre) ou o `doom2.wad` original;
3. o **`jogabilidoom.wad`**.

Os downloads ficam na [página do jogo](https://blog.profevine.com.br/jogabilidoom/)
e na [página de versões do repositório](https://github.com/profevine/jogabilidoom/releases).

> Versão beta: o jogo ainda está em desenvolvimento e cada atualização entra no
> changelog da página do jogo.

## Windows

### Jeito fácil: o pacote pronto

O pacote para Windows (`jogabilidoom-<versão>-windows.zip`) já traz o GZDoom e o
Freedoom, então não precisa instalar nada.

1. Baixe o zip.
2. Clique com o botão direito nele e escolha **Extrair tudo…**. Não rode o jogo
   de dentro do zip.
3. Abra a pasta `Jogabilidoom` e dê dois cliques em **`JOGAR.bat`**.
4. Se aparecer *"O Windows protegeu o computador"*, clique em
   **Mais informações** e depois em **Executar assim mesmo**.

A configuração e os jogos salvos ficam na própria pasta, então dá para levar a
pasta para outro computador ou num pendrive.

### Jeito manual (para quem já tem o GZDoom)

1. Baixe o GZDoom em <https://zdoom.org/downloads> e extraia numa pasta.
2. Baixe o Freedoom em <https://freedoom.github.io/download.html> e copie o
   `freedoom2.wad` para a pasta do GZDoom.
3. Copie o `jogabilidoom.wad` para a mesma pasta.
4. Crie ali um arquivo `jogabilidoom.bat` com esta linha e dê dois cliques nele:

```bat
gzdoom.exe -iwad freedoom2.wad -file jogabilidoom.wad +map MAP01
```

Atalho rápido: arraste o `jogabilidoom.wad` para cima do `gzdoom.exe`. O GZDoom
pergunta qual IWAD usar; escolha o Freedoom (ou o Doom II) e comece um novo
jogo.

## Linux

### 1. Instale o GZDoom

- **Debian, Ubuntu, Mint e derivados:** baixe o `.deb` da página de versões do
  GZDoom (<https://github.com/ZDoom/gzdoom/releases>) e instale:

  ```bash
  sudo apt install ./gzdoom_*_amd64.deb
  ```

- **Arch, Manjaro e derivados:** pelo AUR (por exemplo `yay -S gzdoom`).
- **Outras distribuições:** procure `gzdoom` no gerenciador de pacotes ou use os
  binários da página de versões.

### 2. Instale o Freedoom

```bash
sudo apt install freedoom      # Debian, Ubuntu e derivados
sudo pacman -S freedoom        # Arch e derivados
sudo dnf install freedoom      # Fedora
```

Pelo gerenciador de pacotes, o `freedoom2.wad` costuma ficar em
`/usr/share/games/doom/`. Se preferir, baixe o zip em
<https://freedoom.github.io/download.html> e use o arquivo direto.

### 3. Rode o jogo

Na pasta onde está o `jogabilidoom.wad`:

```bash
gzdoom -iwad /usr/share/games/doom/freedoom2.wad -file jogabilidoom.wad +map MAP01
```

Para abrir o jogo digitando só `jogabilidoom`, acrescente um atalho ao
`~/.bashrc` (ou `~/.zshrc`), ajustando os caminhos, e abra um terminal novo:

```bash
alias jogabilidoom='gzdoom -iwad /usr/share/games/doom/freedoom2.wad -file ~/Jogos/jogabilidoom.wad +map MAP01'
```

## macOS

1. Baixe o GZDoom para macOS em <https://github.com/ZDoom/gzdoom/releases>
   (`gzdoom-…-macos.zip`), extraia e arraste o **GZDoom** para **Aplicativos**.
2. Na primeira vez, abra com o botão direito → **Abrir**, para o macOS deixar
   rodar um aplicativo baixado da internet.
3. Baixe o Freedoom em <https://freedoom.github.io/download.html> e deixe o
   `freedoom2.wad` na mesma pasta do `jogabilidoom.wad`.
4. No Terminal, dentro dessa pasta:

```bash
open -a GZDoom --args -iwad "$PWD/freedoom2.wad" -file "$PWD/jogabilidoom.wad" +map MAP01
```

## Começando a jogar

- Você nasce no saguão, no pé da escadaria. Cada patamar é um ano, de 2016 em
  diante; a alcova iluminada de cada patamar leva ao salão do Top 10 daquele
  ano. É só atravessar a soleira.
- Acima do último ano ficam as quatro arenas de chefe. O arsenal de cada luta
  fica no patamar, antes de entrar, e o portão da arena só abre quando o chefe
  cai.
- No topo, a câmara do troféu. O interruptor da parede encerra o jogo.

**Controles (padrão do GZDoom):** `W A S D` anda, o mouse mira, o botão
esquerdo atira, `E` ou `Espaço` usa, os números trocam de arma e `Esc` abre o
menu. Tudo se troca em **Opções → Controles**.

## Problemas comuns

- **"Não encontrei nenhum IWAD" / "No IWAD found":** o caminho do
  `freedoom2.wad` está errado. Confira o nome e a pasta, ou use o caminho
  completo depois de `-iwad`.
- **O jogo abre no menu do Freedoom em vez do museu:** faltou o
  `-file jogabilidoom.wad` (ou o `+map MAP01`). Pelo menu, *Novo jogo* também
  começa no museu, desde que o WAD tenha sido carregado.
- **Tela preta ou erro de vídeo ao abrir:** atualize o driver da placa de
  vídeo. No GZDoom, em **Opções → Opções de vídeo**, dá para trocar o
  renderizador.
- **No Windows o `JOGAR.bat` não faz nada:** confira se o zip foi extraído
  inteiro e se o `gzdoom.exe` está na mesma pasta.
- **Ficou pesado:** em **Opções → Opções de vídeo**, diminua a resolução ou
  desligue o anti-aliasing.

## Para quem quer gerar o WAD a partir do código

Com Node.js 18 ou mais recente, na pasta do repositório:

```bash
node tools/build-wad.mjs
```

O comando gera o `jogabilidoom.wad` na raiz do projeto. Os detalhes de como o
museu e os chefes são montados estão no [README](README.md).
