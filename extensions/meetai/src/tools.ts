/**
 * MeetAI 工具定义 (纯 TypeScript 实现)
 *
 * 不依赖 MeetAI Rust 服务，直接调用：
 * 1. ASR 外部服务 (HTTP)
 * 2. OpenClaw LLM (用于文本优化、纪要、思维导图、流程图)
 * 3. 渲染服务 (可选，用于生成图片)
 *
 * 工具列表：
 * 1. meeting_transcribe - 音频转写（ASR + LLM 文本优化）
 * 2. meeting_summarize - 会议纪要生成（LLM）
 * 3. meeting_mindmap - 思维导图生成（LLM + 可选渲染）
 * 4. meeting_diagram - 流程图/时序图生成（LLM + 可选渲染）
 */

import { Type } from "@sinclair/typebox";
import { jsonResult, type OpenClawPluginApi } from "openclaw/plugin-sdk";
import fs from "node:fs/promises";
import path from "node:path";
import { AsrClient, type AsrConfig } from "./asr-client.js";
import { RendererClient, type RendererConfig } from "./renderer-client.js";

export interface ToolsConfig {
  api: OpenClawPluginApi;
  outputDir: string;
  asr: AsrConfig;
  renderer?: RendererConfig;
}

/**
 * 确保输出目录存在
 */
async function ensureOutputDir(outputDir: string): Promise<string> {
  const fullPath = path.resolve(outputDir);
  await fs.mkdir(fullPath, { recursive: true });
  return fullPath;
}

/**
 * 生成输出文件名
 */
function generateOutputName(prefix: string, suffix: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const time = Date.now().toString(36);
  return `${date}_${prefix}_${time}${suffix}`;
}

/**
 * 保存 Markdown 文件
 */
async function saveMarkdown(outputDir: string, name: string, content: string): Promise<string> {
  const dir = await ensureOutputDir(outputDir);
  const filePath = path.join(dir, name.endsWith(".md") ? name : `${name}.md`);
  await fs.writeFile(filePath, content, "utf-8");
  return filePath;
}

export function createMeetAITools(config: ToolsConfig) {
  const { api, outputDir, asr, renderer } = config;
  const asrClient = new AsrClient(asr);
  const rendererClient = renderer ? new RendererClient(renderer) : null;

  return [
    // 工具 1: 音频转写
    {
      name: "meeting_transcribe",
      description: `将会议音频转写为文本。支持说话人分离。
输出：Markdown 格式的转写文本，保存到 ${outputDir}/ 目录，可被 OpenClaw memory_search 索引。`,
      parameters: Type.Object({
        audio_path: Type.String({
          description: "音频文件路径（支持 wav/mp3/m4a 格式）",
        }),
        optimize: Type.Optional(
          Type.Boolean({
            description: "是否使用 LLM 优化转写文本（默认 true）",
          }),
        ),
        output_name: Type.Optional(
          Type.String({
            description: "输出文件名（不含扩展名），默认使用音频文件名",
          }),
        ),
      }),
      execute: async (
        _toolCallId,
        input: { audio_path: string; optimize?: boolean; output_name?: string },
      ) => {
        try {
          // 1. ASR 转写
          const asrResult = await asrClient.transcribe(input.audio_path);
          let transcriptText = asrResult.text;

          // 2. 可选：LLM 优化文本
          if (input.optimize !== false && api.callLLM) {
            const optimizePrompt = `请优化以下会议转写文本，修正错别字、补充标点、使语句通顺，保持说话人标签格式（如 S0:、S1:）：

${transcriptText}

直接输出优化后的文本，不要添加额外说明。`;

            transcriptText = await api.callLLM({
              messages: [{ role: "user", content: optimizePrompt }],
            });
          }

          // 3. 生成 Markdown 内容
          const audioName = path.basename(input.audio_path, path.extname(input.audio_path));
          const outputName = input.output_name || generateOutputName(audioName, "_transcript.md");
          const markdownContent = `# 会议转写记录

**音频文件**: ${path.basename(input.audio_path)}
**转写时间**: ${new Date().toLocaleString("zh-CN")}
**订单ID**: ${asrResult.orderId || "N/A"}

---

${transcriptText}
`;

          // 4. 保存文件
          const outputPath = await saveMarkdown(outputDir, outputName, markdownContent);

          return jsonResult({
            status: "success",
            message: "转写完成",
            output_file: outputPath,
            order_id: asrResult.orderId,
            tip: "转写结果已保存为 Markdown，可使用 memory_search 检索内容",
          });
        } catch (error) {
          return jsonResult({
            status: "error",
            message: error instanceof Error ? error.message : "转写失败",
            tip: "请确保 ASR 服务已启动",
          });
        }
      },
    },

    // 工具 2: 会议纪要
    {
      name: "meeting_summarize",
      description: `从转写文本生成结构化会议纪要。
包含：会议概要、关键决策、待办事项（Action Items）、参会人员等。
输出：Markdown 格式，保存到 ${outputDir}/ 目录。`,
      parameters: Type.Object({
        source: Type.String({
          description: "转写文本文件路径（.md）或直接输入文本内容",
        }),
        output_name: Type.Optional(
          Type.String({
            description: "输出文件名（不含扩展名）",
          }),
        ),
      }),
      execute: async (_toolCallId, input: { source: string; output_name?: string }) => {
        try {
          // 1. 读取源内容
          let sourceContent: string;
          if (input.source.endsWith(".md") || input.source.includes("/")) {
            sourceContent = await fs.readFile(input.source, "utf-8");
          } else {
            sourceContent = input.source;
          }

          // 2. LLM 生成纪要
          if (!api.callLLM) {
            throw new Error("LLM 服务不可用");
          }

          const summaryPrompt = `请根据以下会议转写内容，生成一份专业的会议纪要。

要求：
1. **会议基本信息**：提取会议主题、参会人员等信息
2. **会议议题**：总结会议讨论的主要议题
3. **讨论要点**：按议题分类，总结每个议题的讨论内容
4. **决策事项**：明确列出会议中做出的决策
5. **待办事项**：列出需要后续跟进的任务，包括负责人（如果提到）
6. **使用 Markdown 格式**：使用标题、列表、表格等格式

会议转写内容：
---
${sourceContent}
---

请直接输出会议纪要，使用 Markdown 格式。`;

          const summary = await api.callLLM({
            messages: [{ role: "user", content: summaryPrompt }],
          });

          // 3. 保存文件
          const outputName = input.output_name || generateOutputName("meeting", "_summary.md");
          const outputPath = await saveMarkdown(outputDir, outputName, summary);

          return jsonResult({
            status: "success",
            message: "会议纪要生成完成",
            output_file: outputPath,
          });
        } catch (error) {
          return jsonResult({
            status: "error",
            message: error instanceof Error ? error.message : "纪要生成失败",
          });
        }
      },
    },

    // 工具 3: 思维导图
    {
      name: "meeting_mindmap",
      description: `从会议内容生成思维导图。
输出：Markdown 格式（Markmap 语法），保存到 ${outputDir}/ 目录。如果渲染服务可用，还会生成 PNG 图片。`,
      parameters: Type.Object({
        source: Type.String({
          description: "转写/纪要文本文件路径（.md）或直接输入文本内容",
        }),
        output_name: Type.Optional(
          Type.String({
            description: "输出文件名（不含扩展名）",
          }),
        ),
        render_image: Type.Optional(
          Type.Boolean({
            description: "是否渲染为图片（需要 Markmap 渲染服务，默认 true）",
          }),
        ),
      }),
      execute: async (
        _toolCallId,
        input: { source: string; output_name?: string; render_image?: boolean },
      ) => {
        try {
          // 1. 读取源内容
          let sourceContent: string;
          if (input.source.endsWith(".md") || input.source.includes("/")) {
            sourceContent = await fs.readFile(input.source, "utf-8");
          } else {
            sourceContent = input.source;
          }

          // 2. LLM 生成 Markmap 格式的 Markdown
          if (!api.callLLM) {
            throw new Error("LLM 服务不可用");
          }

          const mindmapPrompt = `请根据以下内容生成一个思维导图，使用 Markdown 格式（Markmap 语法）。

要求：
1. 使用 Markdown 标题层级（# ## ### ####）表示思维导图的层级结构
2. 每个节点简洁明了，不超过 10 个字
3. 层级不超过 4 层
4. 主题明确，分支合理
5. 只输出 Markdown 内容，不要添加代码块标记

内容：
---
${sourceContent}
---`;

          const mindmapMarkdown = await api.callLLM({
            messages: [{ role: "user", content: mindmapPrompt }],
          });

          // 3. 保存 Markdown 文件
          const outputName = input.output_name || generateOutputName("mindmap", ".md");
          const markdownPath = await saveMarkdown(outputDir, outputName, mindmapMarkdown);

          // 4. 可选：渲染为图片
          let imagePath: string | undefined;
          if (input.render_image !== false && rendererClient) {
            const renderResult = await rendererClient.renderMarkmap(mindmapMarkdown);
            if (renderResult.success && renderResult.imageData) {
              imagePath = markdownPath.replace(".md", ".png");
              await fs.writeFile(imagePath, renderResult.imageData);
            }
          }

          return jsonResult({
            status: "success",
            message: "思维导图生成完成",
            markdown_file: markdownPath,
            image_file: imagePath,
            tip: imagePath ? "已生成 Markdown 和 PNG 图片" : "已生成 Markdown（渲染服务不可用，未生成图片）",
          });
        } catch (error) {
          return jsonResult({
            status: "error",
            message: error instanceof Error ? error.message : "思维导图生成失败",
          });
        }
      },
    },

    // 工具 4: 流程图/时序图
    {
      name: "meeting_diagram",
      description: `根据描述生成流程图或时序图。
使用 Mermaid 语法，输出 Markdown，保存到 ${outputDir}/ 目录。如果渲染服务可用，还会生成 PNG 图片。`,
      parameters: Type.Object({
        description: Type.String({
          description: "图表描述（自然语言），例如：'用户登录流程' 或 '订单处理时序'",
        }),
        diagram_type: Type.Optional(
          Type.String({
            description: "图表类型：flowchart（流程图，默认）、sequence（时序图）、class（类图）",
          }),
        ),
        output_name: Type.Optional(
          Type.String({
            description: "输出文件名（不含扩展名）",
          }),
        ),
        render_image: Type.Optional(
          Type.Boolean({
            description: "是否渲染为图片（需要 Mermaid 渲染服务，默认 true）",
          }),
        ),
      }),
      execute: async (_toolCallId, input: {
        description: string;
        diagram_type?: string;
        output_name?: string;
        render_image?: boolean;
      }) => {
        try {
          // 1. LLM 生成 Mermaid 代码
          if (!api.callLLM) {
            throw new Error("LLM 服务不可用");
          }

          const diagramType = input.diagram_type || "flowchart";
          const diagramPrompt = `请根据以下描述生成一个 ${diagramType} 图表，使用 Mermaid 语法。

要求：
1. 只输出 Mermaid 代码，不要添加 \`\`\`mermaid 代码块标记
2. 节点文字简洁，不超过 15 个字
3. 使用合适的箭头和连接符
4. 布局清晰，逻辑正确

图表类型：${diagramType}
描述：${input.description}`;

          const mermaidCode = await api.callLLM({
            messages: [{ role: "user", content: diagramPrompt }],
          });

          // 2. 生成 Markdown 内容（包含 Mermaid 代码块）
          const markdownContent = `# ${input.description}

\`\`\`mermaid
${mermaidCode.trim()}
\`\`\`
`;

          // 3. 保存 Markdown 文件
          const outputName = input.output_name || generateOutputName("diagram", ".md");
          const markdownPath = await saveMarkdown(outputDir, outputName, markdownContent);

          // 4. 可选：渲染为图片
          let imagePath: string | undefined;
          if (input.render_image !== false && rendererClient) {
            const renderResult = await rendererClient.renderMermaid(mermaidCode.trim());
            if (renderResult.success && renderResult.imageData) {
              imagePath = markdownPath.replace(".md", ".png");
              await fs.writeFile(imagePath, renderResult.imageData);
            }
          }

          return jsonResult({
            status: "success",
            message: "图表生成完成",
            markdown_file: markdownPath,
            image_file: imagePath,
            tip: imagePath ? "已生成 Markdown 和 PNG 图片" : "已生成 Markdown（渲染服务不可用，未生成图片）",
          });
        } catch (error) {
          return jsonResult({
            status: "error",
            message: error instanceof Error ? error.message : "图表生成失败",
          });
        }
      },
    },
  ];
}
