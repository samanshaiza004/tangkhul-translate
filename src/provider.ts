import { Client } from "@gradio/client";

interface GradioEventLike {
  type: "data" | "status" | "log" | "render";
  data?: unknown[];
  stage?: "pending" | "error" | "complete" | "generating" | "streaming";
  message?: string | unknown[];
  original_msg?: string;
}

interface GradioJobLike extends AsyncIterable<GradioEventLike> {
  cancel(): Promise<void>;
  return(): Promise<IteratorReturnResult<undefined>>;
}

export type ProviderErrorCode = "input_too_long" | "timeout" | "unavailable" | "invalid_response";

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProviderError";
  }
}

export interface TranslationProvider {
  translate(source: string): Promise<string>;
}

interface GradioClientLike {
  submit(endpoint: string, data: unknown[]): GradioJobLike;
  close(): void;
}

export interface GradioProviderOptions {
  space: string;
  token?: `hf_${string}`;
  timeoutMs: number;
  connect?: (reference: string, token?: `hf_${string}`) => Promise<GradioClientLike>;
}

class TimeoutSignal extends Error {}

function publicAppUrl(space: string): string {
  return `https://${space.replace("/", "-")}.hf.space`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isConnectionOrSchemaFailure(error: unknown): boolean {
  const message = messageOf(error).toLowerCase();
  return [
    "space metadata",
    "no api found",
    "could not resolve app config",
    "endpoint",
    "schema",
    "fetch failed",
    "network",
    "connection",
    "broken",
  ].some((fragment) => message.includes(fragment));
}

function isInputTooLong(error: unknown): boolean {
  return messageOf(error).includes("INPUT_TOO_LONG");
}

async function defaultConnect(
  reference: string,
  token?: `hf_${string}`,
): Promise<GradioClientLike> {
  return (await Client.connect(reference, token ? { token } : undefined)) as GradioClientLike;
}

export class GradioTranslationProvider implements TranslationProvider {
  private clientPromise?: Promise<GradioClientLike>;
  private readonly connectClient: NonNullable<GradioProviderOptions["connect"]>;

  constructor(private readonly options: GradioProviderOptions) {
    this.connectClient = options.connect ?? defaultConnect;
  }

  async translate(source: string): Promise<string> {
    return this.translateWithReconnect(source, true);
  }

  private async translateWithReconnect(source: string, mayReconnect: boolean): Promise<string> {
    try {
      const client = await this.getClient();
      return await this.runJob(client, source);
    } catch (error) {
      if (error instanceof ProviderError) throw error;

      if (isInputTooLong(error)) {
        throw new ProviderError("input_too_long", "The source exceeds the model input limit.", {
          cause: error,
        });
      }

      if (mayReconnect && isConnectionOrSchemaFailure(error)) {
        this.invalidateClient();
        return this.translateWithReconnect(source, false);
      }

      throw new ProviderError("unavailable", "The translation service is unavailable.", {
        cause: error,
      });
    }
  }

  private getClient(): Promise<GradioClientLike> {
    if (!this.clientPromise) {
      // A private Space needs HF_TOKEN. Protected/public Spaces can use their
      // public app URL without exposing or requiring a token.
      const reference = this.options.token ? this.options.space : publicAppUrl(this.options.space);
      this.clientPromise = this.connectClient(reference, this.options.token).catch((error) => {
        this.clientPromise = undefined;
        throw error;
      });
    }

    return this.clientPromise;
  }

  private invalidateClient(): void {
    const previous = this.clientPromise;
    this.clientPromise = undefined;
    void previous?.then((client) => client.close()).catch(() => {});
  }

  private async runJob(client: GradioClientLike, source: string): Promise<string> {
    const job = client.submit("/translate", [source]);
    let timer: ReturnType<typeof setTimeout> | undefined;

    const completion = (async () => {
      for await (const event of job) {
        if (event.type === "data") {
          const output = event.data?.[0];
          if (typeof output !== "string") {
            throw new ProviderError(
              "invalid_response",
              "The translation service returned an invalid response.",
            );
          }
          if (output.trim().length === 0) {
            throw new ProviderError(
              "invalid_response",
              "The translation service returned an empty response.",
            );
          }
          return output;
        }

        if (event.type === "status" && event.stage === "error") {
          const message =
            typeof event.message === "string" ? event.message : JSON.stringify(event.message);
          throw new Error(message || event.original_msg || "Provider job failed");
        }
      }

      throw new ProviderError(
        "invalid_response",
        "The translation service completed without a response.",
      );
    })();

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new TimeoutSignal()), this.options.timeoutMs);
    });

    try {
      return await Promise.race([completion, timeout]);
    } catch (error) {
      if (error instanceof TimeoutSignal) {
        await Promise.allSettled([job.cancel(), job.return()]);
        throw new ProviderError("timeout", "The translation request timed out.", { cause: error });
      }
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
