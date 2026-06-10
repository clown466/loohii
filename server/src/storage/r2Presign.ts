type DynamicImport = <T = Record<string, unknown>>(specifier: string) => Promise<T>;

const loadModule = new Function(
  "specifier",
  "return import(specifier)",
) as DynamicImport;

export interface R2ClientOptions {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl?: string;
  endpoint?: string;
  region?: string;
}

export interface PresignPutObjectInput {
  key: string;
  contentType: string;
  expiresInSeconds?: number;
  metadata?: Record<string, string>;
}

export interface PresignGetObjectInput {
  key: string;
  expiresInSeconds?: number;
}

export interface PresignedPutObject {
  key: string;
  uploadUrl: string;
  publicUrl?: string;
  headers: Record<string, string>;
  expiresInSeconds: number;
}

export interface PresignedGetObject {
  key: string;
  downloadUrl: string;
  expiresInSeconds: number;
}

export class R2PresignService {
  private readonly options: R2ClientOptions;

  constructor(options: R2ClientOptions) {
    this.options = options;
  }

  async presignPutObject(
    input: PresignPutObjectInput,
  ): Promise<PresignedPutObject> {
    const expiresIn = input.expiresInSeconds ?? 900;
    const { client, PutObjectCommand, getSignedUrl } =
      await this.createSigningContext();

    const uploadUrl = await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: input.key,
        ContentType: input.contentType,
        Metadata: input.metadata,
      }),
      { expiresIn },
    );

    return {
      key: input.key,
      uploadUrl,
      publicUrl: this.publicUrlForKey(input.key),
      headers: {
        "Content-Type": input.contentType,
      },
      expiresInSeconds: expiresIn,
    };
  }

  async presignGetObject(
    input: PresignGetObjectInput,
  ): Promise<PresignedGetObject> {
    const expiresIn = input.expiresInSeconds ?? 900;
    const { client, GetObjectCommand, getSignedUrl } =
      await this.createSigningContext();

    const downloadUrl = await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: this.options.bucket,
        Key: input.key,
      }),
      { expiresIn },
    );

    return {
      key: input.key,
      downloadUrl,
      expiresInSeconds: expiresIn,
    };
  }

  publicUrlForKey(key: string): string | undefined {
    if (!this.options.publicBaseUrl) {
      return undefined;
    }

    return `${this.options.publicBaseUrl.replace(/\/$/, "")}/${encodeKeyPath(
      key,
    )}`;
  }

  private async createSigningContext(): Promise<{
    client: unknown;
    PutObjectCommand: new (input: Record<string, unknown>) => unknown;
    GetObjectCommand: new (input: Record<string, unknown>) => unknown;
    getSignedUrl: (
      client: unknown,
      command: unknown,
      options: { expiresIn: number },
    ) => Promise<string>;
  }> {
    const [{ S3Client, PutObjectCommand, GetObjectCommand }, { getSignedUrl }] =
      await Promise.all([
        loadModule<{
          S3Client: new (input: Record<string, unknown>) => unknown;
          PutObjectCommand: new (input: Record<string, unknown>) => unknown;
          GetObjectCommand: new (input: Record<string, unknown>) => unknown;
        }>("@aws-sdk/client-s3"),
        loadModule<{
          getSignedUrl: (
            client: unknown,
            command: unknown,
            options: { expiresIn: number },
          ) => Promise<string>;
        }>("@aws-sdk/s3-request-presigner"),
      ]);

    const client = new S3Client({
      region: this.options.region ?? "auto",
      endpoint:
        this.options.endpoint ??
        `https://${this.options.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: this.options.accessKeyId,
        secretAccessKey: this.options.secretAccessKey,
      },
    });

    return { client, PutObjectCommand, GetObjectCommand, getSignedUrl };
  }
}

export function createR2PresignService(
  options: R2ClientOptions,
): R2PresignService {
  return new R2PresignService(options);
}

function encodeKeyPath(key: string): string {
  return key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

