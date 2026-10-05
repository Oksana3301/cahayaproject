import type { RuntimeClientLike } from "@/lib/runtime/types";
import { removeSkillViaGatewayAgent } from "@/lib/skills/remove-gateway";
import type { SkillRemoveRequest, SkillRemoveResult } from "@/lib/skills/types";

const normalizeRequired = (value: string, field: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${field} is required.`);
  }
  return trimmed;
};

export const removeSkillFromGateway = async (
  params: { client: RuntimeClientLike } & SkillRemoveRequest
): Promise<SkillRemoveResult> => {
  const payload: SkillRemoveRequest = {
    skillKey: normalizeRequired(params.skillKey, "skillKey"),
    source: params.source,
    baseDir: normalizeRequired(params.baseDir, "baseDir"),
    workspaceDir: normalizeRequired(params.workspaceDir, "workspaceDir"),
    managedSkillsDir: normalizeRequired(params.managedSkillsDir, "managedSkillsDir"),
  };
  return removeSkillViaGatewayAgent({
    client: params.client,
    request: payload,
  });
};
