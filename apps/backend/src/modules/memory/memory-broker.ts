import type {NodeMemoryPayload, NodeMemoryRecord, WorkflowMemoryContext} from "./types";



export class MemoryBroker {
    //Save a node's memory to the database.
    async saveMemory(payload: NodeMemoryPayload): Promise<{ nodeRunId: string }> {
      throw new Error("MemoryBroker.saveMemory is not implemented yet");
    }
  
    //Load a node's memory from the database.
    async loadMemory(_nodeRunId: string): Promise<NodeMemoryRecord | null> {
      throw new Error("MemoryBroker.loadMemory is not implemented yet");
    }
  
    //Build a context for a node to use when it runs.
    async buildContext(_params: {
      workflowRunId: string;
      nodeId: string;
      threadId?: string;
    }): Promise<WorkflowMemoryContext> {
      throw new Error("MemoryBroker.buildContext is not implemented yet");
    }
  }
  
export const memoryBroker = new MemoryBroker();