export interface MockOpenAI {
  url: string;
  requests: { method: string; path: string; auth?: string }[];
  close(): Promise<void>;
}
export function startMockOpenAI(opts?: { failFirstEvalsCall?: boolean }): Promise<MockOpenAI>;
