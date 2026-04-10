import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai";

const FALLBACK_MODEL = "gemini-2.5-flash-lite";

/**
 * 带指数退避重试 + 模型降级的 Gemini API 调用
 * 1. 先用主模型重试 maxRetries 次（指数退避）
 * 2. 全部失败后自动降级到 gemini-2.5-flash-lite 再试一次
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

      const isRetryable = msg.includes("503") || msg.includes("429") || msg.includes("high demand") || msg.includes("overloaded") || msg.includes("RESOURCE_EXHAUSTED");

      if (!isRetryable || attempt === maxRetries) {
        break; // 进入降级逻辑
      }

      // 指数退避: 2s, 4s, 8s
      const delay = Math.pow(2, attempt + 1) * 1000;
      console.log(`Gemini API 暂时不可用，${delay / 1000}s 后重试 (${attempt + 1}/${maxRetries})...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // 降级：用 flash-lite 兜底
  if (lastError) {
    const msg = lastError.message;
    const isRetryable = msg.includes("503") || msg.includes("429") || msg.includes("high demand") || msg.includes("overloaded") || msg.includes("RESOURCE_EXHAUSTED");

    if (isRetryable) {
      try {
        console.log(`主模型不可用，降级到 ${FALLBACK_MODEL} ...`);
        const apiKey = process.env.GEMINI_API_KEY;
        if (apiKey) {
          const genAI = new GoogleGenerativeAI(apiKey);
          const fallbackModel = genAI.getGenerativeModel({
            model: FALLBACK_MODEL,
            generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
          });
          const result = await fallbackModel.generateContent(prompt);
          return result.response.text();
        }
      } catch (fallbackError) {
        console.error("降级模型也失败:", fallbackError);
        // 抛出原始错误，让调用方知道主模型的问题
      }
    }
  }

  throw lastError || new Error("generateWithRetry: unexpected state");
}
