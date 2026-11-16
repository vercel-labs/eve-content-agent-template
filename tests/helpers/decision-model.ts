import { Experimental_DecisionMockModelV4 as DecisionMockModel } from "ai/test";
import { vi } from "vitest";

type DecideOptions = Parameters<DecisionMockModel["doDecide"]>[0];
type DecideResult = Awaited<ReturnType<DecisionMockModel["doDecide"]>>;

/**
 * One question the decision model was asked.
 */
export type AskedQuestion = DecideOptions["questions"][string];

/**
 * One answer the fake decision model gives.
 */
export type GivenAnswer = DecideResult["answers"][string];

/**
 * One request that reached the fake decision model.
 */
export interface DecisionRequest {
  /** The model id the caller asked for. */
  readonly modelId: string;
  /** The questions, keyed by the caller's question ids. */
  readonly questions: DecideOptions["questions"];
  /** The state the questions are about, serialized for assertions. */
  readonly state: string;
}

/**
 * Answer a yes/no question with a probability.
 *
 * @param probability - The probability that the answer is yes.
 * @returns A boolean answer.
 */
export const says = (probability: number): GivenAnswer => ({
  probability,
  type: "boolean",
});

/**
 * Answer a choice question, giving the chosen option one probability and sharing the rest.
 *
 * @remarks
 * The AI SDK rejects a choice whose probabilities don't cover every option or don't sum to 1,
 * so the remainder is split evenly across the other options.
 *
 * @param question - The question being answered; its criteria name the options.
 * @param choice - The option to choose.
 * @param probability - The probability to give the chosen option.
 * @returns A choice answer the AI SDK accepts.
 */
export const chooses = (
  question: AskedQuestion,
  choice: string,
  probability: number
): GivenAnswer => {
  if (question.type !== "choice") {
    throw new Error(`Expected a choice question, got "${question.type}".`);
  }
  const others = Object.keys(question.criteria).filter(
    (option) => option !== choice
  );
  return {
    choice,
    probabilities: {
      ...Object.fromEntries(
        others.map((option) => [option, (1 - probability) / others.length])
      ),
      [choice]: probability,
    },
    type: "choice",
  };
};

/**
 * Install a fake decision model behind the AI SDK's default provider.
 *
 * @remarks
 * eve's `decide()` and `auto()` resolve a string model id through the AI SDK's global default
 * provider, so this replaces only the network hop: eve's own code and the AI SDK's validation of
 * questions and answers still run. The global is restored after each test.
 *
 * @param answer - Produces the answer to each question, or throws to fail the decision.
 * @returns The requests the fake model received, in order.
 */
export const fakeDecisionModel = (
  answer: (id: string, question: AskedQuestion) => GivenAnswer
): DecisionRequest[] => {
  const requests: DecisionRequest[] = [];
  vi.stubGlobal("AI_SDK_DEFAULT_PROVIDER", {
    decisionModel: (modelId: string) =>
      new DecisionMockModel({
        doDecide: (options) => {
          requests.push({
            modelId,
            questions: options.questions,
            state: JSON.stringify(options.state),
          });
          return Promise.resolve({
            answers: Object.fromEntries(
              Object.entries(options.questions).map(([id, question]) => [
                id,
                answer(id, question),
              ])
            ),
            warnings: [],
          });
        },
        modelId,
        provider: "fake-decisions",
        supportedQuestionTypes: ["boolean", "choice", "score"],
      }),
    specificationVersion: "v4",
  });
  return requests;
};
