import { askQuestion } from "eve/tools/ask_question";

/**
 * Framework `ask_question` tool: ask the writer one question with two or three options.
 *
 * @remarks
 * eve shipped `ask_question` as a default tool until 0.65; it is now opt-in, so this file keeps
 * it available. The agent uses it when it must ask before drafting — for example, which surface a
 * piece is for — and Slack renders the options as a native select menu. The writer can always
 * type their own answer instead. Delete this file to fall back to asking in plain reply text.
 *
 * @see {@link https://eve.dev/docs/concepts/built-in-tools | eve built-in tools}
 */
export default askQuestion();
