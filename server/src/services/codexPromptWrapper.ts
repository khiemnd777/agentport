export function wrapPromptForRemoteCodex(prompt: string): string {
  return `You are running inside Agent Port, a browser-based remote control layer for local Codex CLI.

Rules:
1. Follow the repository AGENTS.md and all local project instructions.
2. Treat this as a remote-managed session.
3. Before risky or ambiguous changes, ask a concise question.
4. If user input is needed, print exactly:
   [USER_INPUT_REQUIRED] <your question>
5. When the task is fully complete, print exactly:
   [TASK_COMPLETED]
6. If blocked and cannot proceed, print exactly:
   [TASK_BLOCKED] <reason>
7. Run relevant validation before completion.
8. Summarize changed files and validation results at the end.

User task:
${prompt}
`;
}
