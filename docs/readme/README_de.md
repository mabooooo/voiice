<p align="center">
  <a href="README.md">English</a> | <a href="README_zh.md">中文</a> | <a href="README_ja.md">日本語</a> | <a href="README_ko.md">한국어</a> | <a href="README_es.md">Español</a> | <a href="README_fr.md">Français</a> | <strong>Deutsch</strong> | <a href="README_pt.md">Português</a> | <a href="README_ru.md">Русский</a> | <a href="README_ar.md">العربية</a> | <a href="README_hi.md">हिन्दी</a> | <a href="README_it.md">Italiano</a> | <a href="README_tr.md">Türkçe</a> | <a href="README_vi.md">Tiếng Việt</a> | <a href="README_th.md">ภาษาไทย</a> | <a href="README_id.md">Bahasa Indonesia</a> | <a href="README_pl.md">Polski</a> | <a href="README_nl.md">Nederlands</a>
</p>

<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" width="128" height="128" alt="OpenTypeless Logo" />
</p>

<h1 align="center">OpenTypeless</h1>

<p align="center">
  Open-Source-KI-Spracheingabe für den Desktop. Sprechen Sie natürlich, erhalten Sie polierten Text in jeder Anwendung.
</p>

<p align="center">
  Ob Sie E-Mails schreiben, programmieren, chatten oder Notizen machen — drücken Sie einfach einen Hotkey,<br/>
  sprechen Sie Ihre Gedanken aus, und OpenTypeless transkribiert und verfeinert Ihre Worte mit KI,<br/>
  und tippt sie direkt in die Anwendung ein, die Sie gerade verwenden.
</p>

<p align="center">
  <a href="https://github.com/tover0314-w/opentypeless/actions/workflows/ci.yml"><img src="https://github.com/tover0314-w/opentypeless/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/tover0314-w/opentypeless/releases"><img src="https://img.shields.io/github/v/release/tover0314-w/opentypeless?color=2ABBA7" alt="Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/tover0314-w/opentypeless" alt="Lizenz" /></a>
  <a href="https://github.com/tover0314-w/opentypeless/stargazers"><img src="https://img.shields.io/github/stars/tover0314-w/opentypeless?style=social" alt="Sterne" /></a>
  <a href="https://discord.gg/V6rRpJ4RGD"><img src="https://img.shields.io/badge/Discord-Join%20us-5865F2?logo=discord&logoColor=white" alt="Discord" /></a>
</p>

<p align="center">
  <img src="docs/images/voice-flow-demo.gif" width="720" alt="OpenTypeless Demo" />
</p>

<details>
<summary>Weitere Screenshots</summary>

<p align="center">
  <img src="docs/images/app-main-light.png" width="720" alt="OpenTypeless Hauptfenster" />
</p>

| Einstellungen | Verlauf |
|---|---|
| <img src="docs/images/app-settings.png" width="360" /> | <img src="docs/images/app-history.png" width="360" /> |

</details>

---

## Warum OpenTypeless?

| | OpenTypeless | macOS Diktat | Windows-Spracheingabe | Whisper Desktop |
|---|---|---|---|---|
| KI-Textverfeinerung | ✅ Mehrere LLMs | ❌ | ❌ | ❌ |
| STT-Anbieterauswahl | ✅ 6+ Anbieter | ❌ Nur Apple | ❌ Nur Microsoft | ❌ Nur Whisper |
| Funktioniert in jeder App | ✅ | ✅ | ✅ | ❌ Kopieren-Einfügen |
| Übersetzungsmodus | ✅ | ❌ | ❌ | ❌ |
| Open Source | ✅ MIT | ❌ | ❌ | ✅ |
| Plattformübergreifend | ✅ Win/Mac/Linux | ❌ Nur Mac | ❌ Nur Windows | ✅ |
| Benutzerwörterbuch | ✅ | ❌ | ❌ | ❌ |
| Selbst hostbar | ✅ BYOK | ❌ | ❌ | ✅ |

## Funktionen

- 🎙️ Globaler Hotkey — Halten zum Aufnehmen oder Umschalten
- 💊 Schwebendes Kapsel-Widget, immer im Vordergrund
- 🗣️ 6+ STT-Anbieter: Deepgram, AssemblyAI, Whisper, Groq, GLM-ASR, SiliconFlow
- 🤖 Textverfeinerung über mehrere LLMs: OpenAI, DeepSeek, Claude, Gemini, Ollama u.a.
- ⚡ Streaming-Ausgabe — Text erscheint während der Generierung
- ⌨️ Tastatur-Simulation oder Zwischenablage-Ausgabe
- 📝 Text markieren vor der Aufnahme als Kontext für das LLM
- 🌐 Übersetzungsmodus: in einer Sprache sprechen, in einer anderen ausgeben (20+ Sprachen)
- 📖 Benutzerwörterbuch für Fachbegriffe
- 🔍 App-Erkennung zur Anpassung der Formatierung
- 📜 Lokaler Verlauf mit Volltextsuche
- 🌗 Dunkles / Helles / System-Theme
- 🚀 Autostart bei Anmeldung

> [!TIP]
> **Empfohlene Konfiguration für das beste Erlebnis**
>
> | | Anbieter | Modell |
> |---|---|---|
> | 🗣️ STT | Groq | `whisper-large-v3-turbo` |
> | 🤖 KI-Verfeinerung | Google | `gemini-2.5-flash` |
>
> Diese Kombination bietet schnelle, präzise Transkription mit hochwertiger Textverfeinerung — und beide bieten großzügige kostenlose Kontingente.

## Herunterladen

Laden Sie die neueste Version für Ihre Plattform herunter:

**[Von Releases herunterladen](https://github.com/tover0314-w/opentypeless/releases)**

| Plattform | Datei |
|-----------|-------|
| Windows | `.msi`-Installer |
| macOS (Apple Silicon) | `.dmg` |
| macOS (Intel) | `.dmg` |
| Linux | `.AppImage` / `.deb` |

## Voraussetzungen

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://rustup.rs/) (Stable-Toolchain)
- Plattformspezifische Abhängigkeiten für Tauri: siehe [Tauri-Voraussetzungen](https://v2.tauri.app/start/prerequisites/)

## Erste Schritte

```bash
# Abhängigkeiten installieren
npm install

# Im Entwicklungsmodus ausführen
npm run tauri dev

# Für Produktion kompilieren
npm run tauri build
```

Die erstellte Anwendung befindet sich in `src-tauri/target/release/bundle/`.

## Konfiguration

Alle Einstellungen sind über das Einstellungsfenster in der App zugänglich:

- **Spracherkennung** — STT-Anbieter auswählen und API-Schlüssel eingeben
- **KI-Verfeinerung** — LLM-Anbieter, Modell und API-Schlüssel auswählen
- **Allgemein** — Hotkey, Ausgabemodus, Theme, Autostart
- **Wörterbuch** — Benutzerdefinierte Begriffe für bessere Transkriptionsgenauigkeit hinzufügen
- **Szenen** — Prompt-Vorlagen für verschiedene Anwendungsfälle

API-Schlüssel werden lokal über `tauri-plugin-store` gespeichert. Es werden keine Schlüssel an OpenTypeless-Server gesendet — alle STT/LLM-Anfragen gehen direkt an den von Ihnen konfigurierten Anbieter.

### Cloud (Pro) Option

OpenTypeless bietet auch ein optionales Pro-Abonnement an, das verwaltetes STT- und LLM-Kontingent bereitstellt, sodass Sie keine eigenen API-Schlüssel benötigen. Dies ist vollständig optional — die App ist mit Ihren eigenen Schlüsseln voll funktionsfähig.

[Mehr über Pro erfahren](https://www.opentypeless.com)

### BYOK (Bring Your Own Key) vs Cloud

| | BYOK-Modus | Cloud (Pro) Modus |
|---|---|---|
| STT | Eigener API-Schlüssel (Deepgram, AssemblyAI usw.) | Verwaltetes Kontingent (10 Std./Monat) |
| LLM | Eigener API-Schlüssel (OpenAI, DeepSeek usw.) | Verwaltetes Kontingent (~5M Token/Monat) |
| Cloud-Abhängigkeit | Keine — alle Anfragen gehen direkt an Ihren Anbieter | Erfordert Verbindung zu www.opentypeless.com |
| Kosten | Direkte Bezahlung an Ihren Anbieter | 4,99 $/Monat Abonnement |

Alle Kernfunktionen — Aufnahme, Transkription, KI-Verfeinerung, Tastatur-/Zwischenablage-Ausgabe, Wörterbuch, Verlauf — funktionieren im BYOK-Modus vollständig ohne OpenTypeless-Server.

### Selbst hosten / Ohne Cloud

Um OpenTypeless ohne jegliche Cloud-Abhängigkeit zu betreiben:

1. Wählen Sie in den Einstellungen einen beliebigen Nicht-Cloud-STT- und LLM-Anbieter
2. Geben Sie Ihre eigenen API-Schlüssel ein
3. Das war's — kein Konto oder Internetverbindung zu opentypeless.com erforderlich

Wenn Sie die optionalen Cloud-Funktionen auf Ihr eigenes Backend umleiten möchten, setzen Sie diese Umgebungsvariablen vor dem Kompilieren:

| Variable | Standard | Beschreibung |
|---|---|---|
| `VITE_API_BASE_URL` | `https://www.opentypeless.com` | Frontend-Cloud-API-Basis-URL |
| `API_BASE_URL` | `https://www.opentypeless.com` | Rust-Backend-Cloud-API-Basis-URL |

```bash
# Beispiel: Kompilieren mit eigenem Backend
VITE_API_BASE_URL=https://my-server.example.com API_BASE_URL=https://my-server.example.com npm run tauri build
```

## Architektur

**Datenfluss-Pipeline:**

```
Mikrofon → Audioaufnahme → STT-Anbieter → Rohtranskript → LLM-Verfeinerung → Tastatur-/Zwischenablage-Ausgabe
```

```
src/                  # React-Frontend (TypeScript)
├── components/       # UI-Komponenten (Einstellungen, Verlauf, Kapsel usw.)
├── hooks/            # React-Hooks (Aufnahme, Theme, Tauri-Events)
├── lib/              # Hilfsfunktionen (API-Client, Router, Konstanten)
└── stores/           # Zustand-Zustandsverwaltung

src-tauri/src/        # Rust-Backend
├── audio/            # Audioaufnahme über cpal
├── stt/              # STT-Anbieter (Deepgram, AssemblyAI, Whisper-kompatibel, Cloud)
├── llm/              # LLM-Anbieter (OpenAI-kompatibel, Cloud)
├── output/           # Textausgabe (Tastatursimulation, Zwischenablage-Einfügen)
├── storage/          # Konfiguration (tauri-plugin-store) + Verlauf/Wörterbuch (SQLite)
├── app_detector/     # Aktive Anwendung für Kontext erkennen
├── pipeline.rs       # Aufnahme → STT → LLM → Ausgabe-Orchestrierung
└── lib.rs            # Tauri-App-Setup, Befehle, Hotkey-Behandlung
```

## Roadmap

- [ ] Plugin-System für benutzerdefinierte STT/LLM-Integrationen
- [ ] Verbesserte mehrsprachige STT-Genauigkeit und Dialektunterstützung
- [ ] Sprachbefehle
- [ ] Anpassbare Hotkey-Kombinationen
- [ ] Verbesserte Onboarding-Erfahrung
- [ ] Mobile Begleit-App

## FAQ

**Wird mein Audio in die Cloud gesendet?**
Im BYOK-Modus wird Audio direkt an Ihren gewählten STT-Anbieter gesendet (z.B. Groq, Deepgram). Nichts passiert die OpenTypeless-Server. Im Cloud (Pro) Modus wird Audio an unseren verwalteten Proxy zur Transkription gesendet.

**Kann ich es offline nutzen?**
Mit einem lokalen STT-Anbieter (Whisper über Ollama) und einem lokalen LLM (Ollama) funktioniert die App vollständig offline. Keine Internetverbindung erforderlich.

**Welche Sprachen werden unterstützt?**
STT unterstützt je nach Anbieter über 99 Sprachen. KI-Verfeinerung und Übersetzung unterstützen über 20 Zielsprachen.

**Ist die App kostenlos?**
Ja. Die App ist mit Ihren eigenen API-Schlüsseln (BYOK) voll funktionsfähig. Das Cloud Pro-Abonnement (4,99 $/Monat) ist optional.

## Community

- 💬 [Discord](https://discord.gg/V6rRpJ4RGD) — Austausch, Hilfe, Feedback
- 🗣️ [GitHub Discussions](https://github.com/tover0314-w/opentypeless/discussions) — Feature-Vorschläge, Fragen & Antworten
- 🐛 [Issue Tracker](https://github.com/tover0314-w/opentypeless/issues) — Fehlerberichte und Feature-Anfragen
- 📖 [Beitragsrichtlinien](CONTRIBUTING.md) — Entwicklungseinrichtung und Richtlinien
- 🔒 [Sicherheitsrichtlinie](SECURITY.md) — Schwachstellen verantwortungsvoll melden
- 🧭 [Vision](VISION.md) — Projektprinzipien und Roadmap-Richtung

## Mitwirken

Beiträge sind willkommen! Siehe [CONTRIBUTING.md](CONTRIBUTING.md) für die Entwicklungseinrichtung und Richtlinien.

Sie suchen einen Einstieg? Schauen Sie sich Issues mit dem Label [`good first issue`](https://github.com/tover0314-w/opentypeless/labels/good%20first%20issue) an.

## Star-Verlauf

<a href="https://star-history.com/#tover0314-w/opentypeless&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=tover0314-w/opentypeless&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=tover0314-w/opentypeless&type=Date" />
    <img alt="Star-Verlauf-Diagramm" src="https://api.star-history.com/svg?repos=tover0314-w/opentypeless&type=Date" />
  </picture>
</a>

## Mit Claude Code an einem Tag entwickelt

Dieses gesamte Projekt wurde an einem einzigen Tag mit [Claude Code](https://claude.com/claude-code) erstellt — vom Architekturdesign bis zur vollständigen Implementierung, einschließlich Tauri-Backend, React-Frontend, CI/CD-Pipeline und dieser README.

## Lizenz

[MIT](LICENSE)
