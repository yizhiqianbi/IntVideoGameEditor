export * from "./types";
export * from "./templates";
export * from "./skills";
export * from "./prompts";
export * from "./mock-adapter";

import {
  PLAY_AGENT_TEMPLATES,
  getPlayAgentTemplateById,
  listPlayAgentTemplates,
} from "./templates";
import {
  PLAY_AGENT_SKILLS,
  getPlayAgentSkillById,
  listPlayAgentSkills,
} from "./skills";
import { buildPlayAgentPlanInput, composePlayAgentPrompt } from "./prompts";
import { MOCK_PLAY_AGENT_ADAPTER, runMockPlayAgent } from "./mock-adapter";

const playAgentModule = {
  PLAY_AGENT_TEMPLATES,
  PLAY_AGENT_SKILLS,
  listPlayAgentTemplates,
  getPlayAgentTemplateById,
  listPlayAgentSkills,
  getPlayAgentSkillById,
  buildPlayAgentPlanInput,
  composePlayAgentPrompt,
  MOCK_PLAY_AGENT_ADAPTER,
  runMockPlayAgent,
};

export default playAgentModule;
