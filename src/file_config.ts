const FALLBACK_VERSION = -1;

export type FileConfigParser<T> = (data: unknown) => T;
export type FileConfigFactory<T> = () => T;

export class FileConfigBackend<T> {
  private cache: T | null = null;
  private version: number = FALLBACK_VERSION;
  private inflight: Promise<T> | null = null;

  constructor(
    private readonly path: string,
    private readonly parse: FileConfigParser<T>,
    private readonly fallback: FileConfigFactory<T>,
  ) {}

  async snapshot(): Promise<T> {
    const file = Bun.file(this.path);
    const exists = await file.exists();
    const currentVersion = exists ? file.lastModified : FALLBACK_VERSION;

    if (this.cache !== null && this.version === currentVersion) {
      return this.cache;
    }

    return this.load(file, currentVersion, exists);
  }

  preload(): void {
    // fire-and-forget; intentionally not awaited
    void this.snapshot();
  }

  invalidate(): void {
    this.version = FALLBACK_VERSION;
  }

  private async load(
    file: ReturnType<typeof Bun.file>,
    version: number,
    exists: boolean,
  ): Promise<T> {
    if (this.inflight) {
      return this.inflight;
    }

    this.inflight = (async () => {
      let nextValue: T;

      if (!exists) {
        nextValue = this.fallback();
      } else {
        try {
          const raw = await file.json();
          nextValue = this.parse(raw);
        } catch (error) {
          console.error(
            `Failed to load file-config '${this.path}', using fallback`,
            error,
          );
          nextValue = this.fallback();
        }
      }

      this.cache = nextValue;
      this.version = version;
      return nextValue;
    })();

    try {
      return await this.inflight;
    } finally {
      this.inflight = null;
    }
  }
}
