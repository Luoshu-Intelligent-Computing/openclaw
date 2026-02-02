/**
 * ASR 客户端 (纯 TypeScript 实现)
 *
 * 直接调用外部 ASR 服务，不依赖 MeetAI Rust 服务
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export interface AsrConfig {
  serviceUrl: string;
  appid?: string;
  accessKeyId?: string;
  accessKeySecret?: string;
}

export interface AsrSegment {
  speaker: string;
  text: string;
  startTime?: number;
  endTime?: number;
}

export interface AsrResult {
  text: string;
  orderId?: string;
  segments?: AsrSegment[];
}

export class AsrClient {
  private config: AsrConfig;

  constructor(config: AsrConfig) {
    this.config = {
      serviceUrl: config.serviceUrl || "http://127.0.0.1:18001",
      ...config,
    };
  }

  /**
   * 转写音频文件
   */
  async transcribe(audioPath: string): Promise<AsrResult> {
    // 1. 检查文件是否存在
    await this.checkAudioFile(audioPath);

    // 2. 上传音频
    const uploadResult = await this.uploadAudio(audioPath);
    const orderId = uploadResult.content?.orderId;

    if (!orderId) {
      throw new Error("上传失败：未获取到订单ID");
    }

    // 3. 轮询获取结果
    const result = await this.pollResult(orderId);

    // 4. 解析转写文本
    const parsed = this.parseTranscript(result);

    return {
      text: parsed.text,
      orderId,
      segments: parsed.segments,
    };
  }

  /**
   * 检查音频文件
   */
  private async checkAudioFile(audioPath: string): Promise<void> {
    try {
      const stats = await fs.stat(audioPath);
      if (!stats.isFile()) {
        throw new Error(`不是有效的文件: ${audioPath}`);
      }

      const ext = path.extname(audioPath).toLowerCase();
      if (![".wav", ".mp3", ".m4a"].includes(ext)) {
        throw new Error(`不支持的音频格式: ${ext}，仅支持 wav/mp3/m4a`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`音频文件不存在: ${audioPath}`);
      }
      throw error;
    }
  }

  /**
   * 生成 HMAC-SHA1 签名
   */
  private generateSignature(params: Record<string, string>): string {
    if (!this.config.accessKeySecret) {
      return ""; // 本地服务可能不需要签名
    }

    const sortedParams = Object.keys(params)
      .filter((k) => k !== "signature" && params[k])
      .sort()
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
      .join("&");

    const hmac = crypto.createHmac("sha1", this.config.accessKeySecret);
    hmac.update(sortedParams);
    return hmac.digest("base64");
  }

  /**
   * 上传音频文件
   */
  private async uploadAudio(audioPath: string): Promise<any> {
    const stats = await fs.stat(audioPath);
    const fileSize = stats.size;
    const fileName = path.basename(audioPath);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = crypto.randomBytes(8).toString("hex");

    // 构建请求参数
    const params: Record<string, string> = {
      appId: this.config.appid || "",
      accessKeyId: this.config.accessKeyId || "",
      timestamp,
      nonce,
      fileSize: fileSize.toString(),
      fileName,
      language: "zh",
      duration: "0",
    };

    // 生成签名
    const signature = this.generateSignature(params);

    // 构建 URL
    const queryString = Object.keys(params)
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
      .join("&");
    const uploadUrl = `${this.config.serviceUrl}/v1/upload?${queryString}`;

    // 读取文件并上传
    const fileBuffer = await fs.readFile(audioPath);
    const formData = new FormData();
    formData.append("file", new Blob([fileBuffer]), fileName);

    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: { signature },
      body: formData,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`上传失败: ${response.status} ${text}`);
    }

    const result = await response.json();
    if (result.code !== "000000") {
      throw new Error(`上传失败: ${result.code} - ${result.descInfo || "未知错误"}`);
    }

    return result;
  }

  /**
   * 轮询获取转写结果
   */
  private async pollResult(orderId: string, maxRetries = 100): Promise<any> {
    let retries = 0;

    while (retries < maxRetries) {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const nonce = crypto.randomBytes(8).toString("hex");

      const params: Record<string, string> = {
        appId: this.config.appid || "",
        accessKeyId: this.config.accessKeyId || "",
        timestamp,
        nonce,
        orderId,
      };

      const signature = this.generateSignature(params);
      const queryString = Object.keys(params)
        .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
        .join("&");
      const queryUrl = `${this.config.serviceUrl}/v1/getResult?${queryString}`;

      const response = await fetch(queryUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          signature,
        },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        throw new Error(`查询失败: ${response.status}`);
      }

      const result = await response.json();
      if (result.code !== "000000") {
        throw new Error(`查询失败: ${result.code} - ${result.descInfo || "未知错误"}`);
      }

      // 检查转写状态：3=处理中，4=完成
      const status = result.content?.orderInfo?.status;
      if (status === 4) {
        return result;
      }
      if (status !== 3) {
        throw new Error(`转写异常: 状态码=${status}`);
      }

      // 等待 10 秒后重试
      retries++;
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }

    throw new Error(`查询超时: 已重试 ${maxRetries} 次`);
  }

  /**
   * 解析转写结果
   */
  private parseTranscript(result: any): { text: string; segments: AsrSegment[] } {
    const sentences = result.content?.orderResult?.sentences || [];
    const segments: AsrSegment[] = [];
    const textParts: string[] = [];

    for (const sentence of sentences) {
      const speaker = sentence.speakerId || "S0";
      const text = sentence.text || "";
      const startTime = sentence.beginTime;
      const endTime = sentence.endTime;

      if (text.trim()) {
        segments.push({ speaker, text: text.trim(), startTime, endTime });
        textParts.push(`${speaker}: ${text.trim()}`);
      }
    }

    return { text: textParts.join("\n"), segments };
  }
}

