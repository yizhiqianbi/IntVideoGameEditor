export type VideoProviderId = "doubao" | "minimax" | "vidu" | "kling";

export type GenerationProviderSelection = VideoProviderId | "auto";

export type VideoGenerationMode = "text-to-video" | "image-to-video";

export type AspectRatio = "16:9" | "9:16" | "1:1";

export type VideoResolution = "720p" | "1080p";

export type GenerationTaskStatus =
  | "idle"
  | "queued"
  | "processing"
  | "succeeded"
  | "failed";

export type ProviderCredentialState = {
  doubao: {
    apiKey: string;
  };
  minimax: {
    apiKey: string;
  };
  vidu: {
    apiKey: string;
  };
  kling: {
    accessKey: string;
    secretKey: string;
  };
};

export type UnifiedVideoGenerationRequest = {
  prompt: string;
  mode: VideoGenerationMode;
  aspectRatio: AspectRatio;
  durationSec: number;
  resolution: VideoResolution;
  model?: string;
  firstFrameImage?: string;
  lastFrameImage?: string;
  referenceImages: string[];
};

export type UnifiedVideoCreateResponse = {
  providerId: VideoProviderId;
  taskId: string;
  status: GenerationTaskStatus;
  rawStatus?: string;
  videoUrl?: string;
  coverUrl?: string;
  errorMessage?: string;
};

export type UnifiedVideoStatusResponse = {
  providerId: VideoProviderId;
  taskId: string;
  status: GenerationTaskStatus;
  rawStatus?: string;
  videoUrl?: string;
  coverUrl?: string;
  errorMessage?: string;
};

export type NodeGenerationConfig = {
  providerId: GenerationProviderSelection;
  mode: VideoGenerationMode;
  model: string;
  aspectRatio: AspectRatio;
  durationSec: number;
  resolution: VideoResolution;
  promptOverride: string;
  referenceCharacterIds: string[];
};

export type CredentialField = {
  key: string;
  label: string;
  placeholder: string;
  secret?: boolean;
};

export type ProviderDefinition = {
  id: VideoProviderId;
  label: string;
  vendor: string;
  videoModel: string;
  imageModel?: string;
  docsUrl: string;
  description: string;
  credentialFields: CredentialField[];
};

export const DEFAULT_PROVIDER_PRIORITY: VideoProviderId[] = [
  "doubao",
];

export const DEFAULT_PROVIDER_CREDENTIALS: ProviderCredentialState = {
  doubao: {
    apiKey: "",
  },
  minimax: {
    apiKey: "",
  },
  vidu: {
    apiKey: "",
  },
  kling: {
    accessKey: "",
    secretKey: "",
  },
};

export const PROVIDER_DEFINITIONS: Record<VideoProviderId, ProviderDefinition> = {
  doubao: {
    id: "doubao",
    label: "火山引擎 / 豆包",
    vendor: "火山方舟 ModelArk",
    videoModel: "doubao-seedance-1-0-pro-fast-251015",
    imageModel: "doubao-seedream-4-5-250821",
    docsUrl: "https://www.volcengine.com/docs/82379/1520757",
    description:
      "当前唯一支持的生成引擎。视频默认走火山方舟 Seedance 1.0 Pro Fast（Lite 版本），参考图相关能力按 Seedream 4.5 组织。",
    credentialFields: [
      {
        key: "apiKey",
        label: "API Key",
        placeholder: "输入火山引擎方舟 API Key",
        secret: true,
      },
    ],
  },
  minimax: {
    id: "minimax",
    label: "MiniMax",
    vendor: "MiniMax API",
    videoModel: "MiniMax-Hailuo-2.3",
    docsUrl: "https://platform.minimax.io/docs/api-reference/video-generation-intro",
    description:
      "第二优先。适合参考图、首尾帧和主体一致性场景，接口文档完整。",
    credentialFields: [
      {
        key: "apiKey",
        label: "API Key",
        placeholder: "输入 MiniMax API Key",
        secret: true,
      },
    ],
  },
  vidu: {
    id: "vidu",
    label: "Vidu",
    vendor: "Vidu API",
    videoModel: "viduq1",
    docsUrl: "https://docs.platform.vidu.com/",
    description:
      "第三优先。多图参考和参考图生视频能力清晰，适合角色一致性短剧。",
    credentialFields: [
      {
        key: "apiKey",
        label: "API Key",
        placeholder: "输入 Vidu API Key",
        secret: true,
      },
    ],
  },
  kling: {
    id: "kling",
    label: "Kling",
    vendor: "Kling AI",
    videoModel: "kling-v2-6",
    docsUrl:
      "https://docs.qingque.cn/d/home/eZQAyImcbaS0fz-8ANjXvU5ed",
    description:
      "第四优先。偏镜头控制和多图参考，鉴权是 Access Key + Secret Key。",
    credentialFields: [
      {
        key: "accessKey",
        label: "Access Key",
        placeholder: "输入 Kling Access Key",
        secret: true,
      },
      {
        key: "secretKey",
        label: "Secret Key",
        placeholder: "输入 Kling Secret Key",
        secret: true,
      },
    ],
  },
};

export const DEFAULT_GENERATION_CONFIG: NodeGenerationConfig = {
  providerId: "auto",
  mode: "image-to-video",
  model: "",
  aspectRatio: "16:9",
  durationSec: 5,
  resolution: "1080p",
  promptOverride: "",
  referenceCharacterIds: [],
};

export function getProviderDefinition(providerId: VideoProviderId) {
  return PROVIDER_DEFINITIONS[providerId];
}

export function getProviderDefaultModel(
  providerId: VideoProviderId,
  mode: VideoGenerationMode,
) {
  if (providerId === "doubao") {
    return "doubao-seedance-1-0-pro-fast-251015";
  }

  if (providerId === "minimax") {
    if (mode === "image-to-video") {
      return "MiniMax-Hailuo-2.3-Fast";
    }

    return "MiniMax-Hailuo-2.3";
  }

  if (providerId === "vidu") {
    return "viduq1";
  }

  return "kling-v2-6";
}

export function isCredentialConfigured(
  providerId: VideoProviderId,
  credentials: ProviderCredentialState,
) {
  const providerCredentials = credentials[providerId];

  return Object.values(providerCredentials).every(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
}

export function getConfiguredProviderPriority(
  credentials: ProviderCredentialState,
  priority = DEFAULT_PROVIDER_PRIORITY,
) {
  return priority.filter((providerId) =>
    isCredentialConfigured(providerId, credentials),
  );
}
