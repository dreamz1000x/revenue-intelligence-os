import { describe, expect, it } from "vitest";
import { kindForStatus } from "../src/lib/api-error";
describe("RIOS API error mapping",()=>{it.each([[401,"unauthorized"],[403,"forbidden"],[404,"missing"],[409,"conflict"],[422,"invalid"],[429,"limited"],[500,"unavailable"]] as const)("maps %i to %s",(status,kind)=>expect(kindForStatus(status)).toBe(kind));});
