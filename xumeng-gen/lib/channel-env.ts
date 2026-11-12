import type { AiapiCredentials } from "./aiapi-channel";

export function channelCredentials(): AiapiCredentials {
  return {
    baseUrl: process.env.AIAPI_BASE_URL,
    apiKey: process.env.AIAPI_APIKEY,
    secretKey: process.env.AIAPI_SECRETKEY,
  };
}

export function adultAsk(prompt: string): string {
  const text = prompt.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 1200);
  return `${text}。虚构的成年角色，二十一岁以上。`.slice(0, 2000);
}
