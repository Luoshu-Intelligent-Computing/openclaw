# MeetAI Extension for OpenClaw

会议音频处理扩展，提供 OpenClaw 没有的差异化能力。

## 架构

**纯 TypeScript 实现**，不依赖 MeetAI Rust 服务：
- ASR 转写：调用外部 ASR HTTP 服务
- 文本处理：使用 OpenClaw 配置的 LLM
- 图表渲染：可选的 Markmap/Mermaid 渲染服务

## 提供的工具

| 工具 | 功能 | 输出 |
|------|------|------|
| `meeting_transcribe` | 音频转写（ASR + LLM 文本优化） | `transcript.md` |
| `meeting_summarize` | 会议纪要生成（LLM） | `summary.md` |
| `meeting_mindmap` | 思维导图生成（LLM + 可选渲染） | `mindmap.md` + PNG |
| `meeting_diagram` | 流程图/时序图生成（LLM + 可选渲染） | `diagram.md` + PNG |

## 配置

在 `~/.openclaw/openclaw.json` 中添加：

```json
{
  "extensions": {
    "meetai": {
      "enabled": true,
      "outputDir": "~/.openclaw/workspace/meetings",
      "asr": {
        "serviceUrl": "http://127.0.0.1:18001"
      },
      "renderer": {
        "markmapUrl": "http://localhost:3000",
        "mermaidUrl": "http://localhost:3001"
      }
    }
  }
}
```

## 使用示例

```bash
# 通过 OpenClaw 调用
openclaw agent --message "转写这个会议录音 /path/to/meeting.wav"
openclaw agent --message "生成会议纪要"
openclaw agent --message "画一个用户登录流程图"
```

## 目录结构

```
extensions/meetai/
├── index.ts              # 插件入口
├── package.json          # 依赖声明
├── openclaw.plugin.json  # 插件元数据
└── src/
    ├── asr-client.ts      # ASR HTTP 客户端
    ├── renderer-client.ts # 渲染服务客户端
    └── tools.ts           # 工具定义
```

## 外部服务依赖

| 服务 | 用途 | 必需 |
|------|------|------|
| ASR HTTP 服务 | 音频转写 | 是（使用 transcribe 工具时） |
| Markmap 渲染服务 | 思维导图 PNG | 否（无服务时只输出 Markdown） |
| Mermaid 渲染服务 | 流程图 PNG | 否（无服务时只输出 Markdown） |

## 故障排查

1. **工具未注册**: 检查 `openclaw config get extensions.meetai.enabled`
2. **ASR 连接失败**: 确认 ASR 服务运行在配置的地址
3. **图片未生成**: 渲染服务不可用，只会输出 Markdown

## 许可证

MIT
