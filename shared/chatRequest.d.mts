export type NormalizedChatRole = "user" | "assistant";
export type DeepSeekOutputFormat = "json_object" | "text";

export interface NormalizedChatMessage {
  role: NormalizedChatRole;
  content: string;
}

export interface CreateDeepSeekBodyOptions {
  model: string;
  messages: unknown;
  systemPrompt: string;
  sessionId: string;
  outputFormat?: DeepSeekOutputFormat;
}

export interface DeepSeekRequestBody {
  model: string;
  messages: Array<NormalizedChatMessage | { role: "system"; content: string }>;
  thinking: { type: "disabled" };
  response_format: { type: DeepSeekOutputFormat };
  stream: true;
  max_tokens: 1600;
  user_id: string;
}

export function normalizeChatMessages(input: unknown): NormalizedChatMessage[];
export function createDeepSeekBody(options: CreateDeepSeekBodyOptions): DeepSeekRequestBody;
