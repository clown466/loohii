import type {
  ImageGenerationAdapter,
  ImageGenerationInput,
  ImageGenerationResult,
} from "./types.js";

export interface MockImageAdapterOptions {
  assetBaseUrl?: string;
  latencyMs?: number;
}

export class MockImageAdapter implements ImageGenerationAdapter {
  readonly provider = "mock";

  private readonly assetBaseUrl: string;
  private readonly latencyMs: number;

  constructor(options: MockImageAdapterOptions = {}) {
    this.assetBaseUrl = options.assetBaseUrl ?? "mock://generated";
    this.latencyMs = options.latencyMs ?? 0;
  }

  async generateImage(
    input: ImageGenerationInput,
  ): Promise<ImageGenerationResult> {
    if (this.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    }

    const count = Math.max(1, input.count ?? 1);
    const generationId = input.generationId ?? "local";

    return {
      provider: this.provider,
      model: input.model ?? "mock-image",
      images: Array.from({ length: count }, (_, index) => ({
        url: `${this.assetBaseUrl}/${generationId}/${index + 1}.png`,
        mimeType: "image/png",
        revisedPrompt: input.prompt,
        providerId: `${generationId}-${index + 1}`,
      })),
      raw: { mocked: true },
    };
  }
}

export function createMockImageAdapter(
  options?: MockImageAdapterOptions,
): MockImageAdapter {
  return new MockImageAdapter(options);
}
