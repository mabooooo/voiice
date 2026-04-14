<p align="center">
  <a href="README.md">English</a> | <a href="README_zh.md">中文</a> | <a href="README_ja.md">日本語</a> | <a href="README_ko.md">한국어</a> | <a href="README_es.md">Español</a> | <a href="README_fr.md">Français</a> | <a href="README_de.md">Deutsch</a> | <strong>Português</strong> | <a href="README_ru.md">Русский</a> | <a href="README_ar.md">العربية</a> | <a href="README_hi.md">हिन्दी</a> | <a href="README_it.md">Italiano</a> | <a href="README_tr.md">Türkçe</a> | <a href="README_vi.md">Tiếng Việt</a> | <a href="README_th.md">ภาษาไทย</a> | <a href="README_id.md">Bahasa Indonesia</a> | <a href="README_pl.md">Polski</a> | <a href="README_nl.md">Nederlands</a>
</p>

<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" width="128" height="128" alt="OpenTypeless Logo" />
</p>

<h1 align="center">OpenTypeless</h1>

<p align="center">
  Entrada de voz com IA de código aberto para desktop. Fale naturalmente, obtenha texto polido em qualquer aplicativo.
</p>

<p align="center">
  Seja escrevendo e-mails, programando, conversando ou fazendo anotações — basta pressionar uma tecla,<br/>
  fale o que pensa, e o OpenTypeless transcreve e refina suas palavras com IA,<br/>
  digitando-as diretamente no aplicativo que você está usando.
</p>

<p align="center">
  <a href="https://github.com/tover0314-w/opentypeless/actions/workflows/ci.yml"><img src="https://github.com/tover0314-w/opentypeless/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/tover0314-w/opentypeless/releases"><img src="https://img.shields.io/github/v/release/tover0314-w/opentypeless?color=2ABBA7" alt="Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/tover0314-w/opentypeless" alt="Licença" /></a>
  <a href="https://github.com/tover0314-w/opentypeless/stargazers"><img src="https://img.shields.io/github/stars/tover0314-w/opentypeless?style=social" alt="Stars" /></a>
  <a href="https://discord.gg/V6rRpJ4RGD"><img src="https://img.shields.io/badge/Discord-Join%20us-5865F2?logo=discord&logoColor=white" alt="Discord" /></a>
</p>

<p align="center">
  <img src="docs/images/voice-flow-demo.gif" width="720" alt="OpenTypeless Demo" />
</p>

<details>
<summary>Mais capturas de tela</summary>

<p align="center">
  <img src="docs/images/app-main-light.png" width="720" alt="OpenTypeless Janela Principal" />
</p>

| Configurações | Histórico |
|---|---|
| <img src="docs/images/app-settings.png" width="360" /> | <img src="docs/images/app-history.png" width="360" /> |

</details>

---

## Por que OpenTypeless?

| | OpenTypeless | Ditado macOS | Digitação por Voz Windows | Whisper Desktop |
|---|---|---|---|---|
| Polimento de texto com IA | ✅ Múltiplos LLMs | ❌ | ❌ | ❌ |
| Escolha de provedor STT | ✅ 6+ provedores | ❌ Apenas Apple | ❌ Apenas Microsoft | ❌ Apenas Whisper |
| Funciona em qualquer app | ✅ | ✅ | ✅ | ❌ Copiar-colar |
| Modo tradução | ✅ | ❌ | ❌ | ❌ |
| Código aberto | ✅ MIT | ❌ | ❌ | ✅ |
| Multiplataforma | ✅ Win/Mac/Linux | ❌ Apenas Mac | ❌ Apenas Windows | ✅ |
| Dicionário personalizado | ✅ | ❌ | ❌ | ❌ |
| Auto-hospedável | ✅ BYOK | ❌ | ❌ | ✅ |

## Funcionalidades

- 🎙️ Tecla de atalho global — manter para gravar ou alternar
- 💊 Widget cápsula flutuante, sempre visível
- 🗣️ 6+ provedores STT: Deepgram, AssemblyAI, Whisper, Groq, GLM-ASR, SiliconFlow
- 🤖 Polimento de texto com múltiplos LLMs: OpenAI, DeepSeek, Claude, Gemini, Ollama e mais
- ⚡ Saída em streaming — o texto aparece conforme o LLM gera
- ⌨️ Saída por simulação de teclado ou área de transferência
- 📝 Selecione texto antes de gravar para dar contexto ao LLM
- 🌐 Modo tradução: fale em um idioma, obtenha a saída em outro (20+ idiomas)
- 📖 Dicionário personalizado para termos específicos
- 🔍 Detecção por aplicativo para adaptar a formatação
- 📜 Histórico local com busca em texto completo
- 🌗 Tema escuro / claro / sistema
- 🚀 Início automático no login

> [!TIP]
> **Configuração recomendada para a melhor experiência**
>
> | | Provedor | Modelo |
> |---|---|---|
> | 🗣️ STT | Groq | `whisper-large-v3-turbo` |
> | 🤖 Polimento IA | Google | `gemini-2.5-flash` |
>
> Esta combinação oferece transcrição rápida e precisa com polimento de texto de alta qualidade — e ambos oferecem generosos níveis gratuitos.

## Download

Baixe a versão mais recente para sua plataforma:

**[Baixar dos Releases](https://github.com/tover0314-w/opentypeless/releases)**

| Plataforma | Arquivo |
|------------|---------|
| Windows | Instalador `.msi` |
| macOS (Apple Silicon) | `.dmg` |
| macOS (Intel) | `.dmg` |
| Linux | `.AppImage` / `.deb` |

## Pré-requisitos

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://rustup.rs/) (toolchain estável)
- Dependências específicas da plataforma para Tauri: veja [Pré-requisitos do Tauri](https://v2.tauri.app/start/prerequisites/)

## Primeiros passos

```bash
# Instalar dependências
npm install

# Executar em modo de desenvolvimento
npm run tauri dev

# Compilar para produção
npm run tauri build
```

O aplicativo compilado estará em `src-tauri/target/release/bundle/`.

## Configuração

Todas as configurações são acessíveis pelo painel de Configurações do aplicativo:

- **Reconhecimento de voz** — escolha o provedor STT e insira sua chave de API
- **Polimento IA** — escolha o provedor LLM, modelo e chave de API
- **Geral** — tecla de atalho, modo de saída, tema, início automático
- **Dicionário** — adicione termos personalizados para melhor precisão na transcrição
- **Cenas** — modelos de prompt para diferentes casos de uso

As chaves de API são armazenadas localmente via `tauri-plugin-store`. Nenhuma chave é enviada aos servidores do OpenTypeless — todas as requisições STT/LLM vão diretamente ao provedor que você configurar.

### Opção Cloud (Pro)

O OpenTypeless também oferece uma assinatura Pro opcional que fornece cota gerenciada de STT e LLM para que você não precise de suas próprias chaves de API. Isso é totalmente opcional — o aplicativo é completamente funcional com suas próprias chaves.

[Saiba mais sobre o Pro](https://www.opentypeless.com)

### BYOK (Traga Sua Própria Chave) vs Cloud

| | Modo BYOK | Modo Cloud (Pro) |
|---|---|---|
| STT | Sua própria chave de API (Deepgram, AssemblyAI, etc.) | Cota gerenciada (10h/mês) |
| LLM | Sua própria chave de API (OpenAI, DeepSeek, etc.) | Cota gerenciada (~5M tokens/mês) |
| Dependência de nuvem | Nenhuma — todas as requisições vão diretamente ao seu provedor | Requer conexão com www.opentypeless.com |
| Custo | Pague diretamente ao seu provedor | Assinatura de $4,99/mês |

Todas as funcionalidades principais — gravação, transcrição, polimento IA, saída por teclado/área de transferência, dicionário, histórico — funcionam totalmente independentes dos servidores do OpenTypeless no modo BYOK.

### Auto-Hospedagem / Sem Cloud

Para executar o OpenTypeless sem nenhuma dependência de nuvem:

1. Escolha qualquer provedor STT e LLM que não seja Cloud nas Configurações
2. Insira suas próprias chaves de API
3. Pronto — nenhuma conta ou conexão com www.opentypeless.com é necessária

Se você quiser apontar os recursos opcionais de nuvem para seu próprio backend, defina estas variáveis de ambiente antes de compilar:

| Variável | Padrão | Descrição |
|---|---|---|
| `VITE_API_BASE_URL` | `https://www.opentypeless.com` | URL base da API cloud do frontend |
| `API_BASE_URL` | `https://www.opentypeless.com` | URL base da API cloud do backend Rust |

```bash
# Exemplo: compilar com um backend personalizado
VITE_API_BASE_URL=https://my-server.example.com API_BASE_URL=https://my-server.example.com npm run tauri build
```

## Arquitetura

**Pipeline de fluxo de dados:**

```
Microfone → Captura de áudio → Provedor STT → Transcrição bruta → Polimento LLM → Saída teclado/área de transferência
```

```
src/                  # Frontend React (TypeScript)
├── components/       # Componentes de UI (Configurações, Histórico, Cápsula, etc.)
├── hooks/            # Hooks React (gravação, tema, eventos Tauri)
├── lib/              # Utilitários (cliente API, roteador, constantes)
└── stores/           # Gerenciamento de estado com Zustand

src-tauri/src/        # Backend Rust
├── audio/            # Captura de áudio via cpal
├── stt/              # Provedores STT (Deepgram, AssemblyAI, compatível com Whisper, Cloud)
├── llm/              # Provedores LLM (compatível com OpenAI, Cloud)
├── output/           # Saída de texto (simulação de teclado, colagem da área de transferência)
├── storage/          # Configuração (tauri-plugin-store) + histórico/dicionário (SQLite)
├── app_detector/     # Detectar aplicativo ativo para contexto
├── pipeline.rs       # Orquestração Gravação → STT → LLM → Saída
└── lib.rs            # Configuração do app Tauri, comandos, tratamento de tecla de atalho
```

## Roadmap

- [ ] Sistema de plugins para integrações STT/LLM personalizadas
- [ ] Melhoria da precisão STT multilíngue e suporte a dialetos
- [ ] Comandos de voz
- [ ] Combinações de teclas personalizáveis
- [ ] Experiência de integração melhorada
- [ ] Aplicativo móvel complementar

## Perguntas frequentes

**Meu áudio é enviado para a nuvem?**
No modo BYOK, o áudio vai diretamente para o provedor STT que você escolheu (ex.: Groq, Deepgram). Nada passa pelos servidores do OpenTypeless. No modo Cloud (Pro), o áudio é enviado ao nosso proxy gerenciado para transcrição.

**Posso usar offline?**
Com um provedor STT local (Whisper via Ollama) e um LLM local (Ollama), o aplicativo funciona totalmente offline. Nenhuma conexão com a internet é necessária.

**Quais idiomas são suportados?**
O STT suporta mais de 99 idiomas dependendo do provedor. O polimento por IA e a tradução suportam mais de 20 idiomas de destino.

**O aplicativo é gratuito?**
Sim. O aplicativo é totalmente funcional com suas próprias chaves de API (BYOK). A assinatura Cloud Pro ($4,99/mês) é opcional.

## Comunidade

- 💬 [Discord](https://discord.gg/V6rRpJ4RGD) — Converse, obtenha ajuda, compartilhe feedback
- 🗣️ [GitHub Discussions](https://github.com/tover0314-w/opentypeless/discussions) — Propostas de funcionalidades, perguntas e respostas
- 🐛 [Issue Tracker](https://github.com/tover0314-w/opentypeless/issues) — Relatórios de bugs e solicitações de funcionalidades
- 📖 [Guia de contribuição](CONTRIBUTING.md) — Configuração de desenvolvimento e diretrizes
- 🔒 [Política de segurança](SECURITY.md) — Relatar vulnerabilidades de forma responsável
- 🧭 [Visão](VISION.md) — Princípios do projeto e direção do roadmap

## Contribuir

Contribuições são bem-vindas! Consulte [CONTRIBUTING.md](CONTRIBUTING.md) para configuração de desenvolvimento e diretrizes.

Procurando por onde começar? Confira as issues com o rótulo [`good first issue`](https://github.com/tover0314-w/opentypeless/labels/good%20first%20issue).

## Star History

<a href="https://star-history.com/#tover0314-w/opentypeless&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=tover0314-w/opentypeless&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=tover0314-w/opentypeless&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=tover0314-w/opentypeless&type=Date" />
  </picture>
</a>

## Desenvolvido com Claude Code em um dia

Este projeto inteiro foi construído em um único dia usando [Claude Code](https://claude.com/claude-code) — do design da arquitetura à implementação completa, incluindo o backend Tauri, frontend React, pipeline CI/CD e este README.

## Licença

[MIT](LICENSE)
