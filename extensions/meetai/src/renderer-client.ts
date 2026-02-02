/**
 * 渲染服务客户端
 *
 * 调用外部渲染服务（Markmap/Mermaid），生成图片
 * 这些服务是可选的，如果不可用则只输出 Markdown
 */

export interface RendererConfig {
  markmapUrl?: string; // 默认: http://localhost:3000
  mermaidUrl?: string; // 默认: http://localhost:3001
}

export interface RenderOptions {
  width?: number;
  height?: number;
  format?: "png" | "svg" | "jpeg";
  theme?: string;
}

export interface RenderResult {
  success: boolean;
  imageData?: Buffer;
  error?: string;
}

export class RendererClient {
  private config: RendererConfig;

  constructor(config: RendererConfig = {}) {
    this.config = {
      markmapUrl: config.markmapUrl || "http://localhost:3000",
      mermaidUrl: config.mermaidUrl || "http://localhost:3001",
    };
  }

  /**
   * 检查渲染服务是否可用
   */
  async checkHealth(service: "markmap" | "mermaid"): Promise<boolean> {
    const url = service === "markmap" ? this.config.markmapUrl : this.config.mermaidUrl;
    try {
      const response = await fetch(`${url}/health`, { method: "GET" });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * 渲染思维导图 (Markmap)
   */
  async renderMarkmap(markdown: string, options: RenderOptions = {}): Promise<RenderResult> {
    const { width = 1920, height = 1080, format = "png" } = options;

    try {
      const response = await fetch(`${this.config.markmapUrl}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown, width, height, format }),
      });

      if (!response.ok) {
        const text = await response.text();
        return { success: false, error: `渲染失败: ${response.status} ${text}` };
      }

      const result = await response.json();
      if (result.image) {
        const imageData = Buffer.from(result.image, "base64");
        return { success: true, imageData };
      }

      return { success: false, error: "渲染结果为空" };
    } catch (error) {
      return { success: false, error: `Markmap 服务不可用: ${(error as Error).message}` };
    }
  }

  /**
   * 渲染流程图/时序图 (Mermaid)
   */
  async renderMermaid(code: string, options: RenderOptions = {}): Promise<RenderResult> {
    const { width = 1920, height = 1080, format = "png", theme = "default" } = options;

    try {
      const response = await fetch(`${this.config.mermaidUrl}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, width, height, format, theme }),
      });

      if (!response.ok) {
        const text = await response.text();
        return { success: false, error: `渲染失败: ${response.status} ${text}` };
      }

      const result = await response.json();
      if (result.image) {
        const imageData = Buffer.from(result.image, "base64");
        return { success: true, imageData };
      }

      return { success: false, error: "渲染结果为空" };
    } catch (error) {
      return { success: false, error: `Mermaid 服务不可用: ${(error as Error).message}` };
    }
  }
}

