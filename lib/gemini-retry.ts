import { GenerativeModel } from "@google/generative-ai";

/**
 * 带指数退避重试的 Gemini API 调用
 * 针对 503 Service Unavailable 等暂时性错误自动重试
 */
export async function generateWithRetry(
  model: GenerativeModel,
  prompt: string,
  maxRetries = 3
): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const msg = lastError.message;

      // 只对 503/429 等暂时性错误重试
      const isRetryable = msg.includes("503") || msg.includes("429") || msg.includes("high demand") || msg.includes("overloaded") || msg.includes("RESOURCE_EXHAUSTED");

      if (!isRetryable || attempt === maxRetries) {
        throw lastError;
      }

      // 指数退避: 2s, 4s, 8s
      const delay = Math.pow(2, attempt + 1) * 1000;
      console.log(`Gemini API 暂时不可用，${delay / 1000}s 后重试 (${attempt + 1}/${maxRetries})...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError || new Error("generateWithRetry: unexpected state");
}
