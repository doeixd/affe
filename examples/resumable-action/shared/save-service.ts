import { Context, type Effect } from "effect";

export interface SaveService {
  readonly save: (label: string) => Effect.Effect<void>;
}

export const SaveService = Context.Service<SaveService>(
  "affe/example/ResumableSaveService",
);
