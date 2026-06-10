import type {
  GeneratedImage,
  ImageGenerationAdapter,
  ImageGenerationInput,
  ImageGenerationResult,
} from "./types.js";

export interface OpenAiCompatibleImageAdapterOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  organization?: string;
  project?: string;
  fetchImpl?: FetchLike;
}

export interface FetchLikeResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  },
) => Promise<FetchLikeResponse>;

interface OpenAiImageResponse {
  data?: Array<{
    url?: string;
    b64_json?: string;
    revised_prompt?: string;
  }>;
}

export class OpenAiCompatibleImageAdapter implements ImageGenerationAdapter {
  readonly provider = "openai-compatible";

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly organization?: string;
  private readonly project?: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: OpenAiCompatibleImageAdapterOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(
      /\/$/,
      "",
    );
    this.model = options.model ?? "gpt-image-1";
    this.organization = options.organization;
    this.project = options.project;
    this.fetchImpl =
      options.fetchImpl ?? (globalThis as unknown as { fetch: FetchLike }).fetch;
  }

  async generateImage(
    input: ImageGenerationInput,
  ): Promise<ImageGenerationResult> {
    const response = await this.fetchImpl(`${this.baseUrl}/images/generations`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify({
        model: input.model ?? this.model,
        prompt: input.prompt,
        n: input.count ?? 1,
        size: toOpenAiSize(input.width, input.height),
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Image generation failed with ${response.status}: ${body}`,
      );
    }

    const payload = (await response.json()) as OpenAiImageResponse;
    const images: GeneratedImage[] = (payload.data ?? []).map((item) => ({
      url: item.url,
      b64Json: item.b64_json,
      mimeType: item.b64_json ? "image/png" : undefined,
      revisedPrompt: item.revised_prompt,
    }));

    return {
      provider: this.provider,
      model: input.model ?? this.model,
      images,
      raw: payload,
    };
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };

    if (this.organization) {
      headers["OpenAI-Organization"] = this.organization;
    }

    if (this.project) {
      headers["OpenAI-Project"] = this.project;
    }

    return headers;
  }
}

export function createOpenAiCompatibleImageAdapter(
  options: OpenAiCompatibleImageAdapterOptions,
): OpenAiCompatibleImageAdapter {
  return new OpenAiCompatibleImageAdapter(options);
}

function toOpenAiSize(width?: number, height?: number): string | undefined {
  if (!width || !height) {
    return undefined;
  }

  return `${width}x${height}`;
}
