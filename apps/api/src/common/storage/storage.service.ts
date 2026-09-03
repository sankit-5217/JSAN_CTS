import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Thin wrapper around @aws-sdk/client-s3 — chosen over the MinIO-specific
 * SDK because it works against any S3-compatible endpoint (custom
 * `endpoint` + `forcePathStyle`), including MinIO locally, without a swap
 * when production points at real S3 (see Sprint 5 plan, Decision 2).
 *
 * Genuinely shared infrastructure (same tier as PrismaService) — any
 * module attaching evidence to an entity (incidents today, vendor cases
 * later) goes through this, not its own client.
 */
@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(configService: ConfigService) {
    this.bucket = configService.get<string>("S3_BUCKET", "opsdesk-attachments");
    this.client = new S3Client({
      region: configService.get<string>("S3_REGION", "us-east-1"),
      endpoint: configService.get<string>("S3_ENDPOINT"),
      forcePathStyle: true,
      credentials: {
        accessKeyId: configService.get<string>("S3_ACCESS_KEY", ""),
        secretAccessKey: configService.get<string>("S3_SECRET_KEY", ""),
      },
    });
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  /**
   * Satisfies spec §17's "signed access URLs" for attachments — the object
   * itself is never made public; every read goes through a short-lived link.
   */
  async getSignedDownloadUrl(key: string, expiresInSeconds = 300): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }
}
