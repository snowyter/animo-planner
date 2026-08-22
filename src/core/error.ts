/**
 * Error extraction and formatting utilities.
 * Preserves identifiable errors like "unimplemented: <command>".
 */

export function formatErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === "object") {
    if ("error" in error && typeof (error as { error: unknown }).error === "string") {
      return (error as { error: string }).error;
    }
    if ("message" in error && typeof (error as { message: unknown }).message === "string") {
      return (error as { message: string }).message;
    }
  }
  return "An unexpected error occurred.";
}

export function isUnimplementedError(error: unknown): boolean {
  const msg = formatErrorMessage(error);
  return msg.startsWith("unimplemented:");
}
