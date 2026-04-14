# Bridge / Windows Electron

这是一个独立的 Windows Electron 实验项目，目标是把语音输入转成安全的桌面白名单动作。

## 当前能力

- 使用 React renderer，并采用轻量的 shadcn 风格组件组织界面
- 选择本地音频文件进行测试
- 使用麦克风录音并导入测试
- 调用阿里云百炼北京节点 `qwen3-omni-flash` 做音频转写
- 在本地把转写文本匹配成白名单动作
- 执行 Windows 桌面动作
- 在开发者模式里执行多屏桌面截图，并可额外生成 `640P` 压缩截图落盘

## 安全边界

当前实现采用三段式：

1. 模型只负责把音频转成文本
2. 本地规则把文本匹配成白名单动作
3. Windows 执行层只接受白名单动作

这样后续你切到 Go / Rust 原生 agent 守护进程时，只需要替换执行层。

## 白名单动作

- `focus_front_window`
- `close_front_window`
- `type_text_to_focused_input`
- `open_app("WeChat")`
- `send_shortcut("cmd+w")`

## 高权限测试动作

以下动作只在界面里手动触发，不走语音匹配：

- `move_mouse_to_center`
- `left_click_current_position`

## 安装

```bash
cd exp/bridge
copy .env.example .env
npm install
```

在 `.env` 中填写：

```bash
DASHSCOPE_API_KEY=你的百炼Key
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen3-omni-flash

XIAOMI_MIMO_API_KEY=你的 Xiaomi Key
XIAOMI_MIMO_BASE_URL=https://api.xiaomimimo.com/v1
XIAOMI_MIMO_MODEL=mimo-v2-omni
```

如果切到 `Xiaomi MiMo` provider，请求 body 里需要额外带上：

```json
{
  "thinking": {
    "type": "disable"
  }
}
```

当前项目会把这组字段直接写到最终请求 body 根层，并继续统一传递 `enable_thinking: false`。

## 启动

```bash
npm run start
```

## 说明

- 流式模式用于观察首字延迟
- 非流式模式更适合短语音指令场景
- `cmd+w` 在 Windows 里会映射为 `Ctrl+W`
- 当前桌面控制通过 Electron 主进程调用 PowerShell 完成
- 桌面截图默认保存到 `exp/bridge/.runtime/desktop-captures`
- 当前界面为 React + Vite 构建产物，Electron 启动前会先构建 renderer
- 后续可以把 `src/windowsController.mjs` 替换为 Go / Rust 守护进程 RPC
