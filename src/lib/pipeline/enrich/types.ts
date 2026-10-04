import type { z } from "zod";
import type { GenerateRequest, GenerateResult } from "@/lib/llm";

/** generateStructured, or a fake in tests. */
export type Generate = <S extends z.ZodType>(req: GenerateRequest<S>) => Promise<GenerateResult<z.output<S>>>;
