import { beforeEach, describe, expect, it, vi } from "vitest";
import { VOICE_NODE_TYPES } from "@coreai/shared";

const mocks = vi.hoisted(() => ({
  findBusiness: vi.fn(),
  updateProfile: vi.fn(),
  createProfile: vi.fn(),
  isVapiConfigured: vi.fn(() => true),
  deployVapiAssistant: vi.fn()
}));

vi.mock("../../lib/prisma", () => ({
  prisma: {
    business: { findUnique: mocks.findBusiness },
    businessProfile: {
      update: mocks.updateProfile,
      create: mocks.createProfile
    }
  }
}));

vi.mock("../architect/vapi-connector", () => ({
  isVapiConfigured: mocks.isVapiConfigured,
  deployVapiAssistant: mocks.deployVapiAssistant
}));

import { deployInstalledAgentVoiceAssistant } from "./deploy";

const BUSINESS_ID = "business-1";
const PROVISIONING_AGENT_ID = "agent-provisioning";

function businessWithProvisioningVoiceAgent() {
  return {
    id: BUSINESS_ID,
    name: "Example Dental",
    type: "dental",
    profile: {
      vapiAssistantId: null,
      services: [],
      faqsJson: [],
      hoursJson: [],
      escalationRules: null,
      calendarId: "primary",
      teamPhone: null,
      bookingUrl: null,
      serviceArea: null
    },
    knowledgeBases: [],
    installedAgents: [
      {
        id: PROVISIONING_AGENT_ID,
        status: "PROVISIONING",
        configJson: {
          assistantName: "Sana",
          businessDetails: {
            businessName: "Example Dental",
            businessType: "dental",
            services: []
          }
        },
        workflow: {
          workflowJson: {
            nodes: [
              { id: "trigger", data: { type: VOICE_NODE_TYPES.phoneCallTrigger } },
              {
                id: "voice",
                data: {
                  type: VOICE_NODE_TYPES.voiceConversation,
                  model: "gpt-4o-mini",
                  systemPrompt: "Help callers book an appointment."
                }
              },
              { id: "end", data: { type: VOICE_NODE_TYPES.endFlow } }
            ],
            edges: [
              { source: "trigger", target: "voice" },
              { source: "voice", target: "end" }
            ]
          }
        }
      }
    ]
  };
}

describe("deployInstalledAgentVoiceAssistant target selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isVapiConfigured.mockReturnValue(true);
    mocks.findBusiness.mockResolvedValue(businessWithProvisioningVoiceAgent());
    mocks.deployVapiAssistant.mockResolvedValue({ id: "assistant-1", created: true });
    mocks.updateProfile.mockResolvedValue({});
    mocks.createProfile.mockResolvedValue({});
  });

  it("loads the exact PROVISIONING agent requested by business setup", async () => {
    const result = await deployInstalledAgentVoiceAssistant(BUSINESS_ID, PROVISIONING_AGENT_ID);

    expect(mocks.findBusiness).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: BUSINESS_ID },
        include: expect.objectContaining({
          installedAgents: expect.objectContaining({
            where: { id: PROVISIONING_AGENT_ID }
          })
        })
      })
    );
    expect(mocks.deployVapiAssistant).toHaveBeenCalledOnce();
    expect(result).toEqual({ assistantId: "assistant-1", created: true });
  });

  it("keeps latest-ACTIVE selection when no exact agent is supplied", async () => {
    await deployInstalledAgentVoiceAssistant(BUSINESS_ID);

    expect(mocks.findBusiness).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          installedAgents: expect.objectContaining({
            where: { status: "ACTIVE" }
          })
        })
      })
    );
  });
});
