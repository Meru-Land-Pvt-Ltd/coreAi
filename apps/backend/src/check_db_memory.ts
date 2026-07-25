import { prisma } from "./lib/prisma";

async function main() {
  const latestRun = await prisma.workflowRun.findFirst({
    orderBy: { createdAt: "desc" },
    include: {
      nodeRuns: {
        orderBy: { executionOrder: "asc" }
      }
    }
  });

  if (!latestRun) {
    console.log("No WorkflowRun records found in database yet.");
    return;
  }

  console.log(`=================================================================`);
  console.log(` WORKFLOW RUN IN DATABASE (Prisma Studio / localhost:5555 DB)`);
  console.log(`=================================================================`);
  console.log(`Run ID:      ${latestRun.id}`);
  console.log(`Workflow ID: ${latestRun.workflowId}`);
  console.log(`Status:      ${latestRun.status}`);
  console.log(`Created At:  ${latestRun.createdAt.toISOString()}`);
  console.log(`=================================================================\n`);

  for (const nodeRun of latestRun.nodeRuns) {
    console.log(`[Order #${nodeRun.executionOrder}] Node: "${nodeRun.nodeLabel}" (ID: ${nodeRun.nodeId})`);
    console.log(`Type:        ${nodeRun.nodeType}`);
    console.log(`Status:      ${nodeRun.status}`);
    
    if (nodeRun.nodeType === "ai.memory") {
      console.log(`MEMORY NODE OUTPUT (Stored in DB):`);
      const memoryText = (nodeRun.outputJson as any)?.memory || JSON.stringify(nodeRun.outputJson, null, 2);
      console.log("-----------------------------------------------------------------");
      console.log(memoryText);
      console.log("-----------------------------------------------------------------");
    } else {
      console.log(`Output:      ${JSON.stringify(nodeRun.outputJson, null, 2)}`);
    }
    console.log("\n");
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
