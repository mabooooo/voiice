<p align="center">
  <a href="README.md">English</a> | <a href="README_zh.md">中文</a> | <a href="README_ja.md">日本語</a> | <a href="README_ko.md">한국어</a> | <a href="README_es.md">Español</a> | <a href="README_fr.md">Français</a> | <a href="README_de.md">Deutsch</a> | <a href="README_pt.md">Português</a> | <a href="README_ru.md">Русский</a> | <a href="README_ar.md">العربية</a> | <a href="README_hi.md">हिन्दी</a> | <a href="README_it.md">Italiano</a> | <a href="README_tr.md">Türkçe</a> | <strong>Tiếng Việt</strong> | <a href="README_th.md">ภาษาไทย</a> | <a href="README_id.md">Bahasa Indonesia</a> | <a href="README_pl.md">Polski</a> | <a href="README_nl.md">Nederlands</a>
</p>

<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" width="128" height="128" alt="Logo OpenTypeless" />
</p>

<h1 align="center">OpenTypeless</h1>

<p align="center">
  Nhập liệu bằng giọng nói AI mã nguồn mở cho máy tính. Nói tự nhiên, nhận văn bản hoàn chỉnh trong mọi ứng dụng.
</p>

<p align="center">
  Dù bạn đang viết email, lập trình, trò chuyện hay ghi chú — chỉ cần nhấn phím tắt,<br/>
  nói những gì bạn nghĩ, và OpenTypeless sẽ chuyển đổi và chỉnh sửa lời nói của bạn bằng AI,<br/>
  sau đó gõ trực tiếp vào ứng dụng bạn đang sử dụng.
</p>

<p align="center">
  <a href="https://github.com/tover0314-w/opentypeless/actions/workflows/ci.yml"><img src="https://github.com/tover0314-w/opentypeless/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/tover0314-w/opentypeless/releases"><img src="https://img.shields.io/github/v/release/tover0314-w/opentypeless?color=2ABBA7" alt="Phiên bản" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/tover0314-w/opentypeless" alt="Giấy phép" /></a>
  <a href="https://github.com/tover0314-w/opentypeless/stargazers"><img src="https://img.shields.io/github/stars/tover0314-w/opentypeless?style=social" alt="Sao" /></a>
  <a href="https://discord.gg/V6rRpJ4RGD"><img src="https://img.shields.io/badge/Discord-Tham%20gia-5865F2?logo=discord&logoColor=white" alt="Discord" /></a>
</p>

<p align="center">
  <img src="docs/images/voice-flow-demo.gif" width="720" alt="Demo OpenTypeless" />
</p>

<details>
<summary>Xem thêm ảnh chụp màn hình</summary>

<p align="center">
  <img src="docs/images/app-main-light.png" width="720" alt="Cửa sổ chính OpenTypeless" />
</p>

| Cài đặt | Lịch sử |
|---|---|
| <img src="docs/images/app-settings.png" width="360" /> | <img src="docs/images/app-history.png" width="360" /> |

</details>

---

## Tại sao chọn OpenTypeless?

| | OpenTypeless | macOS Dictation | Windows Voice Typing | Whisper Desktop |
|---|---|---|---|---|
| Chỉnh sửa văn bản bằng AI | ✅ Nhiều LLM | ❌ | ❌ | ❌ |
| Lựa chọn nhà cung cấp STT | ✅ 6+ nhà cung cấp | ❌ Chỉ Apple | ❌ Chỉ Microsoft | ❌ Chỉ Whisper |
| Hoạt động trong mọi ứng dụng | ✅ | ✅ | ✅ | ❌ Sao chép-dán |
| Chế độ dịch thuật | ✅ | ❌ | ❌ | ❌ |
| Mã nguồn mở | ✅ MIT | ❌ | ❌ | ✅ |
| Đa nền tảng | ✅ Win/Mac/Linux | ❌ Chỉ Mac | ❌ Chỉ Windows | ✅ |
| Từ điển tùy chỉnh | ✅ | ❌ | ❌ | ❌ |
| Tự lưu trữ | ✅ BYOK | ❌ | ❌ | ✅ |

## Tính năng

- 🎙️ Phím tắt ghi âm toàn cục — giữ để ghi hoặc chế độ bật/tắt
- 💊 Widget viên nang nổi luôn ở trên cùng
- 🗣️ 6+ nhà cung cấp STT: Deepgram, AssemblyAI, Whisper, Groq, GLM-ASR, SiliconFlow
- 🤖 Chỉnh sửa văn bản qua nhiều LLM: OpenAI, DeepSeek, Claude, Gemini, Ollama, và nhiều hơn nữa
- ⚡ Xuất trực tuyến — văn bản hiển thị khi LLM đang tạo
- ⌨️ Mô phỏng bàn phím hoặc xuất qua clipboard
- 📝 Bôi đen văn bản trước khi ghi âm để cung cấp ngữ cảnh cho LLM
- 🌐 Chế độ dịch thuật: nói bằng một ngôn ngữ, xuất ra ngôn ngữ khác (20+ ngôn ngữ)
- 📖 Từ điển tùy chỉnh cho các thuật ngữ chuyên ngành
- 🔍 Nhận diện ứng dụng để điều chỉnh định dạng
- 📜 Lịch sử cục bộ với tìm kiếm toàn văn
- 🌗 Giao diện tối / sáng / theo hệ thống
- 🚀 Tự khởi động khi đăng nhập

> [!TIP]
> **Cấu hình khuyến nghị để có trải nghiệm tốt nhất**
>
> | | Nhà cung cấp | Model |
> |---|---|---|
> | 🗣️ STT | Groq | `whisper-large-v3-turbo` |
> | 🤖 AI Polish | Google | `gemini-2.5-flash` |
>
> Sự kết hợp này mang lại khả năng chuyển đổi giọng nói nhanh, chính xác với chất lượng chỉnh sửa văn bản cao — và cả hai đều cung cấp gói miễn phí hào phóng.

## Tải xuống

Tải phiên bản mới nhất cho nền tảng của bạn:

**[Tải từ Releases](https://github.com/tover0314-w/opentypeless/releases)**

| Nền tảng | Tệp |
|----------|------|
| Windows | Trình cài đặt `.msi` |
| macOS (Apple Silicon) | `.dmg` |
| macOS (Intel) | `.dmg` |
| Linux | `.AppImage` / `.deb` |

## Yêu cầu hệ thống

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://rustup.rs/) (stable toolchain)
- Các phụ thuộc theo nền tảng cho Tauri: xem [Yêu cầu Tauri](https://v2.tauri.app/start/prerequisites/)

## Bắt đầu

```bash
# Cài đặt các phụ thuộc
npm install

# Chạy ở chế độ phát triển
npm run tauri dev

# Build cho production
npm run tauri build
```

Ứng dụng đã build sẽ nằm trong `src-tauri/target/release/bundle/`.

## Cấu hình

Tất cả cài đặt đều có thể truy cập từ bảng Cài đặt trong ứng dụng:

- **Nhận dạng giọng nói** — chọn nhà cung cấp STT và nhập API key của bạn
- **AI Polish** — chọn nhà cung cấp LLM, model và API key
- **Chung** — phím tắt, chế độ xuất, giao diện, tự khởi động
- **Từ điển** — thêm thuật ngữ tùy chỉnh để cải thiện độ chính xác
- **Kịch bản** — mẫu prompt cho các trường hợp sử dụng khác nhau

API key được lưu trữ cục bộ qua `tauri-plugin-store`. Không có key nào được gửi đến máy chủ OpenTypeless — tất cả yêu cầu STT/LLM đều đi trực tiếp đến nhà cung cấp bạn cấu hình.

### Tùy chọn Cloud (Pro)

OpenTypeless cũng cung cấp gói đăng ký Pro tùy chọn với hạn ngạch STT và LLM được quản lý để bạn không cần API key riêng. Điều này hoàn toàn tùy chọn — ứng dụng hoạt động đầy đủ với key của riêng bạn.

[Tìm hiểu thêm về Pro](https://www.opentypeless.com)

### BYOK (Mang Key Riêng) so với Cloud

| | Chế độ BYOK | Chế độ Cloud (Pro) |
|---|---|---|
| STT | API key của bạn (Deepgram, AssemblyAI, v.v.) | Hạn ngạch được quản lý (10 giờ/tháng) |
| LLM | API key của bạn (OpenAI, DeepSeek, v.v.) | Hạn ngạch được quản lý (~5M token/tháng) |
| Phụ thuộc cloud | Không — tất cả yêu cầu đi trực tiếp đến nhà cung cấp của bạn | Cần kết nối đến www.opentypeless.com |
| Chi phí | Thanh toán trực tiếp cho nhà cung cấp | Đăng ký $4.99/tháng |

Tất cả tính năng cốt lõi — ghi âm, chuyển đổi giọng nói, AI polish, xuất bàn phím/clipboard, từ điển, lịch sử — hoạt động hoàn toàn độc lập với máy chủ OpenTypeless trong chế độ BYOK.

### Tự lưu trữ / Không Cloud

Để chạy OpenTypeless mà không phụ thuộc cloud:

1. Chọn bất kỳ nhà cung cấp STT và LLM không phải Cloud nào trong Cài đặt
2. Nhập API key của riêng bạn
3. Vậy là xong — không cần tài khoản hay kết nối internet đến www.opentypeless.com

Nếu bạn muốn chuyển hướng các tính năng cloud tùy chọn đến backend riêng, đặt các biến môi trường sau trước khi build:

| Biến | Mặc định | Mô tả |
|---|---|---|
| `VITE_API_BASE_URL` | `https://www.opentypeless.com` | URL cơ sở API cloud cho frontend |
| `API_BASE_URL` | `https://www.opentypeless.com` | URL cơ sở API cloud cho Rust backend |

```bash
# Ví dụ: build với backend tùy chỉnh
VITE_API_BASE_URL=https://my-server.example.com API_BASE_URL=https://my-server.example.com npm run tauri build
```

## Kiến trúc

**Luồng dữ liệu:**

```
Microphone → Thu âm → Nhà cung cấp STT → Bản ghi thô → LLM Polish → Xuất Bàn phím/Clipboard
```

```
src/                  # React frontend (TypeScript)
├── components/       # Các thành phần UI (Cài đặt, Lịch sử, Capsule, v.v.)
├── hooks/            # React hooks (ghi âm, giao diện, sự kiện Tauri)
├── lib/              # Tiện ích (API client, router, hằng số)
└── stores/           # Quản lý trạng thái Zustand

src-tauri/src/        # Rust backend
├── audio/            # Thu âm qua cpal
├── stt/              # Nhà cung cấp STT (Deepgram, AssemblyAI, tương thích Whisper, Cloud)
├── llm/              # Nhà cung cấp LLM (tương thích OpenAI, Cloud)
├── output/           # Xuất văn bản (mô phỏng bàn phím, dán clipboard)
├── storage/          # Cấu hình (tauri-plugin-store) + lịch sử/từ điển (SQLite)
├── app_detector/     # Nhận diện ứng dụng đang hoạt động
├── pipeline.rs       # Điều phối Ghi âm → STT → LLM → Xuất
└── lib.rs            # Thiết lập ứng dụng Tauri, lệnh, xử lý phím tắt
```

## Lộ trình

- [ ] Hệ thống plugin cho tích hợp STT/LLM tùy chỉnh
- [ ] Cải thiện độ chính xác STT đa ngôn ngữ và hỗ trợ phương ngữ
- [ ] Lệnh giọng nói (ví dụ: "xóa câu cuối")
- [ ] Tùy chỉnh tổ hợp phím tắt
- [ ] Cải thiện trải nghiệm hướng dẫn ban đầu
- [ ] Ứng dụng đồng hành trên di động

## Câu hỏi thường gặp

**Âm thanh của tôi có được gửi lên cloud không?**
Trong chế độ BYOK, âm thanh đi trực tiếp đến nhà cung cấp STT bạn chọn (ví dụ: Groq, Deepgram). Không có dữ liệu nào đi qua máy chủ OpenTypeless. Trong chế độ Cloud (Pro), âm thanh được gửi đến proxy quản lý của chúng tôi để chuyển đổi.

**Tôi có thể sử dụng offline không?**
Với nhà cung cấp STT cục bộ (Whisper qua Ollama) và LLM cục bộ (Ollama), ứng dụng hoạt động hoàn toàn offline. Không cần kết nối internet.

**Những ngôn ngữ nào được hỗ trợ?**
STT hỗ trợ 99+ ngôn ngữ tùy thuộc vào nhà cung cấp. AI polish và dịch thuật hỗ trợ 20+ ngôn ngữ đích.

**Ứng dụng có miễn phí không?**
Có. Ứng dụng hoạt động đầy đủ với API key của riêng bạn (BYOK). Gói đăng ký Cloud Pro ($4.99/tháng) là tùy chọn.

## Cộng đồng

- 💬 [Discord](https://discord.gg/V6rRpJ4RGD) — Trò chuyện, nhận hỗ trợ, chia sẻ phản hồi
- 🗣️ [GitHub Discussions](https://github.com/tover0314-w/opentypeless/discussions) — Đề xuất tính năng, Hỏi & Đáp
- 🐛 [Issue Tracker](https://github.com/tover0314-w/opentypeless/issues) — Báo lỗi và yêu cầu tính năng
- 📖 [Hướng dẫn đóng góp](CONTRIBUTING.md) — Thiết lập phát triển và hướng dẫn
- 🔒 [Chính sách bảo mật](SECURITY.md) — Báo cáo lỗ hổng một cách có trách nhiệm
- 🧭 [Tầm nhìn](VISION.md) — Nguyên tắc dự án và hướng đi lộ trình

## Đóng góp

Chúng tôi hoan nghênh mọi đóng góp! Xem [CONTRIBUTING.md](CONTRIBUTING.md) để biết hướng dẫn thiết lập phát triển.

Đang tìm điểm bắt đầu? Hãy xem các issue được gắn nhãn [`good first issue`](https://github.com/tover0314-w/opentypeless/labels/good%20first%20issue).

## Lịch sử Star

<a href="https://star-history.com/#tover0314-w/opentypeless&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=tover0314-w/opentypeless&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=tover0314-w/opentypeless&type=Date" />
    <img alt="Biểu đồ lịch sử Star" src="https://api.star-history.com/svg?repos=tover0314-w/opentypeless&type=Date" />
  </picture>
</a>

## Xây dựng với Claude Code

Toàn bộ dự án này được xây dựng trong một ngày duy nhất bằng [Claude Code](https://claude.com/claude-code) — từ thiết kế kiến trúc đến triển khai đầy đủ, bao gồm Tauri backend, React frontend, CI/CD pipeline, và file README này.

## Giấy phép

[MIT](LICENSE)
