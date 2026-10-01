import type { GoldenPort } from "./contract.js";

export async function useGolden(port: GoldenPort): Promise<"ok"> {
  return port.ping();
}
