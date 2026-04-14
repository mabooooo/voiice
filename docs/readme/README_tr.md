<p align="center">
  <a href="README.md">English</a> | <a href="README_zh.md">中文</a> | <a href="README_ja.md">日本語</a> | <a href="README_ko.md">한국어</a> | <a href="README_es.md">Español</a> | <a href="README_fr.md">Français</a> | <a href="README_de.md">Deutsch</a> | <a href="README_pt.md">Português</a> | <a href="README_ru.md">Русский</a> | <a href="README_ar.md">العربية</a> | <a href="README_hi.md">हिन्दी</a> | <a href="README_it.md">Italiano</a> | <strong>Türkçe</strong> | <a href="README_vi.md">Tiếng Việt</a> | <a href="README_th.md">ภาษาไทย</a> | <a href="README_id.md">Bahasa Indonesia</a> | <a href="README_pl.md">Polski</a> | <a href="README_nl.md">Nederlands</a>
</p>

<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" width="128" height="128" alt="OpenTypeless Logo" />
</p>

<h1 align="center">OpenTypeless</h1>

<p align="center">
  Masaüstü için açık kaynaklı yapay zeka sesli giriş. Doğal konuşun, herhangi bir uygulamada cilalı metin elde edin.
</p>

<p align="center">
  E-posta yazıyor, kodlıyor, sohbet ediyor veya not alıyor olun — sadece bir kısayol tuşuna basın,<br/>
  düşüncelerinizi söyleyin, OpenTypeless sözlerinizi yapay zeka ile yazıya döker ve cilalandırır,<br/>
  ardından kullandığınız uygulamaya doğrudan yazar.
</p>

<p align="center">
  <a href="https://github.com/tover0314-w/opentypeless/actions/workflows/ci.yml"><img src="https://github.com/tover0314-w/opentypeless/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/tover0314-w/opentypeless/releases"><img src="https://img.shields.io/github/v/release/tover0314-w/opentypeless?color=2ABBA7" alt="Sürüm" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/tover0314-w/opentypeless" alt="Lisans" /></a>
  <a href="https://github.com/tover0314-w/opentypeless/stargazers"><img src="https://img.shields.io/github/stars/tover0314-w/opentypeless?style=social" alt="Yıldızlar" /></a>
  <a href="https://discord.gg/V6rRpJ4RGD"><img src="https://img.shields.io/badge/Discord-Join%20us-5865F2?logo=discord&logoColor=white" alt="Discord" /></a>
</p>

<p align="center">
  <img src="docs/images/voice-flow-demo.gif" width="720" alt="OpenTypeless Demo" />
</p>

<details>
<summary>Daha fazla ekran görüntüsü</summary>

<p align="center">
  <img src="docs/images/app-main-light.png" width="720" alt="OpenTypeless Ana Pencere" />
</p>

| Ayarlar | Geçmiş |
|---|---|
| <img src="docs/images/app-settings.png" width="360" /> | <img src="docs/images/app-history.png" width="360" /> |

</details>

---

## Neden OpenTypeless?

| | OpenTypeless | macOS Dikte | Windows Sesli Yazma | Whisper Desktop |
|---|---|---|---|---|
| Yapay zeka metin cilalama | ✅ Çoklu LLM | ❌ | ❌ | ❌ |
| STT sağlayıcı seçimi | ✅ 6+ sağlayıcı | ❌ Sadece Apple | ❌ Sadece Microsoft | ❌ Sadece Whisper |
| Her uygulamada çalışır | ✅ | ✅ | ✅ | ❌ Kopyala-yapıştır |
| Çeviri modu | ✅ | ❌ | ❌ | ❌ |
| Açık kaynak | ✅ MIT | ❌ | ❌ | ✅ |
| Çapraz platform | ✅ Win/Mac/Linux | ❌ Sadece Mac | ❌ Sadece Windows | ✅ |
| Özel sözlük | ✅ | ❌ | ❌ | ❌ |
| Kendi sunucusunda barındırma | ✅ BYOK | ❌ | ❌ | ✅ |

## Özellikler

- 🎙️ Global kısayol tuşu — basılı tut veya aç/kapat modu
- 💊 Her zaman üstte kalan yüzen kapsül widget
- 🗣️ 6+ STT sağlayıcı: Deepgram, AssemblyAI, Whisper, Groq, GLM-ASR, SiliconFlow
- 🤖 Çoklu LLM ile metin cilalama: OpenAI, DeepSeek, Claude, Gemini, Ollama ve daha fazlası
- ⚡ Akışlı çıktı — metin LLM üretirken görünür
- ⌨️ Klavye simülasyonu veya pano çıktısı
- 📝 Kayıttan önce metin seçerek LLM'ye bağlam sağlayın
- 🌐 Çeviri modu: bir dilde konuşun, başka bir dilde çıktı alın (20+ dil)
- 📖 Alan-özel terimler için özel sözlük
- 🔍 Uygulama algılama ile biçimlendirme uyarlama
- 📜 Tam metin aramalı yerel geçmiş
- 🌗 Koyu / açık / sistem teması
- 🚀 Oturum açmada otomatik başlatma

> [!TIP]
> **En İyi Deneyim İçin Önerilen Yapılandırma**
>
> | | Sağlayıcı | Model |
> |---|---|---|
> | 🗣️ STT | Groq | `whisper-large-v3-turbo` |
> | 🤖 AI Cilalama | Google | `gemini-2.5-flash` |
>
> Bu kombinasyon hızlı, doğru transkripsiyon ve yüksek kaliteli metin cilalama sunar — ve her ikisi de cömert ücretsiz katmanlar sunar.

## İndirme

Platformunuz için en son sürümü indirin:

**[Releases'dan İndirin](https://github.com/tover0314-w/opentypeless/releases)**

| Platform | Dosya |
|----------|-------|
| Windows | `.msi` yükleyici |
| macOS (Apple Silicon) | `.dmg` |
| macOS (Intel) | `.dmg` |
| Linux | `.AppImage` / `.deb` |

## Ön Koşullar

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://rustup.rs/) (stable araç zinciri)
- Tauri için platforma özgü bağımlılıklar: bkz. [Tauri Ön Koşulları](https://v2.tauri.app/start/prerequisites/)

## Başlarken

```bash
# Bağımlılıkları yükle
npm install

# Geliştirme modunda çalıştır
npm run tauri dev

# Üretim için derle
npm run tauri build
```

Derlenen uygulama `src-tauri/target/release/bundle/` dizininde olacaktır.

## Yapılandırma

Tüm ayarlara uygulama içi Ayarlar panelinden erişilebilir:

- **Konuşma Tanıma** — STT sağlayıcıyı seçin ve API anahtarınızı girin
- **AI Cilalama** — LLM sağlayıcı, model ve API anahtarı seçin
- **Genel** — kısayol tuşu, çıktı modu, tema, otomatik başlatma
- **Sözlük** — daha iyi transkripsiyon doğruluğu için özel terimler ekleyin
- **Sahneler** — farklı kullanım durumları için prompt şablonları

API anahtarları `tauri-plugin-store` aracılığıyla yerel olarak saklanır. Hiçbir anahtar OpenTypeless sunucularına gönderilmez — tüm STT/LLM istekleri doğrudan yapılandırdığınız sağlayıcıya gider.

### Cloud (Pro) Seçeneği

OpenTypeless ayrıca kendi API anahtarlarınıza ihtiyaç duymamanız için yönetilen STT ve LLM kotası sağlayan isteğe bağlı bir Pro aboneliği sunar. Bu tamamen isteğe bağlıdır — uygulama kendi anahtarlarınızla tam işlevseldir.

[Pro hakkında daha fazla bilgi](https://www.opentypeless.com)

### BYOK (Kendi Anahtarını Getir) vs Cloud

| | BYOK Modu | Cloud (Pro) Modu |
|---|---|---|
| STT | Kendi API anahtarınız (Deepgram, AssemblyAI, vb.) | Yönetilen kota (10 saat/ay) |
| LLM | Kendi API anahtarınız (OpenAI, DeepSeek, vb.) | Yönetilen kota (~5M token/ay) |
| Bulut bağımlılığı | Yok — tüm istekler doğrudan sağlayıcınıza gider | www.opentypeless.com bağlantısı gerekir |
| Maliyet | Sağlayıcınıza doğrudan ödeyin | $4,99/ay abonelik |

Tüm temel özellikler — kayıt, transkripsiyon, AI cilalama, klavye/pano çıktısı, sözlük, geçmiş — BYOK modunda OpenTypeless sunucularından tamamen bağımsız çalışır.

### Kendi Sunucunda Barındırma / Bulutsuz

OpenTypeless'ı bulut bağımlılığı olmadan çalıştırmak için:

1. Ayarlarda Cloud olmayan herhangi bir STT ve LLM sağlayıcı seçin
2. Kendi API anahtarlarınızı girin
3. Bu kadar — www.opentypeless.com'a hesap veya internet bağlantısı gerekmez

İsteğe bağlı bulut özelliklerini kendi arka ucunuza yönlendirmek istiyorsanız, derlemeden önce bu ortam değişkenlerini ayarlayın:

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `VITE_API_BASE_URL` | `https://www.opentypeless.com` | Ön uç bulut API temel URL'si |
| `API_BASE_URL` | `https://www.opentypeless.com` | Rust arka uç bulut API temel URL'si |

```bash
# Örnek: özel arka uçla derleme
VITE_API_BASE_URL=https://my-server.example.com API_BASE_URL=https://my-server.example.com npm run tauri build
```

## Mimari

**Veri Akışı Pipeline:**

```
Mikrofon → Ses Yakalama → STT Sağlayıcı → Ham Transkript → LLM Cilalama → Klavye/Pano Çıktısı
```

```
src/                  # React ön uç (TypeScript)
├── components/       # UI bileşenleri (Ayarlar, Geçmiş, Kapsül, vb.)
├── hooks/            # React hook'ları (kayıt, tema, Tauri olayları)
├── lib/              # Yardımcı araçlar (API istemcisi, yönlendirici, sabitler)
└── stores/           # Zustand durum yönetimi

src-tauri/src/        # Rust arka uç
├── audio/            # cpal ile ses yakalama
├── stt/              # STT sağlayıcılar (Deepgram, AssemblyAI, Whisper uyumlu, Cloud)
├── llm/              # LLM sağlayıcılar (OpenAI uyumlu, Cloud)
├── output/           # Metin çıktısı (klavye simülasyonu, pano yapıştırma)
├── storage/          # Yapılandırma (tauri-plugin-store) + geçmiş/sözlük (SQLite)
├── app_detector/     # Bağlam için aktif uygulama algılama
├── pipeline.rs       # Kayıt → STT → LLM → Çıktı orkestrasyonu
└── lib.rs            # Tauri uygulama kurulumu, komutlar, kısayol tuşu işleme
```

## Yol Haritası

- [ ] Özel STT/LLM entegrasyonları için eklenti sistemi
- [ ] Geliştirilmiş çok dilli STT doğruluğu ve lehçe desteği
- [ ] Sesli komutlar
- [ ] Özelleştirilebilir kısayol tuşu kombinasyonları
- [ ] Geliştirilmiş tanıtım deneyimi
- [ ] Mobil yardımcı uygulama

## SSS

**Sesim buluta gönderiliyor mu?**
BYOK modunda, ses doğrudan seçtiğiniz STT sağlayıcıya gider (ör. Groq, Deepgram). OpenTypeless sunucularından hiçbir şey geçmez. Cloud (Pro) modunda, ses transkripsiyon için yönetilen proxy'mize gönderilir.

**Çevrimdışı kullanabilir miyim?**
Yerel bir STT sağlayıcı (Ollama üzerinden Whisper) ve yerel bir LLM (Ollama) ile uygulama tamamen çevrimdışı çalışır. İnternet bağlantısı gerekmez.

**Hangi diller destekleniyor?**
STT, sağlayıcıya bağlı olarak 99+ dili destekler. AI cilalama ve çeviri 20+ hedef dili destekler.

**Uygulama ücretsiz mi?**
Evet. Uygulama kendi API anahtarlarınızla (BYOK) tam işlevseldir. Cloud Pro aboneliği ($4,99/ay) isteğe bağlıdır.

## Topluluk

- 💬 [Discord](https://discord.gg/V6rRpJ4RGD) — Sohbet, yardım, geri bildirim
- 🗣️ [GitHub Discussions](https://github.com/tover0314-w/opentypeless/discussions) — Özellik önerileri, soru-cevap
- 🐛 [Issue Tracker](https://github.com/tover0314-w/opentypeless/issues) — Hata raporları ve özellik istekleri
- 📖 [Katkı Rehberi](CONTRIBUTING.md) — Geliştirme kurulumu ve kurallar
- 🔒 [Güvenlik Politikası](SECURITY.md) — Güvenlik açıklarını sorumlu bir şekilde bildirin
- 🧭 [Vizyon](VISION.md) — Proje ilkeleri ve yol haritası yönü

## Katkıda Bulunma

Katkılar memnuniyetle karşılanır! Geliştirme kurulumu ve kurallar için [CONTRIBUTING.md](CONTRIBUTING.md) sayfasına bakın.

Nereden başlayacağınızı mı arıyorsunuz? [`good first issue`](https://github.com/tover0314-w/opentypeless/labels/good%20first%20issue) etiketli sorunlara göz atın.

## Star History

<a href="https://star-history.com/#tover0314-w/opentypeless&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=tover0314-w/opentypeless&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=tover0314-w/opentypeless&type=Date" />
    <img alt="Star History Grafiği" src="https://api.star-history.com/svg?repos=tover0314-w/opentypeless&type=Date" />
  </picture>
</a>

## Claude Code ile Bir Günde Geliştirildi

Bu projenin tamamı [Claude Code](https://claude.com/claude-code) kullanılarak tek bir günde oluşturuldu — mimari tasarımından tam uygulamaya kadar, Tauri arka uç, React ön uç, CI/CD pipeline ve bu README dahil.

## Lisans

[MIT](LICENSE)
