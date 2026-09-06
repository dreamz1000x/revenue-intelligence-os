import { describe, expect, it } from "vitest";
import { hasRole } from "../src/lib/roles";
describe("role-aware presentation",()=>{it("preserves the viewer/operator/admin hierarchy",()=>{expect(hasRole(["viewer"],"viewer")).toBe(true);expect(hasRole(["viewer"],"operator")).toBe(false);expect(hasRole(["operator"],"viewer")).toBe(true);expect(hasRole(["admin"],"operator")).toBe(true)});it("rejects unknown roles",()=>expect(hasRole(["owner"],"viewer")).toBe(false));});
