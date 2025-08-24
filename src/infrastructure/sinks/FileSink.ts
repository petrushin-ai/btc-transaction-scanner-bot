import path from "path";

import { getFileStorage } from "@/infrastructure/storage/FileStorageService";
import type { AddressActivityFoundEvent } from "@/types/events";

import type { FileSinkOptions, NotificationSink, SinkResult } from "./types";

export class FileSink implements NotificationSink {
  public readonly kind = "file" as const;
  private readonly filePath: string;

  constructor(options: FileSinkOptions) {
    this.filePath = options.path;
    const storage = getFileStorage();
    storage.ensureDir( path.dirname( this.filePath ) );
    storage.ensureFile( this.filePath, "" );
  }

  async send(event: AddressActivityFoundEvent): Promise<SinkResult> {
    try {
      const storage = getFileStorage();
      const line = `${ JSON.stringify( event ) }\n`;
      storage.writeFile( this.filePath, line, { encoding: "utf-8", flag: "a" } );
      return { ok: true };
    } catch ( err ) {
      const error = err instanceof Error ? err : new Error( String( err ) );
      return { ok: false, error };
    }
  }
}


