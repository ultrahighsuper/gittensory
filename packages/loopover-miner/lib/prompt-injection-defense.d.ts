export const PROMPT_INJECTION_RE: RegExp;

export function hasPromptInjection(text: string | null | undefined): boolean;

export function neutralizePromptInjection(text: string | null | undefined): { text: string; injected: boolean };
