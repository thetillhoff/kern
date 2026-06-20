// Pick the model id to record in the decision log.
// The live session model wins so a model set elsewhere (e.g. the task tool)
// is reported truthfully; only then fall back to the configured default.
export function currentModelId(
  model: { id?: string } | undefined,
  defaultModel: string | null,
): string {
  return model?.id ?? defaultModel ?? "unknown";
}
