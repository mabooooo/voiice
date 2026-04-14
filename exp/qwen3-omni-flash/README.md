# Qwen3-Omni-Flash 实验

这个目录用于做独立实验，不接入主项目现有前端或 Rust 流程。

## 目的

- 使用 Node.js 验证阿里云百炼北京节点是否可用
- 以 `音频 + 文本提示词` 的方式调用 `qwen3-omni-flash`
- 让模型返回音频对应的文本内容

## 环境

- Node.js 20+
- 北京地域百炼 API Key

## 初始化

```bash
cd exp/qwen3-omni-flash
copy .env.example .env
npm install
```

在 `.env` 中填写：

```bash
DASHSCOPE_API_KEY=你的北京地域Key
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen3-omni-flash
```

## 运行

```bash
npm run start -- --audio ./sample.mp3 --prompt "请转写这段音频，并给出一句简短总结。"
```

如果只想拿音频文字内容，也可以直接：

```bash
npm run start -- --audio ./sample.mp3 --prompt "请只返回这段音频的逐字转写结果。"
```

## 说明

- 当前脚本默认 `modalities: ["text"]`，因此只取文本输出。
- 当前脚本显式关闭了思考模式，避免与音频理解场景冲突。
- 若后续你想测试语音输出，可以把请求改成 `modalities: ["text", "audio"]`，并补上 `audio` 参数。
