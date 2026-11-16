import type { ApprovalContext, ApprovalStatus } from "eve/tools/approval";

/**
 * The part of a Standard Schema this suite relies on.
 *
 * @remarks
 * eve types a tool's `inputSchema` and `outputSchema` as Standard Schema, not as Zod. The
 * helpers below validate through that interface, so they keep working if a schema moves to
 * another Standard Schema library.
 */
interface StandardValidator {
  readonly "~standard": {
    readonly validate: (value: unknown) => unknown;
  };
}

/**
 * The outcome of validating a value against a schema.
 */
type Validation =
  | { readonly ok: true; readonly value: unknown }
  | { readonly issues: readonly string[]; readonly ok: false };

/**
 * Whether a value implements the Standard Schema validation interface.
 *
 * @param schema - A tool's `inputSchema` or `outputSchema`.
 * @returns True when the schema can validate values at runtime.
 */
const isValidator = (schema: unknown): schema is StandardValidator =>
  typeof schema === "object" && schema !== null && "~standard" in schema;

/**
 * Validate a value against a tool schema through its Standard Schema interface.
 *
 * @param schema - A tool's `inputSchema` or `outputSchema`.
 * @param value - The value to validate.
 * @returns The parsed value, or the validation issues.
 * @throws When the schema is plain JSON Schema, which this suite has no validator for.
 */
export const validate = async (
  schema: unknown,
  value: unknown
): Promise<Validation> => {
  if (!isValidator(schema)) {
    throw new Error("Expected a Standard Schema with a runtime validator.");
  }
  const result = (await schema["~standard"].validate(value)) as {
    readonly issues?: readonly { readonly message: string }[];
    readonly value?: unknown;
  };
  return result.issues
    ? { issues: result.issues.map((issue) => issue.message), ok: false }
    : { ok: true, value: result.value };
};

/**
 * The members of a tool definition {@link callTool} uses.
 */
interface CallableTool<TInput, TOutput, TContext> {
  readonly execute: (
    input: TInput,
    ctx: TContext
  ) => AsyncIterable<TOutput> | Promise<TOutput> | TOutput;
  readonly inputSchema: unknown;
  readonly outputSchema?: unknown;
}

/**
 * Whether a tool's input schema accepts a value.
 *
 * @param tool - The tool definition.
 * @param input - A candidate input, valid or not.
 * @returns True when the input passes the tool's `inputSchema`.
 */
export const acceptsInput = async (
  tool: { readonly inputSchema: unknown },
  input: unknown
): Promise<boolean> => (await validate(tool.inputSchema, input)).ok;

/**
 * Call a tool through its declared contract: validate the input, run `execute`, check the output.
 *
 * @remarks
 * eve validates a tool's input against `inputSchema` before `execute` runs, so this does too.
 * It then checks the result against the tool's own `outputSchema`, its declared return shape.
 * Every call therefore also asserts that the tool accepts the input it is given and returns what
 * it declares, on success and failure paths alike.
 *
 * @param tool - The tool definition, as exported by its file under `agent/`.
 * @param input - The tool input. Its type comes from the tool alone (`NoInfer`), so a missing
 * or misspelled field is a compile error instead of widening what the tool accepts.
 * @param ctx - The tool context; see `tool-context.ts` and `workflow-context.ts` for fakes.
 * @returns The tool's output.
 * @throws When the input or the output fails its schema, or `execute` throws.
 */
export const callTool = async <TInput, TOutput, TContext>(
  tool: CallableTool<TInput, TOutput, TContext>,
  input: NoInfer<TInput>,
  ctx: TContext
): Promise<TOutput> => {
  const parsed = await validate(tool.inputSchema, input);
  if (!parsed.ok) {
    throw new Error(`Invalid tool input: ${parsed.issues.join("; ")}`);
  }
  const output = (await tool.execute(parsed.value as TInput, ctx)) as TOutput;
  if (tool.outputSchema !== undefined) {
    const checked = await validate(tool.outputSchema, output);
    if (!checked.ok) {
      throw new Error(`Invalid tool output: ${checked.issues.join("; ")}`);
    }
  }
  return output;
};

/**
 * Evaluate an approval policy for one tool call.
 *
 * @param approval - A tool's or connection's `approval`.
 * @param call - The call's tool name and, optionally, its input.
 * @returns The policy's decision, such as `"user-approval"` or `"not-applicable"`.
 * @throws When `approval` is not a policy function.
 */
export const approvalFor = async (
  approval: unknown,
  call: { readonly toolInput?: unknown; readonly toolName: string }
): Promise<ApprovalStatus> => {
  if (typeof approval !== "function") {
    throw new Error("Expected an approval policy function.");
  }
  const policy = approval as (
    ctx: ApprovalContext
  ) => ApprovalStatus | Promise<ApprovalStatus>;
  return await policy({
    abortSignal: new AbortController().signal,
    callId: "call_test",
    ...call,
  } as ApprovalContext);
};
