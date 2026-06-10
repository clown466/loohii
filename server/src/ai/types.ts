export interface ImageGenerationInput {
  prompt: string;
  generationId?: string;
  projectId?: string;
  userId?: string;
  count?: number;
  width?: number;
  height?: number;
  model?: string;
  seed?: number;
  metadata?: Record<string, unknown>;
}

export interface GeneratedImage {
  url?: string;
  b64Json?: string;
  mimeType?: string;
  revisedPrompt?: string;
  providerId?: string;
}

export interface ImageGenerationResult {
  provider: string;
  model?: string;
  images: GeneratedImage[];
  raw?: unknown;
}

export interface ImageGenerationAdapter {
  readonly provider: string;
  generateImage(input: ImageGenerationInput): Promise<ImageGenerationResult>;
}

