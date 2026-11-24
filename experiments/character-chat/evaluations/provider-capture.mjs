import { createHash } from 'node:crypto';

// Preserve every model call while keeping the historical step.rawContent alias
// exclusively for the visible Replyer output. Planner JSON is never a reply.
export async function captureProviderCall({ report, step, url, request, fetch, save }) {
  const requestBody = JSON.parse(request.body);
  const title = new Headers(request.headers).get('X-Title') ?? '';
  const stage = title === 'XUMENG Companion Planner' ? 'planner' : 'replyer';
  const call = { stage, requestBody, startedAt: new Date().toISOString(),
    promptSha256: createHash('sha256').update(JSON.stringify(requestBody.messages)).digest('hex') };
  (step.calls ??= []).push(call);
  report.actualCalls += 1;
  report.callsByStage ??= { planner: 0, replyer: 0 };
  report.callsByStage[stage] += 1;
  report.parametersByStage ??= {};
  report.parametersByStage[stage] ??= Object.fromEntries(Object.entries(requestBody).filter(([key]) => !['model', 'messages'].includes(key)));
  if (stage === 'replyer') {
    step.requestBody = requestBody;
    step.promptSha256 = call.promptSha256;
    report.parameters ??= report.parametersByStage.replyer;
  }
  await save();
  const start = performance.now();
  try {
    const response = await fetch(url, request);
    call.httpStatus = response.status;
    if (stage === 'replyer') step.httpStatus = response.status;
    if (response.ok) {
      try {
        const data = await response.clone().json();
        call.rawContent = data.choices?.[0]?.message?.content ?? null;
        call.usage = data.usage ?? null;
        call.finishReason = data.choices?.[0]?.finish_reason ?? null;
        if (stage === 'replyer') {
          step.rawContent = call.rawContent;
          step.usage = call.usage;
          step.finishReason = call.finishReason;
        }
      } catch { /* Production provider validates malformed transport/output. */ }
    }
    return response;
  } catch (error) {
    call.transportFailed = true;
    throw error;
  } finally {
    call.latencyMs = Math.round(performance.now() - start);
    await save();
  }
}
