import type { ToolContext } from "eve/tools";

/**
 * Build a fake context for a plain `defineTool` tool.
 *
 * @remarks
 * Only `abortSignal` exists. Reading any other member throws, so a tool that starts depending on
 * the session, the sandbox, or a token fails its test instead of quietly receiving `undefined`.
 *
 * @param abortSignal - The signal the tool should see; defaults to one that never aborts.
 * @returns The context to pass to `execute`.
 */
export const toolContext = (
  abortSignal: AbortSignal = new AbortController().signal
): ToolContext =>
  new Proxy({ abortSignal } as ToolContext, {
    get(target, property, receiver) {
      if (typeof property === "string" && !(property in target)) {
        throw new Error(`The fake tool context has no "${property}".`);
      }
      return Reflect.get(target, property, receiver);
    },
  });
