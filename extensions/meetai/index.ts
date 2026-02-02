/**
 * MeetAI Extension for OpenClaw (纯 TypeScript 实现)
 *
 * 轻量级集成方案：只引入 OpenClaw 没有的差异化能力
 * - ASR 语音转写（调用外部 ASR 服务）
 * - 会议纪要生成（使用 OpenClaw LLM）
 * - 思维导图生成（使用 OpenClaw LLM + 可选渲染服务）
 * - 流程图生成（使用 OpenClaw LLM + 可选渲染服务）
 *
 * 设计原则：
 * 1. 不依赖 MeetAI Rust 服务，直接调用外部服务
 * 2. 使用 OpenClaw 原生 LLM 能力
 * 3. 输出统一为 Markdown 文件，可被 OpenClaw memory_search 索引
 */

import os from "node:os";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { createMeetAITools } from "./src/tools.js";
import type { AsrConfig } from "./src/asr-client.js";
import type { RendererConfig } from "./src/renderer-client.js";

export interface MeetAIConfig {
  /** 是否启用扩展，默认 true */
  enabled?: boolean;
  /** 输出目录（相对于 workspace），默认 ~/.openclaw/workspace/meetings/ */
  outputDir?: string;
  /** ASR 服务配置 */
  asr?: AsrConfig;
  /** 渲染服务配置（可选） */
  renderer?: RendererConfig;
}

const meetaiPlugin = {
  id: "meetai",
  name: "MeetAI",
  description: "会议音频处理：转写、纪要、思维导图、流程图（输出 Markdown）",
  kind: "tool",
  configSchema: emptyPluginConfigSchema(),

  register(api: OpenClawPluginApi) {
    const config = (api.getConfig?.() || {}) as MeetAIConfig;

    if (config.enabled === false) {
      api.log?.info?.("[MeetAI] 扩展已禁用");
      return;
    }

    // 默认配置
    const homeDir = process.env.HOME || process.env.USERPROFILE || "/tmp";
    const outputDir = config.outputDir || `${homeDir}/.openclaw/workspace/meetings`;
    const asrConfig: AsrConfig = {
      serviceUrl: config.asr?.serviceUrl || "http://127.0.0.1:18001",
      appid: config.asr?.appid,
      accessKeyId: config.asr?.accessKeyId,
      accessKeySecret: config.asr?.accessKeySecret,
    };
    const rendererConfig: RendererConfig | undefined = config.renderer || {
      markmapUrl: "http://localhost:3000",
      mermaidUrl: "http://localhost:3001",
    };

    api.log?.info?.(`[MeetAI] 注册工具，ASR: ${asrConfig.serviceUrl}, 输出目录: ${outputDir}`);

    // 注册所有 MeetAI 工具
    const tools = createMeetAITools({
      api,
      outputDir,
      asr: asrConfig,
      renderer: rendererConfig,
    });

    for (const tool of tools) {
      api.registerTool(() => tool, {
        optional: true, // 服务不可用时不阻塞 OpenClaw
      });
    }

    api.log?.info?.(`[MeetAI] 已注册 ${tools.length} 个工具`);
  },
};

export default meetaiPlugin;

