import { PrismaClient } from "@prisma/client";
import { preloadPlatformApiSettings } from "./dist/modules/admin/platform-api-settings.js";
import { initProviderEngine } from "./dist/modules/ai-provider-engine/provider-engine.js";
import { composeOrchestration } from "./dist/modules/architect/composer/compose.js";
import { planToCanvas } from "./dist/modules/architect/composer/to-canvas.js";
import { repairCanvas } from "./dist/modules/architect/composer/repair.js";
import { checkWiring } from "@coreai/shared";

await preloadPlatformApiSettings();
await initProviderEngine();

const prisma = new PrismaClient();
const architect = await prisma.user.findFirst({ where: { role: "ARCHITECT" }, select: { id: true, email: true } })
  ?? await prisma.user.findFirst({ select: { id: true, email: true } });

console.log("\n=== 1. DESCRIBE IT ===");
const want = "An AI receptionist for a dental clinic. It answers the phone, talks to the patient, books them into our calendar, and texts them a confirmation.";
console.log(`"${want}"`);

console.log("\n=== 2. BUILD IT ===");
const t0 = Date.now();
const built = await composeOrchestration({
  architectUserId: architect.id, want,
  onProgress: p => console.log("   *", p.step, p.detail ? `- ${p.detail}` : "")
});
if (!built.ok) { console.log("FAILED:", built.message); await prisma.$disconnect(); process.exit(1); }
console.log(`   built in ${((Date.now()-t0)/1000).toFixed(1)}s, ${built.attempts} attempt(s)`);
console.log("   summary:", built.plan.summary);

const canvas = planToCanvas(built.plan);
console.log(`   ${canvas.nodes.length} steps, ${canvas.edges.length} wires:`);
for (const n of canvas.nodes) console.log(`      ${n.id}  ${n.data.type}  "${n.data.title}"`);

console.log("\n=== 3. VERIFY IT ===");
let check = checkWiring({ nodes: canvas.nodes, edges: canvas.edges.map(e=>({source:e.source,target:e.target})) });
console.log(check.ok ? "   ALL GREEN - every step gets what it needs" : `   ${check.problems.length} RED:`);
for (const p of check.problems) console.log(`      ${p.nodeLabel}: ${p.message}`);

let nodes = canvas.nodes, edges = canvas.edges;
console.log("\n=== 4. FIX IT FOR ME ===");
if (!check.ok) {
  const fix = await repairCanvas({ architectUserId: architect.id, nodes, edges });
  if (fix.ok) {
    console.log("   ", fix.summary);
    for (const f of fix.fixed) console.log("      fixed:", f);
    nodes = fix.nodes; edges = fix.edges;
    check = checkWiring({ nodes, edges: edges.map(e=>({source:e.source,target:e.target})) });
    console.log(check.ok ? "   NOW ALL GREEN" : `   still ${check.problems.length} red`);
  } else console.log("   ", fix.message);
} else console.log("   nothing to fix");

console.log("\n=== 5. READY TO PUBLISH ===");
console.log("   wiring:", check.ok ? "green" : `${check.problems.length} problems`);
console.log("   steps:", nodes.length, "| wires:", edges.length);
console.log("\nRESULT:", check.ok ? "END TO END GREEN" : "NOT GREEN");
await prisma.$disconnect();
