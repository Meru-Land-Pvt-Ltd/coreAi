import type { AIExecuteRequest, AIExecuteResponse } from "../types";
import dalleAdapter from "../providers/dalle.adapter";
import stabilityAdapter from "../providers/stability.adapter";
import geminiImagenAdapter from "../providers/gemini-imagen.adapter";
import { StateGraph, Annotation } from "@langchain/langgraph";

export type ImageGenOptions = {
  model?: string;
  prompt: string;
  referenceImage?: Buffer | string;
  imageSize?: string;
};

export const ImageNodeStateAnnotation = Annotation.Root({
  prompt: Annotation<string>(),
  model: Annotation<string>(),
  referenceImage: Annotation<Buffer | string | undefined>(),
  imageResult: Annotation<AIExecuteResponse | undefined>(),
});

export async function executeImageGeneration(options: ImageGenOptions): Promise<AIExecuteResponse> {
  const model = (options.model ?? "gemini-3.1-flash-image").trim().toLowerCase();

  const request: AIExecuteRequest = {
    capability: "image-gen",
    model: options.model,
    imagePrompt: options.prompt,
    referenceImage: options.referenceImage,
    imageSize: options.imageSize,
  };

  if (model.includes("imagen") || model.includes("gemini")) {
    return geminiImagenAdapter.execute(request);
  }

  if (model.includes("dall-e") || model.includes("dalle") || model.includes("openai")) {
    return dalleAdapter.execute(request);
  }

  if (
    model.includes("stable-diffusion") ||
    model.includes("sdxl") ||
    model.includes("stability") ||
    model.includes("sd3") ||
    model.startsWith("sd")
  ) {
    return stabilityAdapter.execute(request);
  }

  // Default fallback to Gemini Imagen adapter
  return geminiImagenAdapter.execute(request);
}

export async function executeImageGenerationWithLangGraph(options: ImageGenOptions): Promise<AIExecuteResponse> {
  const workflow = new StateGraph(ImageNodeStateAnnotation)
    .addNode("dispatch_image_gen", async (state) => {
      const res = await executeImageGeneration({
        prompt: state.prompt,
        model: state.model,
        referenceImage: state.referenceImage
      });
      return { imageResult: res };
    })
    .addEdge("__start__", "dispatch_image_gen");

  const app = workflow.compile();
  const state = await app.invoke({
    prompt: options.prompt,
    model: options.model,
    referenceImage: options.referenceImage
  });

  return state.imageResult ?? await executeImageGeneration(options);
}
