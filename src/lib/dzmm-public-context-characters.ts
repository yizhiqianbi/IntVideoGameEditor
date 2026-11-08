import dataset from "./dzmm-public-context-2026-10-15.json";
import metadata from "./dzmm-public-context-metadata.json";

type ContextRecord = {
  id: string | number;
  description?: string;
  firstMessage?: string;
};

const records = dataset.characters as ContextRecord[];
if (
  records.length !== metadata.characters.length ||
  records.some((record, index) => String(record.id) !== metadata.characters[index]?.id)
) {
  throw new Error("公开语境清单与正文不一致。");
}

const collapsed = (value: string | undefined) => String(value ?? "").replace(/\s+/g, " ").trim();

export const DZMM_PUBLIC_CONTEXT_BY_ID = new Map(
  records.map((record) => {
    const description = String(record.description ?? "");
    const firstMessage = String(record.firstMessage ?? "");
    const shelf = metadata.characters.find((item) => item.id === String(record.id));
    const descriptionShelf = collapsed(record.description);
    const firstMessageShelf = collapsed(record.firstMessage);
    const deferred =
      descriptionShelf.length > (shelf?.shelfDescription.length ?? 0) ||
      firstMessageShelf.length > (shelf?.shelfFirstMessage.length ?? 0);
    if (!shelf || shelf.contextDeferred !== deferred) throw new Error("公开语境摘要与正文不一致。");
    return [String(record.id), { description, firstMessage }] as const;
  }),
);

export function dzmmPublicContextText(id: string) {
  return DZMM_PUBLIC_CONTEXT_BY_ID.get(id) ?? null;
}
