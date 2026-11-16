import type {
  AgentMessageResult,
  AgentSendOptions,
  WorkflowToolContext,
} from "eve/tools";

/**
 * One message a workflow tool sent to a subagent through the fake context.
 */
export interface AgentCall {
  /** The message the subagent would have received. */
  readonly message: unknown;
  /** The subagent's id, as passed to `ctx.agent()`. */
  readonly name: string;
  /** The per-turn options, including the `outputSchema` and abort `signal`. */
  readonly options: AgentSendOptions | undefined;
}

/**
 * Decides how a fake subagent turn ends.
 */
export type AgentResponder = (
  call: AgentCall
) => AgentMessageResult | Promise<AgentMessageResult>;

/**
 * Build a completed subagent turn carrying structured `data`.
 *
 * @param data - The structured output the subagent delivered.
 * @returns A `completed` turn result.
 */
export const completed = (data: unknown): AgentMessageResult => ({
  data,
  reply: undefined,
  sessionEnded: false,
  status: "completed",
});

/**
 * Build a failed subagent turn.
 *
 * @param message - Why the turn failed.
 * @returns A `failed` turn result.
 */
export const failed = (message: string): AgentMessageResult => ({
  data: undefined,
  error: { message },
  reply: undefined,
  sessionEnded: false,
  status: "failed",
});

/**
 * Build a cancelled subagent turn, which ends without structured output.
 *
 * @returns A `cancelled` turn result.
 */
export const cancelled = (): AgentMessageResult => ({
  data: undefined,
  reply: undefined,
  sessionEnded: false,
  status: "cancelled",
});

/**
 * Build a fake workflow tool context that records subagent calls instead of running them.
 *
 * @remarks
 * Only `agent()` and `abortSignal` exist, the two members this project's workflow tools use.
 * Reading any other member throws, so a tool that starts depending on more of the context fails
 * its test instead of quietly receiving `undefined`.
 *
 * @param respond - Produces the result of each subagent turn.
 * @returns The context to pass to `execute`, the recorded `calls`, and the abort `controller`.
 */
export const fakeWorkflowContext = (
  respond: AgentResponder = () => completed(undefined)
) => {
  const calls: AgentCall[] = [];
  const controller = new AbortController();
  const members: Pick<WorkflowToolContext, "abortSignal" | "agent"> = {
    abortSignal: controller.signal,
    agent: (name) => ({
      send: (message, options) => {
        const call: AgentCall = { message, name, options };
        calls.push(call);
        return Promise.resolve({
          result: () => Promise.resolve(respond(call)),
        }) as never;
      },
    }),
  };
  const ctx = new Proxy(members as WorkflowToolContext, {
    get(target, property, receiver) {
      if (typeof property === "string" && !(property in target)) {
        throw new Error(`The fake workflow context has no "${property}".`);
      }
      return Reflect.get(target, property, receiver);
    },
  });
  return { calls, controller, ctx };
};
