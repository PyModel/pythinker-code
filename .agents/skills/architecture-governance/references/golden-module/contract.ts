export interface GoldenPort {
  ping(): Promise<"ok">;
}
